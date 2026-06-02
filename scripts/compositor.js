'use strict';
// compositor.js — full widget compositor for burnrate-copilot.
//
// render(stdinData, dataDir, scriptDir) → string
//
// Loads config from ~/.copilot/burnrate-copilot/config.json (falls back to
// DEFAULT_CONFIG when absent or malformed). Loads session data once and
// passes it to all widgets. Renders in plain or powerline mode.
//
// Every turn: writes last_known_nano_aiu, last_known_cost, last_known_tokens,
// and metadata back to the session file so SessionEnd and orphan recovery
// always have accurate data available.

const fs   = require('fs');
const path = require('path');

const { getTheme, setBg, setFg, PL_RIGHT, R } = require('./themes');
const { getMtdAndProjected } = require('./pricing');
const { detectJiraKey } = require('./jira-detector');
const { applyJiraDelta, round6 } = require('./jira-attribution');

const WIDGETS = {
  ...require('./widgets/cost'),
  ...require('./widgets/context'),
  ...require('./widgets/session'),
  ...require('./widgets/jira'),
  ...require('./widgets/git'),
  ...require('./widgets/system'),
  ...require('./widgets/custom'),
  ...require('./widgets/tools'),
};

// Default config — rendered when config.json is absent or malformed.
// Shows model, context fill, token totals, inference speed, premium requests,
// and session cost/duration.
const DEFAULT_CONFIG = {
  powerline: false,
  theme: 'default',
  separator: '│',
  segments: [
    { widget: 'model_name', short: true, show_label: true },
    { widget: 'separator' },
    { widget: 'context_window', format: 'full', show_label: true },
    { widget: 'separator' },
    { widget: 'git_branch' },
    { widget: 'git_status' },
    { widget: 'newline' },
    { widget: 'session_cost', show_label: true },
    { widget: 'session_duration' },
    { widget: 'separator' },
    { widget: 'mtd_cost' },
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
    jira:      (user.jira && typeof user.jira === 'object') ? user.jira : null,
  };
}

// ---------------------------------------------------------------------------
// Session data loading + write-back
// ---------------------------------------------------------------------------

