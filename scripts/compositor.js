'use strict';
// compositor.js — full widget compositor for copilot-hud.
//
// render(stdinData, dataDir, scriptDir) → string
//
// Loads config from ~/.copilot/hud-costs/config.json (falls back to
// DEFAULT_CONFIG when absent or malformed). Loads session data once and
// passes it to all widgets. Renders in plain or powerline mode.
//
// Every turn: writes last_known_tokens back to the session file so that
// cost can be computed retroactively when Phase 6 implements pricing.

const fs   = require('fs');
const path = require('path');

const { getTheme, setBg, setFg, PL_RIGHT, R } = require('./themes');

const WIDGETS = {
  ...require('./widgets/cost'),
  ...require('./widgets/context'),
  ...require('./widgets/session'),
  ...require('./widgets/git'),
  ...require('./widgets/system'),
  ...require('./widgets/custom'),
  ...require('./widgets/tools'),
};

// Default config — rendered when config.json is absent or malformed.
// Shows model, context fill, token totals, inference speed, premium requests,
// and session duration. Cost widgets are omitted until Phase 6 resolves pricing.
const DEFAULT_CONFIG = {
  powerline: false,
  theme: 'default',
  separator: '│',
  segments: [
    { widget: 'model_name', short: true },
    { widget: 'separator' },
    { widget: 'context_window' },
    { widget: 'separator' },
    { widget: 'token_breakdown', show_cache: false },
    { widget: 'separator' },
    { widget: 'output_speed' },
    { widget: 'separator' },
    { widget: 'premium_requests' },
    { widget: 'separator' },
    { widget: 'session_duration' },
  ],
};

// ---------------------------------------------------------------------------
// Config loading and deep-merge
// ---------------------------------------------------------------------------

// Known valid theme names (mirrors themes.js THEMES keys).
const KNOWN_THEMES = new Set(['default', 'minimal', 'nord', 'dracula', 'catppuccin']);

// loadConfig returns any valid JSON object from config.json, or null.
// Deliberately permissive — partial configs (e.g. { "powerline": true }) are
// valid. mergeConfig below applies type-checked defaults for any missing keys.
function loadConfig(dataDir) {
  const configPath = path.join(dataDir, 'config.json');
  try {
    if (fs.existsSync(configPath)) {
      const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      if (parsed && typeof parsed === 'object') return parsed;
    }
  } catch (_) {}
  return null;
}

// mergeConfig applies user overrides on top of defaults.
// Each key is type-checked; invalid user values fall back to the default.
//   powerline  — must be boolean
//   theme      — must be one of KNOWN_THEMES
//   separator  — must be a non-empty string
//   segments   — must be an array; overrides entire default list (order matters)
function mergeConfig(user, defaults) {
  if (!user) return defaults;
  return {
    powerline: typeof user.powerline === 'boolean' ? user.powerline : defaults.powerline,
    theme:     KNOWN_THEMES.has(user.theme)        ? user.theme     : defaults.theme,
    separator: (typeof user.separator === 'string' && user.separator.length > 0)
               ? user.separator : defaults.separator,
    segments:  Array.isArray(user.segments)        ? user.segments  : defaults.segments,
  };
}

// ---------------------------------------------------------------------------
// Session data loading + write-back
// ---------------------------------------------------------------------------

// Loads all session-related data once. Widgets read from this object rather
// than doing their own file I/O or cost calculations.
function loadSessionData(stdinData, dataDir, scriptDir) {
  const sessionId = (stdinData.session_id || '').trim();
  const model     = stdinData.model || {};
  const ctx       = stdinData.context_window || {};
  const now       = new Date();

  const sd = {
    sessionId,
    modelId:          model.id || '',
    modelDisplayName: model.display_name || '',
    snapshot:         null,
    startedAt:        null,
    hasSnapshot:      false,
    hasPricing:       false,  // Phase 6 sets this true when pricing.json is loaded
    sessionCost:      0,      // Phase 6 computes this
    mtd:              0,      // Phase 6
    projected:        null,   // Phase 6
    mtdError:         false,
    monthKey:         now.toISOString().slice(0, 7),
    dataDir,
    scriptDir,
    project:          '',
    projectId:        '',
    recentTools:      [],     // Phase 3 populates via state.js
    agents:           [],     // Phase 3 populates via state.js
    lastPrompt:       null,
  };

  // Load session snapshot
  if (sessionId) {
    try {
      const sessionPath = path.join(dataDir, 'sessions', sessionId + '.json');
      if (fs.existsSync(sessionPath)) {
        const session  = JSON.parse(fs.readFileSync(sessionPath, 'utf8'));
        sd.snapshot    = session.snapshot || null;
        sd.startedAt   = session.started_at || null;
        sd.hasSnapshot = !!sd.snapshot;
        if (!sd.modelId) sd.modelId = session.last_known_model || session.model_id || '';
        sd.project   = session.last_known_project    || session.project    || '';
        sd.projectId = session.last_known_project_id || session.project_id || '';
      }
    } catch (_) {}
  }

  // Write last_known_tokens back to the session file on every turn.
  // Critical for Phase 6 retroactive cost computation and orphan recovery.
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
        sessionRaw.last_known_at    = now.toISOString().replace(/\.\d{3}Z$/, 'Z');

        const cwd = (stdinData.cwd || '').trim();
        if (cwd) {
          sessionRaw.last_known_project    = path.basename(cwd);
          sessionRaw.last_known_project_id = cwd.replace(/\//g, '-');
        }

        fs.writeFileSync(sessionPath, JSON.stringify(sessionRaw, null, 2));
      }
    } catch (_) {} // never crash the statusline
  }

  // Load tool/agent state (Phase 1/2 stub returns empty defaults)
  try {
    const { readState } = require('./state');
    const state = readState();
    if (state.sessionId === sessionId) {
      sd.recentTools = state.recentTools || [];
      sd.agents      = state.agents      || [];
      sd.lastPrompt  = state.lastPrompt  || null;
    }
  } catch (_) {}

  return sd;
}

