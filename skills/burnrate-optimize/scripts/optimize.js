#!/usr/bin/env node
'use strict';
// optimize.js — analyze Copilot CLI session telemetry for cost patterns and inefficiencies.
// Usage: node optimize.js [--days N] [--project name]
// Defaults: last 30 days, all projects.
//
// Note: Unlike Claude Code's optimize (which scans raw session transcripts),
// this version analyzes the monthly JSONL telemetry records collected by the
// session hooks. Recommendations are based on cost patterns, tool/model usage,
// and turn-interval data.

const fs   = require('fs');
const path = require('path');
const { getDataDir } = require('../../../scripts/paths');

// ─── config ───────────────────────────────────────────────────────────────────

const HEALTH_WEIGHT = { high: 15, medium: 7, low: 3 };

// Models ranked by approximate cost tier for upgrade/downgrade suggestions.
// Lower index = cheaper / faster.
const MODEL_TIERS = [
  'claude-haiku-4.5',
  'gpt-4.1-mini',
  'gpt-5-mini',
  'gpt-5.4-mini',
  'gemini-3-flash',
  'claude-sonnet-4.5',
  'claude-sonnet-4.6',
  'gpt-5.2',
  'gpt-5.3-codex',
  'gpt-5.2-codex',
  'gpt-5.4',
  'gpt-5.5',
  'claude-opus-4.5',
  'claude-opus-4.6',
  'claude-opus-4.7',
];
const EXPENSIVE_MODELS = new Set(['claude-opus-4.5', 'claude-opus-4.6', 'claude-opus-4.7', 'gpt-5.5']);

// ─── arg parsing ──────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
let days = 30;
let filterProject = null;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--days' && args[i + 1]) days = parseInt(args[++i], 10) || 30;
  if ((args[i] === '--project' || args[i] === '-p') && args[i + 1]) filterProject = args[++i];
}

const cutoff = new Date(Date.now() - days * 86400000);
const dataDir = getDataDir();

// ─── load records ─────────────────────────────────────────────────────────────

function loadRecords() {
  const monthlyDir = path.join(dataDir, 'monthly');
  if (!fs.existsSync(monthlyDir)) return [];

  const months = new Set();
  const today = new Date();
  for (let i = 0; i <= Math.ceil(days / 28) + 1; i++) {
    const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
    months.add(d.toISOString().slice(0, 7));
  }

  const records = [];
  for (const month of months) {
    const file = path.join(monthlyDir, month + '.jsonl');
    if (!fs.existsSync(file)) continue;
    const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        const r = JSON.parse(line);
        if (r.date && new Date(r.date) < cutoff) continue;
        if (filterProject && r.project && !r.project.includes(filterProject)) continue;
        records.push(r);
      } catch (_) {}
    }
  }
  return records;
}

// ─── analysis helpers ─────────────────────────────────────────────────────────

function topN(obj, n) {
  return Object.entries(obj)
    .sort(([, a], [, b]) => b - a)
    .slice(0, n);
}

function avg(arr) {
  if (!arr.length) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function p95(arr) {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length * 0.95)];
}

function fmtMs(ms) {
  if (ms < 60000) return `${(ms / 1000).toFixed(0)}s`;
  if (ms < 3600000) return `${(ms / 60000).toFixed(1)}m`;
  return `${(ms / 3600000).toFixed(1)}h`;
}

// ─── main analysis ────────────────────────────────────────────────────────────

const records = loadRecords();

if (!records.length) {
  console.log(`No session data found for the last ${days} days.`);
  console.log('Start using Copilot CLI with the burnrate-copilot plugin to capture telemetry.');
  process.exit(0);
}

const totalCost      = records.reduce((s, r) => s + (r.cost_usd || 0), 0);
const sessionCount   = records.length;
const avgCost        = totalCost / sessionCount;

// Aggregate telemetry
const allIntervals   = records.flatMap(r => Array.isArray(r.turn_intervals) ? r.turn_intervals : []);
const allTurns       = records.filter(r => r.turn_count > 0).map(r => r.turn_count);

// Model distribution
const modelCost = {};
const modelSessions = {};
for (const r of records) {
  const m = r.model || 'unknown';
  modelCost[m]     = (modelCost[m] || 0) + (r.cost_usd || 0);
  modelSessions[m] = (modelSessions[m] || 0) + 1;
}

// Tool distribution (aggregate across sessions)
const toolTotals = {};
for (const r of records) {
  if (!r.tool_counts || typeof r.tool_counts !== 'object') continue;
  for (const [tool, count] of Object.entries(r.tool_counts)) {
    toolTotals[tool] = (toolTotals[tool] || 0) + count;
  }
}

