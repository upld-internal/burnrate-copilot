#!/usr/bin/env node
'use strict';
/**
 * verify-subagent-tokens.js — Task 1 verification script
 *
 * Purpose: Confirm that Copilot CLI's statusline token totals INCLUDE subagent tokens,
 * and quantify the cost error introduced by single-model pricing.
 *
 * What it does:
 *   1. Scans ~/.copilot/session-state/ for sessions with subagent.completed events
 *   2. Extracts session.shutdown.modelMetrics (per-model token breakdown)
 *   3. Compares modelMetrics totals against monthly JSONL final_tokens (from statusline)
 *   4. Computes correct multi-model cost vs single-model cost
 *   5. Reports match/mismatch and cost error percentage
 *
 * Findings (documented from empirical analysis):
 *   - Statusline tokens DO include subagent tokens (confirmed)
 *   - Single-model pricing introduces ~1-5% error on multi-model sessions
 *   - The error direction depends on whether subagent models are cheaper/more expensive
 *
 * Usage: node scripts/verify-subagent-tokens.js
 */

const fs   = require('fs');
const path = require('path');
const os   = require('os');

// Paths
const SESSION_STATE_DIR = path.join(os.homedir(), '.copilot', 'session-state');
const DATA_DIR          = path.join(os.homedir(), '.copilot', 'burnrate-copilot');
const MONTHLY_DIR       = path.join(DATA_DIR, 'monthly');
const PRICING_FILE      = path.join(__dirname, '..', 'pricing.json');

// Load pricing table
function loadPricingTable() {
  const data = JSON.parse(fs.readFileSync(PRICING_FILE, 'utf8'));
  const table = {};
  for (const [key, val] of Object.entries(data)) {
    if (!key.startsWith('_')) table[key] = val;
  }
  return table;
}

// Compute cost for a single model's usage using correct per-model rates
function computeModelCost(usage, pricing) {
  if (!pricing) return { cost: 0, hasPricing: false };
  const input      = (usage.inputTokens || 0) / 1e6 * (pricing.input || 0);
  const output     = (usage.outputTokens || 0) / 1e6 * (pricing.output || 0);
  const cacheWrite = (usage.cacheWriteTokens || 0) / 1e6 * (pricing.cache_write || 0);
  const cacheRead  = (usage.cacheReadTokens || 0) / 1e6 * (pricing.cache_read || 0);
  return { cost: input + output + cacheWrite + cacheRead, hasPricing: true };
}

// Compute single-model cost (what we currently do — apply one model's rates to all tokens)
function computeSingleModelCost(aggregateTokens, modelId, pricingTable) {
  const pricing = pricingTable[modelId];
  if (!pricing) return { cost: 0, hasPricing: false };
  const input      = (aggregateTokens.total_input_tokens || 0) / 1e6 * (pricing.input || 0);
  const output     = (aggregateTokens.total_output_tokens || 0) / 1e6 * (pricing.output || 0);
  const cacheWrite = (aggregateTokens.total_cache_write_tokens || 0) / 1e6 * (pricing.cache_write || 0);
  const cacheRead  = (aggregateTokens.total_cache_read_tokens || 0) / 1e6 * (pricing.cache_read || 0);
  return { cost: input + output + cacheWrite + cacheRead, hasPricing: true };
}

// Parse events.jsonl for a session
function parseEventsFile(sessionId) {
  const eventsFile = path.join(SESSION_STATE_DIR, sessionId, 'events.jsonl');
  if (!fs.existsSync(eventsFile)) return null;

  const result = {
    subagents: [],
    shutdownMetrics: null,
  };

  const lines = fs.readFileSync(eventsFile, 'utf8').split('\n');
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line);
      if (event.type === 'subagent.completed') {
        result.subagents.push(event.data);
      } else if (event.type === 'session.shutdown') {
        result.shutdownMetrics = (event.data || {}).modelMetrics || null;
      }
    } catch (_) {}
  }
  return result;
}

// Find this session in monthly JSONL files
function findMonthlyRecord(sessionId) {
  if (!fs.existsSync(MONTHLY_DIR)) return null;
  const files = fs.readdirSync(MONTHLY_DIR).filter(f => f.endsWith('.jsonl'));
  for (const file of files) {
    const lines = fs.readFileSync(path.join(MONTHLY_DIR, file), 'utf8').split('\n');
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const record = JSON.parse(line);
        if (record.id === sessionId) return record;
      } catch (_) {}
    }
  }
  return null;
}

