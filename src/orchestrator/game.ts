// Game actions used by the Discord commands (and, later, by the mobile app).
// Each GM call runs inside store.update, so actions on the same channel are handled one at a time.
import type { GenerateInput, GenerateResult } from '../llm/client.ts';
import {
  OPEN_SCENE_INSTRUCTION,
  RESUME_SESSION_INSTRUCTION,
  SECRETS_PROMPT,
  SUMMARY_PROMPT,
} from '../llm/prompts.ts';
import { buildAttributes, describeCheck, rollCheck, type Attribute, type Attributes, type CheckResult } from '../rules/checks.ts';
import { describeRoll, rollDice, type RollResult, type Rng } from '../rules/dice.ts';
import {
  addParticipant,
  appendHistory,
  characterAttributes,
  charactersAtTable,
  createCampaign,
  currentSession,
  endSession,
  lastSummary,
  recordSetupUsage,
  recordUsage,
  sessionHistory,
  setCharacter,
  setSecrets,
  startSession,
  type Campaign,
  type Character,
  type TokenUsage,
} from '../state/campaign.ts';
import type { CampaignStore } from '../state/store.ts';
import { buildContext, formatEntry } from './context.ts';
import { parseCallToAction, type CallToAction } from './call-to-action.ts';
import { campaignStatus, type CampaignStatus } from './status.ts';

export type Generate = (input: GenerateInput) => Promise<GenerateResult>;

/** Error whose message is meant for the player (pt-BR). Anything else is an internal error. */
export class GameError extends Error {}

/** What the GM said (without its closing line) and whose turn it is or which check it asked for. */
export interface Narration {
  text: string;
  callToAction: CallToAction | null;
}

export type StartSessionResult =
  | { status: 'started'; characters: Character[]; narration: Narration }
  | { status: 'missing-characters'; userIds: string[] };

export interface GameDeps {
  store: CampaignStore;
  generate: Generate;
  rng?: Rng;
}

