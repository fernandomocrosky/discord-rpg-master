// Campaign model and pure functions to change it. Knows nothing about Discord or where state is stored.
import { NEUTRAL_ATTRIBUTES, type Attribute, type Attributes } from '../rules/checks.ts';

export interface Character {
  userId: string;
  name: string;
  concept: string;
  attributes?: Attributes; // absent on characters created before attributes existed
}

/** The character's attributes; older characters without them count as +0 everywhere. */
export function characterAttributes(character: Character): Attributes {
  return character.attributes ?? NEUTRAL_ATTRIBUTES;
}

export type HistoryRole = 'player' | 'roll' | 'check' | 'gm';

export interface HistoryEntry {
  role: HistoryRole;
  userId?: string; // absent for GM entries
  text: string;
  at: string; // ISO 8601
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  calls: number;
}

/** A check the GM asked for and the player has not rolled yet. */
export interface PendingCheck {
  attribute: Attribute;
  difficulty: number;
  goal?: string;
}

/** Something a player declared in the open round, waiting for the GM's single response. */
export interface RoundEntry {
  userId: string;
  role: 'player' | 'roll';
  text: string;
}

export interface Session {
  number: number;
  startedAt: string;
  endedAt?: string;
  summary?: string;
  participants: string[]; // userIds of the players at the table this session
  pendingChecks?: Record<string, PendingCheck>; // key: userId; at most one per character
  round?: RoundEntry[]; // declared since the GM last spoke
  roundDeadline?: string; // ISO 8601; when the open round or the pending checks stop waiting
  usage: TokenUsage;
}

export interface Campaign {
  channelId: string;
  setting: string;
  tone: string;
  hook: string;
  secrets?: string; // GM-only notes (hidden truth, NPC agendas, advancing threat); never shown to players
  createdAt: string;
  characters: Record<string, Character>; // key: Discord userId
  history: HistoryEntry[]; // recent entries only; long-term memory lives in session summaries
  sessions: Session[];
  setupUsage: TokenUsage; // tokens spent creating the campaign (secrets), outside any session
}

/** How many history entries are stored. The prompt uses an even smaller window. */
export const MAX_STORED_HISTORY = 500;

export function createCampaign(
  channelId: string,
  input: { setting: string; tone: string; hook: string },
  now = new Date(),
): Campaign {
  return {
    channelId,
    ...input,
    createdAt: now.toISOString(),
    characters: {},
    history: [],
    sessions: [],
    setupUsage: emptyUsage(),
  };
}

function emptyUsage(): TokenUsage {
  return { inputTokens: 0, outputTokens: 0, calls: 0 };
}

function addUsage(total: TokenUsage, usage: { inputTokens: number; outputTokens: number }): TokenUsage {
  return {
    inputTokens: total.inputTokens + usage.inputTokens,
    outputTokens: total.outputTokens + usage.outputTokens,
    calls: total.calls + 1,
  };
}

export function setSecrets(campaign: Campaign, secrets: string): Campaign {
  return { ...campaign, secrets };
}

export function setCharacter(campaign: Campaign, character: Character): Campaign {
  return { ...campaign, characters: { ...campaign.characters, [character.userId]: character } };
}

export function appendHistory(
  campaign: Campaign,
  entry: Omit<HistoryEntry, 'at'>,
  now = new Date(),
): Campaign {
  const history = [...campaign.history, { ...entry, at: now.toISOString() }].slice(-MAX_STORED_HISTORY);
  return { ...campaign, history };
}

/** The ongoing session, or undefined if the last one has ended. */
export function currentSession(campaign: Campaign): Session | undefined {
  const last = campaign.sessions.at(-1);
  return last && !last.endedAt ? last : undefined;
}

/** Characters whose players are at the table in the ongoing session. */
export function charactersAtTable(campaign: Campaign): Character[] {
  const participants = currentSession(campaign)?.participants ?? [];
  return participants.flatMap((id) => campaign.characters[id] ?? []);
}

/** Summary of the last ended session, used to resume the story. */
export function lastSummary(campaign: Campaign): string | undefined {
  return campaign.sessions.findLast((s) => s.summary)?.summary;
}

/** History entries recorded during the ongoing session (empty if there is none). */
export function sessionHistory(campaign: Campaign): HistoryEntry[] {
  const session = currentSession(campaign);
  if (!session) return [];
  return campaign.history.filter((entry) => entry.at >= session.startedAt);
}

/** Checks waiting to be rolled in the ongoing session. */
export function pendingChecks(campaign: Campaign): Record<string, PendingCheck> {
  return currentSession(campaign)?.pendingChecks ?? {};
}

/** Records the character's pending check, replacing any previous one. */
export function setPendingCheck(campaign: Campaign, userId: string, check: PendingCheck): Campaign {
  const session = currentSession(campaign);
  if (!session) {
    throw new Error('Não há sessão em andamento.');
  }
  return replaceCurrentSession(campaign, { ...session, pendingChecks: { ...session.pendingChecks, [userId]: check } });
}

