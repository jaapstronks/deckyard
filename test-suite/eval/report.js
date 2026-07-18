/**
 * Run reporting: markdown report per run, plus a rolling history so progress
 * (and regression) across prompt versions is visible.
 */

import fs from 'node:fs/promises';
import path from 'node:path';

import {
  DIMENSION_LABELS,
  HISTORY_FILE,
  REFERENCE_DIMENSION,
  RUBRIC_DIMENSIONS,
} from '../lib/config.js';
import { changedPromptFiles } from '../lib/prompt-version.js';

/** A dimension must move by at least this much to count as a real change. */
const SIGNIFICANCE_THRESHOLD = 0.15;

/**
 * Average each dimension across all case results in a run.
 *
 * @param {object[]} results
 * @returns {Record<string, number|null>}
 */
export function aggregateScores(results) {
  const dimensions = [...RUBRIC_DIMENSIONS, REFERENCE_DIMENSION];
  const out = {};
  for (const dimension of dimensions) {
    const values = results
      .flatMap((result) => result.repeats || [])
      .map((repeat) => repeat.verdict?.scores?.[dimension]?.score)
      .filter((n) => Number.isFinite(n));
    out[dimension] = values.length
      ? Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100) / 100
      : null;
  }
  return out;
}

/**
 * Overall mean across the five universal dimensions. humanLikeness is excluded
 * so runs over different case subsets stay comparable.
 *
 * @param {Record<string, number|null>} scores
 */
export function overallScore(scores) {
  const values = RUBRIC_DIMENSIONS.map((d) => scores[d]).filter((n) => Number.isFinite(n));
  if (!values.length) return null;
  return Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100) / 100;
}

/**
 * Load run history.
 * @returns {Promise<object[]>}
 */
export async function loadHistory() {
  try {
    return JSON.parse(await fs.readFile(HISTORY_FILE, 'utf8'));
  } catch {
    return [];
  }
}

/**
 * Append a run to history.
 *
 * @param {object} entry
 */
export async function appendHistory(entry) {
  const history = await loadHistory();
  history.push(entry);
  await fs.writeFile(HISTORY_FILE, `${JSON.stringify(history, null, 2)}\n`);
}

/**
 * Find the most recent prior run that covered the same case set, so deltas
 * compare like with like rather than a full run against a 4-case subset.
 *
 * @param {object[]} history
 * @param {string[]} caseIds
 */
export function findComparableRun(history, caseIds) {
  const target = [...caseIds].sort().join(',');
  for (let i = history.length - 1; i >= 0; i -= 1) {
    if ([...(history[i].caseIds || [])].sort().join(',') === target) return history[i];
  }
  return null;
}

/**
 * Classify per-dimension movement against a previous run.
 *
 * @param {Record<string, number|null>} current
 * @param {Record<string, number|null>} previous
 * @returns {{dimension: string, delta: number, direction: 'up'|'down'|'flat'}[]}
 */
export function computeDeltas(current, previous) {
  if (!previous) return [];
  const out = [];
  for (const dimension of [...RUBRIC_DIMENSIONS, REFERENCE_DIMENSION]) {
    const now = current[dimension];
    const before = previous[dimension];
    if (!Number.isFinite(now) || !Number.isFinite(before)) continue;
    const delta = Math.round((now - before) * 100) / 100;
    out.push({
      dimension,
      delta,
      direction:
        Math.abs(delta) < SIGNIFICANCE_THRESHOLD ? 'flat' : delta > 0 ? 'up' : 'down',
    });
  }
  return out;
}

/**
 * Write the markdown report for a run.
 *
 * @param {object} run - Full run record
 * @param {object|null} previous - Comparable previous history entry
 * @param {string} outputPath
 * @returns {Promise<string>} The markdown written
 */
