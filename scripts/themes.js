'use strict';
// themes.js — ANSI color palettes and helpers for powerline mode.
//
// In powerline mode each segment gets a background color cycling through the
// theme's segmentColors array. The powerline glyph (\uE0B0) is injected between
// adjacent segments with fg = left segment's bg and bg = right segment's bg,
// producing the classic "arrow flowing right" transition.
//
// Requires a Nerd Font or Powerline-patched font when powerline mode is active.
// Plain (non-powerline) mode uses only the ANSI constants exported below.

const ESC = '\x1b';

// --- Plain-mode ANSI constants (used by widgets in non-powerline rendering) ---
const R  = `${ESC}[0m`;         // reset all
const B  = `${ESC}[1m`;         // bold
const D  = `${ESC}[2m`;         // dim
const GR = `${ESC}[32m`;        // green (ANSI-16)
const YL = `${ESC}[38;5;214m`; // yellow-orange / amber (ANSI-256 #214)
const RD = `${ESC}[31m`;        // red (ANSI-16)

// --- Powerline helpers (ANSI-256) ---
function setBg(n) { return `${ESC}[48;5;${n}m`; }
function setFg(n) { return `${ESC}[38;5;${n}m`; }

// Powerline glyphs — require Nerd Font / Powerline-patched font
const PL_RIGHT = '\uE0B0'; // filled right arrow: 

// --- Theme definitions ---
// segmentColors: ANSI-256 bg color numbers, cycled per segment.
// fg: ANSI-256 fg color applied to all segment text.
// termBg: ANSI-256 number for the terminal background (used in final glyph
//         transition). null = let the terminal reset handle it.
const THEMES = {
  default: {
    segmentColors: [237, 239, 241, 243],
    fg: 255,
    termBg: null,
  },
  minimal: {
    // No segment backgrounds — just joins segment text with spaces.
    // Works without a Nerd Font; powerline glyphs are not emitted.
    segmentColors: [],
    fg: 255,
    termBg: null,
  },
  nord: {
    // Nord palette: dark bg cycling through blues and teals
    segmentColors: [235, 24, 67, 31],
    fg: 253,
    termBg: null,
  },
  dracula: {
    // Dracula palette: dark bg with purples and pinks
    segmentColors: [235, 61, 97, 141],
    fg: 255,
    termBg: null,
  },
  catppuccin: {
    // Catppuccin Mocha palette
    segmentColors: [235, 24, 61, 99],
    fg: 255,
    termBg: null,
  },
};

function getTheme(name) {
  return THEMES[name] || THEMES.default;
}

// --- Gradient palettes (ANSI-256 fg color sequences, per-character cycling) ---
// Used by the cwd widget's `gradient: true` option in plain mode.
const GRADIENT_PALETTES = {
  // Full-spectrum rainbow: red → orange → yellow → green → cyan → blue → purple → pink
  default:    [196, 202, 208, 214, 226, 118, 46, 51, 33, 57, 201],
  minimal:    [196, 202, 208, 214, 226, 118, 46, 51, 33, 57, 201],
  // Nord: cool blues, teals, sky
  nord:       [153, 117, 75, 67, 31, 37, 43, 80, 117],
  // Dracula: purples, pinks, lavender
  dracula:    [141, 183, 207, 201, 213, 219, 183],
  // Catppuccin: soft pastels cycling warm→cool
  catppuccin: [147, 183, 152, 116, 111, 141, 183, 219],
};

function getGradientPalette(themeName) {
  return GRADIENT_PALETTES[themeName] || GRADIENT_PALETTES.default;
}

// withLabel — prepend a dim "Label: " prefix to a widget value.
// label:     short label string (e.g. "Ctx", "Model")
// value:     the already-formatted widget output (may contain ANSI codes)
// show:      boolean — if false, returns value unchanged
// powerline: boolean — if true, uses plain text in label (no ANSI codes)
function withLabel(label, value, show, powerline) {
  if (!show || !label) return value;
  if (powerline) return `${label}: ${value}`;
  return `${D}${label}:${R} ${value}`;
}

module.exports = { getTheme, getGradientPalette, setBg, setFg, PL_RIGHT, R, B, D, GR, YL, RD, withLabel };
