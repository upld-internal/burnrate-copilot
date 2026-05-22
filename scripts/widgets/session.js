'use strict';
// widgets/session.js — session-related widgets for burnrate-copilot.
//
// model_name  — model ID with effort/multiplier badge parsed from display_name
// session_duration — elapsed time since session start
// session_name     — session name from stdin (new vs cost-display)
// lines_changed    — +added/-removed lines from Copilot's cost data

const { R, B, D, withLabel } = require('../themes');

// Parse a short display name and optional effort/multiplier from Copilot's
// model.display_name field, e.g.:
//   "claude-sonnet-4.6 (3x) (high)" → { name: "Sonnet 4.6", badge: "3x·high" }
//   "claude-opus-4.7"               → { name: "Opus 4.7",   badge: null }
//   "gpt-4.1"                       → { name: "GPT-4.1",    badge: null }
//   "gpt-5.4-mini"                  → { name: "GPT-5.4 mini", badge: null }
function parseModelName(displayName, modelId) {
  const raw = (displayName || modelId || '').trim();
  if (!raw) return { name: null, badge: null };

  let name = raw;
  let multiplier;
  let effort;

  const mxMatch = name.match(/\((\d+x)\)/);
  if (mxMatch) { multiplier = mxMatch[1]; name = name.replace(mxMatch[0], '').trim(); }

  const effortMatch = name.match(/\((low|medium|high|default)\)/i);
  if (effortMatch) { effort = effortMatch[1]; name = name.replace(effortMatch[0], '').trim(); }

  let shortName;
  if (/^claude-/i.test(name)) {
    // Strip "claude-" prefix; capitalise model family
    shortName = name
      .replace(/^claude-/i, '')
      .replace(/^(opus|sonnet|haiku)/i, m => m.charAt(0).toUpperCase() + m.slice(1))
      .replace(/-/g, ' ')
      .trim();
  } else if (/^gpt-/i.test(name)) {
    // "gpt-4.1" → "GPT-4.1", "gpt-5.4-mini" → "GPT-5.4 mini"
    shortName = name
      .replace(/^gpt-/i, 'GPT-')
      .replace(/-/g, ' ')
      .trim();
  } else {
    shortName = name.replace(/-/g, ' ').trim();
  }

  const badge = multiplier
    ? (effort ? `${multiplier} (${effort})` : multiplier)
    : (effort ? `(${effort})` : null);
  return { name: shortName, badge };
}

// model_name — display name with optional effort/multiplier badge.
// opts.short:      true (default) — short form e.g. "Sonnet 4.6 3x·high"
//                  false — use full display_name as-is
// opts.show_label: boolean (default false) — show "Model: " prefix
// opts.show_badge: boolean (default true)  — show effort/multiplier badge
function model_name(stdinData, sessionData, opts) {
  const model   = stdinData.model || {};
  const display = model.display_name || '';
  const id      = model.id || sessionData.modelId || '';

  if (!display && !id) return null;

  const showShort  = opts.short !== false;
  const showLabel  = opts.show_label === true;
  const showBadge  = opts.show_badge !== false;

  let label;
  if (!showShort) {
    label = display || id;
  } else {
    const { name, badge } = parseModelName(display, id);
    label = name || id;
    if (badge && showBadge) label += ` ${badge}`;
  }

  const value = opts._powerline ? label : `${B}${label}${R}`;
  return withLabel('Model', value, showLabel, opts._powerline);
}

// session_duration — elapsed time since session start.
// Format: "47m" or "2h 3m".
// opts.show_label: boolean (default false)
function session_duration(stdinData, sessionData, opts) {
  if (!sessionData.startedAt) return null;

  let elapsedMs;
  try {
    elapsedMs = Date.now() - new Date(sessionData.startedAt).getTime();
  } catch (_) {
    return null;
  }

  if (elapsedMs < 0) return null;

  const totalMin = Math.floor(elapsedMs / 60000);
  const hours    = Math.floor(totalMin / 60);
  const mins     = totalMin % 60;

  const text      = hours > 0 ? `(${hours}h ${mins}m)` : `(${mins}m)`;
  const showLabel = opts.show_label === true;
  const value     = opts._powerline ? text : `${B}${text}${R}`;
  return withLabel('Dur', value, showLabel, opts._powerline);
}

// session_name — the session's name from stdin.
// Source: stdinData.session_name (set when the user names a session).
// Returns null if the field is absent or empty.
// opts.show_label: boolean (default false)
function session_name(stdinData, sessionData, opts) {
  const name = (stdinData.session_name || '').trim();
  if (!name) return null;

  const showLabel = opts.show_label === true;
  const value     = opts._powerline ? name : `${D}${name}${R}`;
  return withLabel('Session', value, showLabel, opts._powerline);
}

// lines_changed — cumulative lines added/removed in the session.
// Source: stdinData.cost.total_lines_added / total_lines_removed
// Format: "+42/-3" (dim when both are zero)
// Returns null if both fields are absent.
// opts.show_label: boolean (default false)
function lines_changed(stdinData, sessionData, opts) {
  const cost = stdinData.cost || {};
  const added   = cost.total_lines_added;
  const removed = cost.total_lines_removed;

  if (added == null && removed == null) return null;

  const a = added   || 0;
  const r = removed || 0;

  const text      = `+${a}/-${r}`;
  const showLabel = opts.show_label === true;
  const value     = opts._powerline ? text : `${D}${text}${R}`;
  return withLabel('Lines', value, showLabel, opts._powerline);
}

module.exports = { model_name, session_duration, session_name, lines_changed };
