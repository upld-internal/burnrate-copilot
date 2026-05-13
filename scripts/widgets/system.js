'use strict';
// widgets/system.js — system/environment widgets for copilot-hud.
//
// Note: `account` widget from cost-display is omitted — Copilot CLI has no
// equivalent Bedrock/Anthropic distinction.

const path           = require('path');
const { R, B, setFg, getGradientPalette, withLabel } = require('../themes');

// Per-character ANSI-256 gradient coloring. Falls back to bold if no palette.
function applyGradient(text, palette) {
  if (!palette || !palette.length) return `${B}${text}${R}`;
  return text.split('').map((ch, i) => setFg(palette[i % palette.length]) + ch).join('') + R;
}

// cwd — current working directory (last N path segments).
// opts.depth:      number of segments to show (default 1)
// opts.gradient:   boolean — per-character rainbow coloring (plain mode only)
// opts.show_label: boolean (default false)
function cwd(stdinData, sessionData, opts) {
  const dir = stdinData.cwd;
  if (!dir) return null;

  const depth   = opts.depth || 1;
  const parts   = dir.split(path.sep).filter(Boolean);
  const segment = parts.slice(-depth).join(path.sep);

  if (!segment) return null;

  const showLabel = opts.show_label === true;
  let value;
  if (opts._powerline) {
    value = segment;
  } else if (opts.gradient) {
    value = applyGradient(segment, getGradientPalette(opts._theme));
  } else {
    value = `${B}${segment}${R}`;
  }

  return withLabel('Dir', value, showLabel, opts._powerline);
}

module.exports = { cwd };
