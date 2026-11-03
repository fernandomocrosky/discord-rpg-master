// Rolagem de dados. Código puro: o RNG é injetado para os testes serem determinísticos.

/** Retorna um número em [0, 1), como Math.random. */
export type Rng = () => number;

export interface DiceExpression {
  count: number;
  sides: number;
  modifier: number;
}

export interface RollResult {
  expression: string; // forma normalizada, ex.: "1d20+3"
  rolls: number[];
  modifier: number;
  total: number;
}

const MAX_COUNT = 100;
const MAX_SIDES = 1000;
const EXPRESSION = /^(\d*)d(\d+)\s*(?:([+-])\s*(\d+))?$/i;

/** Lê expressões como "1d20+3", "2d6", "d8-1". Lança erro com mensagem amigável se for inválida. */
export function parseDice(input: string): DiceExpression {
  const match = EXPRESSION.exec(input.trim());
  if (!match) {
    throw new Error(`Expressão inválida: "${input}". Use algo como 1d20+3, 2d6 ou d8-1.`);
  }
  const [, countText, sidesText, sign, modifierText] = match;
  const count = countText ? Number(countText) : 1;
  const sides = Number(sidesText);
  const modifier = modifierText ? Number(modifierText) * (sign === '-' ? -1 : 1) : 0;

  if (count < 1 || count > MAX_COUNT) {
    throw new Error(`Quantidade de dados deve ficar entre 1 e ${MAX_COUNT}.`);
  }
  if (sides < 2 || sides > MAX_SIDES) {
    throw new Error(`O dado deve ter entre 2 e ${MAX_SIDES} lados.`);
  }
  return { count, sides, modifier };
}

export function formatDice({ count, sides, modifier }: DiceExpression): string {
  const mod = modifier === 0 ? '' : modifier > 0 ? `+${modifier}` : `${modifier}`;
  return `${count}d${sides}${mod}`;
}

export function rollDice(input: string, rng: Rng = Math.random): RollResult {
  const expr = parseDice(input);
  const rolls = Array.from({ length: expr.count }, () => Math.floor(rng() * expr.sides) + 1);
  const total = rolls.reduce((sum, r) => sum + r, 0) + expr.modifier;
  return { expression: formatDice(expr), rolls, modifier: expr.modifier, total };
}
