#!/usr/bin/env node
'use strict';
// session-end.js — Copilot CLI SessionEnd hook.
// Reads the session file and appends a record to the monthly JSONL file.
// Cost is derived from last_known_nano_aiu (written by compositor every turn).
// final_tokens is preserved for cache efficiency analysis.
//
// SessionEnd stdin schema (Copilot): only session_id / sessionId is provided.
// All cost data comes from the session file (written by statusline.js on every turn).

const fs   = require('fs');
const path = require('path');
const { getDataDir } = require('./paths');
const { parseShutdownEnriched } = require('./events-parser');
const { normalizeJiraCosts, selectPrimaryJiraKey } = require('./jira-attribution');
const { buildTelemetryFields, logHookDebug } = require('./session-file');

const dataDir = getDataDir();

// Compute final cost from session file.
// Strategy 1: last_known_nano_aiu → authoritative AI Credits billing
// Strategy 2: last_known_cost     → compositor-computed cost from last statusline turn
function computeFinalCost(session) {
  const nanoAiu = session.last_known_nano_aiu;
  if (typeof nanoAiu === 'number' && nanoAiu > 0) {
    return {
      cost: nanoAiu / 100_000_000_000,
      cost_method: 'ai_credits',
    };
  }
  return {
    cost: session.last_known_cost || 0,
    cost_method: session.last_known_cost ? 'last_known' : 'none',
  };
}

let raw = '';
process.stdin.setEncoding('utf8');
setTimeout(() => process.exit(0), 4000).unref(); // safety: exit if stdin never closes (Windows)
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

    const costResult = computeFinalCost(session);

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
    };

    // Jira attribution — include per-ticket cost breakdown when tracked.
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

    // Enriched fields from session.shutdown — files, reasoning, context breakdown, etc.
    try {
      const enriched = parseShutdownEnriched(sessionId);
      if (enriched) {
        if (enriched.files_modified)       record.files_modified       = enriched.files_modified;
        if (enriched.files_modified_count) record.files_modified_count = enriched.files_modified_count;
        if (enriched.premium_requests)     record.premium_requests     = enriched.premium_requests;
        if (enriched.api_duration_ms)      record.api_duration_ms      = enriched.api_duration_ms;
        if (enriched.reasoning_tokens)     record.reasoning_tokens     = enriched.reasoning_tokens;
        if (enriched.context_breakdown)    record.context_breakdown    = enriched.context_breakdown;
        if (enriched.models_used)          record.models_used          = enriched.models_used;
        if (enriched.lines_added != null)  record.lines_added          = enriched.lines_added;
        if (enriched.lines_removed != null) record.lines_removed       = enriched.lines_removed;
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
