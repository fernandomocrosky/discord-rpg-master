// Reads the GM's closing line, which says whose turn it is or asks for a check:
//   "👉 Lia, o pescador está prestes a fugir. O que você faz?"
//   "🎲 Lia, teste de Agilidade para escalar o mastro (dificuldade 15)"
// A check line may go on after the difficulty, usually with what is at stake: "... (dificuldade 15). Se falhar, ela cai."
// Phase 1 replaces this text parsing with a structured (JSON) request from the LLM.
import { characterAttributes, type Character } from '../state/campaign.ts';
import { parseAttribute, type Attribute } from '../rules/checks.ts';

export type CallToAction =
  | { kind: 'turn'; userId: string; characterName: string; prompt: string }
  | {
      kind: 'check';
      userId: string;
      characterName: string;
      attribute: Attribute;
      modifier: number;
      difficulty: number;
      goal?: string;
      stakes?: string;
    };

/** Used when the GM forgets the difficulty: the standard one. It is still shown before the roll. */
export const DEFAULT_DIFFICULTY = 10;

const TURN_LINE = /^👉\s*(.+?),\s*(.+)$/;
const CHECK_LINE = /^🎲\s*(.+?),\s*teste\s+de\s+(\p{L}+)(?:\s+para\s+(.+?))?\s*(?:\(\s*dificuldade\s*(\d+)\s*\)\s*\.?\s*(.*?)\s*|\.?)$/iu;

/**
 * Splits the narration from its closing call to action. The line is removed from the text only
 * when it names a character at the table; otherwise the text is returned untouched and the
 * call to action is null (players can still use /acao and /rolar).
 */
export function parseCallToAction(
  text: string,
  charactersAtTable: Character[],
): { narration: string; callToAction: CallToAction | null } {
  const lines = text.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!.replace(/[*_]/g, '').trim(); // the GM may bold or italicize the line
    if (!line.startsWith('👉') && !line.startsWith('🎲')) continue;

    const callToAction = parseLine(line, charactersAtTable);
    if (!callToAction) break;
    const narration = [...lines.slice(0, i), ...lines.slice(i + 1)].join('\n').trim();
    return { narration, callToAction };
  }
  return { narration: text.trim(), callToAction: null };
}

function parseLine(line: string, characters: Character[]): CallToAction | null {
  const check = CHECK_LINE.exec(line);
  if (check) {
    const [, name = '', attributeLabel = '', goal, difficulty, stakes] = check;
    const character = findCharacter(characters, name);
    const attribute = parseAttribute(attributeLabel);
    if (!character || !attribute) return null;
    return {
      kind: 'check',
      userId: character.userId,
      characterName: character.name,
      attribute,
      modifier: characterAttributes(character)[attribute],
      difficulty: difficulty ? Number(difficulty) : DEFAULT_DIFFICULTY,
      ...(goal ? { goal } : {}),
      ...(stakes ? { stakes } : {}),
    };
  }

  const turn = TURN_LINE.exec(line);
  if (turn) {
    const [, name = '', prompt = ''] = turn;
    const character = findCharacter(characters, name);
    if (!character) return null;
    return { kind: 'turn', userId: character.userId, characterName: character.name, prompt: prompt.trim() };
  }
  return null;
}

function findCharacter(characters: Character[], name: string): Character | undefined {
  // localeCompare with sensitivity "base" ignores case and accents.
  return characters.find((c) => c.name.trim().localeCompare(name.trim(), 'pt-BR', { sensitivity: 'base' }) === 0);
}
