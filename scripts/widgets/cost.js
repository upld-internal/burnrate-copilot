'use strict';
// widgets/cost.js — cost display widgets for burnrate-copilot.
//
// Cost is sourced from ai_used.total_nano_aiu (GitHub billing figure, June 2026+).
//   USD cost  = nano_aiu / 100_000_000_000
//   AI Credits = nano_aiu / 1_000_000_000   (1 credit = $0.01 USD)
//
// session_cost / mtd_cost  — display in USD ($)
// session_credits / mtd_credits — display in AI Credits (matches Copilot footer)

const { R, B, D, YL, RD, withLabel } = require('../themes');

const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

// projectFromMtd — linear projection of a MTD value to full-month total.
// Returns null when there is nothing meaningful to show (day 1, or mtd is 0).
function projectFromMtd(mtd) {
  if (!mtd || mtd <= 0) return null;
  const now         = new Date();
  const dayOfMonth  = now.getUTCDate();
  const daysInMonth = new Date(Date.UTC(now.getFullYear(), now.getMonth() + 1, 0)).getUTCDate();
  return (mtd / Math.max(1, dayOfMonth)) * daysInMonth;
}

// projColor — ANSI color for a projected value relative to the monthly entitlement.
// proj and entitlement must be in the same unit (both USD or both credits).
// > 100% of entitlement → red, > 90% → yellow-orange, otherwise no color.
function projColor(proj, entitlement) {
  if (!entitlement || entitlement <= 0) return '';
  const ratio = proj / entitlement;
  if (ratio > 1.0) return RD;
  if (ratio > 0.9) return YL;
  return '';
}

// fmtCredits — format an AI credit value to match the Copilot footer style.
// < 10: two decimal places ("9.22"), < 100: one decimal ("13.8"), >= 100: none ("142").
function fmtCredits(n) {
  if (n < 10)  return n.toFixed(2);
  if (n < 100) return n.toFixed(1);
  return n.toFixed(0);
}

// session_cost — current session cost in USD.
// opts.show_label: boolean (default true)
function session_cost(stdinData, sessionData, opts) {
  if (!sessionData.hasPricing) return null;

  const showLabel = opts.show_label !== false;
  const cost  = sessionData.sessionCost || 0;
  const c     = cost < 1 ? '' : cost < 5 ? YL : RD;
  const value = opts._powerline
    ? `$${cost.toFixed(2)}`
    : `${c}${B}$${cost.toFixed(2)}${R}`;
  return withLabel('Session', value, showLabel, opts._powerline);
}

// mtd_cost — month-to-date cost in USD with optional projection.
// Primary source: API quota cache (sd.hasQuota). Fallback: JSONL sum.
// opts.show_projected: boolean (default true)
function mtd_cost(stdinData, sessionData, opts) {
  if (!sessionData.hasPricing && !sessionData.hasQuota) return null;

  const name = MONTH_NAMES[new Date().getUTCMonth()];
  const showProjected = opts.show_projected !== false;

  if (sessionData.hasQuota) {
    const entitlementUsd = (sessionData.quotaEntitlement || 0) / 100;
    const used  = (sessionData.quotaEntitlement - sessionData.quotaRemaining) / 100;
    const amt   = used.toFixed(2);
    const tilde = sessionData.quotaStale ? '~' : '';
    const proj  = showProjected ? projectFromMtd(used) : null;
    if (opts._powerline) {
      return proj
        ? `${name} ${tilde}$${amt} (~$${Math.round(proj)}/mo)`
        : `${name} ${tilde}$${amt}`;
    }
    if (proj) {
      const c = projColor(proj, entitlementUsd);
      return `${D}${name}${R} ${B}${tilde}$${amt}${R} ${c}${D}(~$${Math.round(proj)}/mo)${R}`;
    }
    return `${D}${name}${R} ${B}${tilde}$${amt}${R}`;
  }

  // Fallback: JSONL sum path (unchanged)
  const mtd  = sessionData.mtd || 0;
  const amt  = mtd.toFixed(2);
  if (opts._powerline) {
    if (showProjected && sessionData.projected > 0) {
      return `${name} $${amt} (~$${Math.round(sessionData.projected)}/mo)`;
    }
    return `${name} $${amt}`;
  }
  if (showProjected && sessionData.projected > 0) {
    return `${D}${name}${R} ${B}$${amt}${R} ${D}(~$${Math.round(sessionData.projected)}/mo)${R}`;
  }
  return `${D}${name}${R} ${B}$${amt}${R}`;
}

// session_credits — current session cost in AI Credits (1 credit = $0.01).
// Matches the "AI Credits: X.XX" format shown in the Copilot footer.
// opts.show_label: boolean (default true)
function session_credits(stdinData, sessionData, opts) {
  if (!sessionData.hasPricing) return null;

  const showLabel = opts.show_label !== false;
  const credits = (sessionData.sessionCost || 0) * 100;
  const c       = credits < 100 ? '' : credits < 500 ? YL : RD;
  const value   = opts._powerline
    ? `${fmtCredits(credits)}`
    : `${c}${B}${fmtCredits(credits)}${R}`;
  return withLabel('Credits', value, showLabel, opts._powerline);
}