// ---------------------------------------------------------------------------
// Rendering — plain mode
// ---------------------------------------------------------------------------

function renderPlain(renderedSegments) {
  const SPACER_WIDGETS = new Set(['separator', 'newline']);
  let out = '';
  for (let i = 0; i < renderedSegments.length; i++) {
    const seg  = renderedSegments[i];
    const prev = renderedSegments[i - 1];
    if (i > 0 && !SPACER_WIDGETS.has(prev.widget) && !SPACER_WIDGETS.has(seg.widget)) {
      out += ' ';
    }
    out += seg.text;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Rendering — powerline mode
// ---------------------------------------------------------------------------

function renderPowerline(contentSegments, theme) {
  const colors = theme.segmentColors;

  if (!colors.length) {
    return contentSegments.map(s => s.text).join(' ');
  }

  let out = '';
  for (let i = 0; i < contentSegments.length; i++) {
    const bg     = colors[i % colors.length];
    const nextBg = i < contentSegments.length - 1 ? colors[(i + 1) % colors.length] : null;

    out += setBg(bg) + setFg(theme.fg) + ' ' + contentSegments[i].text + ' ';

    if (nextBg !== null) {
      out += R + setFg(bg) + setBg(nextBg) + PL_RIGHT;
    } else {
      out += R + setFg(bg) + PL_RIGHT;
    }
  }

  out += R;
  return out;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

function render(stdinData, dataDir, scriptDir) {
  const config      = mergeConfig(loadConfig(dataDir), DEFAULT_CONFIG);
  const sessionData = loadSessionData(stdinData, dataDir, scriptDir);
  const powerline   = config.powerline || false;
  const separator   = config.separator || '│';
  const theme       = getTheme(config.theme);

  const rendered = [];

  for (const seg of (config.segments || DEFAULT_CONFIG.segments)) {
    const handler = WIDGETS[seg.widget];
    if (!handler) continue;

    const opts = Object.assign({}, seg, {
      _powerline:       powerline,
      _globalSeparator: separator,
    });

    let text;
    try {
      text = handler(stdinData, sessionData, opts);
    } catch (_) {
      text = null; // widget error → omit segment, never crash compositor
    }

    if (text !== null && text !== undefined) {
      rendered.push({ text, widget: seg.widget });
    }
  }

  // Collapse consecutive separators; strip leading/trailing separators
  const collapsed = [];
  for (const seg of rendered) {
    const prevIsSep = collapsed.length > 0 && collapsed[collapsed.length - 1].widget === 'separator';
    if (seg.widget === 'separator' && prevIsSep) continue;
    collapsed.push(seg);
  }
  while (collapsed.length > 0 && collapsed[0].widget === 'separator')                  collapsed.shift();
  while (collapsed.length > 0 && collapsed[collapsed.length - 1].widget === 'separator') collapsed.pop();

  if (powerline) {
    const contentSegments = collapsed.filter(s => s.widget !== 'separator');
    if (!contentSegments.length) return '';

    const rows = [];
    let current = [];
    for (const seg of contentSegments) {
      if (seg.widget === 'newline') {
        rows.push(current);
        current = [];
      } else {
        current.push(seg);
      }
    }
    if (current.length) rows.push(current);

    return rows
      .filter(row => row.length > 0)
      .map(row => renderPowerline(row, theme))
      .join('\n');
  }

  return renderPlain(collapsed);
}

module.exports = { render, loadConfig, mergeConfig, loadSessionData, DEFAULT_CONFIG, KNOWN_THEMES };