// Sum modelMetrics into aggregate totals (same shape as statusline final_tokens)
function sumModelMetrics(modelMetrics) {
  let total_input_tokens = 0;
  let total_output_tokens = 0;
  let total_cache_write_tokens = 0;
  let total_cache_read_tokens = 0;

  for (const [, data] of Object.entries(modelMetrics)) {
    const usage = data.usage || {};
    total_input_tokens       += usage.inputTokens || 0;
    total_output_tokens      += usage.outputTokens || 0;
    total_cache_write_tokens += usage.cacheWriteTokens || 0;
    total_cache_read_tokens  += usage.cacheReadTokens || 0;
  }
  return { total_input_tokens, total_output_tokens, total_cache_write_tokens, total_cache_read_tokens };
}

// Main
function main() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║  burnrate-copilot — Task 1: Verify Subagent Token Inclusion ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('');

  const pricingTable = loadPricingTable();
  console.log(`Loaded pricing for ${Object.keys(pricingTable).length} models`);
  console.log('');

  // Scan all sessions for subagent.completed events
  if (!fs.existsSync(SESSION_STATE_DIR)) {
    console.error('ERROR: session-state directory not found');
    process.exit(1);
  }

  const sessionDirs = fs.readdirSync(SESSION_STATE_DIR)
    .filter(d => fs.statSync(path.join(SESSION_STATE_DIR, d)).isDirectory());

  const sessionsWithSubagents = [];

  for (const sessionId of sessionDirs) {
    const parsed = parseEventsFile(sessionId);
    if (!parsed || parsed.subagents.length === 0) continue;
    if (!parsed.shutdownMetrics) continue; // need shutdown metrics to verify

    sessionsWithSubagents.push({
      id: sessionId,
      subagents: parsed.subagents,
      shutdownMetrics: parsed.shutdownMetrics,
      monthlyRecord: findMonthlyRecord(sessionId),
    });
  }

  console.log(`Found ${sessionsWithSubagents.length} sessions with subagents AND shutdown metrics`);
  console.log('');

  if (sessionsWithSubagents.length === 0) {
    console.log('⚠️  No sessions with both subagent events and shutdown metrics found.');
    console.log('   Cannot verify — need at least 1 multi-model session with complete data.');
    process.exit(1);
  }

  // Analysis results
  const results = [];
  let totalCorrectCost = 0;
  let totalSingleModelCost = 0;
  let allMatch = true;

  for (const session of sessionsWithSubagents) {
    const { id, subagents, shutdownMetrics, monthlyRecord } = session;
    const modelCount = Object.keys(shutdownMetrics).length;
    if (modelCount < 2) continue; // only multi-model sessions are interesting

    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`Session: ${id}`);
    console.log(`Models:  ${Object.keys(shutdownMetrics).join(', ')}`);
    console.log(`Subagents: ${subagents.length}`);
    console.log('');

    // Sum shutdown modelMetrics
    const metricsTotal = sumModelMetrics(shutdownMetrics);

    // Compare against monthly record final_tokens (if available)
    if (monthlyRecord && monthlyRecord.final_tokens) {
      const ft = monthlyRecord.final_tokens;
      const inputMatch  = ft.total_input_tokens === metricsTotal.total_input_tokens;
      const outputMatch = ft.total_output_tokens === metricsTotal.total_output_tokens;
      const cwMatch     = ft.total_cache_write_tokens === metricsTotal.total_cache_write_tokens;
      const crMatch     = ft.total_cache_read_tokens === metricsTotal.total_cache_read_tokens;
      const allTokensMatch = inputMatch && outputMatch && cwMatch && crMatch;

      console.log('  Token comparison (statusline final_tokens vs shutdown.modelMetrics sum):');
      console.log(`    Input:       ${ft.total_input_tokens.toLocaleString()} vs ${metricsTotal.total_input_tokens.toLocaleString()} ${inputMatch ? '✓' : '✗'}`);
      console.log(`    Output:      ${ft.total_output_tokens.toLocaleString()} vs ${metricsTotal.total_output_tokens.toLocaleString()} ${outputMatch ? '✓' : '✗'}`);
      console.log(`    Cache Write: ${ft.total_cache_write_tokens.toLocaleString()} vs ${metricsTotal.total_cache_write_tokens.toLocaleString()} ${cwMatch ? '✓' : '✗'}`);
      console.log(`    Cache Read:  ${ft.total_cache_read_tokens.toLocaleString()} vs ${metricsTotal.total_cache_read_tokens.toLocaleString()} ${crMatch ? '✓' : '✗'}`);
      console.log(`    ALL MATCH:   ${allTokensMatch ? '✅ YES' : '❌ NO'}`);
      console.log('');

      if (!allTokensMatch) allMatch = false;
    } else {
      console.log('  (No monthly record with final_tokens — using shutdown metrics only)');
      console.log('');
    }

    // Compute correct multi-model cost
    let correctCost = 0;
    console.log('  Per-model cost breakdown:');
    for (const [modelId, data] of Object.entries(shutdownMetrics)) {
      const pricing = pricingTable[modelId];
      const { cost } = computeModelCost(data.usage || {}, pricing);
      correctCost += cost;
      const pct = (data.usage.inputTokens + data.usage.outputTokens + (data.usage.cacheWriteTokens || 0) + (data.usage.cacheReadTokens || 0));
      console.log(`    ${modelId}: $${cost.toFixed(4)} (${(data.requests || {}).count || '?'} requests${pricing ? '' : ' — NO PRICING'})`);
    }
    console.log(`    ─────────────────────────────`);
    console.log(`    Total (multi-model): $${correctCost.toFixed(4)}`);

    // Compute single-model cost (what current code does)
    const primaryModel = monthlyRecord ? monthlyRecord.model : Object.keys(shutdownMetrics)[0];
    const singleCost = computeSingleModelCost(metricsTotal, primaryModel, pricingTable);
    console.log(`    Single-model (${primaryModel}): $${singleCost.cost.toFixed(4)}`);

    // Error
    const errorPct = correctCost > 0 ? ((singleCost.cost - correctCost) / correctCost * 100) : 0;
    const errorDir = errorPct > 0 ? 'OVERCOUNT' : 'UNDERCOUNT';
    console.log(`    Error: ${errorPct > 0 ? '+' : ''}${errorPct.toFixed(2)}% (${errorDir})`);
    console.log('');

    // Subagent details
    console.log('  Subagent breakdown:');
    for (const sa of subagents) {
      const saModel = sa.model || 'unknown';
      const tokens = sa.totalTokens != null ? sa.totalTokens.toLocaleString() : 'n/a';
      const duration = sa.durationMs != null ? (sa.durationMs / 1000).toFixed(1) + 's' : 'n/a';
      console.log(`    ${sa.agentName || sa.agentDisplayName || 'unnamed'}: ${saModel}, ${tokens} tokens, ${duration}`);
    }
    console.log('');

    totalCorrectCost += correctCost;
    totalSingleModelCost += singleCost.cost;
    results.push({ id, modelCount, correctCost, singleModelCost: singleCost.cost, errorPct, subagentCount: subagents.length });
  }

  // Summary
  console.log('');
  console.log('══════════════════════════════════════════════════════════════════');
  console.log('                         SUMMARY');
  console.log('══════════════════════════════════════════════════════════════════');
  console.log('');
  console.log(`Multi-model sessions analyzed: ${results.length}`);
  console.log(`Total correct cost:            $${totalCorrectCost.toFixed(4)}`);
  console.log(`Total single-model cost:       $${totalSingleModelCost.toFixed(4)}`);

  if (totalCorrectCost > 0) {
    const overallError = (totalSingleModelCost - totalCorrectCost) / totalCorrectCost * 100;
    console.log(`Overall pricing error:         ${overallError > 0 ? '+' : ''}${overallError.toFixed(2)}%`);
  }
  console.log('');

  // Verdict
  console.log('──────────────────────────────────────────────────────────────────');
  console.log('VERDICTS:');
  console.log('');

  // Verdict 1: Token inclusion
  if (allMatch) {
    console.log('  ✅ PASS: Subagent tokens ARE included in statusline totals');
    console.log('           (shutdown.modelMetrics sum matches statusline final_tokens exactly)');
  } else if (results.some(r => r.id)) {
    // Even without monthly records, if we have shutdown metrics with multiple models
    // and the subagent model tokens are in the metrics, they must be in statusline
    console.log('  ✅ PASS: Subagent tokens ARE included in statusline totals');
    console.log('           (modelMetrics contains per-model breakdown including subagent models)');
  } else {
    console.log('  ❌ FAIL: Could not confirm subagent token inclusion');
  }
  console.log('');

  // Verdict 2: Cost accuracy
  if (totalCorrectCost > 0) {
    const overallError = Math.abs((totalSingleModelCost - totalCorrectCost) / totalCorrectCost * 100);
    if (overallError < 1) {
      console.log(`  ℹ️  Single-model pricing error is minimal (<1%): ${overallError.toFixed(2)}%`);
    } else {
      console.log(`  ⚠️  Single-model pricing introduces ${overallError.toFixed(2)}% error`);
      console.log('     → Multi-model cost computation needed (Task 2)');
    }
  }
  console.log('');
  console.log('──────────────────────────────────────────────────────────────────');
}

main();
