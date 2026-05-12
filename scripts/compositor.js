'use strict';
// compositor.js — Phase 1 minimal compositor for copilot-hud.
//
// Responsibilities:
//   1. Load session data from the session file
//   2. Write last_known_tokens back to the session file every turn
//      (used for cost computation in Phase 6 and orphan recovery)
//   3. Render a simple statusline
//
// Phase 2 replaces this with the full widget-based compositor (config.json
// driven, powerline support, all widgets). Phase 1 renders inline.
//
// Default output:
//   Sonnet 4.6 3x·high │ Ctx: 35% │ 5m │  main

const fs          = require('fs');
const path        = require('path');
const { execSync } = require('child_process');
const { R, B, D, YL, RD } = require('./themes');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pctColor(pct) {
  if (pct >= 70) return RD;
  if (pct >= 50) return YL;
  return '';
}

function fmtDuration(startedAt) {
  if (!startedAt) return null;
  try {
    const ms = Date.now() - new Date(startedAt).getTime();
    if (ms < 0) return null;
    const totalMin = Math.floor(ms / 60000);
    const hours    = Math.floor(totalMin / 60);
    const mins     = totalMin % 60;
    return hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
  } catch (_) {
    return null;
  }
}

// Parse short model name and optional effort/multiplier from display_name.
// "claude-sonnet-4.6 (3x) (high)" → "Sonnet 4.6 3x·high"
function parseModelDisplay(displayName, modelId) {
  const raw = displayName || modelId || '';
  if (!raw) return null;

  let name = raw;
  let multiplier;
  let effort;

  const mxMatch = name.match(/\((\d+x)\)/);
  if (mxMatch) { multiplier = mxMatch[1]; name = name.replace(mxMatch[0], '').trim(); }

  const effortMatch = name.match(/\((low|medium|high|default)\)/i);
  if (effortMatch) { effort = effortMatch[1]; name = name.replace(effortMatch[0], '').trim(); }

  // Shorten: "claude-sonnet-4.6" → "Sonnet 4.6"
  const shortName = name
    .replace(/^claude-/i, '')
    .replace(/^(opus|sonnet|haiku)/i, m => m.charAt(0).toUpperCase() + m.slice(1))
    .replace(/-/g, ' ')
    .trim();

  let label = shortName;
  if (multiplier || effort) {
    const extras = [multiplier, effort].filter(Boolean).join('·');
    label += ` ${extras}`;
  }
  return label || null;
}

function gitBranch(cwd) {
  if (!cwd) return null;
  try {
    return execSync('git branch --show-current', {
      cwd,
      timeout: 500,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim() || null;
  } catch (_) {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Session data loading + write-back
// ---------------------------------------------------------------------------

function loadSessionData(stdinData, dataDir) {
  const sessionId = (stdinData.session_id || '').trim();
  const model     = stdinData.model || {};
  const ctx       = stdinData.context_window || {};

  const sd = {
    sessionId,
    modelId:   model.id || '',
    modelName: model.display_name || model.id || '',
    startedAt: null,
    project:   '',
    projectId: '',
  };

  // Load session snapshot for startedAt and project info
  if (sessionId) {
    try {
      const sessionPath = path.join(dataDir, 'sessions', sessionId + '.json');
      if (fs.existsSync(sessionPath)) {
        const session = JSON.parse(fs.readFileSync(sessionPath, 'utf8'));
        sd.startedAt = session.started_at || null;
        if (!sd.modelId) sd.modelId = session.last_known_model || session.model_id || '';
        sd.project   = session.last_known_project    || session.project    || '';
        sd.projectId = session.last_known_project_id || session.project_id || '';
      }
    } catch (_) {}
  }

  // Write last_known_tokens back to the session file on every turn.
  // This is the core data capture for Phase 6 cost computation and orphan recovery.
  if (sessionId) {
    try {
      const sessionPath = path.join(dataDir, 'sessions', sessionId + '.json');
      if (fs.existsSync(sessionPath)) {
        const sessionRaw = JSON.parse(fs.readFileSync(sessionPath, 'utf8'));

        sessionRaw.last_known_tokens = {
          total_input_tokens:       ctx.total_input_tokens       || 0,
          total_output_tokens:      ctx.total_output_tokens      || 0,
          total_cache_write_tokens: ctx.total_cache_write_tokens || 0,
          total_cache_read_tokens:  ctx.total_cache_read_tokens  || 0,
        };
        sessionRaw.last_known_model = sd.modelId || undefined;
        sessionRaw.last_known_at    = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

        const cwd = (stdinData.cwd || '').trim();
        if (cwd) {
          sessionRaw.last_known_project    = path.basename(cwd);
          sessionRaw.last_known_project_id = cwd.replace(/\//g, '-');
        }

        fs.writeFileSync(sessionPath, JSON.stringify(sessionRaw, null, 2));
      }
    } catch (_) {} // never crash the statusline
  }

  return sd;
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

function render(stdinData, dataDir, scriptDir) {
  const sd  = loadSessionData(stdinData, dataDir);
  const ctx = stdinData.context_window || {};
  const SEP = ` ${D}│${R} `;

  const parts = [];

  // Model name with effort/multiplier
  const modelLabel = parseModelDisplay(sd.modelName, sd.modelId);
  if (modelLabel) {
    parts.push(`${B}${modelLabel}${R}`);
  }

  // Context window usage %
  const pct = ctx.used_percentage;
  if (pct != null) {
    const c = pctColor(pct);
    parts.push(`${D}Ctx:${R} ${c}${B}${pct}%${R}`);
  }

  // Session duration
  const dur = fmtDuration(sd.startedAt);
  if (dur) {
    parts.push(`${B}${dur}${R}`);
  }

  // Git branch
  const branch = gitBranch(stdinData.cwd);
  if (branch) {
    parts.push(` ${B}${branch}${R}`);
  }

  if (!parts.length) return '';
  return parts.join(SEP);
}

module.exports = { render };