// mtd_credits — month-to-date cost in AI Credits with optional projection.
// Primary source: API quota cache (sd.hasQuota). Fallback: JSONL sum.
// opts.show_projected: boolean (default true)
function mtd_credits(stdinData, sessionData, opts) {
  if (!sessionData.hasPricing && !sessionData.hasQuota) return null;

  const name = MONTH_NAMES[new Date().getUTCMonth()];
  const showProjected = opts.show_projected !== false;

  if (sessionData.hasQuota) {
    const entitlementCr = sessionData.quotaEntitlement || 0;
    const used  = entitlementCr - sessionData.quotaRemaining;
    const amt   = fmtCredits(used);
    const tilde = sessionData.quotaStale ? '~' : '';
    const proj  = showProjected ? projectFromMtd(used) : null;
    if (opts._powerline) {
      return proj
        ? `${name} ${tilde}${amt} (~${Math.round(proj)}/mo)`
        : `${name} ${tilde}${amt}`;
    }
    if (proj) {
      const c = projColor(proj, entitlementCr);
      return `${D}${name}${R} ${B}${tilde}${amt}${R} ${c}${D}(~${Math.round(proj)}/mo)${R}`;
    }
    return `${D}${name}${R} ${B}${tilde}${amt}${R}`;
  }

  // Fallback: JSONL sum path (unchanged)
  const credits = (sessionData.mtd || 0) * 100;
  const amt     = fmtCredits(credits);
  if (opts._powerline) {
    if (showProjected && sessionData.projected > 0) {
      return `${name} ${amt} (~${Math.round(sessionData.projected * 100)}/mo)`;
    }
    return `${name} ${amt}`;
  }
  if (showProjected && sessionData.projected > 0) {
    return `${D}${name}${R} ${B}${amt}${R} ${D}(~${Math.round(sessionData.projected * 100)}/mo)${R}`;
  }
  return `${D}${name}${R} ${B}${amt}${R}`;
}

// ---------------------------------------------------------------------------
// New quota widgets
// ---------------------------------------------------------------------------

// quota_remaining — credits remaining this billing period.
// Stale cache values are prefixed with tilde.
// opts.show_reset_date: boolean (default true)
// opts.show_label: boolean (default false)
function quota_remaining(stdinData, sessionData, opts) {
  if (!sessionData.hasQuota) return null;

  const showResetDate = opts.show_reset_date !== false;
  const showLabel     = opts.show_label === true;
  const tilde         = sessionData.quotaStale ? '~' : '';
  const remaining     = Math.round(sessionData.quotaRemaining * 10) / 10;

  let resetStr = '';
  if (showResetDate && sessionData.quotaResetDate) {
    try {
      const d = new Date(sessionData.quotaResetDate);
      resetStr = ` · resets ${MONTH_NAMES[d.getUTCMonth()]} ${d.getUTCDate()}`;
    } catch (_) {}
  }

  const core = `${tilde}${remaining} left${resetStr}`;
  if (opts._powerline) return showLabel ? `Quota: ${core}` : core;

  const colored = `${B}${tilde}${remaining}${R} left${resetStr}`;
  return showLabel ? `Quota: ${colored}` : colored;
}

// quota_used — used-vs-entitlement display.
// opts.show_label: boolean (default false)
function quota_used(stdinData, sessionData, opts) {
  if (!sessionData.hasQuota) return null;

  const showLabel  = opts.show_label === true;
  const used       = Math.round((sessionData.quotaEntitlement - sessionData.quotaRemaining) * 10) / 10;
  const total      = sessionData.quotaEntitlement;
  const pctUsed    = (100 - (sessionData.quotaPercent || 0)).toFixed(1);

  const core = opts._powerline
    ? `${used}/${total}`
    : `${B}${used}/${total}${R} ${D}(${pctUsed}%)${R}`;

  return showLabel ? `Used: ${core}` : core;
}

// overage_status — only shown when overage_count > 0.
// opts.show_label: boolean (default false)
function overage_status(stdinData, sessionData, opts) {
  if (!sessionData.hasQuota) return null;
  if (!sessionData.quotaOverage || sessionData.quotaOverage <= 0) return null;

  const showLabel = opts.show_label === true;
  const count     = sessionData.quotaOverage;
  const core      = opts._powerline ? `+${count} over` : `${RD}+${count} overage${R}`;
  return showLabel ? `Overage: ${core}` : core;
}

module.exports = {
  session_cost,
  mtd_cost,
  session_credits,
  mtd_credits,
  quota_remaining,
  quota_used,
  overage_status,
};
