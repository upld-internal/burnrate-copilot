'use strict';
/**
 * pricing.js — month-to-date computation for burnrate-copilot.
 *
 * Session cost comes directly from ai_used.total_nano_aiu in the Copilot CLI
 * statusline payload (authoritative GitHub billing data, June 2026+).
 * This file now only handles the MTD/projected summary from the monthly JSONL.
 *
 * Exports:
 *   getMtdAndProjected(monthKey, dataDir) → { mtd, projected, error }
 */

const fs   = require('fs');
const path = require('path');

/**
 * Compute month-to-date cost and projected monthly cost from the JSONL file.
 *
 * Returns { mtd, projected, error }:
 *   { mtd: 0,    projected: null,  error: false }  — no sessions yet this month
 *   { mtd: n,    projected: n|null, error: false }  — normal; projected null when mtd is 0
 *   { mtd: null, projected: null,  error: true  }  — read/parse error
 */
function getMtdAndProjected(monthKey, dataDir) {
  const monthlyFile = path.join(dataDir, 'monthly', monthKey + '.jsonl');
  if (!fs.existsSync(monthlyFile)) {
    return { mtd: 0, projected: null, error: false };
  }
  try {
    let total = 0;
    for (const line of fs.readFileSync(monthlyFile, 'utf8').split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try { total += JSON.parse(trimmed).cost_usd || 0; } catch (_) {}
    }
    const now         = new Date();
    const dayOfMonth  = now.getUTCDate();
    const daysInMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
    const projected   = total > 0 ? (total / Math.max(1, dayOfMonth)) * daysInMonth : null;
    return { mtd: total, projected, error: false };
  } catch (_) {
    return { mtd: null, projected: null, error: true };
  }
}

module.exports = { getMtdAndProjected };
