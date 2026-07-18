#!/usr/bin/env node
/**
 * AI slide-generation test suite runner.
 *
 * Usage:
 *   npm run test:ai-suite -- [options]
 *
 * Options:
 *   --cases a,b,c   Only run these case ids (default: all)
 *   --repeat N      Generate each case N times to expose variance (default: 1)
 *   --dry-run       Deterministic metrics only; no judge, no API cost beyond generation
 *   --no-generate   Re-evaluate the decks from --reuse-run instead of generating
 *   --reuse-run ID  Run id to reuse decks from (implies --no-generate)
 *   --refresh       Bypass the judge/topic cache
 *   --label TEXT    Free-text label stored in the run metadata
 *   --vendor NAME   Generation vendor: claude (default) or openai. The judge
 *                   always stays on the pinned judge model, so scores from
 *                   different vendors remain on one scale.
 */

import fs from 'node:fs/promises';
import path from 'node:path';

import { loadCases, readReferenceDeck, readSourceText } from '../lib/cases.js';
import { CostTracker } from '../lib/cost.js';
import {
  DEFAULT_VENDOR,
  GENERATION_VENDORS,
  JUDGE_EFFORT,
  MODEL,
  RUNS_DIR,
} from '../lib/config.js';
import { computePromptVersion } from '../lib/prompt-version.js';
import { judgeDeck, meanScore } from '../eval/judge.js';
import { deckMetrics, numberFidelity, specialTypeUsage } from '../eval/metrics.js';
import { compareToReference } from '../eval/reference.js';
import {
  aggregateScores,
  appendHistory,
  findComparableRun,
  loadHistory,
  overallScore,
  writeReport,
} from '../eval/report.js';
import { extractKeyTopics } from '../eval/topics.js';

/**
 * Parse argv into options.
 * @param {string[]} argv
 */
function parseArgs(argv) {
  const options = {
    cases: null,
    repeat: 1,
    dryRun: false,
    generate: true,
    reuseRun: null,
    refresh: false,
    label: '',
    vendor: DEFAULT_VENDOR,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => argv[(i += 1)];
    if (arg === '--cases') options.cases = next().split(',').map((s) => s.trim()).filter(Boolean);
    else if (arg === '--repeat') options.repeat = Math.max(1, Number(next()) || 1);
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--no-generate') options.generate = false;
    else if (arg === '--reuse-run') {
      options.reuseRun = next();
      options.generate = false;
    } else if (arg === '--refresh') options.refresh = true;
    else if (arg === '--label') options.label = next();
    else if (arg === '--vendor') {
      options.vendor = next();
      if (!GENERATION_VENDORS[options.vendor]) {
        throw new Error(
          `Unknown vendor "${options.vendor}". Known: ${Object.keys(GENERATION_VENDORS).join(', ')}`
        );
      }
    }
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`Unknown option: ${arg}`);
  }
  return options;
}

/**
 * Build a sortable, human-readable run id.
 * @returns {string}
 */
