'use strict';
/**
 * paths.js — shared path helpers for copilot-hud.
 *
 * Exports:
 *   getCopilotConfigDir() → string — respects COPILOT_HOME env var
 *   getDataDir()          → string — ~/.copilot/hud-costs/
 */

const os   = require('os');
const path = require('path');

/**
 * Return the Copilot config directory, honouring the COPILOT_HOME
 * environment variable when set.
 */
function getCopilotConfigDir() {
  const env = (process.env.COPILOT_HOME || '').trim();
  if (env) return env;
  return path.join(os.homedir(), '.copilot');
}

/**
 * Return the hud-costs data directory where all plugin data lives.
 */
function getDataDir() {
  return path.join(getCopilotConfigDir(), 'hud-costs');
}

module.exports = { getCopilotConfigDir, getDataDir };
