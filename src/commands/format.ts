// Discord-side formatting of game data shared by several commands.
import { ATTRIBUTES, ATTRIBUTE_LABELS, formatModifier } from '../rules/checks.ts';
import { characterAttributes, type Character } from '../state/campaign.ts';

/** e.g. "Força +0 · Agilidade +2 · Mente +1 · Presença -1" */
export function attributeLine(character: Character): string {
  const attributes = characterAttributes(character);
  return ATTRIBUTES.map((a) => `${ATTRIBUTE_LABELS[a]} ${formatModifier(attributes[a])}`).join(' · ');
}
