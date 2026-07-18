#!/usr/bin/env node
/**
 * Stage-level iteration tool.
 *
 * `run.js` is the benchmark of record: full pipeline, full rubric, comparable
 * across runs. This is the opposite tool — it isolates one stage so a prompt
 * change can be tested cheaply and attributed to the prompt that caused it.
 *
 * The intended loop:
 *
 *   1. `--stage outline` — is the document split into the right sections, in
 *      the right order, with the right number of slides each? One LLM call per
 *      case. If this scores badly, fix the phase 1 prompt and stop here; running
 *      phase 2 would only measure a bad plan being rendered faithfully.
 *
 *   2. `--stage refine --from <run-id> --groups 1` — freeze a good outline and
 *      refine only its first section. One LLM call plus one judge call, so a
 *      round costs cents rather than dollars, and because the input is frozen
 *      any score movement belongs to the phase 2 prompt alone.
 *
 * Usage:
 *   npm run ai-suite:stage -- --stage outline --cases asml-q4-2024
 *   npm run ai-suite:stage -- --stage refine --from <run-id> --groups 1
 *
 * Options:
 *   --stage outline|refine   Which stage to run (required)
 *   --cases a,b              Cases to run (default: all)
 *   --from RUN-ID            Outline run to refine from (refine stage)
 *   --groups N               Refine only the first N sections
 *   --vendor NAME            Generation vendor (claude default, or openai)
 *   --refresh                Bypass the judge cache
 *   --label TEXT             Stored in the stage run metadata
 */

import fs from 'node:fs/promises';
import path from 'node:path';

import { loadCases, readReferenceDeck, readSourceText } from '../lib/cases.js';
import { CostTracker } from '../lib/cost.js';
import { DEFAULT_VENDOR, GENERATION_VENDORS, MODEL, SUITE_ROOT } from '../lib/config.js';
import { computePromptVersion } from '../lib/prompt-version.js';
import { judgeDeck, meanScore } from '../eval/judge.js';
import {
  OUTLINE_DIMENSIONS,
  OUTLINE_DIMENSION_LABELS,
  judgeOutline,
  outlineMetrics,
} from '../eval/judge-outline.js';
import { deckMetrics, numberFidelity } from '../eval/metrics.js';
import { runOutlineStage, runRefineStage, splitOutline } from './pipeline.js';

const STAGES_DIR = path.join(SUITE_ROOT, 'stages');

function parseArgs(argv) {
  const options = {
    stage: null,
    cases: null,
    from: null,
    groups: null,
    vendor: DEFAULT_VENDOR,
    refresh: false,
    label: '',
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => argv[(i += 1)];
    if (arg === '--stage') options.stage = next();
    else if (arg === '--cases') options.cases = next().split(',').map((s) => s.trim()).filter(Boolean);
    else if (arg === '--from') options.from = next();
    else if (arg === '--groups') options.groups = Math.max(1, Number(next()) || 1);
    else if (arg === '--vendor') options.vendor = next();
    else if (arg === '--refresh') options.refresh = true;
    else if (arg === '--label') options.label = next();
    else throw new Error(`Unknown option: ${arg}`);
  }

  if (!['outline', 'refine'].includes(options.stage)) {
    throw new Error('--stage must be "outline" or "refine"');
  }
  if (!GENERATION_VENDORS[options.vendor]) {
    throw new Error(`Unknown vendor "${options.vendor}"`);
  }
  if (options.stage === 'refine' && !options.from) {
    throw new Error('--stage refine requires --from <outline-run-id>');
  }
  return options;
}