export async function writeReport(run, previous, outputPath) {
  const lines = [];
  const scores = run.scores;
  const deltas = computeDeltas(scores, previous?.scores);
  const regressions = deltas.filter((d) => d.direction === 'down');

  lines.push(`# AI suite run \`${run.runId}\``);
  lines.push('');
  lines.push(`- **Date**: ${run.startedAt}`);
  lines.push(`- **Model**: \`${run.model}\` (effort: ${run.effort})`);
  lines.push(`- **Prompt version**: \`${run.promptVersion.hash}\``);
  lines.push(`- **Cases**: ${run.caseIds.length} (${run.caseIds.join(', ')})`);
  lines.push(`- **Repeats per case**: ${run.repeats}`);
  lines.push(`- **API cost**: $${run.cost.totalUsd.toFixed(4)}`);
  if (run.dryRun) lines.push('- **Mode**: dry run (metrics only, no judge)');
  lines.push('');

  if (previous) {
    const changed = changedPromptFiles(previous.promptVersion?.files, run.promptVersion.files);
    lines.push(
      `Compared against run \`${previous.runId}\` (prompt version \`${previous.promptVersion?.hash}\`).`
    );
    if (changed.length) {
      lines.push('');
      lines.push('Prompt files changed since then:');
      for (const file of changed) lines.push(`- \`${file}\``);
    } else {
      lines.push('');
      lines.push('No prompt files changed since then — differences are run-to-run variance.');
    }
    lines.push('');
  }

  // Scores
  lines.push('## Scores by dimension');
  lines.push('');
  lines.push('| Dimension | Score | vs. previous |');
  lines.push('| --- | ---: | ---: |');
  for (const dimension of [...RUBRIC_DIMENSIONS, REFERENCE_DIMENSION]) {
    const score = scores[dimension];
    if (!Number.isFinite(score)) continue;
    const delta = deltas.find((d) => d.dimension === dimension);
    lines.push(
      `| ${DIMENSION_LABELS[dimension]} | ${score.toFixed(2)} | ${formatDelta(delta)} |`
    );
  }
  const overall = overallScore(scores);
  if (Number.isFinite(overall)) {
    lines.push(`| **Overall** | **${overall.toFixed(2)}** | ${formatDelta(overallDelta(run, previous))} |`);
  }
  lines.push('');

  if (regressions.length) {
    lines.push('> **Regression warning.** These dimensions moved down:');
    for (const r of regressions) {
      lines.push(`> - ${DIMENSION_LABELS[r.dimension]} (${r.delta.toFixed(2)})`);
    }
    lines.push('');
  }

  // Per-case table
  lines.push('## Per-case results');
  lines.push('');
  lines.push('| Case | Cat | Slides | Words/slide | Walls | Number support | Coverage | Mean |');
  lines.push('| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |');
  for (const result of run.results) {
    const first = result.repeats?.[0];
    if (!first) continue;
    const m = first.metrics;
    const meanOfCase = averageOf(
      (result.repeats || []).map((r) => r.meanScore).filter(Number.isFinite)
    );
    lines.push(
      `| ${result.caseId} | ${result.category} | ${m.slideCount} | ` +
        `${m.wordsPerSlide.mean} | ${m.wallOfTextSlides} | ` +
        `${formatPercent(first.numberFidelity.supportRate)} | ` +
        `${formatScore(first.verdict?.scores?.coverage?.score)} | ` +
        `${meanOfCase === null ? '—' : meanOfCase.toFixed(2)} |`
    );
  }
  lines.push('');

  // Lowest-scoring dimensions with rationales — the actionable part.
  const weakest = [...RUBRIC_DIMENSIONS, REFERENCE_DIMENSION]
    .filter((d) => Number.isFinite(scores[d]))
    .sort((a, b) => scores[a] - scores[b])
    .slice(0, 3);

  if (weakest.length && !run.dryRun) {
    lines.push('## Weakest dimensions — judge rationales');
    lines.push('');
    lines.push('These rationales are the input for the next prompt change.');
    lines.push('');
    for (const dimension of weakest) {
      lines.push(`### ${DIMENSION_LABELS[dimension]} (${scores[dimension].toFixed(2)})`);
      lines.push('');
      for (const result of run.results) {
        const entry = result.repeats?.[0]?.verdict?.scores?.[dimension];
        if (!entry) continue;
        lines.push(`- **${result.caseId}** (${entry.score}/5): ${entry.rationale}`);
      }
      lines.push('');
    }
  }

  if (!run.dryRun) {
    lines.push('## Top issue per case');
    lines.push('');
    for (const result of run.results) {
      const issue = result.repeats?.[0]?.verdict?.topLevelIssue;
      if (issue) lines.push(`- **${result.caseId}**: ${issue}`);
    }
    lines.push('');
  }

  // Variance across repeats — the model takes no temperature, so this is the
  // only honest read on run-to-run stability.
  const varied = run.results.filter((r) => (r.repeats || []).length > 1);
  if (varied.length) {
    lines.push('## Variance across repeats');
    lines.push('');
    lines.push('| Case | Mean scores per repeat | Spread |');
    lines.push('| --- | --- | ---: |');
    for (const result of varied) {
      const means = result.repeats.map((r) => r.meanScore).filter(Number.isFinite);
      const spread = means.length ? Math.max(...means) - Math.min(...means) : 0;
      lines.push(
        `| ${result.caseId} | ${means.map((m) => m.toFixed(2)).join(', ')} | ${spread.toFixed(2)} |`
      );
    }
    lines.push('');
  }

  lines.push('## Cost breakdown');
  lines.push('');
  lines.push('| Category | Calls | Input | Output | Cache read | USD |');
  lines.push('| --- | ---: | ---: | ---: | ---: | ---: |');
  for (const [category, bucket] of Object.entries(run.cost.byCategory)) {
    lines.push(
      `| ${category} | ${bucket.calls} | ${bucket.inputTokens} | ${bucket.outputTokens} | ` +
        `${bucket.cacheReadTokens} | $${bucket.usd.toFixed(4)} |`
    );
  }
  lines.push(`| **Total** | ${run.cost.total.calls} | ${run.cost.total.inputTokens} | ` +
    `${run.cost.total.outputTokens} | ${run.cost.total.cacheReadTokens} | ` +
    `**$${run.cost.totalUsd.toFixed(4)}** |`);
  lines.push('');

  const markdown = lines.join('\n');
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, markdown);
  return markdown;
}

function overallDelta(run, previous) {
  if (!previous) return null;
  const now = overallScore(run.scores);
  const before = overallScore(previous.scores);
  if (!Number.isFinite(now) || !Number.isFinite(before)) return null;
  const delta = Math.round((now - before) * 100) / 100;
  return {
    delta,
    direction: Math.abs(delta) < SIGNIFICANCE_THRESHOLD ? 'flat' : delta > 0 ? 'up' : 'down',
  };
}

function formatDelta(delta) {
  if (!delta) return '—';
  const arrow = delta.direction === 'up' ? '▲' : delta.direction === 'down' ? '▼' : '·';
  const sign = delta.delta > 0 ? '+' : '';
  return `${arrow} ${sign}${delta.delta.toFixed(2)}`;
}

function formatScore(score) {
  return Number.isFinite(score) ? `${score}/5` : '—';
}

function formatPercent(rate) {
  return Number.isFinite(rate) ? `${Math.round(rate * 100)}%` : '—';
}

function averageOf(values) {
  if (!values.length) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}
