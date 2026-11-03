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
  usage: TokenUsage;
}

export interface Campaign {
  channelId: string;
  setting: string;
  tone: string;
  hook: string;
  createdAt: string;
  characters: Record<string, Character>; // key: Discord userId
  history: HistoryEntry[]; // recent entries only; long-term memory lives in session summaries
  sessions: Session[];
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
    sessions: [newSession(1, now)],
  };
}

function newSession(number: number, now: Date): Session {
  return { number, startedAt: now.toISOString(), usage: { inputTokens: 0, outputTokens: 0, calls: 0 } };
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

/** Summary of the last ended session, used to resume the story. */
export function lastSummary(campaign: Campaign): string | undefined {
  return campaign.sessions.findLast((s) => s.summary)?.summary;
}

export function startSession(campaign: Campaign, now = new Date()): Campaign {
  if (currentSession(campaign)) {
    throw new Error('Já existe uma sessão em andamento.');
  }
  const number = (campaign.sessions.at(-1)?.number ?? 0) + 1;
  return { ...campaign, sessions: [...campaign.sessions, newSession(number, now)] };
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
  return replaceCurrentSession(campaign, {
    ...session,
    usage: {
      inputTokens: session.usage.inputTokens + usage.inputTokens,
      outputTokens: session.usage.outputTokens + usage.outputTokens,
      calls: session.usage.calls + 1,
    },
  });
}

function replaceCurrentSession(campaign: Campaign, session: Session): Campaign {
  return { ...campaign, sessions: [...campaign.sessions.slice(0, -1), session] };
}