function makeRunId(stage) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
  return `${stage}-${stamp}`;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  const generation = GENERATION_VENDORS[options.vendor];
  for (const envVar of generation.envVars) process.env[envVar] = generation.model;
  process.env.LLM_VENDOR = options.vendor;
  process.env.AI_VALIDATION_LOGGING = process.env.AI_VALIDATION_LOGGING || 'false';
  if (!process.env.CLAUDE_API && process.env.ANTHROPIC_API_KEY) {
    process.env.CLAUDE_API = process.env.ANTHROPIC_API_KEY;
  }

  const cases = await loadCases(options.cases);
  const runId = makeRunId(options.stage);
  const runDir = path.join(STAGES_DIR, runId);
  const promptVersion = await computePromptVersion();
  const cost = new CostTracker().attachToAppLlm();

  console.log(`\nStage run ${runId}`);
  console.log(`  stage=${options.stage} generation=${options.vendor}/${generation.model}`);
  console.log(`  prompts=${promptVersion.hash} cases=${cases.map((c) => c.id).join(', ')}`);
  if (options.groups) console.log(`  groups=first ${options.groups}`);
  console.log('');

  const results = [];

  for (const testCase of cases) {
    const sourceText = await readSourceText(testCase);
    const caseDir = path.join(runDir, testCase.id);
    await fs.mkdir(caseDir, { recursive: true });

    if (options.stage === 'outline') {
      results.push(await doOutline({ testCase, sourceText, caseDir, options, cost }));
    } else {
      results.push(await doRefine({ testCase, sourceText, caseDir, options, cost }));
    }
  }

  cost.detach();

  const summary = {
    runId,
    stage: options.stage,
    label: options.label,
    generationVendor: options.vendor,
    generationModel: generation.model,
    judgeModel: MODEL,
    promptVersion,
    fromRun: options.from,
    groupLimit: options.groups,
    cost: cost.summary(),
    results,
  };
  await fs.writeFile(path.join(runDir, 'stage.json'), JSON.stringify(summary, null, 2));

  printSummary(summary);
  console.log(`\nArtifacts: ${runDir}`);
  if (options.stage === 'outline') {
    console.log(`Refine from these outlines with:\n  npm run ai-suite:stage -- --stage refine --from ${runId} --groups 1`);
  }
}

/** Phase 1 only, then judge the plan. */
async function doOutline({ testCase, sourceText, caseDir, options, cost }) {
  const started = Date.now();
  const outline = await runOutlineStage(sourceText, {
    targetLang: testCase.language === 'nl' ? 'nl' : 'en-GB',
    vendor: options.vendor,
  });
  const durationMs = Date.now() - started;

  await fs.writeFile(path.join(caseDir, 'outline.json'), JSON.stringify(outline, null, 2));

  const metrics = outlineMetrics(outline);
  const { structuralSlides, contentGroups } = splitOutline(outline);

  const { verdict, cached } = await judgeOutline({
    testCase,
    sourceText,
    outline,
    onUsage: (usage) => cost.record('judge-outline', usage, MODEL),
    refresh: options.refresh,
  });

  console.log(
    `[${testCase.id}] ${metrics.plannedSlides} planned slides, ${metrics.sectionCount} sections ` +
      `(${metrics.slidesPerSection.min}-${metrics.slidesPerSection.max} each) in ${Math.round(durationMs / 1000)}s` +
      `${cached ? ' [judge cached]' : ''}`
  );
  for (const dimension of OUTLINE_DIMENSIONS) {
    console.log(`    ${OUTLINE_DIMENSION_LABELS[dimension].padEnd(18)} ${verdict.scores[dimension].score}/5`);
  }
  console.log(`    weakest stretch: ${verdict.worstSection}`);

  return {
    caseId: testCase.id,
    stage: 'outline',
    durationMs,
    metrics,
    structuralSlideCount: structuralSlides.length,
    contentGroupCount: contentGroups.length,
    verdict,
    meanScore: meanOf(OUTLINE_DIMENSIONS.map((d) => verdict.scores[d].score)),
  };
}

