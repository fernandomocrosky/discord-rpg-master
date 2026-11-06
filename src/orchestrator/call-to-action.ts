// Reads the GM's closing lines, which call the whole table or ask for checks (one line per character):
//   "👉 Todos, o guarda se aproxima. O que vocês fazem?"
//   "👉 Lia, o pescador está prestes a fugir. O que você faz?"
//   "🎲 Lia, teste de Agilidade para escalar o mastro (dificuldade 15)"
// A check line may go on after the difficulty, usually with what is at stake: "... (dificuldade 15). Se falhar, ela cai."
// Phase 1 replaces this text parsing with a structured (JSON) request from the LLM.
import { characterAttributes, type Character } from '../state/campaign.ts';
import { parseAttribute, type Attribute } from '../rules/checks.ts';

export type CallToAction =
  | { kind: 'group'; players: { userId: string; characterName: string }[]; prompt: string }
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
 * Splits the narration from its closing calls. A line is removed from the text only when it can be
 * read (a character at the table, a known attribute); otherwise it stays and players can still use /acao.
 * Checks win over a 👉 line, since the table first has to roll. A character's last check wins.
 */
export function parseCallsToAction(text: string, charactersAtTable: Character[]): { narration: string; calls: CallToAction[] } {
  const kept: string[] = [];
  const parsed: CallToAction[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.replace(/[*_]/g, '').trim(); // the GM may bold or italicize the line
    const call = line.startsWith('👉') || line.startsWith('🎲') ? parseLine(line, charactersAtTable) : null;
    if (call) parsed.push(call);
    else kept.push(raw);
  }

  const checks = new Map<string, CallToAction>();
  for (const call of parsed) {
    if (call.kind === 'check') checks.set(call.userId, call);
  }
  const calls = checks.size ? [...checks.values()] : parsed.slice(-1);
  return { narration: kept.join('\n').trim(), calls };
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
    if (name.trim().toLowerCase() === 'todos' && characters.length) {
      const players = characters.map((c) => ({ userId: c.userId, characterName: c.name }));
      return { kind: 'group', players, prompt: prompt.trim() };
    }
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
