// Builds what the LLM sees on each call: GM prompt + campaign facts + a short window of recent history.
import type Anthropic from '@anthropic-ai/sdk';
import { CONTINUE_PLACEHOLDER, GM_SYSTEM_PROMPT } from '../llm/prompts.ts';
import { ATTRIBUTES, ATTRIBUTE_LABELS, formatModifier } from '../rules/checks.ts';
import { characterAttributes, charactersAtTable, lastSummary, type Campaign, type Character, type HistoryEntry } from '../state/campaign.ts';

/** How many recent history entries go into the prompt. */
export const HISTORY_WINDOW = 12;

export interface LlmContext {
  system: string;
  messages: Anthropic.MessageParam[];
}

/**
 * @param instruction extra user turn for when the GM speaks unprompted (opening a scene, resuming a session).
 */
export function buildContext(campaign: Campaign, instruction?: string): LlmContext {
  const messages: Anthropic.MessageParam[] = campaign.history
    .slice(-HISTORY_WINDOW)
    .map((entry) => toMessage(campaign, entry));
  if (instruction) {
    messages.push({ role: 'user', content: instruction });
  }

  // The API requires the first message to be from the user.
  if (messages[0]?.role !== 'user') {
    messages.unshift({ role: 'user', content: CONTINUE_PLACEHOLDER });
  }
  // The last message must also be from the user (no assistant prefill on current models).
  if (messages.at(-1)?.role !== 'user') {
    throw new Error('Context must end with a user message: nothing for the GM to respond to.');
  }

  return { system: `${GM_SYSTEM_PROMPT}\n\n${campaignBlock(campaign)}`, messages };
}

function campaignBlock(campaign: Campaign): string {
  // Only characters whose players are at the table take part in the scene.
  const atTable = charactersAtTable(campaign);
  const absent = Object.values(campaign.characters).filter((c) => !atTable.includes(c));
  const describe = (list: Character[]) => list.map(describeCharacter).join('; ');

  const lines = [
    'Campanha:',
    `- Cenário: ${campaign.setting}`,
    `- Tom: ${campaign.tone}`,
    `- Gancho: ${campaign.hook}`,
    '',
    `Personagens na mesa: ${atTable.length ? describe(atTable) : 'nenhum'}`,
  ];
  if (absent.length) {
    lines.push(`Personagens ausentes nesta sessão (não aparecem na cena): ${describe(absent)}`);
  }
  const summary = lastSummary(campaign);
  if (summary) {
    lines.push('', `Resumo da sessão anterior:\n${summary}`);
  }
  if (campaign.secrets) {
    lines.push('', `Segredos do mestre (nunca revele diretamente):\n${campaign.secrets}`);
  }
  return lines.join('\n');
}

/** e.g. "Lia (pescadora curiosa; Força +0, Agilidade +2, Mente +1, Presença -1)". */
function describeCharacter(character: Character): string {
  const attributes = characterAttributes(character);
  const stats = ATTRIBUTES.map((a) => `${ATTRIBUTE_LABELS[a]} ${formatModifier(attributes[a])}`).join(', ');
  return `${character.name} (${character.concept}; ${stats})`;
}

/** Turns a history entry into text, e.g. "Lia: abro a porta" or "Lia rolou 1d20+2 = 17 (15 + 2)". */
export function formatEntry(campaign: Campaign, entry: HistoryEntry): string {
  const name = (entry.userId && campaign.characters[entry.userId]?.name) || 'Jogador';
  switch (entry.role) {
    case 'player':
      return `${name}: ${entry.text}`;
    case 'roll':
      return `${name} rolou ${entry.text}`;
    case 'check':
      return `${name} fez ${entry.text}`;
    case 'gm':
      return entry.text;
  }
}

function toMessage(campaign: Campaign, entry: HistoryEntry): Anthropic.MessageParam {
  return { role: entry.role === 'gm' ? 'assistant' : 'user', content: formatEntry(campaign, entry) };
}