/** Phase 2 only, from a frozen outline. */
async function doRefine({ testCase, sourceText, caseDir, options, cost }) {
  const outlinePath = path.join(STAGES_DIR, options.from, testCase.id, 'outline.json');
  let outline;
  try {
    outline = JSON.parse(await fs.readFile(outlinePath, 'utf8'));
  } catch {
    throw new Error(`No stored outline for "${testCase.id}" in run ${options.from} (${outlinePath})`);
  }

  const started = Date.now();
  const { deck, groupCount, refinedCount } = await runRefineStage(outline, {
    vendor: options.vendor,
    groupLimit: options.groups,
  });
  const durationMs = Date.now() - started;

  await fs.writeFile(path.join(caseDir, 'deck.json'), JSON.stringify(deck, null, 2));

  const metrics = deckMetrics(deck);
  const fidelity = numberFidelity(deck, sourceText);
  const referenceDeck = await readReferenceDeck(testCase);

  // Judged against the source as usual. With --groups the deck is a partial
  // one, so coverage is expected to be low and is not the signal — slide
  // economy, faithfulness and presentability are what this stage controls.
  const { verdict, cached } = await judgeDeck({
    testCase,
    sourceText,
    deck,
    topics: [],
    referenceDeck: options.groups ? null : referenceDeck,
    onUsage: (usage) => cost.record('judge', usage, MODEL),
    refresh: options.refresh,
  });

  console.log(
    `[${testCase.id}] refined ${refinedCount} slides from ${options.groups ? `first ${options.groups} of ` : ''}` +
      `${groupCount} sections in ${Math.round(durationMs / 1000)}s${cached ? ' [judge cached]' : ''}`
  );
  console.log(
    `    slides=${metrics.slideCount} words/slide=${metrics.wordsPerSlide.mean} ` +
      `walls=${metrics.wallOfTextSlides} repeats=${metrics.repetition.consecutiveRepeats} ` +
      `types=${Object.keys(metrics.slideTypeDistribution).length}`
  );
  console.log(
    `    economy=${verdict.scores.slideEconomy.score}/5 ` +
      `faithful=${verdict.scores.faithfulness.score}/5 ` +
      `presentable=${verdict.scores.presentability.score}/5`
  );

  return {
    caseId: testCase.id,
    stage: 'refine',
    durationMs,
    groupCount,
    refinedCount,
    partial: Boolean(options.groups),
    metrics,
    numberFidelity: fidelity,
    verdict,
    meanScore: meanScore(verdict.scores),
  };
}

function printSummary(summary) {
  console.log('\n--- summary ---');
  if (summary.stage === 'outline') {
    for (const dimension of OUTLINE_DIMENSIONS) {
      const mean = meanOf(summary.results.map((r) => r.verdict.scores[dimension].score));
      console.log(`  ${OUTLINE_DIMENSION_LABELS[dimension].padEnd(18)} ${mean.toFixed(2)}`);
    }
  } else {
    // On a partial run the deck is a leading fragment, so coverage and
    // structure are judging a deck that was never meant to be whole. Report
    // only the dimensions this stage genuinely controls at section level.
    const partial = summary.results.some((r) => r.partial);
    const dimensions = partial
      ? ['slideEconomy', 'faithfulness', 'presentability']
      : ['slideEconomy', 'faithfulness', 'presentability', 'structure', 'coverage'];
    if (partial) {
      console.log('  (partial run — coverage and structure omitted: the deck is a fragment)');
    }
    for (const dimension of dimensions) {
      const mean = meanOf(summary.results.map((r) => r.verdict.scores[dimension].score));
      console.log(`  ${dimension.padEnd(18)} ${mean.toFixed(2)}`);
    }
  }
  console.log(`  cost               $${summary.cost.totalUsd.toFixed(4)}`);
}

function meanOf(values) {
  const nums = values.filter((n) => Number.isFinite(n));
  if (!nums.length) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

main().catch((err) => {
  console.error(`\nStage run failed: ${err.message}`);
  if (process.env.DEBUG) console.error(err.stack);
  process.exitCode = 1;
});