// Loads all session-related data once. Widgets read from this object rather
// than doing their own file I/O or cost calculations.
function loadSessionData(stdinData, dataDir, scriptDir, config) {
  const sessionId = (stdinData.session_id || '').trim();
  const model     = stdinData.model || {};
  const ctx       = stdinData.context_window || {};
  const now       = new Date();

  const sd = {
    sessionId,
    modelId:              model.id || '',
    modelDisplayName:     model.display_name || '',
    snapshot:             null,
    startedAt:            null,
    hasSnapshot:          false,
    hasPricing:           false,
    sessionCost:          0,
    mtd:                  0,
    projected:            null,
    mtdError:             false,
    monthKey:             now.toISOString().slice(0, 7),
    dataDir,
    scriptDir,
    project:              '',
    projectId:            '',
    jiraKey:              '',
    jiraSource:           '',
    lastKnownJiraKey:     '',
    lastKnownJiraSource:  '',
    jiraBaseUrl:          ((config && config.jira && config.jira.base_url) || ''),
    recentTools:          [],
    agents:               [],
    lastPrompt:           null,
    hasQuota:             false,
  };

  // Load session snapshot. If the file is missing (e.g. orphan-recovery deleted it
  // when the model changed mid-session and Copilot issued a new SessionStart), recreate
  // it lazily so second-line widgets keep rendering for the remainder of the session.
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
        sd.jiraKey              = session.jira_key              || '';
        sd.jiraSource           = session.jira_source           || '';
        sd.lastKnownJiraKey     = session.last_known_jira_key   || '';
        sd.lastKnownJiraSource  = session.last_known_jira_source || '';
      } else {
        // Session file missing — recreate a minimal one so widgets don't go blank.
        // Uses current token counts as the baseline snapshot (cost delta will be 0
        // from this point forward, but duration and model widgets will work again).
        const cwd       = (stdinData.cwd || '').trim();
        const recovered = {
          session_id:  sessionId,
          started_at:  now.toISOString().replace(/\.\d{3}Z$/, 'Z'),
          start_month: now.toISOString().slice(0, 7),
          model_id:    sd.modelId || '',
          project:     cwd ? path.basename(cwd) : undefined,
          project_id:  cwd ? cwd.replace(/[/\\]/g, '-') : undefined,
          snapshot: {
            total_input_tokens:       ctx.total_input_tokens       || 0,
            total_output_tokens:      ctx.total_output_tokens      || 0,
            total_cache_write_tokens: ctx.total_cache_write_tokens || 0,
            total_cache_read_tokens:  ctx.total_cache_read_tokens  || 0,
          },
          recovered_by_compositor: true,
        };
        fs.mkdirSync(path.join(dataDir, 'sessions'), { recursive: true });
        fs.writeFileSync(sessionPath, JSON.stringify(recovered, null, 2));
        sd.snapshot    = recovered.snapshot;
        sd.startedAt   = recovered.started_at;
        sd.hasSnapshot = true;
        sd.project     = recovered.project   || '';
        sd.projectId   = recovered.project_id || '';
      }
    } catch (_) {}
  }

  // Read quota from cache (synchronous, ~0ms). Falls back to last_known_quota
  // stored in the session file so the first turn after a restart shows data.
  try {
    const { readQuotaCache } = require('./quota-api');
    const { data: qd, stale } = readQuotaCache(dataDir);

    // Resolve last_known_quota from session file if cache miss.
    let sessionLastQuota = null;
    if (!qd && sessionId) {
      try {
        const sessionPath = path.join(dataDir, 'sessions', sessionId + '.json');
        if (fs.existsSync(sessionPath)) {
          const raw = JSON.parse(fs.readFileSync(sessionPath, 'utf8'));
          sessionLastQuota = raw.last_known_quota || null;
        }
      } catch (_) {}
    }

    const quota = qd || sessionLastQuota || null;
    if (quota) {
      sd.quotaRemaining   = quota.quota_remaining;
      sd.quotaEntitlement = quota.entitlement;
      sd.quotaPercent     = quota.percent_remaining;
      sd.quotaResetDate   = quota.quota_reset_date_utc;
      sd.quotaOverage     = quota.overage_count ?? 0;
      sd.quotaOverageOk   = quota.overage_permitted ?? false;
      sd.quotaStale       = stale || !qd;
      sd.hasQuota         = true;
    }
  } catch (_) {}

  // Detect Jira key from git branch — runs independently of session file state
  // so the widget appears immediately (no one-turn delay from read/write cycle).
  if (sessionId && stdinData.cwd) {
    try {
      const jiraConfig  = config && typeof config === 'object' ? config.jira : null;
      const projectKeys = jiraConfig && Array.isArray(jiraConfig.project_keys)
        ? jiraConfig.project_keys : null;
      const jira = detectJiraKey(stdinData.cwd, projectKeys);
      if (jira) {
        sd.lastKnownJiraKey    = jira.key;
        sd.lastKnownJiraSource = 'branch';
      }
    } catch (_) {}
  }

  // AI Credits (Copilot billing June 2026+): 1 credit = 1,000,000,000 nano-AIU = $0.01 USD.
  // ai_used.total_nano_aiu is the authoritative session-cumulative cost source.
  const aiUsed   = stdinData.ai_used || {};
  const nanoAiu  = typeof aiUsed.total_nano_aiu === 'number' ? aiUsed.total_nano_aiu : -1;
  sd.hasPricing  = nanoAiu >= 0; // show $0.00 immediately, not "?"
  if (nanoAiu > 0) {
    sd.sessionCost = nanoAiu / 100_000_000_000;
  }

  // Write last_known_nano_aiu, last_known_tokens, and metadata to session file every turn.
  if (sessionId) {
    try {
      const sessionPath = path.join(dataDir, 'sessions', sessionId + '.json');
      if (fs.existsSync(sessionPath)) {
        const sessionRaw = JSON.parse(fs.readFileSync(sessionPath, 'utf8'));

        if (nanoAiu > 0) {
          sessionRaw.last_known_nano_aiu = nanoAiu;
        }

        const currentTokens = {
          total_input_tokens:       ctx.total_input_tokens       || 0,
          total_output_tokens:      ctx.total_output_tokens      || 0,
          total_cache_write_tokens: ctx.total_cache_write_tokens || 0,
          total_cache_read_tokens:  ctx.total_cache_read_tokens  || 0,
        };
        sessionRaw.last_known_tokens = currentTokens;
        sessionRaw.last_known_model  = sd.modelId || undefined;
        sessionRaw.last_known_at     = now.toISOString().replace(/\.\d{3}Z$/, 'Z');
        if (sd.sessionCost > 0) {
          sessionRaw.last_known_cost = sd.sessionCost;
        }

        if (sd.hasQuota) {
          sessionRaw.last_known_quota = {
            entitlement:          sd.quotaEntitlement,
            remaining:            Math.floor(sd.quotaRemaining),
            quota_remaining:      sd.quotaRemaining,
            percent_remaining:    sd.quotaPercent,
            overage_permitted:    sd.quotaOverageOk,
            overage_count:        sd.quotaOverage,
            quota_reset_date_utc: sd.quotaResetDate,
            captured_at:          now.toISOString().replace(/\.\d{3}Z$/, 'Z'),
          };
        }

        // Attribute cost delta to active Jira key (or unattributed bucket).
        applyJiraDelta(sessionRaw, sd.sessionCost, sd.lastKnownJiraKey || null);

        const cwd = (stdinData.cwd || '').trim();
        if (cwd) {
          sessionRaw.last_known_project    = path.basename(cwd);
          sessionRaw.last_known_project_id = cwd.replace(/[/\\]/g, '-');
        }

        fs.writeFileSync(sessionPath, JSON.stringify(sessionRaw, null, 2));
      }
    } catch (_) {} // never crash the statusline
  }

  // Compute MTD (after sessionCost is determined)
  if (sd.hasPricing || sd.sessionCost > 0) {
    const { mtd, error } = getMtdAndProjected(sd.monthKey, dataDir);
    sd.mtd      = (mtd || 0) + sd.sessionCost;
    sd.mtdError = error;
    if (sd.mtd > 0) {
      const dayOfMonth  = now.getUTCDate();
      const daysInMonth = new Date(Date.UTC(now.getFullYear(), now.getMonth() + 1, 0)).getDate();
      sd.projected = (sd.mtd / Math.max(1, dayOfMonth)) * daysInMonth;
    }
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

  // Supplement agent tracking from events.jsonl (fallback for missing hooks).
  // Only polls if we have a session — adds agents not already known from hooks.
  if (sessionId) {
    try {
      const { pollSubagentEvents } = require('./events-watcher');
      const knownIds = new Set(sd.agents.map(a => a.id).filter(Boolean));
      const poll = pollSubagentEvents(sessionId, knownIds);

      // Add newly-started agents not already tracked by hooks
      for (const agent of poll.started) {
        if (!knownIds.has(agent.id)) {
          sd.agents.push(agent);
          knownIds.add(agent.id);
        }
      }

      // Mark completed agents (whether from hooks or watcher)
      for (const done of poll.completed) {
        const existing = sd.agents.find(a => a.id === done.id);
        if (existing) {
          existing.status = done.status;
        }
      }
    } catch (_) {}
  }

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
  const sessionData = loadSessionData(stdinData, dataDir, scriptDir, config);
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
