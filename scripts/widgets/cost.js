'use strict';
// widgets/cost.js — cost display widgets for copilot-hud.
//
// Cost computation is deferred to Phase 6 (GitHub Copilot pricing model TBD).
// These widgets return a "?" placeholder until Phase 6 implements pricing.
// Raw token data is already captured every turn via last_known_tokens; cost
// can be computed retroactively once pricing is known.
//
// When Phase 6 is implemented: replace these stubs with the ported pricing
// logic from cost-display, adapting token field names:
//   total_cache_write_tokens  (Copilot) ← cache_creation_input_tokens (Claude)
//   total_cache_read_tokens   (Copilot) ← cache_read_input_tokens      (Claude)

const { R, B, D, YL, RD, withLabel } = require('../themes');

const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

// session_cost — current session cost.
// Phase 6: compute from token delta × pricing.
// Until then: returns null (hidden until pricing is available).
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

// mtd_cost — month-to-date cost with optional projection.
// Phase 6: reads from monthly JSONL + current session.
// Until then: returns null (hidden until pricing is available).
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

module.exports = { session_cost, mtd_cost };
