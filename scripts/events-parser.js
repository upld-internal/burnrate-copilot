'use strict';
/**
 * events-parser.js — parse Copilot CLI events.jsonl for cost-relevant data.
 *
 * The events.jsonl file (at ~/.copilot/session-state/<session-id>/events.jsonl)
 * is the authoritative source for per-model token usage. Key events:
 *
 *   session.shutdown → data.modelMetrics: per-model token breakdown
 *   subagent.completed → data.totalTokens, data.model, data.durationMs
 *   session.compaction_complete → data.compactionTokensUsed
 *
 * This module extracts modelMetrics and computes accurate multi-model cost.
 *
 * IMPORTANT: events.jsonl may not always be available:
 *   - Session ended normally → file exists, session.shutdown event present
 *   - Ctrl+C / crash → file may exist but no session.shutdown event
 *   - Session-state cleaned up → file gone entirely
 *
 * Callers must handle null returns gracefully and fall back to single-model pricing.
 *
 * Exports:
 *   getSessionStateDir(sessionId)           → string
 *   parseShutdownMetrics(sessionId)         → modelMetrics object | null
 *   computeMultiModelCost(modelMetrics, pricingTable) → { total, perModel, models }
 *   computeMultiModelCostForSession(sessionId, pricingTable) → result | null
 *   loadPricingTable(dataDir, scriptDir)    → { modelId: { input, output, ... } }
 */

const fs   = require('fs');
const path = require('path');
const { getCopilotConfigDir } = require('./paths');

/**
 * Returns the session-state directory for a given session ID.
 * This is where Copilot CLI stores events.jsonl, checkpoints, etc.
 */
function getSessionStateDir(sessionId) {
  return path.join(getCopilotConfigDir(), 'session-state', sessionId);
}

/**
 * Parse events.jsonl for a session, extracting cost-relevant data in one pass.
 *
 * Returns { shutdownMetrics, subagents } or null if file doesn't exist.
 *   shutdownMetrics: modelMetrics object from session.shutdown, or null
 *   subagents: array of subagent.completed event data objects
 */
function parseEventsFile(sessionId) {
  const eventsFile = path.join(getSessionStateDir(sessionId), 'events.jsonl');
  if (!fs.existsSync(eventsFile)) return null;

  let shutdownMetrics = null;
  const subagents = [];

  try {
    const content = fs.readFileSync(eventsFile, 'utf8');
    const lines = content.split('\n');

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const event = JSON.parse(line);
        if (event.type === 'session.shutdown') {
          shutdownMetrics = (event.data || {}).modelMetrics || null;
        } else if (event.type === 'subagent.completed') {
          subagents.push(event.data || {});
        }
      } catch (_) {}
    }
  } catch (_) {
    return null;
  }

  return { shutdownMetrics, subagents };
}

/**
 * Parse the events.jsonl for a session and extract session.shutdown.modelMetrics.
 * Returns the modelMetrics object if found, null otherwise.
 */
function parseShutdownMetrics(sessionId) {
  const result = parseEventsFile(sessionId);
  return result ? result.shutdownMetrics : null;
}

/**
 * Parse subagent.completed events and compute per-agent cost.
 *
 * Returns array of:
 *   { name, model, tokens, cost_usd, duration_ms, tool_calls }
 *
 * Note: subagent.completed.totalTokens = inputTokens + outputTokens only (no cache).
 * We approximate cost as: totalTokens split 95% input / 5% output for pricing.
 * This is approximate — the authoritative total comes from modelMetrics.
 *
 * @param {string} sessionId
 * @param {Object} pricingTable — full pricing table
 * @returns {Array|null} — null if events.jsonl not available
 */
function parseSubagentCompletions(sessionId, pricingTable) {
  const result = parseEventsFile(sessionId);
  if (!result || result.subagents.length === 0) return null;

  return result.subagents.map(sa => {
    const model = sa.model || 'unknown';
    const totalTokens = sa.totalTokens || 0;
    const pricing = pricingTable[model];

    // Approximate cost: totalTokens ≈ input + output.
    // From empirical data, subagent token splits are roughly 95% input / 5% output.
    // Use weighted average rate: (0.95 * input_rate + 0.05 * output_rate) per token
    let costUsd = 0;
    if (pricing && totalTokens > 0) {
      const inputTokens  = Math.round(totalTokens * 0.95);
      const outputTokens = totalTokens - inputTokens;
      costUsd = inputTokens / 1e6 * (pricing.input || 0) +
                outputTokens / 1e6 * (pricing.output || 0);
    }

    return {
      name:        sa.agentName || sa.agentDisplayName || 'unnamed',
      model:       model,
      tokens:      totalTokens,
      cost_usd:    Math.round(costUsd * 1e6) / 1e6, // 6 decimal places
      duration_ms: sa.durationMs || 0,
      tool_calls:  sa.totalToolCalls || 0,
    };
  });
}

