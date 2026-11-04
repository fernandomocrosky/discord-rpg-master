// Reads the GM's roll request line from a narration, e.g.
// "🎲 Lia, role /rolar 1d20 para escalar o mastro (dificuldade 15)".
// Phase 1 replaces this text parsing with a structured (JSON) request from the LLM.
import { parseDice } from '../rules/dice.ts';
import type { Character } from '../state/campaign.ts';

export interface RollRequest {
  userId: string;
  characterName: string;
  expression: string;
  goal?: string;
  difficulty?: number;
}

const REQUEST_LINE = /🎲\s*(.+?),\s*role\s+\/rolar\s+(\S+)(?:\s+para\s+(.+?))?\s*(?:\(\s*dificuldade\s*(\d+)\s*\))?\s*$/i;

/**
 * Returns the last roll request in the text, if it names a character at the table and a valid
 * dice expression. Anything else returns null (players can still use /rolar).
 */
export function parseRollRequest(text: string, charactersAtTable: Character[]): RollRequest | null {
  const lines = text
    .split('\n')
    .map((line) => line.replace(/[*_]/g, '').trim()) // the GM may bold or italicize the line
    .filter((line) => line.includes('🎲'));

  for (const line of lines.reverse()) {
    const match = REQUEST_LINE.exec(line);
    if (!match) continue;
    const [, name = '', expression = '', goal, difficulty] = match;

    const character = charactersAtTable.find((c) => sameName(c.name, name));
    if (!character || !isValidDice(expression)) return null;
    return {
      userId: character.userId,
      characterName: character.name,
      expression,
      ...(goal ? { goal } : {}),
      ...(difficulty ? { difficulty: Number(difficulty) } : {}),
    };
  }
  return null;
}

function sameName(a: string, b: string): boolean {
  return a.trim().localeCompare(b.trim(), 'pt-BR', { sensitivity: 'base' }) === 0; // ignores case and accents
}

function isValidDice(expression: string): boolean {
  try {
    parseDice(expression);
    return true;
  } catch {
    return false;
  }
}
