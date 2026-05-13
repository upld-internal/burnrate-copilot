'use strict';
// widgets/custom.js — user-defined widgets: custom_text, custom_symbol,
//                     custom_command, separator, and newline.

const { execSync } = require('child_process');
const { R, B, D }  = require('../themes');

const COLOR_MAP = {
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m',
  blue: '\x1b[34m', magenta: '\x1b[35m', cyan: '\x1b[36m',
  white: '\x1b[37m', dim: D, bold: B,
};

// custom_text — static text label.
// opts.text: string (required)
// opts.color: color name from COLOR_MAP (optional)
// opts.bold: boolean (optional)
function custom_text(stdinData, sessionData, opts) {
  const text = opts.text;
  if (!text) return null;
  if (opts._powerline) return text;

  let out = '';
  if (opts.bold)  out += B;
  if (opts.color) out += COLOR_MAP[opts.color] || '';
  out += text;
  if (opts.bold || opts.color) out += R;
  return out;
}

// custom_symbol — a single unicode character or emoji.
// opts.symbol: string (required)
// opts.color: color name from COLOR_MAP (optional)
function custom_symbol(stdinData, sessionData, opts) {
  const sym = opts.symbol;
  if (!sym) return null;
  if (opts._powerline) return sym;

  if (opts.color && COLOR_MAP[opts.color]) {
    return `${COLOR_MAP[opts.color]}${sym}${R}`;
  }
  return sym;
}

// custom_command — runs an external command, embeds its stdout as a segment.
// The full stdin JSON is piped to the subprocess's stdin.
// opts.command:       shell command string (required)
// opts.timeout:       ms (default 1000)
// opts.preserveColors: boolean (default false)
function custom_command(stdinData, sessionData, opts) {
  const command = opts.command;
  if (!command) return null;

  try {
    const result = execSync(command, {
      input: JSON.stringify(stdinData),
      timeout: opts.timeout || 1000,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'],
      env: process.env,
      shell: true,
    });
    const output = result.replace(/\n$/, '').trimEnd();
    return output || null;
  } catch (_) {
    return null;
  }
}

// separator — visual divider between segments.
// Returns null in powerline mode (glyphs are injected by the compositor).
function separator(stdinData, sessionData, opts) {
  if (opts._powerline) return null;
  const char = opts.char || opts._globalSeparator || '│';
  return ` ${char} `;
}

// newline — inserts a literal newline.
// In powerline mode, the compositor uses this as a row boundary.
function newline(stdinData, sessionData, opts) {
  return '\n';
}

module.exports = { custom_text, custom_symbol, custom_command, separator, newline };