export function clearPendingCheck(campaign: Campaign, userId: string): Campaign {
  const session = currentSession(campaign);
  if (!session?.pendingChecks?.[userId]) return campaign;
  const { [userId]: _resolved, ...rest } = session.pendingChecks;
  return replaceCurrentSession(campaign, { ...session, pendingChecks: rest });
}

export function roundEntries(campaign: Campaign): RoundEntry[] {
  return currentSession(campaign)?.round ?? [];
}

export function roundDeadline(campaign: Campaign): string | undefined {
  return currentSession(campaign)?.roundDeadline;
}

export function setRoundDeadline(campaign: Campaign, deadline: string | undefined): Campaign {
  const session = currentSession(campaign);
  if (!session) {
    throw new Error('Não há sessão em andamento.');
  }
  const { roundDeadline: _previous, ...rest } = session;
  return replaceCurrentSession(campaign, deadline ? { ...rest, roundDeadline: deadline } : rest);
}

/** Adds to the open round. A new action replaces the player's previous one; free rolls add up. */
export function declare(campaign: Campaign, entry: RoundEntry, deadline: string): Campaign {
  const session = currentSession(campaign);
  if (!session) {
    throw new Error('Não há sessão em andamento.');
  }
  const kept = (session.round ?? []).filter((e) => entry.role !== 'player' || e.role !== 'player' || e.userId !== entry.userId);
  return replaceCurrentSession(campaign, {
    ...session,
    round: [...kept, entry],
    roundDeadline: session.roundDeadline ?? deadline,
  });
}

/** Participants who have declared nothing in the open round. */
export function undeclared(campaign: Campaign): string[] {
  const session = currentSession(campaign);
  if (!session) return [];
  return session.participants.filter((id) => !session.round?.some((entry) => entry.userId === id));
}

/** Moves what was declared into the history, closing the round. */
export function flushRound(campaign: Campaign, now = new Date()): Campaign {
  const session = currentSession(campaign);
  if (!session) {
    throw new Error('Não há sessão em andamento.');
  }
  const { round = [], roundDeadline: _deadline, ...rest } = session;
  const closed = replaceCurrentSession(campaign, rest);
  return round.reduce((updated, entry) => appendHistory(updated, entry, now), closed);
}

export function startSession(campaign: Campaign, participants: string[], now = new Date()): Campaign {
  if (currentSession(campaign)) {
    throw new Error('Já existe uma sessão em andamento.');
  }
  const session: Session = {
    number: (campaign.sessions.at(-1)?.number ?? 0) + 1,
    startedAt: now.toISOString(),
    participants: [...new Set(participants)],
    usage: emptyUsage(),
  };
  return { ...campaign, sessions: [...campaign.sessions, session] };
}

/** Adds a late-arriving player to the ongoing session (no-op if already there). */
export function addParticipant(campaign: Campaign, userId: string): Campaign {
  const session = currentSession(campaign);
  if (!session) {
    throw new Error('Não há sessão em andamento.');
  }
  if (session.participants.includes(userId)) return campaign;
  return replaceCurrentSession(campaign, { ...session, participants: [...session.participants, userId] });
}

export function endSession(campaign: Campaign, summary: string, now = new Date()): Campaign {
  const session = currentSession(campaign);
  if (!session) {
    throw new Error('Não há sessão em andamento.');
  }
  return replaceCurrentSession(campaign, { ...session, endedAt: now.toISOString(), summary });
}

/** Adds one LLM call's token usage to the current session. */
export function recordUsage(
  campaign: Campaign,
  usage: { inputTokens: number; outputTokens: number },
): Campaign {
  const session = currentSession(campaign);
  if (!session) {
    throw new Error('Não há sessão em andamento.');
  }
  return replaceCurrentSession(campaign, { ...session, usage: addUsage(session.usage, usage) });
}

/** Tokens spent on the whole campaign: setup plus every session. */
export function totalUsage(campaign: Campaign): TokenUsage {
  return [campaign.setupUsage, ...campaign.sessions.map((s) => s.usage)].reduce((total, usage) => ({
    inputTokens: total.inputTokens + usage.inputTokens,
    outputTokens: total.outputTokens + usage.outputTokens,
    calls: total.calls + usage.calls,
  }));
}

/** Adds token usage spent setting up the campaign, before any session. */
export function recordSetupUsage(
  campaign: Campaign,
  usage: { inputTokens: number; outputTokens: number },
): Campaign {
  return { ...campaign, setupUsage: addUsage(campaign.setupUsage, usage) };
}

function replaceCurrentSession(campaign: Campaign, session: Session): Campaign {
  return { ...campaign, sessions: [...campaign.sessions.slice(0, -1), session] };
}