function makeRunId() {
  return new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(await fs.readFile(new URL(import.meta.url), 'utf8').then(headerComment));
    return;
  }

  // Pin the generation model for the chosen vendor. getLlmConfig reads these
  // per call, so setting them here covers the whole run. Both Claude stages
  // (plan and fill) are pinned to one model so the two phases stay comparable.
  const generation = GENERATION_VENDORS[options.vendor];
  for (const envVar of generation.envVars) process.env[envVar] = generation.model;
  process.env.LLM_VENDOR = options.vendor;
  // Keep the app's own debug logging out of the repo during suite runs.
  process.env.AI_VALIDATION_LOGGING = process.env.AI_VALIDATION_LOGGING || 'false';

  if (!process.env.CLAUDE_API && process.env.ANTHROPIC_API_KEY) {
    process.env.CLAUDE_API = process.env.ANTHROPIC_API_KEY;
  }

  const cases = await loadCases(options.cases);
  if (!cases.length) throw new Error('No cases to run.');

  const runId = makeRunId();
  const runDir = path.join(RUNS_DIR, runId);
  const promptVersion = await computePromptVersion();
  const cost = new CostTracker().attachToAppLlm();
  const startedAt = new Date().toISOString();

  console.log(`\nRun ${runId}`);
  console.log(
    `  generation=${options.vendor}/${generation.model}  judge=${MODEL} (effort ${JUDGE_EFFORT})`
  );
  console.log(`  prompts=${promptVersion.hash}`);
  console.log(`  cases=${cases.map((c) => c.id).join(', ')} repeat=${options.repeat}`);
  if (options.dryRun) console.log('  mode=dry-run (no judge)');
  console.log('');

  // Imported lazily so --dry-run / --no-generate paths don't pay for loading
  // the whole generation pipeline.
  const { generateDeckV2 } = await import('../../server/utils/ai/index.js');

  const results = [];

  for (const testCase of cases) {
    console.log(`[${testCase.id}] (category ${testCase.category}, ${testCase.language})`);
    const sourceText = await readSourceText(testCase);
    const referenceDeck = await readReferenceDeck(testCase);

    let topics = [];
    if (!options.dryRun) {
      const extracted = await extractKeyTopics({
        caseId: testCase.id,
        sourceText,
        onUsage: (usage) => cost.record('topics', usage, MODEL),
        refresh: options.refresh,
      });
      topics = extracted.topics;
      console.log(`  topics: ${topics.length}${extracted.cached ? ' (cached)' : ''}`);
    }

    const repeats = [];
    for (let repeat = 0; repeat < options.repeat; repeat += 1) {
      const caseDir = path.join(runDir, testCase.id);
      const deckPath = path.join(caseDir, `deck${repeat ? `-${repeat + 1}` : ''}.json`);

      let deck;
      if (options.generate) {
        const startedGeneration = Date.now();
        deck = await generateDeckV2(sourceText, {
          targetLang: testCase.language === 'nl' ? 'nl' : 'en-GB',
          vendor: options.vendor,
          enableLogging: false,
        });
        const durationMs = Date.now() - startedGeneration;
        await fs.mkdir(caseDir, { recursive: true });
        await fs.writeFile(deckPath, JSON.stringify(deck, null, 2));
        console.log(
          `  repeat ${repeat + 1}: ${deck.slides?.length ?? 0} slides in ${Math.round(durationMs / 1000)}s`
        );
      } else {
        const sourceRunId = options.reuseRun;
        if (!sourceRunId) throw new Error('--no-generate requires --reuse-run <run-id>');
        const reusePath = path.join(
          RUNS_DIR,
          sourceRunId,
          testCase.id,
          `deck${repeat ? `-${repeat + 1}` : ''}.json`
        );
        deck = JSON.parse(await fs.readFile(reusePath, 'utf8'));
        await fs.mkdir(caseDir, { recursive: true });
        await fs.writeFile(deckPath, JSON.stringify(deck, null, 2));
        console.log(`  repeat ${repeat + 1}: reused deck from ${sourceRunId}`);
      }

      const metrics = deckMetrics(deck);
      const fidelity = numberFidelity(deck, sourceText);
      const specialTypes = specialTypeUsage(deck, testCase.expectedSlideTypes || []);
      const referenceComparison = referenceDeck ? compareToReference(deck, referenceDeck) : null;

      let verdict = null;
      if (!options.dryRun) {
        const judged = await judgeDeck({
          testCase,
          sourceText,
          deck,
          topics,
          referenceDeck,
          // Only pays off when the same source is judged more than once.
          cacheContext: options.repeat > 1,
          onUsage: (usage) => cost.record('judge', usage, MODEL),
          refresh: options.refresh,
        });
        verdict = judged.verdict;
        console.log(
          `    judge: ${meanScore(verdict.scores).toFixed(2)}/5${judged.cached ? ' (cached)' : ''}`
        );
      }
      if (specialTypes.expected) {
        const missed = specialTypes.missing.map((m) => m.type).join(', ');
        console.log(
          `    specialised layouts: ${specialTypes.found.length}/${specialTypes.expected}` +
            (missed ? ` — missed ${missed}` : '')
        );
      }

      repeats.push({
        repeat: repeat + 1,
        deckPath: path.relative(RUNS_DIR, deckPath),
        metrics,
        numberFidelity: fidelity,
        specialTypes,
        referenceComparison,
        verdict,
        meanScore: verdict ? meanScore(verdict.scores) : null,
      });
    }

    results.push({
      caseId: testCase.id,
      title: testCase.title,
      category: testCase.category,
      language: testCase.language,
      topics,
      repeats,
    });
  }

  cost.detach();

  const scores = aggregateScores(results);
  const run = {
    runId,
    startedAt,
    finishedAt: new Date().toISOString(),
    label: options.label,
    model: MODEL,
    generationVendor: options.vendor,
    generationModel: generation.model,
    effort: JUDGE_EFFORT,
    promptVersion,
    caseIds: cases.map((c) => c.id),
    repeats: options.repeat,
    dryRun: options.dryRun,
    scores,
    overall: overallScore(scores),
    cost: cost.summary(),
    results,
  };

  await fs.mkdir(runDir, { recursive: true });
  await fs.writeFile(path.join(runDir, 'run.json'), JSON.stringify(run, null, 2));

  const history = await loadHistory();
  const previous = await findComparableRun(history, run.caseIds, options.vendor);
  await writeReport(run, previous, path.join(runDir, 'report.md'));

  await appendHistory({
    runId,
    startedAt,
    label: options.label,
    model: MODEL,
    generationVendor: options.vendor,
    generationModel: generation.model,
    effort: JUDGE_EFFORT,
    promptVersion,
    caseIds: run.caseIds,
    repeats: options.repeat,
    dryRun: options.dryRun,
    scores,
    overall: run.overall,
    costUsd: run.cost.totalUsd,
  });

  console.log('');
  console.log(`Overall: ${run.overall === null ? 'n/a (dry run)' : `${run.overall.toFixed(2)}/5`}`);
  console.log(`Cost:    $${run.cost.totalUsd.toFixed(4)}`);
  console.log(`Report:  ${path.join(runDir, 'report.md')}`);
}

/** Pull the usage block out of this file's own header comment. */
function headerComment(text) {
  const match = text.match(/\/\*\*([\s\S]*?)\*\//);
  return match ? match[1].replace(/^\s*\*ate?/gm, '').replace(/^\s*\* ?/gm, '') : '';
}

main().catch((err) => {
  console.error(`\nSuite failed: ${err.message}`);
  if (process.env.DEBUG) console.error(err.stack);
  process.exitCode = 1;
});
