'use strict';
// widgets/context.js — context_window and Copilot-specific context widgets.
//
// New in copilot-hud vs cost-display:
//   - premium_requests — total premium API requests this session
//   - token_breakdown  — compact in/out/cache summary
//   - output_speed     — tokens per second (output / API duration)
//   - last_call        — last API call input/output token counts
//   - cache_breakdown  — separate cache read and write counts

const { R, B, D, YL, RD, withLabel } = require('../themes');

const BAR_FILLED = '█';
const BAR_EMPTY  = '░';
const BAR_LEN    = 10;

function pctColor(pct) {
  if (pct < 50) return '';
  if (pct < 70) return YL;
  return RD;
}

function renderBar(pct) {
  const filled = Math.round((pct / 100) * BAR_LEN);
  return BAR_FILLED.repeat(filled) + BAR_EMPTY.repeat(BAR_LEN - filled);
}

function fmtTokens(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
  return String(n);
}

// context_window — context usage percentage, bar, or token count.
// opts.format:     "percent" (default) | "bar" | "tokens"
// opts.show_label: boolean (default true)
function context_window(stdinData, sessionData, opts) {
  const ctx = stdinData.context_window || {};
  const pct = ctx.used_percentage;
  if (pct == null) return null;

  const showLabel = opts.show_label !== false;
  const format    = opts.format || 'percent';
  const c         = pctColor(pct);

  if (format === 'bar') {
    const bar   = renderBar(pct);
    const value = opts._powerline
      ? `${bar} ${pct}%`
      : `${c}${bar}${R} ${B}${pct}%${R}`;
    return withLabel('Ctx', value, showLabel, opts._powerline);
  }

  if (format === 'tokens') {
    const max  = ctx.context_window_size || null;
    const used = max != null ? Math.round(max * pct / 100) : null;
    if (max != null && used != null) {
      const value = opts._powerline
        ? `${fmtTokens(used)} / ${fmtTokens(max)}`
        : `${c}${B}${fmtTokens(used)}${R}${D} / ${fmtTokens(max)}${R}`;
      return withLabel('Ctx', value, showLabel, opts._powerline);
    }
    const value = opts._powerline ? `${pct}%` : `${c}${B}${pct}%${R}`;
    return withLabel('Ctx', value, showLabel, opts._powerline);
  }

  // percent (default)
  const value = opts._powerline ? `${pct}%` : `${c}${B}${pct}%${R}`;
  return withLabel('Ctx', value, showLabel, opts._powerline);
}

// premium_requests — total premium API requests consumed this session.
// Source: stdinData.cost.total_premium_requests
// Returns null if the field is absent or zero.
// opts.show_label: boolean (default false)
// opts.show_zero:  boolean (default false) — show even when count is 0
function premium_requests(stdinData, sessionData, opts) {
  const count = (stdinData.cost || {}).total_premium_requests;
  if (count == null) return null;

  const showZero  = opts.show_zero === true;
  if (!showZero && count === 0) return null;

  const showLabel = opts.show_label === true;
  const value     = opts._powerline ? `⟐ ${count}` : `${B}⟐ ${count}${R}`;
  return withLabel('Prem', value, showLabel, opts._powerline);
}

// token_breakdown — compact summary of all cumulative token counts.
// Format: "in:24.1K out:8.4K cache:6.3K"
// Source: stdinData.context_window (total_input/output/cache_read/cache_write tokens)
// Returns null if no token counts are present.
// opts.show_label: boolean (default false)
// opts.show_cache: boolean (default true) — include combined cache token count
function token_breakdown(stdinData, sessionData, opts) {
  const ctx  = stdinData.context_window || {};
  const tin  = ctx.total_input_tokens;
  const tout = ctx.total_output_tokens;
  const tcr  = ctx.total_cache_read_tokens;
  const tcw  = ctx.total_cache_write_tokens;

  if (tin == null && tout == null) return null;
  if ((tin === 0 || tin == null) && (tout === 0 || tout == null)) return null;

  const showCache = opts.show_cache !== false; // default: show cache
  const parts = [];
  if (tin  != null) parts.push(`in:${fmtTokens(tin)}`);
  if (tout != null) parts.push(`out:${fmtTokens(tout)}`);
  const cacheTotal = (tcr || 0) + (tcw || 0);
  if (showCache && cacheTotal > 0) parts.push(`cache:${fmtTokens(cacheTotal)}`);

  const showLabel = opts.show_label === true;
  const raw       = parts.join(' ');
  const value     = opts._powerline ? raw : `${D}${raw}${R}`;
  return withLabel('Tokens', value, showLabel, opts._powerline);
}

// output_speed — output token throughput in tokens per second.
// Computed from total_output_tokens / (total_api_duration_ms / 1000).
// Returns null if duration or output token count is missing.
// opts.show_label: boolean (default false)
function output_speed(stdinData, sessionData, opts) {
  const ctx  = stdinData.context_window || {};
  const cost = stdinData.cost || {};
  const tout = ctx.total_output_tokens;
  const dur  = cost.total_api_duration_ms;

  if (!tout || !dur || dur <= 0) return null;

  const tps       = Math.round(tout / (dur / 1000));
  const showLabel = opts.show_label === true;
  const value     = opts._powerline ? `${tps} t/s` : `${B}${tps}${R}${D} t/s${R}`;
  return withLabel('Speed', value, showLabel, opts._powerline);
}

// last_call — token counts for the most recent API call.
// Source: stdinData.context_window.last_call_input_tokens / last_call_output_tokens
// Format: "↳ 3.2K / 820"
// Returns null if either count is absent.
// opts.show_label: boolean (default false)
function last_call(stdinData, sessionData, opts) {
  const ctx = stdinData.context_window || {};
  const tin  = ctx.last_call_input_tokens;
  const tout = ctx.last_call_output_tokens;

  if (tin == null && tout == null) return null;

  const parts = [];
  if (tin  != null) parts.push(`↳ ${fmtTokens(tin)}`);
  if (tout != null) parts.push(fmtTokens(tout));
  const raw       = parts.join(' / ');
  const showLabel = opts.show_label === true;
  const value     = opts._powerline ? raw : `${D}${raw}${R}`;
  return withLabel('Last', value, showLabel, opts._powerline);
}

// cache_breakdown — separate read and write cache token counts.
// Format: "R:5.2K W:1.1K"
// Returns null if neither cache field is present.
// opts.show_label: boolean (default false)
function cache_breakdown(stdinData, sessionData, opts) {
  const ctx = stdinData.context_window || {};
  const tcr = ctx.total_cache_read_tokens;
  const tcw = ctx.total_cache_write_tokens;

  if (tcr == null && tcw == null) return null;

  const parts = [];
  if (tcr != null && tcr > 0) parts.push(`R:${fmtTokens(tcr)}`);
  if (tcw != null && tcw > 0) parts.push(`W:${fmtTokens(tcw)}`);
  if (!parts.length) return null;

  const showLabel = opts.show_label === true;
  const raw       = parts.join(' ');
  const value     = opts._powerline ? raw : `${D}${raw}${R}`;
  return withLabel('Cache', value, showLabel, opts._powerline);
}

module.exports = {
  context_window,
  premium_requests,
  token_breakdown,
  output_speed,
  last_call,
  cache_breakdown,
};
