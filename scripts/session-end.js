#!/usr/bin/env node
'use strict';
// session-end.js — Copilot CLI SessionEnd hook.
// Reads the session file and appends a record to the monthly JSONL file.
// cost_usd is 0 until pricing is resolved in Phase 6.
// final_tokens is preserved so cost can be recomputed retroactively.
//
// SessionEnd stdin schema (Copilot): only session_id / sessionId is provided.
// All cost/token data comes from the session file (written by statusline.js
// on every turn via last_known_tokens).

const fs   = require('fs');
const path = require('path');
const { getDataDir } = require('./paths');
const { loadPricing, computeCost, computeSessionCost } = require('./pricing');
const { computeMultiModelCostForSession, parseSubagentCompletions, parseCompactionCosts, loadPricingTable } = require('./events-parser');
const { normalizeJiraCosts, selectPrimaryJiraKey } = require('./jira-attribution');
const { buildTelemetryFields, logHookDebug } = require('./session-file');

const dataDir = getDataDir();

// Compute final cost — tries multi-model (events.jsonl) first, falls back to single-model.
// Returns { cost, model_metrics, cost_method }
function computeFinalCostWithMetrics(session, sessionId, modelId, dataDir) {
  // Strategy 1: Multi-model cost from events.jsonl session.shutdown.modelMetrics
  // This is the most accurate method — per-model rates applied to per-model tokens.
  try {
    const pricingTable = loadPricingTable(dataDir, __dirname);
    const result = computeMultiModelCostForSession(sessionId, pricingTable);
    if (result && result.total > 0) {
      return {
        cost: result.total,
        model_metrics: result.perModel,
        cost_method: 'multi_model',
      };
    }
  } catch (_) {}

  // Strategy 2: model_tokens from session file (real-time per-model tracking)
  // Available after Ctrl+C since compositor writes model_tokens every turn.
  if (session.model_tokens && Object.keys(session.model_tokens).length) {
    try {
      const pricingTable = loadPricingTable(dataDir, __dirname);
      let total = 0;
      let hasPricing = false;
      const perModel = {};
      for (const [mid, tokens] of Object.entries(session.model_tokens)) {
        const mp = pricingTable[mid];
        if (mp) {
          hasPricing = true;
          const cost = computeCost(tokens.input || 0, tokens.output || 0, tokens.cache_write || 0, tokens.cache_read || 0, mp);
          total += cost;
          perModel[mid] = { cost, hasPricing: true, tokens };
        } else {
          perModel[mid] = { cost: 0, hasPricing: false, tokens };
        }
      }
      if (hasPricing && total > 0) {
        return {
          cost: total,
          model_metrics: perModel,
          cost_method: 'model_tokens',
        };
      }
    } catch (_) {}
  }

  // Strategy 3: Single-model pricing from last_known_tokens (fallback)
  // Used when both events.jsonl and model_tokens are unavailable
  const tokens = session.last_known_tokens;
  const snap   = session.snapshot;
  if (tokens && snap) {
    const pricing = loadPricing(modelId, dataDir, __dirname);
    if (pricing) {
      return {
        cost: computeSessionCost(tokens, snap, pricing),
        model_metrics: null,
        cost_method: 'single_model',
      };
    }
  }

  // Strategy 4: Use last_known_cost from compositor (last resort)
  return {
    cost: session.last_known_cost || 0,
    model_metrics: null,
    cost_method: session.last_known_cost ? 'last_known' : 'none',
  };
}

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { raw += chunk; });
process.stdin.on('end', () => {
  try {
    raw = raw.trim();
    if (!raw) process.exit(0);

    const data = JSON.parse(raw);

    const sessionId = (data.sessionId || data.session_id || '').trim();
    if (!sessionId) process.exit(0);

    logHookDebug('sessionEnd', data, sessionId);

    const sessionPath = path.join(dataDir, 'sessions', sessionId + '.json');
    if (!fs.existsSync(sessionPath)) process.exit(0);

    const session    = JSON.parse(fs.readFileSync(sessionPath, 'utf8'));
    const modelId    = session.last_known_model || session.model_id || '';
    const startMonth = session.start_month || new Date().toISOString().slice(0, 7);

    const monthlyDir  = path.join(dataDir, 'monthly');
    fs.mkdirSync(monthlyDir, { recursive: true });
    const monthlyFile = path.join(monthlyDir, startMonth + '.jsonl');

    // Compute cost — prefers multi-model (events.jsonl) over single-model
    const costResult = computeFinalCostWithMetrics(session, sessionId, modelId, dataDir);

    const record = {
      id:           sessionId,
      date:         new Date().toISOString().slice(0, 10),
      start_month:  startMonth,
      cost_usd:     costResult.cost,
      cost_pending: false,
      cost_method:  costResult.cost_method,
      model:        modelId,
      project:      session.last_known_project    || session.project    || undefined,
      project_id:   session.last_known_project_id || session.project_id || undefined,
      final_tokens: session.last_known_tokens     || undefined,
      model_metrics: costResult.model_metrics     || undefined,
    };

    // Jira attribution — include per-ticket cost breakdown when tracked.
    // Fall back to a single-key record when jira_costs map is absent but
    // last_known_jira_key was set (e.g. only one ticket the whole session).
    const jiraCosts = normalizeJiraCosts(session.jira_costs);
    if (!Object.keys(jiraCosts).length && session.last_known_jira_key && record.cost_usd > 0) {
      jiraCosts[session.last_known_jira_key] = Math.round(record.cost_usd * 1e6) / 1e6;
    }
    if (Object.keys(jiraCosts).length) {
      record.jira_costs = jiraCosts;
      const primary = selectPrimaryJiraKey(jiraCosts, session.last_known_jira_key);
      if (primary) {
        record.jira_key    = primary;
        record.jira_source = 'branch';
      }
      const seenKeys = Object.keys(jiraCosts).filter(k => k !== 'unattributed');
      if (seenKeys.length > 1) record.jira_keys_seen = seenKeys.sort();
    }

    // Telemetry fields — turn counts, tool usage, file extensions, timing
    Object.assign(record, buildTelemetryFields(session));

    // Subagent cost attribution — per-agent breakdown from events.jsonl
    try {
      const pricingTable = loadPricingTable(dataDir, __dirname);
      const subagentsDetail = parseSubagentCompletions(sessionId, pricingTable);
      if (subagentsDetail && subagentsDetail.length > 0) {
        record.subagents_detail = subagentsDetail;
      }
      // Compaction cost data
      const compactionData = parseCompactionCosts(sessionId, pricingTable);
      if (compactionData) {
        record.compaction_cost = compactionData;
      }
    } catch (_) {}

    // appendFileSync is safe for concurrent sessions on local disk
    fs.appendFileSync(monthlyFile, JSON.stringify(record) + '\n');

    // Clean up session snapshot only after the JSONL record is written
    try { fs.unlinkSync(sessionPath); } catch (_) {}

    // Mark session inactive in hud-state.json
    try {
      const { withStateLock, STATE_FILE } = require('./state');
      withStateLock(state => ({ ...state, sessionActive: false }), STATE_FILE);
    } catch (_) {}

  } catch (_) {
    // Never crash Copilot shutdown
  }
});
