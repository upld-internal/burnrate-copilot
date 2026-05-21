#!/usr/bin/env node
'use strict';
// session-start.js — Copilot CLI SessionStart hook.
// Captures a zero-baseline token snapshot at session open.
// Also recovers orphaned sessions from prior crashes.
// Copilot CLI pipes session JSON to stdin when this hook fires.
//
// SessionStart stdin schema (Copilot):
//   sessionId     — camelCase (unlike statusLine which uses session_id)
//   session_id    — also present in some versions; we handle both
//   model.id      — model identifier string
//   model.display_name — human-readable model name
//   cwd           — current working directory

const fs   = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { getDataDir, getCopilotConfigDir } = require('./paths');
const { normalizeJiraCosts, selectPrimaryJiraKey } = require('./jira-attribution');
const { buildTelemetryFields, logHookDebug } = require('./session-file');
const { ensureStatusLineConfig } = require('./statusline-config');

const dataDir = getDataDir();

// ---------------------------------------------------------------------------
// Orphan recovery
// ---------------------------------------------------------------------------
// Scans sessions/ for files left behind by sessions that exited without
// firing SessionEnd (crash, force-quit, etc.). For each orphaned file:
//   - Writes a JSONL record preserving last_known_tokens for future cost
//     recomputation when pricing is resolved (Phase 6).
//   - Deletes the file regardless, so orphans don't accumulate.
//
// Safety: skips any session file whose last_known_at (or started_at) is
// less than 2 minutes old — it may belong to a concurrently running session.
function recoverOrphanedSessions(currentSessionId) {
  const TWO_MIN = 2 * 60 * 1000;
  const sessionsDir = path.join(dataDir, 'sessions');
  let files;
  try { files = fs.readdirSync(sessionsDir); } catch (_) { return; }

  const now = Date.now();

  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    const orphanId = file.slice(0, -5);
    if (orphanId === currentSessionId) continue;

    const filePath = path.join(sessionsDir, file);
    try {
      const session = JSON.parse(fs.readFileSync(filePath, 'utf8'));

      // Determine age from last_known_at, falling back to started_at
      const ageRef = session.last_known_at || session.started_at;
      if (ageRef) {
        const age = now - new Date(ageRef).getTime();
        if (age < TWO_MIN) continue; // too recent — may be a concurrent session
      }

      // Write recovery record. cost_usd is 0 until pricing is resolved
      // in Phase 6. last_known_tokens is preserved for retroactive computation.
      const modelId    = session.last_known_model || session.model_id || '';
      const startMonth = session.start_month || new Date().toISOString().slice(0, 7);
      const monthlyDir = path.join(dataDir, 'monthly');
      fs.mkdirSync(monthlyDir, { recursive: true });
      const monthlyFile = path.join(monthlyDir, startMonth + '.jsonl');

      const record = {
        id:           session.session_id,
        date:         new Date().toISOString().slice(0, 10),
        start_month:  startMonth,
        cost_usd:     0,         // placeholder until pricing resolved (Phase 6)
        cost_pending: true,      // flag that cost needs recomputation
        model:        modelId,
        project:      session.last_known_project    || session.project    || undefined,
        project_id:   session.last_known_project_id || session.project_id || undefined,
        final_tokens: session.last_known_tokens     || undefined,
        recovered:    true,
      };

      // Include Jira attribution if it was tracked in this orphaned session.
      const jiraCosts = normalizeJiraCosts(session.jira_costs);
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

      // Include telemetry if it was tracked in this orphaned session.
      Object.assign(record, buildTelemetryFields(session));
      fs.appendFileSync(monthlyFile, JSON.stringify(record) + '\n');

      // Delete regardless — even zero-activity orphans should not accumulate
      fs.unlinkSync(filePath);
    } catch (_) {
      // Can't process this file — leave it for next time
    }
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { raw += chunk; });
process.stdin.on('end', () => {
  try {
    fs.mkdirSync(path.join(dataDir, 'sessions'), { recursive: true });
    fs.mkdirSync(path.join(dataDir, 'monthly'),  { recursive: true });

    raw = raw.trim();
    if (!raw) process.exit(0);

    const data = JSON.parse(raw);

    // SessionStart uses camelCase sessionId; statusLine uses snake_case session_id.
    // Handle both for robustness.
    const sessionId = (data.sessionId || data.session_id || '').trim()
      || ('session-' + Date.now());

    // model is always an object in Copilot (unlike Claude Code which sends a string)
    const model   = data.model || {};
    const modelId = model.id || '';

    const now     = new Date();
    const cwd     = (data.cwd || '').trim();

    // project_id uses the same slugify convention as Claude Code project dirs
    const project   = cwd ? path.basename(cwd) : '';
    const projectId = cwd ? cwd.replace(/[/\\]/g, '-') : '';

    // Capture active git branch. Fails silently for non-git dirs and detached HEAD.
    let gitBranch;
    if (cwd) {
      try {
        gitBranch = execFileSync('git', ['-C', cwd, 'branch', '--show-current'], {
          timeout: 2000, stdio: ['ignore', 'pipe', 'ignore'],
        }).toString().trim() || undefined;
      } catch (_) {}
    }

    // Write session file with zero-baseline snapshot.
    // The snapshot is subtracted from cumulative token counts each turn to get
    // the per-session delta. All fields are 0 since Copilot resets counts per session.
    const sessionFile = {
      session_id:  sessionId,
      started_at:  now.toISOString().replace(/\.\d{3}Z$/, 'Z'),
      start_month: now.toISOString().slice(0, 7),
      model_id:    modelId,
      project:     project   || undefined,
      project_id:  projectId || undefined,
      git_branch:  gitBranch || undefined,
      snapshot: {
        total_input_tokens:       0,
        total_output_tokens:      0,
        total_cache_write_tokens: 0,
        total_cache_read_tokens:  0,
      },
    };

    const sessionPath = path.join(dataDir, 'sessions', sessionId + '.json');
    fs.writeFileSync(sessionPath, JSON.stringify(sessionFile, null, 2));

    // Log to debug file after session file is written so session_after is captured
    logHookDebug('sessionStart', data, sessionId);

    // Auto-configure statusLine in settings.json if not yet pointing to our script.
    // Returns a notification string when a change is made; null when already correct.
    // Written to a pending-notification file so the statusline compositor can display
    // it once on the next render turn (hook stdout is discarded by Copilot).
    try {
      const notification = ensureStatusLineConfig(
        process.env.PLUGIN_ROOT,
        getCopilotConfigDir(),
        dataDir
      );
      if (notification) {
        const notifPath = path.join(dataDir, 'pending-notification.json');
        fs.writeFileSync(notifPath, JSON.stringify({ message: notification, shown: false }));
      }
    } catch (_) {}

    recoverOrphanedSessions(sessionId);

    // Initialize hud-state.json for this session.
    // Clear recentTools; preserve agents if this is the same session resuming
    // (e.g. Copilot restarted mid-session without a SessionEnd firing).
    try {
      const { readState, writeState, STATE_FILE } = require('./state');
      const prevState  = readState(STATE_FILE);
      const prevAgents = (prevState.sessionId === sessionId && Array.isArray(prevState.agents))
        ? prevState.agents : [];

      const ts = data.timestamp || Date.now();
      writeState({
        sessionId:      sessionId,
        sessionStart:   ts,
        cwd:            cwd || null,
        lastPrompt:     null,
        lastPromptTime: null,
        recentTools:    [],
        agents:         prevAgents,
        sessionActive:  true,
      }, STATE_FILE);
    } catch (_) {}

  } catch (_) {
    // Never crash Copilot startup
  }
});
