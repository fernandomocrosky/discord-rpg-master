// Numbers computed from a simulated session. Pure code: it only reads the session's events.
import type { CheckGrade, CheckResult } from '../rules/checks.ts';
import type { Narration } from '../orchestrator/game.ts';

export type SimEvent =
  | { kind: 'gm'; rawText: string; narration: Narration }
  | { kind: 'action'; userId: string; name: string; text: string }
  | { kind: 'silence'; userId: string; name: string }
  | { kind: 'check'; userId: string; name: string; check: CheckResult }
  | { kind: 'missed-check'; userId: string; name: string }
  | { kind: 'round-closed' };

export interface SimMetrics {
  responses: number;
  actionsByCharacter: Record<string, number>;
  checksAskedByCharacter: Record<string, number>;
  checksRolledByCharacter: Record<string, number>;
  silences: number;
  missedChecks: number;
  forcedRounds: number; // rounds closed without waiting for everyone
  ignoredActions: number; // heuristic: the GM's answer does not even name a character who acted
  difficulties: Record<string, number>;
  grades: Partial<Record<CheckGrade, number>>;
  groupCalls: number;
  singleCalls: number; // a 👉 for one character with others at the table
  missingCallToAction: number; // responses whose closing lines could not be read
  difficultyMismatches: number; // difficulty written by the GM differs from the one the code used
  menuQuestions: number; // heuristic: a prompt offering options ("... ou ...?")
  narrationsWithYou: number; // heuristic: "você" in the narration itself, ambiguous in a group
}

const add = (counts: Record<string, number>, key: string) => {
  counts[key] = (counts[key] ?? 0) + 1;
};

export function computeMetrics(events: SimEvent[], names: Record<string, string>): SimMetrics {
  const zeroes = () => Object.fromEntries(Object.values(names).map((name) => [name, 0]));
  const metrics: SimMetrics = {
    responses: 0,
    actionsByCharacter: zeroes(),
    checksAskedByCharacter: zeroes(),
    checksRolledByCharacter: zeroes(),
    silences: 0,
    missedChecks: 0,
    forcedRounds: 0,
    ignoredActions: 0,
    difficulties: {},
    grades: {},
    groupCalls: 0,
    singleCalls: 0,
    missingCallToAction: 0,
    difficultyMismatches: 0,
    menuQuestions: 0,
    narrationsWithYou: 0,
  };

  let actedSinceGm = new Set<string>();
  for (const event of events) {
    switch (event.kind) {
      case 'action':
        add(metrics.actionsByCharacter, event.name);
        actedSinceGm.add(event.name);
        break;
      case 'silence':
        metrics.silences++;
        break;
      case 'missed-check':
        metrics.missedChecks++;
        break;
      case 'round-closed':
        metrics.forcedRounds++;
        break;
      case 'check':
        add(metrics.checksRolledByCharacter, event.name);
        metrics.grades[event.check.grade] = (metrics.grades[event.check.grade] ?? 0) + 1;
        actedSinceGm.add(event.name);
        break;
      case 'gm':
        metrics.responses++;
        for (const name of actedSinceGm) {
          if (!event.rawText.includes(name)) metrics.ignoredActions++;
        }
        actedSinceGm = new Set();
        countGmResponse(metrics, event);
        break;
    }
  }
  return metrics;
}

function countGmResponse(metrics: SimMetrics, event: Extract<SimEvent, { kind: 'gm' }>): void {
  if (/(?<!\p{L})você(?!\p{L})/iu.test(event.narration.text)) metrics.narrationsWithYou++;
  if (event.narration.calls.length === 0) metrics.missingCallToAction++;
  for (const call of event.narration.calls) {
    if (call.kind === 'check') {
      add(metrics.checksAskedByCharacter, call.characterName);
      add(metrics.difficulties, String(call.difficulty));
      const line = event.rawText.split('\n').find((l) => l.includes('🎲') && l.includes(call.characterName));
      const written = line && /dificuldade\s*(\d+)/i.exec(line)?.[1];
      if (written && Number(written) !== call.difficulty) metrics.difficultyMismatches++;
      continue;
    }
    if (call.kind === 'group') metrics.groupCalls++;
    else metrics.singleCalls++;
    if (/\bou\b[^?]*\?/i.test(call.prompt)) metrics.menuQuestions++;
  }
}