/**
 * Compute accurate multi-model cost from modelMetrics.
 *
 * @param {Object} modelMetrics — from session.shutdown event
 * @param {Object} pricingTable — { modelId: { input, output, cache_write, cache_read } }
 * @returns {{ total: number, perModel: Object, models: string[], missingPricing: string[] }}
 */
function computeMultiModelCost(modelMetrics, pricingTable) {
  if (!modelMetrics || typeof modelMetrics !== 'object') {
    return null;
  }

  let total = 0;
  const perModel = {};
  const models = [];
  const missingPricing = [];

  for (const [modelId, data] of Object.entries(modelMetrics)) {
    const usage = data.usage || {};
    const pricing = pricingTable[modelId];
    models.push(modelId);

    if (!pricing) {
      missingPricing.push(modelId);
      perModel[modelId] = {
        cost: 0,
        hasPricing: false,
        tokens: {
          input: usage.inputTokens || 0,
          output: usage.outputTokens || 0,
          cache_write: usage.cacheWriteTokens || 0,
          cache_read: usage.cacheReadTokens || 0,
        },
        requests: (data.requests || {}).count || 0,
      };
      continue;
    }

    const input      = (usage.inputTokens || 0) / 1e6 * (pricing.input || 0);
    const output     = (usage.outputTokens || 0) / 1e6 * (pricing.output || 0);
    const cacheWrite = (usage.cacheWriteTokens || 0) / 1e6 * (pricing.cache_write || 0);
    const cacheRead  = (usage.cacheReadTokens || 0) / 1e6 * (pricing.cache_read || 0);
    const cost = input + output + cacheWrite + cacheRead;

    total += cost;
    perModel[modelId] = {
      cost,
      hasPricing: true,
      tokens: {
        input: usage.inputTokens || 0,
        output: usage.outputTokens || 0,
        cache_write: usage.cacheWriteTokens || 0,
        cache_read: usage.cacheReadTokens || 0,
      },
      requests: (data.requests || {}).count || 0,
    };
  }

  return { total, perModel, models, missingPricing };
}

/**
 * High-level convenience: parse events.jsonl + compute multi-model cost in one call.
 *
 * @param {string} sessionId
 * @param {Object} pricingTable — full pricing table (all models)
 * @returns {{ total, perModel, models, missingPricing } | null} — null if no data
 */
function computeMultiModelCostForSession(sessionId, pricingTable) {
  const metrics = parseShutdownMetrics(sessionId);
  if (!metrics) return null;
  return computeMultiModelCost(metrics, pricingTable);
}

/**
 * Load the full pricing table (all models) from pricing.json.
 *
 * Searches:
 *   1. <dataDir>/pricing.json (user override)
 *   2. <scriptDir>/../pricing.json (bundled default)
 *
 * Returns { modelId: { input, output, cache_write, cache_read } }
 */
function loadPricingTable(dataDir, scriptDir) {
  const candidates = [
    dataDir   ? path.join(dataDir,   'pricing.json')       : '',
    scriptDir ? path.join(scriptDir, '..', 'pricing.json') : '',
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) continue;
    try {
      const data = JSON.parse(fs.readFileSync(candidate, 'utf8'));
      const table = {};
      for (const [key, val] of Object.entries(data)) {
        if (!key.startsWith('_') && typeof val === 'object' && val !== null) {
          table[key] = val;
        }
      }
      return table;
    } catch (_) {}
  }
  return {};
}

module.exports = {
  getSessionStateDir,
  parseEventsFile,
  parseShutdownMetrics,
  parseSubagentCompletions,
  computeMultiModelCost,
  computeMultiModelCostForSession,
  loadPricingTable,
};