// Extension distribution
const extTotals = {};
for (const r of records) {
  if (!r.ext_counts || typeof r.ext_counts !== 'object') continue;
  for (const [ext, count] of Object.entries(r.ext_counts)) {
    extTotals[ext] = (extTotals[ext] || 0) + count;
  }
}

// Project distribution
const projCost = {};
for (const r of records) {
  const p = r.project || 'unknown';
  projCost[p] = (projCost[p] || 0) + (r.cost_usd || 0);
}

// High-cost sessions
const sortedByCost = [...records].sort((a, b) => (b.cost_usd || 0) - (a.cost_usd || 0));
const topSessions  = sortedByCost.slice(0, 5);

// Sessions using expensive models
const expensiveSessions = records.filter(r => EXPENSIVE_MODELS.has(r.model));

// ─── generate findings ────────────────────────────────────────────────────────

const findings = [];

// Finding: high use of expensive models
const expensiveCost = expensiveSessions.reduce((s, r) => s + (r.cost_usd || 0), 0);
const expensivePct  = totalCost > 0 ? (expensiveCost / totalCost) * 100 : 0;
if (expensivePct > 20 && expensiveSessions.length >= 3) {
  findings.push({
    severity: 'high',
    title: `${expensivePct.toFixed(0)}% of cost from expensive models`,
    detail: `${expensiveSessions.length} sessions used ${[...EXPENSIVE_MODELS].filter(m => modelSessions[m]).join(', ')}. Consider claude-sonnet-4.6 for routine tasks — typically 4-6× cheaper per token.`,
    fix: 'Use --model claude-sonnet-4.6 or set the model via /model in the session start.',
  });
}

// Finding: single project dominates
const topProj = topN(projCost, 1)[0];
if (topProj && totalCost > 0 && (topProj[1] / totalCost) > 0.7 && sessionCount >= 5) {
  findings.push({
    severity: 'medium',
    title: `${topProj[0]} accounts for ${((topProj[1] / totalCost) * 100).toFixed(0)}% of total spend`,
    detail: 'Concentrated spend in one project. Review whether large context loads or repeated operations are driving the cost.',
    fix: `Run /burnrate-cost-summary with --by-project for a detailed breakdown of ${topProj[0]}.`,
  });
}

// Finding: high average turns per session
if (allTurns.length > 0) {
  const avgTurns = avg(allTurns);
  const p95Turns = p95(allTurns);
  if (avgTurns > 30 || p95Turns > 60) {
    findings.push({
      severity: 'medium',
      title: `High turn count: avg ${avgTurns.toFixed(0)}, p95 ${p95Turns} turns/session`,
      detail: 'Long sessions accumulate context, which increases input token costs for every subsequent turn. Consider starting new sessions for unrelated tasks.',
      fix: 'Split long sessions. Use /clear or start a new Copilot session for each major task change.',
    });
  }
}

// Finding: slow turn intervals (long think time between prompts)
if (allIntervals.length >= 10) {
  const avgInterval = avg(allIntervals);
  const p95Interval = p95(allIntervals);
  if (p95Interval > 120000) { // 2 minutes
    findings.push({
      severity: 'low',
      title: `High p95 turn interval: ${fmtMs(p95Interval)}`,
      detail: `Average time between prompts is ${fmtMs(avgInterval)}. Long intervals can mean the AI is doing complex multi-step work — consider using subagents for parallelizable tasks.`,
      fix: 'Use the task tool with multiple parallel agents for independent subtasks.',
    });
  }
}

// Finding: heavy use of view/read without corresponding edits
const totalViews = toolTotals['view'] || 0;
const totalEdits = (toolTotals['edit'] || 0) + (toolTotals['create'] || 0);
if (totalViews > 0 && totalEdits > 0 && totalViews / totalEdits > 4) {
  findings.push({
    severity: 'medium',
    title: `High view-to-edit ratio: ${totalViews} views vs ${totalEdits} edits`,
    detail: 'Reading many files repeatedly consumes significant input tokens. Repeated reads of the same file are a common source of waste.',
    fix: 'Use glob/grep for targeted searches. Avoid re-reading files you\'ve already read in the same session.',
  });
}

