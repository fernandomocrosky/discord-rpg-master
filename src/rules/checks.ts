// Attributes and graded checks (own simple system: 1d20 + attribute vs difficulty).
// Pure code: the RNG is injected so tests are deterministic.
import { rollDice, type Rng } from './dice.ts';

export const ATTRIBUTES = ['forca', 'agilidade', 'mente', 'presenca'] as const;
export type Attribute = (typeof ATTRIBUTES)[number];
export type Attributes = Record<Attribute, number>;

export const ATTRIBUTE_LABELS: Record<Attribute, string> = {
  forca: 'Força',
  agilidade: 'Agilidade',
  mente: 'Mente',
  presenca: 'Presença',
};

export const NEUTRAL_ATTRIBUTES: Attributes = { forca: 0, agilidade: 0, mente: 0, presenca: 0 };

/** Strong +2, good +1, weak -1, the remaining one +0. The three must be different. */
export function buildAttributes(profile: { strong: Attribute; good: Attribute; weak: Attribute }): Attributes {
  const { strong, good, weak } = profile;
  if (new Set([strong, good, weak]).size !== 3) {
    throw new Error('Ponto forte, ponto bom e ponto fraco precisam ser atributos diferentes.');
  }
  return { ...NEUTRAL_ATTRIBUTES, [strong]: 2, [good]: 1, [weak]: -1 };
}

/** Finds an attribute by its label, ignoring case and accents ("forca" → forca). */
export function parseAttribute(label: string): Attribute | null {
  const wanted = label.trim();
  return (
    ATTRIBUTES.find(
      (attribute) => ATTRIBUTE_LABELS[attribute].localeCompare(wanted, 'pt-BR', { sensitivity: 'base' }) === 0,
    ) ?? null
  );
}

export function formatModifier(modifier: number): string {
  return modifier >= 0 ? `+${modifier}` : `${modifier}`;
}

export type CheckGrade = 'critical' | 'full-success' | 'success' | 'close' | 'failure' | 'disaster';

export const GRADE_INFO: Record<CheckGrade, { emoji: string; label: string; meaning: string }> = {
  critical: { emoji: '🌟', label: 'Crítico', meaning: 'sucesso espetacular, com um bônus inesperado' },
  'full-success': { emoji: '✅', label: 'Sucesso pleno', meaning: 'consegue com folga' },
  success: { emoji: '✅', label: 'Sucesso', meaning: 'consegue' },
  close: { emoji: '⚠️', label: 'Por pouco', meaning: 'consegue, mas com um custo ou complicação' },
  failure: { emoji: '❌', label: 'Falha', meaning: 'não consegue, e a situação piora' },
  disaster: { emoji: '💀', label: 'Desastre', meaning: 'falha com uma complicação séria' },
};

export interface CheckResult {
  attribute: Attribute;
  die: number;
  modifier: number;
  total: number;
  difficulty: number;
  margin: number; // total - difficulty
  grade: CheckGrade;
}

/** Natural 20 and natural 1 win over the math; otherwise the margin decides. */
export function gradeCheck(die: number, margin: number): CheckGrade {
  if (die === 20) return 'critical';
  if (die === 1) return 'disaster';
  if (margin >= 5) return 'full-success';
  if (margin >= 0) return 'success';
  if (margin >= -4) return 'close';
  return 'failure';
}

export function rollCheck(
  attribute: Attribute,
  modifier: number,
  difficulty: number,
  rng: Rng = Math.random,
): CheckResult {
  const die = rollDice('1d20', rng).rolls[0]!;
  const total = die + modifier;
  const margin = total - difficulty;
  return { attribute, die, modifier, total, difficulty, margin, grade: gradeCheck(die, margin) };
}

/** Text the GM receives, e.g. "teste de Agilidade: 1d20 (14) +2 = 16 contra dificuldade 15 → Sucesso por 1 (consegue)". */
export function describeCheck(result: CheckResult): string {
  const { attribute, die, modifier, total, difficulty, margin, grade } = result;
  const info = GRADE_INFO[grade];
  const by = margin === 0 ? 'no limite' : `por ${Math.abs(margin)}`;
  return (
    `teste de ${ATTRIBUTE_LABELS[attribute]}: 1d20 (${die}) ${formatModifier(modifier)} = ${total} ` +
    `contra dificuldade ${difficulty} → ${info.label} ${by} (${info.meaning})`
  );
}
