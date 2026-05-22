#!/usr/bin/env node
'use strict';
// session-file.js — shared helpers for per-session telemetry.
//
// Exports:
//   updateSession(sessionId, fn, opts?) — atomic read-modify-write with per-session lock.
//   buildTelemetryFields(session)       — extract JSONL-ready telemetry summary.
//   logHookDebug(event, data, sessionId)— debug logger, enabled by COPILOT_HUD_DEBUG=1.
//
// Data directory: ~/.copilot/burnrate-copilot/  (override via COPILOT_HOME env var)

const fs   = require('fs');
const path = require('path');
const { getDataDir } = require('./paths');

const dataDir = getDataDir();

function sessionFilePath(sessionId) {
  return path.join(dataDir, 'sessions', sessionId + '.json');
}

// syncSleepMs — busy wait (same pattern as state.js; acceptable in short-lived hooks)
function syncSleepMs(ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {}
}

// updateSession — atomic read → fn(session) → write with per-session mkdir lock.
//
// Options:
//   mustExist: true  — skip entirely if session file does not exist.
//                      Telemetry hooks use this to avoid creating ghost files
//                      when preToolUse/postToolUse fire without a prior SessionStart.
//   mustExist: false — (default) create file if absent.
//
// fn mutates the session object in-place. Return value is ignored.
// If fn throws, no write occurs. If the write fails, temp file is cleaned up.
//
// Locking: per-session mkdir lock prevents lost updates when concurrent hooks
// race on the same session file. Each process gets a unique temp file name.
function updateSession(sessionId, fn, opts) {
  if (!sessionId) return;
  const { mustExist = false } = opts || {};
  const p       = sessionFilePath(sessionId);
  const lockDir = p + '.lock';

  // Acquire per-session lock (same mkdir pattern as state.js)
  let locked = false;
  for (let i = 0; i < 40; i++) {
    try { fs.mkdirSync(lockDir); locked = true; break; }
    catch (e) {
      if (e.code !== 'EEXIST') break;
      syncSleepMs(50);
    }
  }
  if (!locked) {
    // Stale lock — force-remove and try once more
    try { fs.rmdirSync(lockDir); } catch (_) {}
    try { fs.mkdirSync(lockDir); locked = true; } catch (_) {}
    if (!locked) return;
  }

  try {
    const exists = fs.existsSync(p);
    if (!exists && mustExist) return;

    let session = {};
    if (exists) {
      try { session = JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_) {}
    }

    try { fn(session); } catch (_) { return; }

    // Unique temp file name to avoid collisions from concurrent processes
    const tmp = p + '.tmp.' + process.pid + '.' + Date.now();
    try {
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(tmp, JSON.stringify(session, null, 2));
      fs.renameSync(tmp, p);
    } catch (_) {
      try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch (_) {}
    }
  } finally {
    try { fs.rmdirSync(lockDir); } catch (_) {}
  }
}

// computeP50 — median of a numeric array
function computeP50(arr) {
  if (!arr || !arr.length) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

// buildTelemetryFields — extract JSONL-ready telemetry from a session object.
// Returns only fields with meaningful data; empty maps/arrays are omitted.
// Called by session-end.js and orphan recovery in session-start.js.
function buildTelemetryFields(session) {
  const f = {};

  if (session.turn_count > 0)
    f.turn_count = session.turn_count;

  if (session.tool_counts && Object.keys(session.tool_counts).length)
    f.tool_counts = session.tool_counts;

  if (session.ext_counts && Object.keys(session.ext_counts).length)
    f.ext_counts = session.ext_counts;

  const subagents = session.subagents;
  if (Array.isArray(subagents) && subagents.length) {
    f.subagent_count = subagents.length;
    const types = {};
    subagents.forEach(a => { const t = a.type || 'unknown'; types[t] = (types[t] || 0) + 1; });
    if (Object.keys(types).length) f.subagent_types = types;
  }

  // turn_intervals: elapsed ms between consecutive userPromptSubmitted events.
  // Note: this measures user think-time + AI response time combined and is NOT
  // pure AI response latency (Copilot has no Stop/assistant-complete hook).
  const intervals = session.turn_intervals;
  if (Array.isArray(intervals) && intervals.length) {
    const p50 = computeP50(intervals);
    if (p50 != null) {
      f.turn_interval_p50_ms = p50;
      f.turn_interval_max_ms = Math.max(...intervals);
      f.turn_interval_count  = intervals.length;
    }
  }

  if (session.git_branch) f.git_branch = session.git_branch;

  return f;
}

// logHookDebug — append a debug entry to debug/hooks.jsonl.
// Activated by COPILOT_HUD_DEBUG=1. Captures raw stdin and resulting session state.
function logHookDebug(event, stdinData, sessionId) {
  if (process.env.COPILOT_HUD_DEBUG !== '1') return;
  try {
    const debugDir = path.join(dataDir, 'debug');
    fs.mkdirSync(debugDir, { recursive: true });

    let sessionAfter = null;
    if (sessionId) {
      try {
        const p = sessionFilePath(sessionId);
        if (fs.existsSync(p)) sessionAfter = JSON.parse(fs.readFileSync(p, 'utf8'));
      } catch (_) {}
    }

    const entry = {
      ts:            new Date().toISOString(),
      hook:          event,
      session_id:    sessionId,
      stdin_fields:  Object.keys(stdinData || {}),
      stdin:         stdinData,
      session_after: sessionAfter,
    };
    fs.appendFileSync(path.join(debugDir, 'hooks.jsonl'), JSON.stringify(entry) + '\n');
  } catch (_) {}
}

module.exports = { dataDir, sessionFilePath, updateSession, buildTelemetryFields, logHookDebug };
