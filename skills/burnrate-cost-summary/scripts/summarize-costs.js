#!/usr/bin/env node
'use strict';
// summarize-costs.js — session cost summary from monthly JSONL records.
// Usage: node summarize-costs.js [YYYY-MM] [from-date] [to-date] [--by-project] [--by-jira] [--daily] [--top N]
// Month defaults to the current month when omitted.
// Example: node summarize-costs.js 2026-05 2026-05-05 2026-05-11 --by-project --daily --top 5

const fs   = require('fs');
const path = require('path');
const { getDataDir } = require('../../../scripts/paths');

// Separate flags from positional args so flags can appear anywhere.
const rawArgs = process.argv.slice(2);

// --top N: show top N most expensive sessions (default 5).
let topN = 5;
const topIdx = rawArgs.findIndex(a => a === '--top');
if (topIdx !== -1) {
  const n = parseInt(rawArgs[topIdx + 1], 10);
  topN = (n > 0) ? n : 5;
}

const topConsumed = new Set(topIdx !== -1 ? [topIdx, topIdx + 1] : []);
const flags       = new Set(rawArgs.filter((a, i) => !topConsumed.has(i) && a.startsWith('--')));
const positional  = rawArgs.filter((a, i) => !topConsumed.has(i) && !a.startsWith('--'));

const byProject = flags.has('--by-project');
const byJira    = flags.has('--by-jira');
const daily     = flags.has('--daily');
const monthKey  = positional[0] || new Date().toISOString().slice(0, 7);
const fromDate  = positional[1];
const toDate    = positional[2];

const dataDir = getDataDir();
const file    = path.join(dataDir, 'monthly', monthKey + '.jsonl');
if (!fs.existsSync(file)) { console.log('No data file for', monthKey); process.exit(0); }

const records = fs.readFileSync(file, 'utf8')
  .split('\n').filter(Boolean)
  .map(l => { try { return JSON.parse(l); } catch (_) { return null; } })
  .filter(Boolean);

const filtered = records.filter(r => {
  if (!fromDate && !toDate) return true;
  const d = r.date || '';
  if (fromDate && d < fromDate) return false;
  if (toDate   && d > toDate)   return false;
  return true;
});

// Extract nested final_tokens fields. Our Copilot JSONL stores token counts
// under final_tokens.total_* rather than as top-level fields.
function tok(r, field) {
  const t = r.final_tokens;
  if (t && t[field] != null) return t[field];
  // Fallback: accept top-level field names for cross-compatibility
  return r[field] || 0;
}

const pluginTotal     = filtered.reduce((s, r) => s + (r.cost_usd || 0), 0);
const totalInput      = filtered.reduce((s, r) => s + tok(r, 'total_input_tokens'), 0);
const totalOutput     = filtered.reduce((s, r) => s + tok(r, 'total_output_tokens'), 0);
const totalCacheWrite = filtered.reduce((s, r) => s + tok(r, 'total_cache_write_tokens'), 0);
const totalCacheRead  = filtered.reduce((s, r) => s + tok(r, 'total_cache_read_tokens'), 0);
const hasTokens       = filtered.some(r => r.final_tokens != null);
const hasCacheTokens  = filtered.some(r =>
  tok(r, 'total_cache_write_tokens') > 0 || tok(r, 'total_cache_read_tokens') > 0);

const periodLabel = fromDate || toDate
  ? `${monthKey} (${fromDate || 'start'} to ${toDate || 'end'})`
  : monthKey;

console.log(`Period: ${periodLabel}`);
console.log(`Sessions: ${filtered.length}`);
console.log('');
console.log('─────────────────────────────────────────────────────────');
console.log(`Total cost: $${pluginTotal.toFixed(2)}`);
if (hasTokens) {
  console.log('─────────────────────────────────────────────────────────');
  console.log('Token totals  (sessions with token data):');
  console.log(`  Input:        ${totalInput.toLocaleString()}`);
  console.log(`  Output:       ${totalOutput.toLocaleString()}`);
  if (hasCacheTokens) {
    console.log(`  Cache writes: ${totalCacheWrite.toLocaleString()}`);
    console.log(`  Cache reads:  ${totalCacheRead.toLocaleString()}`);
  }
}
console.log('─────────────────────────────────────────────────────────');

// By-model summary
const modelMap = {};
for (const r of filtered) {
  const key = normalizeModel(r.model);
  if (!modelMap[key]) modelMap[key] = { sessions: 0, cost: 0 };
  modelMap[key].sessions += 1;
  modelMap[key].cost     += r.cost_usd || 0;
}
const modelRows = Object.entries(modelMap).sort((a, b) => b[1].cost - a[1].cost);
if (modelRows.length > 0) {
  console.log('');
  console.log('By model:');
  const nameW = Math.max(7, ...modelRows.map(([n]) => n.length));
  console.log(`  ${'Model'.padEnd(nameW)}  Sessions  Cost          % of total`);
  console.log(`  ${'─'.repeat(nameW)}  ────────  ──────────    ──────────`);
  for (const [name, row] of modelRows) {
    const pct = pluginTotal > 0 ? `${((row.cost / pluginTotal) * 100).toFixed(1)}%` : 'n/a';
    console.log(`  ${name.padEnd(nameW)}  ${String(row.sessions).padStart(8)}  $${row.cost.toFixed(2).padStart(9)}  ${pct.padStart(9)}`);
  }
  console.log('─────────────────────────────────────────────────────────');
}

