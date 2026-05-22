'use strict';
/**
 * pricing.js — cost computation for copilot-hud.
 *
 * Uses GitHub Copilot AI Credits rates (effective June 1 2026, 1 credit = $0.01 USD).
 * Rates are sourced from GitHub's official pricing table, not Anthropic/AWS direct rates.
 *
 * Key differences from the Claude Code version:
 *   - Uses getCopilotConfigDir / paths.js instead of getClaudeConfigDir
 *   - computeSessionCost uses Copilot's token field names:
 *       total_cache_write_tokens  (vs cache_creation_input_tokens in Claude Code)
 *       total_cache_read_tokens   (vs cache_read_input_tokens in Claude Code)
 *   - OpenAI/Google models have cache_write = 0 (only Anthropic charges for cache writes)
 *
 * Source for rates:
 *   https://docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing
 *
 * Exports:
 *   loadPricing(modelId, dataDir, scriptDir) → object | null
 *   computeCost(dInput, dOutput, dCacheWrite, dCacheRead, pricing) → number
 *   computeSessionCost(ctx, snapshot, pricing) → number
 *   getMtdAndProjected(monthKey, dataDir) → { mtd, projected, error }
 */

const fs   = require('fs');
const path = require('path');

/**
 * Load pricing for modelId.
 *
 * Search order:
 *   1. <dataDir>/pricing.json     — user override in ~/.copilot/burnrate-copilot/
 *   2. <scriptDir>/../pricing.json — repo-bundled default (pricing.json at repo root)
 *
 * Returns the pricing object for the model, or null if not found.
 * Emits a staleness warning to stderr when pricing.json is older than 60 days.
 */
function loadPricing(modelId, dataDir, scriptDir) {
  const candidates = [
    dataDir   ? path.join(dataDir,   'pricing.json')         : '',
    scriptDir ? path.join(scriptDir, '..', 'pricing.json')   : '',
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) continue;
    try {
      const data = JSON.parse(fs.readFileSync(candidate, 'utf8'));

      // Staleness warning — stderr only, never pollutes statusline stdout
      const lastVerified = (data._meta || {}).last_verified || '';
      if (lastVerified) {
        try {
          const ageDays = Math.floor((Date.now() - new Date(lastVerified).getTime()) / 86400000);
          if (ageDays > 60) {
            process.stderr.write(
              `burnrate: pricing.json is ${ageDays} days old — ` +
              `update pricing.json to refresh rates\n`
            );
          }
        } catch (_) {}
      }

      const modelPricing = data[modelId];
      if (modelPricing) return modelPricing;
    } catch (_) {}
  }
  return null;
}

/**
 * Compute cost in USD from token deltas and a pricing object.
 * Returns 0 if pricing is null — caller is responsible for hasPricing flag.
 */
function computeCost(dInput, dOutput, dCacheWrite, dCacheRead, pricing) {
  const p = pricing || {};
  return (
    dInput      / 1e6 * (p.input       || 0) +
    dOutput     / 1e6 * (p.output      || 0) +
    dCacheWrite / 1e6 * (p.cache_write || 0) +
    dCacheRead  / 1e6 * (p.cache_read  || 0)
  );
}

/**
 * Compute session cost from current context_window totals and the session
 * baseline snapshot captured at SessionStart.
 *
 * ctx      — stdinData.context_window (Copilot field names)
 * snapshot — session file's snapshot (zero baseline from SessionStart)
 * pricing  — pricing object from loadPricing, or null
 */
function computeSessionCost(ctx, snapshot, pricing) {
  const dInput      = Math.max(0, (ctx.total_input_tokens       || 0) - (snapshot.total_input_tokens       || 0));
  const dOutput     = Math.max(0, (ctx.total_output_tokens      || 0) - (snapshot.total_output_tokens      || 0));
  const dCacheWrite = Math.max(0, (ctx.total_cache_write_tokens || 0) - (snapshot.total_cache_write_tokens || 0));
  const dCacheRead  = Math.max(0, (ctx.total_cache_read_tokens  || 0) - (snapshot.total_cache_read_tokens  || 0));
  return computeCost(dInput, dOutput, dCacheWrite, dCacheRead, pricing);
}

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

module.exports = { loadPricing, computeCost, computeSessionCost, getMtdAndProjected };
