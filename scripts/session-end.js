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
const { loadPricing, computeSessionCost } = require('./pricing');

const dataDir = getDataDir();

const DEBUG = process.env.COPILOT_HUD_DEBUG === '1';

// Compute final cost from last_known_tokens and pricing.
// Falls back to last_known_cost (written by compositor each turn) if pricing unavailable.
function computeFinalCost(session, modelId, dataDir) {
  const tokens  = session.last_known_tokens;
  const snap    = session.snapshot;
  if (tokens && snap) {
    const pricing = loadPricing(modelId, dataDir, __dirname);
    if (pricing) return computeSessionCost(tokens, snap, pricing);
  }
  return session.last_known_cost || 0;
}

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { raw += chunk; });
process.stdin.on('end', () => {
  try {
    raw = raw.trim();
    if (!raw) process.exit(0);

    const data = JSON.parse(raw);

    if (DEBUG) {
      try {
        const logPath = path.join(dataDir, 'session-end-debug.jsonl');
        fs.appendFileSync(logPath, JSON.stringify({ ts: new Date().toISOString(), data }) + '\n');
      } catch (_) {}
    }

    const sessionId = (data.sessionId || data.session_id || '').trim();
    if (!sessionId) process.exit(0);

    const sessionPath = path.join(dataDir, 'sessions', sessionId + '.json');
    if (!fs.existsSync(sessionPath)) process.exit(0);

    const session    = JSON.parse(fs.readFileSync(sessionPath, 'utf8'));
    const modelId    = session.last_known_model || session.model_id || '';
    const startMonth = session.start_month || new Date().toISOString().slice(0, 7);

    const monthlyDir  = path.join(dataDir, 'monthly');
    fs.mkdirSync(monthlyDir, { recursive: true });
    const monthlyFile = path.join(monthlyDir, startMonth + '.jsonl');

    const record = {
      id:           sessionId,
      date:         new Date().toISOString().slice(0, 10),
      start_month:  startMonth,
      cost_usd:     computeFinalCost(session, modelId, dataDir),
      cost_pending: false,
      model:        modelId,
      project:      session.last_known_project    || session.project    || undefined,
      project_id:   session.last_known_project_id || session.project_id || undefined,
      final_tokens: session.last_known_tokens     || undefined,
    };

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