if (byProject) {
  console.log('');
  console.log('By project:');

  const projects = {};
  for (const r of filtered) {
    const key  = r.project_id || r.project || '__unknown__';
    const name = r.project || (r.project_id ? r.project_id.split('-').pop() : 'unknown');
    if (!projects[key]) projects[key] = { name, cost: 0, sessions: 0 };
    projects[key].cost     += r.cost_usd || 0;
    projects[key].sessions += 1;
  }

  const sorted    = Object.values(projects).sort((a, b) => b.cost - a.cost);
  const nameWidth = Math.max(7, ...sorted.map(p => p.name.length));
  console.log(`  ${'Project'.padEnd(nameWidth)}  Sessions  Cost          % of total`);
  console.log(`  ${'─'.repeat(nameWidth)}  ────────  ──────────    ──────────`);
  for (const p of sorted) {
    const pct = pluginTotal > 0 ? `${((p.cost / pluginTotal) * 100).toFixed(1)}%` : 'n/a';
    console.log(`  ${p.name.padEnd(nameWidth)}  ${String(p.sessions).padStart(8)}  $${p.cost.toFixed(2).padStart(9)}  ${pct.padStart(9)}`);
  }
}

if (byJira) {
  console.log('');
  console.log('By Jira:');

  const jira = {};
  for (const r of filtered) {
    const split = (r.jira_costs && typeof r.jira_costs === 'object' && !Array.isArray(r.jira_costs))
      ? Object.entries(r.jira_costs).filter(([, val]) => isFinite(val) && val > 0)
      : [];

    if (split.length > 0) {
      for (const [key, cost] of split) {
        const label = key || 'unattributed';
        if (!jira[label]) jira[label] = { cost: 0, sessions: 0 };
        jira[label].cost += cost || 0;
        jira[label].sessions += 1;
      }
      continue;
    }

    const key = r.jira_key || 'unattributed';
    if (!jira[key]) jira[key] = { cost: 0, sessions: 0 };
    jira[key].cost += r.cost_usd || 0;
    jira[key].sessions += 1;
  }

  const sorted = Object.entries(jira).sort((a, b) => b[1].cost - a[1].cost);
  if (!sorted.length) {
    console.log('  no Jira attribution data');
  } else {
    const nameWidth = Math.max(12, ...sorted.map(([name]) => name.length));
    console.log(`  ${'Jira key'.padEnd(nameWidth)}  Sessions  Cost          % of total`);
    console.log(`  ${'─'.repeat(nameWidth)}  ────────  ──────────    ──────────`);
    for (const [name, row] of sorted) {
      const pct = pluginTotal > 0 ? `${((row.cost / pluginTotal) * 100).toFixed(1)}%` : 'n/a';
      console.log(`  ${name.padEnd(nameWidth)}  ${String(row.sessions).padStart(8)}  $${row.cost.toFixed(2).padStart(9)}  ${pct.padStart(9)}`);
    }
  }
}

if (daily) {
  console.log('');
  console.log('Daily breakdown:');

  const byDate = {};
  for (const r of filtered) {
    const d = r.date || 'unknown';
    if (!byDate[d]) byDate[d] = { sessions: 0, cost: 0, input: 0, cacheRead: 0 };
    byDate[d].sessions += 1;
    byDate[d].cost     += r.cost_usd                           || 0;
    byDate[d].input    += tok(r, 'total_input_tokens');
    byDate[d].cacheRead+= tok(r, 'total_cache_read_tokens');
  }

  const dates = Object.keys(byDate).sort();
  console.log('  Date        Sessions  Cost        Cache%');
  console.log('  ──────────  ────────  ──────────  ──────');
  for (const d of dates) {
    const row      = byDate[d];
    const cacheHit = row.input > 0
      ? `${Math.round((row.cacheRead / row.input) * 100)}%`.padStart(6)
      : '   n/a';
    console.log(`  ${d}  ${String(row.sessions).padStart(8)}  $${row.cost.toFixed(2).padStart(9)}  ${cacheHit}`);
  }
}

if (topN > 0) {
  console.log('');
  const label = topN === 1 ? 'top session' : `top ${topN} sessions`;
  console.log(`Most expensive sessions (${label}):`);
  const top = [...filtered].sort((a, b) => (b.cost_usd || 0) - (a.cost_usd || 0)).slice(0, topN);
  console.log('  Date        ID        Cost        Turns  Model');
  console.log('  ──────────  ────────  ──────────  ─────  ─────');
  top.forEach(r => {
    const proj   = r.project ? ` [${r.project}]` : '';
    const turns  = r.turn_count != null ? String(r.turn_count).padStart(5) : '  n/a';
    console.log(`  ${r.date}  ${(r.id||'').slice(0,8)}  $${(r.cost_usd||0).toFixed(2).padStart(9)}  ${turns}  ${normalizeModel(r.model)}${proj}`);
  });
}

console.log('');

function normalizeModel(raw) {
  if (!raw || raw === 'unknown') return '(unknown)';
  let m = raw.replace(/^(?:[a-z0-9]+\.)+/, '');
  if (!m.startsWith('claude')) return raw;
  const parts = m.split('-');
  let i = parts.length - 1;
  while (i > 0 && /^\d[\d.]*$/.test(parts[i])) i--;
  const nameParts = parts.slice(0, i + 1);
  const verParts  = parts.slice(i + 1);
  const name = nameParts.map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(' ');
  const ver = verParts.length && !/^\d{8,}/.test(verParts[0])
    ? ' ' + verParts.join('.')
    : '';
  return name + ver;
}