export function createGame({ store, generate, rng = Math.random }: GameDeps) {
  /** Calls the LLM with the current context, records its narration and token usage. */
  async function narrate(campaign: Campaign, instruction?: string): Promise<{ campaign: Campaign; narration: Narration }> {
    const { text, usage } = await generate(buildContext(campaign, instruction));
    let updated = appendHistory(campaign, { role: 'gm', text });
    updated = recordUsage(updated, usage);
    // History keeps the raw text (with the closing line) so the GM keeps seeing its own format.
    const { narration, callToAction } = parseCallToAction(text, charactersAtTable(updated));
    return { campaign: updated, narration: { text: narration, callToAction } };
  }

  /**
   * Runs `play` on the channel's campaign, requiring an ongoing session and the player's character.
   * A player who was not at the table when the session started joins it here.
   */
  async function withPlayer<T>(
    channelId: string,
    userId: string,
    play: (campaign: Campaign) => Promise<{ campaign: Campaign; result: T }>,
  ): Promise<T> {
    let result!: T;
    await store.update(channelId, async (current) => {
      const campaign = requireCampaign(current);
      requireSession(campaign);
      if (!campaign.characters[userId]) {
        throw new GameError('Você ainda não tem personagem. Use /personagem criar.');
      }
      const outcome = await play(addParticipant(campaign, userId));
      result = outcome.result;
      return outcome.campaign;
    });
    return result;
  }

  return {
    /** Creates the campaign and its GM secrets. The first scene only opens on startSession. */
    async newCampaign(channelId: string, input: { setting: string; tone: string; hook: string }): Promise<void> {
      await store.update(channelId, async (current) => {
        if (current) {
          throw new GameError('Este canal já tem uma campanha.');
        }
        const secrets = await generate({
          system: SECRETS_PROMPT,
          messages: [
            { role: 'user', content: `Cenário: ${input.setting}\nTom: ${input.tone}\nGancho: ${input.hook}` },
          ],
        });
        return recordSetupUsage(setSecrets(createCampaign(channelId, input), secrets.text), secrets.usage);
      });
    },

    /** What players may see about the channel's campaign (no GM secrets), or null if there is none. */
    async getStatus(channelId: string): Promise<CampaignStatus | null> {
      const campaign = await store.load(channelId);
      return campaign ? campaignStatus(campaign) : null;
    },

    /** Status of every active campaign. */
    async listCampaigns(): Promise<CampaignStatus[]> {
      return (await store.list()).map(campaignStatus);
    },

    /** Archives the channel's campaign so a new one can start. An ongoing session is archived as is. */
    async endCampaign(channelId: string): Promise<void> {
      if (!(await store.archive(channelId))) {
        throw new GameError('Este canal não tem campanha para encerrar.');
      }
    },

    async createCharacter(
      channelId: string,
      userId: string,
      input: { name: string; concept: string; profile: { strong: Attribute; good: Attribute; weak: Attribute } },
    ): Promise<Character> {
      let attributes: Attributes;
      try {
        attributes = buildAttributes(input.profile);
      } catch (error) {
        throw new GameError((error as Error).message);
      }
      const character: Character = { userId, name: input.name, concept: input.concept, attributes };
      await store.update(channelId, (current) => setCharacter(requireCampaign(current), character));
      return character;
    },

    async getCharacter(channelId: string, userId: string): Promise<Character | null> {
      const campaign = await store.load(channelId);
      return campaign?.characters[userId] ?? null;
    },

    playerAction(channelId: string, userId: string, text: string): Promise<Narration> {
      return withPlayer(channelId, userId, async (campaign) => {
        const withAction = appendHistory(campaign, { role: 'player', userId, text });
        const { campaign: updated, narration } = await narrate(withAction);
        return { campaign: updated, result: narration };
      });
    },

    playerRoll(channelId: string, userId: string, expression: string): Promise<{ roll: RollResult; narration: Narration }> {
      return withPlayer(channelId, userId, async (campaign) => {
        let roll: RollResult;
        try {
          roll = rollDice(expression, rng);
        } catch (error) {
          throw new GameError((error as Error).message);
        }
        const withRoll = appendHistory(campaign, { role: 'roll', userId, text: describeRoll(roll) });
        const { campaign: updated, narration } = await narrate(withRoll);
        return { campaign: updated, result: { roll, narration } };
      });
    },

    /**
     * Starts a session with the players at the table. If any of them has no character yet,
     * nothing changes and their userIds are returned so they can create one first.
     */
    /** Check asked for by the GM: the code rolls 1d20 + attribute, compares and grades; the GM narrates the verdict. */
    playerCheck(
      channelId: string,
      userId: string,
      attribute: Attribute,
      difficulty: number,
    ): Promise<{ check: CheckResult; narration: Narration }> {
      return withPlayer(channelId, userId, async (campaign) => {
        const modifier = characterAttributes(campaign.characters[userId]!)[attribute];
        const check = rollCheck(attribute, modifier, difficulty, rng);
        const withCheck = appendHistory(campaign, { role: 'check', userId, text: describeCheck(check) });
        const { campaign: updated, narration } = await narrate(withCheck);
        return { campaign: updated, result: { check, narration } };
      });
    },

    async startSession(channelId: string, playerIds: string[]): Promise<StartSessionResult> {
      let result!: StartSessionResult;
      await store.update(channelId, async (current) => {
        const campaign = requireCampaign(current);
        if (currentSession(campaign)) {
          throw new GameError('Já existe uma sessão em andamento. Use /sessao encerrar antes.');
        }
        if (playerIds.length === 0) {
          throw new GameError('Não há ninguém na mesa.');
        }
        const missing = playerIds.filter((id) => !campaign.characters[id]);
        if (missing.length) {
          result = { status: 'missing-characters', userIds: missing };
          return campaign;
        }

        const isFirstSession = campaign.sessions.length === 0;
        const { campaign: updated, narration } = await narrate(
          startSession(campaign, playerIds),
          isFirstSession ? OPEN_SCENE_INSTRUCTION : RESUME_SESSION_INSTRUCTION,
        );
        const characters = playerIds.map((id) => campaign.characters[id]!);
        result = { status: 'started', characters, narration };
        return updated;
      });
      return result;
    },

    async endSession(channelId: string): Promise<{ summary: string; usage: TokenUsage }> {
      let result!: { summary: string; usage: TokenUsage };
      await store.update(channelId, async (current) => {
        const campaign = requireCampaign(current);
        requireSession(campaign);

        const previous = lastSummary(campaign);
        const transcript = sessionHistory(campaign).map((entry) => formatEntry(campaign, entry)).join('\n\n');
        const { text: summary, usage } = await generate({
          system: SUMMARY_PROMPT,
          messages: [
            {
              role: 'user',
              content: `${previous ? `Resumo da sessão anterior:\n${previous}\n\n` : ''}Sessão de hoje:\n${transcript || '(nada aconteceu)'}`,
            },
          ],
        });

        const ended = endSession(recordUsage(campaign, usage), summary);
        result = { summary, usage: ended.sessions.at(-1)!.usage };
        return ended;
      });
      return result;
    },
  };
}

export type Game = ReturnType<typeof createGame>;

function requireCampaign(campaign: Campaign | null): Campaign {
  if (!campaign) {
    throw new GameError('Este canal ainda não tem campanha. Use /campanha nova.');
  }
  return campaign;
}

function requireSession(campaign: Campaign) {
  const session = currentSession(campaign);
  if (!session) {
    throw new GameError('Não há sessão em andamento. Use /sessao iniciar.');
  }
  return session;
}
