// Runs one simulated session with the real LLM. It spends tokens from ANTHROPIC_API_KEY, up to the budget.
//   npm run sim -- --scenario porto --responses 20 --budget 200000 --seed 1
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { generate } from '../llm/client.ts';
import { JsonCampaignStore } from '../state/store.ts';
import { computeMetrics, type SimEvent } from './metrics.ts';
import { SCENARIOS } from './scenarios.ts';
import { seededRng, simulate } from './simulate.ts';

const { values } = parseArgs({
  options: {
    scenario: { type: 'string', default: 'porto' },
    responses: { type: 'string', default: '20' },
    budget: { type: 'string', default: '200000' },
    seed: { type: 'string', default: '1' },
  },
});

const scenario = SCENARIOS.find((s) => s.id === values.scenario);
if (!scenario) throw new Error(`Unknown scenario: ${values.scenario}`);

// A temporary store: a simulation never touches the real campaigns in data/.
const dir = await mkdtemp(path.join(tmpdir(), 'rpg-bot-sim-'));
try {
  const result = await simulate({
    scenario,
    store: new JsonCampaignStore(dir),
    generate,
    rng: seededRng(Number(values.seed)),
    maxResponses: Number(values.responses),
    budgetTokens: Number(values.budget),
  });

  const names = Object.fromEntries(scenario.players.map((p) => [p.userId, p.name]));
  const report = {
    scenario: scenario.id,
    seed: Number(values.seed),
    stopReason: result.stopReason,
    metrics: computeMetrics(result.events, names),
    gm: result.gm,
    players: result.players,
    summary: result.summary,
  };

  const outDir = path.join('sim-output', new Date().toISOString().replace(/[:.]/g, '-'));
  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2));
  await writeFile(path.join(outDir, 'transcript.md'), result.events.map(render).join('\n\n'));
  console.log(JSON.stringify(report, null, 2));
  console.log(`\nSaved to ${outDir}`);
} finally {
  await rm(dir, { recursive: true, force: true });
}

function render(event: SimEvent): string {
  switch (event.kind) {
    case 'gm':
      return `**Mestre:** ${event.rawText}`;
    case 'action':
      return `**${event.name}${event.called ? '' : ' (fora da vez)'}:** ${event.text}`;
    case 'silence':
      return `*${event.name} não respondeu.*`;
    case 'check':
      return `*${event.name}: 1d20 (${event.check.die}) ${event.check.modifier >= 0 ? '+' : ''}${event.check.modifier} = ${event.check.total} vs ${event.check.difficulty}, ${event.check.grade}*`;
  }
}
