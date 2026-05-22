'use strict';
// widgets/system.js — system/environment widgets for burnrate-copilot.
//
// Note: `account` widget from cost-display is omitted — Copilot CLI has no
// equivalent Bedrock/Anthropic distinction.

const path           = require('path');
const { R, B, withLabel } = require('../themes');

// cwd — current working directory (last N path segments).
// opts.depth:      number of segments to show (default 1)
// opts.show_label: boolean (default false)
function cwd(stdinData, sessionData, opts) {
  const dir = stdinData.cwd;
  if (!dir) return null;

  const depth   = opts.depth || 1;
  const parts   = dir.split(path.sep).filter(Boolean);
  const segment = parts.slice(-depth).join(path.sep);

  if (!segment) return null;

  const showLabel = opts.show_label === true;
  const value     = opts._powerline ? segment : `${B}${segment}${R}`;
  return withLabel('Dir', value, showLabel, opts._powerline);
}

module.exports = { cwd };
