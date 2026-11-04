// What players may see about a campaign. Built here, not in commands, so GM secrets never leave the orchestrator.
import {
  charactersAtTable,
  lastSummary,
  totalUsage,
  type Campaign,
  type Character,
  type TokenUsage,
} from '../state/campaign.ts';

export interface CampaignStatus {
  channelId: string;
  setting: string;
  tone: string;
  hook: string;
  createdAt: string;
  /** Latest session (ongoing or ended), or null before the first one. */
  session: { number: number; ongoing: boolean; startedAt: string; endedAt?: string } | null;
  atTable: Character[];
  otherCharacters: Character[];
  lastSummary?: string;
  usage: { session?: TokenUsage; total: TokenUsage };
}

export function campaignStatus(campaign: Campaign): CampaignStatus {
  const latest = campaign.sessions.at(-1);
  const atTable = charactersAtTable(campaign);
  const summary = lastSummary(campaign);
  return {
    channelId: campaign.channelId,
    setting: campaign.setting,
    tone: campaign.tone,
    hook: campaign.hook,
    createdAt: campaign.createdAt,
    session: latest
      ? {
          number: latest.number,
          ongoing: !latest.endedAt,
          startedAt: latest.startedAt,
          ...(latest.endedAt ? { endedAt: latest.endedAt } : {}),
        }
      : null,
    atTable,
    otherCharacters: Object.values(campaign.characters).filter((c) => !atTable.includes(c)),
    ...(summary ? { lastSummary: summary } : {}),
    usage: {
      ...(latest && !latest.endedAt ? { session: latest.usage } : {}),
      total: totalUsage(campaign),
    },
  };
}