// Finding: top 5 sessions represent large % of spend
const top5Cost = topSessions.reduce((s, r) => s + (r.cost_usd || 0), 0);
const top5Pct  = totalCost > 0 ? (top5Cost / totalCost) * 100 : 0;
if (top5Pct > 60 && sessionCount > 10) {
  const worst = topSessions[0];
  findings.push({
    severity: 'high',
    title: `Top 5 sessions = ${top5Pct.toFixed(0)}% of total spend`,
    detail: `Most expensive session: ${worst.date} (${worst.project || 'unknown'}) — $${(worst.cost_usd || 0).toFixed(2)} with ${worst.turn_count || 'n/a'} turns.`,
    fix: 'Investigate these sessions. Long sessions on complex tasks may benefit from context clearing or task decomposition.',
  });
}

// ─── health score ─────────────────────────────────────────────────────────────

const healthPenalty = findings.reduce((s, f) => s + HEALTH_WEIGHT[f.severity], 0);
const healthScore   = Math.max(0, 100 - healthPenalty);
const healthLabel   = healthScore >= 80 ? '✓ Good' : healthScore >= 60 ? '⚡ Fair' : '⚠ Needs attention';

// ─── output ───────────────────────────────────────────────────────────────────

const periodLabel = days === 30 ? 'last 30 days' : `last ${days} days`;
console.log(`Period: ${periodLabel}  |  Sessions: ${sessionCount}  |  Total: $${totalCost.toFixed(2)}  |  Avg: $${avgCost.toFixed(2)}/session`);
console.log('');
console.log(`Health score: ${healthScore}/100  ${healthLabel}`);
console.log('─────────────────────────────────────────────────────────');

// Model breakdown
const modelRows = topN(modelCost, 5);
if (modelRows.length) {
  console.log('');
  console.log('Model usage:');
  const nameW = Math.max(5, ...modelRows.map(([n]) => n.length));
  for (const [name, cost] of modelRows) {
    const pct  = totalCost > 0 ? `${((cost / totalCost) * 100).toFixed(0)}%` : 'n/a';
    const sess = modelSessions[name] || 0;
    const tier = EXPENSIVE_MODELS.has(name) ? ' [premium]' : '';
    console.log(`  ${name.padEnd(nameW)}  $${cost.toFixed(2).padStart(7)}  ${pct.padStart(4)}  ${sess} sessions${tier}`);
  }
}

// Top tools
const toolRows = topN(toolTotals, 8);
if (toolRows.length) {
  console.log('');
  console.log('Tool usage (all sessions):');
  const nameW = Math.max(4, ...toolRows.map(([n]) => n.length));
  for (const [tool, count] of toolRows) {
    console.log(`  ${tool.padEnd(nameW)}  ${String(count).padStart(6)} calls`);
  }
}

// Top file extensions edited
const extRows = topN(extTotals, 6);
if (extRows.length) {
  console.log('');
  console.log('Files edited by extension:');
  for (const [ext, count] of extRows) {
    console.log(`  ${(ext || '[no ext]').padEnd(10)}  ${count} edits`);
  }
}

// Turn stats
if (allTurns.length > 0 || allIntervals.length > 0) {
  console.log('');
  console.log('Session stats:');
  if (allTurns.length > 0)
    console.log(`  Avg turns/session:   ${avg(allTurns).toFixed(1)}  (p95: ${p95(allTurns)})`);
  if (allIntervals.length > 0)
    console.log(`  Avg turn interval:   ${fmtMs(avg(allIntervals))}  (p95: ${fmtMs(p95(allIntervals))})`);
}

// Findings
if (findings.length > 0) {
  console.log('');
  console.log('─────────────────────────────────────────────────────────');
  console.log('Recommendations:');
  for (let i = 0; i < findings.length; i++) {
    const f = findings[i];
    const icon = f.severity === 'high' ? '⚠' : f.severity === 'medium' ? '◆' : '○';
    console.log('');
    console.log(`  ${icon} [${f.severity.toUpperCase()}] ${f.title}`);
    console.log(`     ${f.detail}`);
    console.log(`     Fix: ${f.fix}`);
  }
} else {
  console.log('');
  console.log('No significant inefficiencies detected. Session patterns look healthy.');
}

// Top expensive sessions
console.log('');
console.log('─────────────────────────────────────────────────────────');
console.log('Top sessions by cost:');
console.log('  Date        ID        Cost        Turns  Model');
console.log('  ──────────  ────────  ──────────  ─────  ─────');
topSessions.forEach(r => {
  const proj  = r.project ? ` [${r.project}]` : '';
  const turns = r.turn_count != null ? String(r.turn_count).padStart(5) : '  n/a';
  console.log(`  ${r.date}  ${(r.id||'').slice(0,8)}  $${(r.cost_usd||0).toFixed(2).padStart(9)}  ${turns}  ${r.model || 'unknown'}${proj}`);
});

console.log('');
