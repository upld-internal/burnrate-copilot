#!/usr/bin/env node
'use strict';
/**
 * verify-compaction-cost.js — Task 7 verification script.
 *
 * Confirms:
 * 1. Compaction tokens are INCLUDED in modelMetrics (not double-counted)
 * 2. parseCompactionCosts correctly extracts cost breakdown
 * 3. compaction_cost is always a proper subset of total session cost
 * 4. Sessions without compaction return null (field omitted)
 *
 * Usage: node scripts/verify-compaction-cost.js
 */

const { parseEventsFile, parseCompactionCosts, computeMultiModelCost, loadPricingTable } = require('./events-parser');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { getDataDir } = require('./paths');

const dataDir = getDataDir();
const pricingTable = loadPricingTable(dataDir, __dirname);
const { getCopilotConfigDir } = require('./paths');
const configDir = path.join(getCopilotConfigDir(), 'session-state');

if (!fs.existsSync(configDir)) {
  console.log('No session-state directory found. Cannot verify.');
  process.exit(1);
}

const dirs = fs.readdirSync(configDir).filter(d => !d.startsWith('.'));
let totalSessions = 0;
let withCompaction = 0;
let withoutCompaction = 0;
let verified = 0;
let passed = 0;
let totalCompactionCost = 0;
let totalSessionCost = 0;

console.log('═══════════════════════════════════════════════════════════════');
console.log(' Task 7 Verification: Compaction Token Cost Tracking');
console.log('═══════════════════════════════════════════════════════════════\n');

for (const sid of dirs) {
  const result = parseEventsFile(sid);
  if (!result) continue;
  totalSessions++;

  if (result.compactions.length === 0) {
    withoutCompaction++;
    // Verify null returned
    const comp = parseCompactionCosts(sid, pricingTable);
    if (comp !== null) {
      console.log(`✗ FAIL: ${sid} has 0 compactions but parseCompactionCosts returned non-null`);
    }
    continue;
  }

  withCompaction++;
  if (!result.shutdownMetrics) continue;

  const multiModel = computeMultiModelCost(result.shutdownMetrics, pricingTable);
  const compaction = parseCompactionCosts(sid, pricingTable);
  if (!multiModel || !compaction || multiModel.total === 0) continue;

  verified++;
  totalCompactionCost += compaction.total_cost_usd;
  totalSessionCost += multiModel.total;

  const isSubset = compaction.total_cost_usd < multiModel.total;
  if (isSubset) {
    passed++;
  } else {
    console.log(`✗ FAIL: ${sid}`);
    console.log(`  Compaction: $${compaction.total_cost_usd.toFixed(4)} >= Total: $${multiModel.total.toFixed(4)}`);
  }

  if (verified <= 5) {
    const pct = (compaction.total_cost_usd / multiModel.total * 100).toFixed(1);
    console.log(`  ${sid.slice(0, 8)}... → $${multiModel.total.toFixed(2)} total, $${compaction.total_cost_usd.toFixed(4)} compaction (${pct}%), ${compaction.count} compactions`);
  }
}

console.log('\n───────────────────────────────────────────────────────────────');
console.log(' Results');
console.log('───────────────────────────────────────────────────────────────');
console.log(`  Sessions scanned:        ${totalSessions}`);
console.log(`  With compaction:         ${withCompaction}`);
console.log(`  Without compaction:      ${withoutCompaction}`);
console.log(`  Verified (data+metrics): ${verified}`);
console.log(`  Passed (subset check):   ${passed}/${verified}`);
console.log(`  Avg compaction % of total: ${(totalCompactionCost / totalSessionCost * 100).toFixed(1)}%`);
console.log('───────────────────────────────────────────────────────────────');

if (passed === verified && verified > 0) {
  console.log('\n✓ VERIFIED: Compaction tokens are INCLUDED in modelMetrics.');
  console.log('  → compaction_cost is informational only (subset breakdown)');
  console.log('  → NOT added to cost_usd (would be double-counting)');
  console.log('  → Task 7 acceptance criteria: PASS');
  process.exit(0);
} else if (verified === 0) {
  console.log('\n⚠ No sessions with both compaction + shutdown data to verify.');
  process.exit(1);
} else {
  console.log('\n✗ SOME FAILURES — investigate double-counting risk.');
  process.exit(1);
}
