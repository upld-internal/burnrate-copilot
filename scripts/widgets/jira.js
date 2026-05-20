'use strict';
// widgets/jira.js — Jira attribution widget.

const { R, B, D, GR, YL, RD, withLabel } = require('../themes');

const SOURCE_ICON = {
  explicit:      '●',
  atlassian_mcp: '⬡',
  branch:        '⎇',
  commit:        '↩',
};

const COLOR_MAP = {
  default: '',
  dim:     D,
  green:   GR,
  yellow:  YL,
  red:     RD,
  bold:    B,
};

// Wrap text in an OSC 8 terminal hyperlink.
function osc8Link(url, text) {
  const ESC = '\x1b';
  const BEL = '\x07';
  return `${ESC}]8;;${url}${BEL}${text}${ESC}]8;;${BEL}`;
}

// jira_ticket — active Jira ticket key inferred from the current git branch.
//
// Reads key/source from sessionData fields populated by compositor.js.
//
// opts.show_source: boolean (default false) — append source icon (e.g. ⎇ for branch)
// opts.show_label:  boolean (default false) — prepend "Jira: "
// opts.color:       "default" | "dim" | "green" | "yellow" | "red" | "bold"
// opts.link:        boolean (default true)  — wrap key in a clickable OSC 8 hyperlink
// opts.base_url:    string (default from sessionData.jiraBaseUrl) — Atlassian base URL
function jira_ticket(stdinData, sessionData, opts) {
  const key = sessionData.lastKnownJiraKey || sessionData.jiraKey || '';
  if (!key) return null;

  const showSource = opts.show_source === true;
  const source     = sessionData.lastKnownJiraSource || sessionData.jiraSource || '';
  const icon       = showSource ? (SOURCE_ICON[source] || '') : '';

  const plainText = icon ? `${key} ${icon}` : key;
  const colored   = opts._powerline ? plainText : colorize(plainText, opts.color);

  const baseUrl   = opts.base_url || sessionData.jiraBaseUrl || 'https://uplandsoftware.atlassian.net/browse';
  const showLink  = opts.link !== false; // default true
  const value     = showLink ? osc8Link(`${baseUrl}/${key}`, colored) : colored;

  const showLabel = opts.show_label === true; // default false
  return withLabel('Jira', value, showLabel, opts._powerline);
}

function colorize(text, color) {
  const code = COLOR_MAP[color || 'default'] || '';
  if (!code) return `${B}${text}${R}`;
  if (code === B) return `${B}${text}${R}`;
  return `${code}${B}${text}${R}`;
}

module.exports = { jira_ticket };
