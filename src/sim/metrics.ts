// Numbers computed from a simulated session. Pure code: it only reads the session's events.
import type { CheckGrade, CheckResult } from '../rules/checks.ts';
import type { Narration } from '../orchestrator/game.ts';

export type SimEvent =
  | { kind: 'gm'; rawText: string; narration: Narration }
  | { kind: 'action'; userId: string; name: string; text: string; called: boolean }
  | { kind: 'silence'; userId: string; name: string }
  | { kind: 'check'; userId: string; name: string; check: CheckResult };

export interface SimMetrics {
  responses: number;
  callsByCharacter: Record<string, number>;
  actionsByCharacter: Record<string, number>;
  checksByCharacter: Record<string, number>;
  outOfTurnActions: number;
  unansweredCalls: number; // the called character was not the next one to act
  longestCallStreak: { name: string; length: number } | null;
  difficulties: Record<string, number>;
  grades: Partial<Record<CheckGrade, number>>;
  missingCallToAction: number; // responses whose closing line could not be read
  difficultyMismatches: number; // difficulty written by the GM differs from the one the code used
  menuQuestions: number; // heuristic: a turn prompt offering options ("... ou ...?")
  narrationsWithYou: number; // heuristic: "você" in the narration itself, ambiguous in a group
}

const add = (counts: Record<string, number>, key: string) => {
  counts[key] = (counts[key] ?? 0) + 1;
};

export function computeMetrics(events: SimEvent[], names: Record<string, string>): SimMetrics {
  const metrics: SimMetrics = {
    responses: 0,
    callsByCharacter: Object.fromEntries(Object.values(names).map((name) => [name, 0])),
    actionsByCharacter: Object.fromEntries(Object.values(names).map((name) => [name, 0])),
    checksByCharacter: Object.fromEntries(Object.values(names).map((name) => [name, 0])),
    outOfTurnActions: 0,
    unansweredCalls: 0,
    longestCallStreak: null,
    difficulties: {},
    grades: {},
    missingCallToAction: 0,
    difficultyMismatches: 0,
    menuQuestions: 0,
    narrationsWithYou: 0,
  };

  let streak = { name: '', length: 0 };
  events.forEach((event, index) => {
    if (event.kind === 'action') {
      add(metrics.actionsByCharacter, event.name);
      if (!event.called) metrics.outOfTurnActions++;
    }
    if (event.kind === 'check') {
      add(metrics.checksByCharacter, event.name);
      metrics.grades[event.check.grade] = (metrics.grades[event.check.grade] ?? 0) + 1;
    }
    if (event.kind !== 'gm') return;

    metrics.responses++;
    if (/(?<!\p{L})você(?!\p{L})/iu.test(event.narration.text)) metrics.narrationsWithYou++;

    const action = event.narration.callToAction;
    if (!action) {
      metrics.missingCallToAction++;
      return;
    }

    add(metrics.callsByCharacter, action.characterName);
    streak = streak.name === action.characterName ? { ...streak, length: streak.length + 1 } : { name: action.characterName, length: 1 };
    if (!metrics.longestCallStreak || streak.length > metrics.longestCallStreak.length) {
      metrics.longestCallStreak = { ...streak };
    }

    const next = events.slice(index + 1).find((e) => e.kind === 'action' || e.kind === 'check') as Extract<SimEvent, { userId: string }> | undefined;
    if (next && next.userId !== action.userId) metrics.unansweredCalls++;

    if (action.kind === 'turn') {
      if (/\bou\b[^?]*\?/i.test(action.prompt)) metrics.menuQuestions++;
    } else {
      add(metrics.difficulties, String(action.difficulty));
      const written = /🎲[^\n]*dificuldade\s*(\d+)/i.exec(event.rawText)?.[1];
      if (written && Number(written) !== action.difficulty) metrics.difficultyMismatches++;
    }
  });
  return metrics;
}
