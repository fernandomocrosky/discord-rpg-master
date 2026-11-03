// Game actions used by the Discord commands (and, later, by the mobile app).
// Each GM call runs inside store.update, so actions on the same channel are handled one at a time.
import type { GenerateInput, GenerateResult } from '../llm/client.ts';
import {
  OPEN_SCENE_INSTRUCTION,
  RESUME_SESSION_INSTRUCTION,
  SECRETS_PROMPT,
  SUMMARY_PROMPT,
} from '../llm/prompts.ts';
import { describeRoll, rollDice, type RollResult, type Rng } from '../rules/dice.ts';
import {
  appendHistory,
  createCampaign,
  currentSession,
  endSession,
  lastSummary,
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

export type Generate = (input: GenerateInput) => Promise<GenerateResult>;

/** Error whose message is meant for the player (pt-BR). Anything else is an internal error. */
export class GameError extends Error {}

export interface GameDeps {
  store: CampaignStore;
  generate: Generate;
  rng?: Rng;
}

export function createGame({ store, generate, rng = Math.random }: GameDeps) {
  /** Calls the LLM with the current context, records its narration and token usage. */
  async function narrate(campaign: Campaign, instruction?: string): Promise<{ campaign: Campaign; text: string }> {
    const { text, usage } = await generate(buildContext(campaign, instruction));
    let updated = appendHistory(campaign, { role: 'gm', text });
    updated = recordUsage(updated, usage);
    return { campaign: updated, text };
  }

  /** Runs `play` on the channel's campaign, requiring an ongoing session and the player's character. */
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
      const outcome = await play(campaign);
      result = outcome.result;
      return outcome.campaign;
    });
    return result;
  }

  return {
    async newCampaign(channelId: string, input: { setting: string; tone: string; hook: string }): Promise<string> {
      let narration = '';
      await store.update(channelId, async (current) => {
        if (current) {
          throw new GameError('Este canal já tem uma campanha.');
        }
        let campaign = createCampaign(channelId, input);

        const secrets = await generate({
          system: SECRETS_PROMPT,
          messages: [
            { role: 'user', content: `Cenário: ${input.setting}\nTom: ${input.tone}\nGancho: ${input.hook}` },
          ],
        });
        campaign = recordUsage(setSecrets(campaign, secrets.text), secrets.usage);

        const opened = await narrate(campaign, OPEN_SCENE_INSTRUCTION);
        narration = opened.text;
        return opened.campaign;
      });
      return narration;
    },

    async createCharacter(channelId: string, userId: string, input: { name: string; concept: string }): Promise<Character> {
      const character: Character = { userId, ...input };
      await store.update(channelId, (current) => setCharacter(requireCampaign(current), character));
      return character;
    },

    async getCharacter(channelId: string, userId: string): Promise<Character | null> {
      const campaign = await store.load(channelId);
      return campaign?.characters[userId] ?? null;
    },

    playerAction(channelId: string, userId: string, text: string): Promise<string> {
      return withPlayer(channelId, userId, async (campaign) => {
        const withAction = appendHistory(campaign, { role: 'player', userId, text });
        const { campaign: updated, text: narration } = await narrate(withAction);
        return { campaign: updated, result: narration };
      });
    },

    playerRoll(channelId: string, userId: string, expression: string): Promise<{ roll: RollResult; narration: string }> {
      return withPlayer(channelId, userId, async (campaign) => {
        let roll: RollResult;
        try {
          roll = rollDice(expression, rng);
        } catch (error) {
          throw new GameError((error as Error).message);
        }
        const withRoll = appendHistory(campaign, { role: 'roll', userId, text: describeRoll(roll) });
        const { campaign: updated, text: narration } = await narrate(withRoll);
        return { campaign: updated, result: { roll, narration } };
      });
    },

    async startSession(channelId: string): Promise<string> {
      let narration = '';
      await store.update(channelId, async (current) => {
        const campaign = requireCampaign(current);
        if (currentSession(campaign)) {
          throw new GameError('Já existe uma sessão em andamento. Use /sessao encerrar antes.');
        }
        const resumed = await narrate(startSession(campaign), RESUME_SESSION_INSTRUCTION);
        narration = resumed.text;
        return resumed.campaign;
      });
      return narration;
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
