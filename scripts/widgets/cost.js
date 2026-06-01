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
// opts.show_projected: boolean (default true)
function mtd_cost(stdinData, sessionData, opts) {
  if (!sessionData.hasPricing) return null;

  const name = MONTH_NAMES[new Date().getUTCMonth()];
  const showProjected = opts.show_projected !== false;
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
    ? `${fmtCredits(credits)} cr`
    : `${c}${B}${fmtCredits(credits)}${R} ${D}cr${R}`;
  return withLabel('Creds', value, showLabel, opts._powerline);
}

// mtd_credits — month-to-date cost in AI Credits with optional projection.
// opts.show_projected: boolean (default true)
function mtd_credits(stdinData, sessionData, opts) {
  if (!sessionData.hasPricing) return null;

  const name          = MONTH_NAMES[new Date().getUTCMonth()];
  const showProjected = opts.show_projected !== false;
  const credits       = (sessionData.mtd || 0) * 100;
  const amt           = fmtCredits(credits);

  if (opts._powerline) {
    if (showProjected && sessionData.projected > 0) {
      return `${name} ${amt} cr (~${Math.round(sessionData.projected * 100)}/mo)`;
    }
    return `${name} ${amt} cr`;
  }

  if (showProjected && sessionData.projected > 0) {
    return `${D}${name}${R} ${B}${amt}${R} ${D}cr${R} ${D}(~${Math.round(sessionData.projected * 100)}/mo)${R}`;
  }
  return `${D}${name}${R} ${B}${amt}${R} ${D}cr${R}`;
}

module.exports = { session_cost, mtd_cost, session_credits, mtd_credits };
