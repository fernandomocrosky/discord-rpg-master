// Campaign model and pure functions to change it. Knows nothing about Discord or where state is stored.

export interface Character {
  userId: string;
  name: string;
  concept: string;
}

export type HistoryRole = 'player' | 'roll' | 'gm';

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

export interface Session {
  number: number;
  startedAt: string;
  endedAt?: string;
  summary?: string;
  participants: string[]; // userIds of the players at the table this session
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
export const MAX_STORED_HISTORY = 50;

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
