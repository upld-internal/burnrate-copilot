#!/usr/bin/env node
'use strict';
// session-start.js — Copilot CLI SessionStart hook.

// Diagnostic: runs before any other require() so even a bad require is captured.
// Writes to os.tmpdir() as a guaranteed-writable fallback on all platforms.
try {
  const _fs = require('fs'), _os = require('os'), _path = require('path');
  const _line = new Date().toISOString() + ' session-start.js invoked PLUGIN_ROOT=' + (process.env.PLUGIN_ROOT || '(unset)') + '\n';
  _fs.appendFileSync(_path.join(_os.tmpdir(), 'burnrate-session-start.log'), _line);
} catch (_) {}

const fs   = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { getDataDir, getCopilotConfigDir } = require('./paths');
const { normalizeJiraCosts, selectPrimaryJiraKey } = require('./jira-attribution');
const { buildTelemetryFields, logHookDebug } = require('./session-file');
const { ensureStatusLineConfig } = require('./statusline-config');

// One-time migration: move data from old path (~/.copilot/burnrate-copilot/)
// to standard plugin-data path (~/.copilot/plugin-data/burnrate-copilot/).
(function migrateDataDir() {
  const copilotDir = getCopilotConfigDir();
  const oldDir = path.join(copilotDir, 'burnrate-copilot');
  const newDir = path.join(copilotDir, 'plugin-data', 'burnrate-copilot');
  try {
    if (fs.existsSync(oldDir) && !fs.existsSync(newDir)) {
      fs.mkdirSync(path.join(copilotDir, 'plugin-data'), { recursive: true });
      fs.renameSync(oldDir, newDir);
    }
  } catch (_) {}
})();

// Compute final cost for orphan recovery.
// Strategy 1: last_known_nano_aiu → authoritative AI Credits billing
// Strategy 2: last_known_cost     → compositor-computed cost from last statusline turn
function computeFinalCost(session) {
  const nanoAiu = session.last_known_nano_aiu;
  if (typeof nanoAiu === 'number' && nanoAiu > 0) {
    return nanoAiu / 100_000_000_000;
  }
  return session.last_known_cost || 0;
}

const dataDir = getDataDir();

// Diagnostic: write a startup marker so we can confirm the script is being invoked.
try {
  fs.mkdirSync(path.join(dataDir, 'debug'), { recursive: true });
  fs.appendFileSync(
    path.join(dataDir, 'debug', 'startup.log'),
    new Date().toISOString() + ' session-start.js invoked, PLUGIN_ROOT=' + (process.env.PLUGIN_ROOT || '(unset)') + '\n'
  );
} catch (_) {}

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
// less than the safety window — it may belong to a concurrently running session.
// last_known_at is written by the compositor on every statusline turn, so a
// live session will always be within seconds. A 10-minute window on last_known_at
// ensures a session can survive a model switch (which triggers a new SessionStart)
// without being archived. Fall back to a 2-minute window on started_at only when
// the compositor has never written to the file (very new session, no turns yet).
function recoverOrphanedSessions(currentSessionId) {
  const TWO_MIN    = 2  * 60 * 1000;
  const TEN_MIN    = 10 * 60 * 1000;
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

      // Use last_known_at (written by compositor every turn) as the freshness
      // signal — it reflects actual recent activity. Fall back to started_at only
      // when the compositor has never written to this file (very new session).
      const lastActive = session.last_known_at;
      const startedAt  = session.started_at;

      if (lastActive) {
        const age = now - new Date(lastActive).getTime();
        if (age < TEN_MIN) continue; // compositor wrote recently → still active
      } else if (startedAt) {
        const age = now - new Date(startedAt).getTime();
        if (age < TWO_MIN) continue; // too recent — may be a concurrent session
      }

      // Write recovery record using last_known_tokens for accurate cost.
      // Falls back to last_known_cost if tokens or pricing are unavailable.
      const modelId    = session.last_known_model || session.model_id || '';
      const startMonth = session.start_month || new Date().toISOString().slice(0, 7);
      const monthlyDir = path.join(dataDir, 'monthly');
      fs.mkdirSync(monthlyDir, { recursive: true });
      const monthlyFile = path.join(monthlyDir, startMonth + '.jsonl');

      const record = {
        id:           session.session_id,
        date:         new Date().toISOString().slice(0, 10),
        start_month:  startMonth,
        cost_usd:     computeFinalCost(session),
        cost_pending: false,
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

let raw;
try { raw = fs.readFileSync(0, 'utf8'); } catch (_) { process.exit(0); }
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
        process.env.PLUGIN_ROOT || path.dirname(__dirname),
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

  } catch (e) {
    try {
      const _os = require('os'), _path = require('path');
      require('fs').appendFileSync(
        _path.join(_os.tmpdir(), 'burnrate-session-start.log'),
        new Date().toISOString() + ' ERROR: ' + e.message + '\n' + e.stack + '\n'
      );
    } catch (_) {}
  }
