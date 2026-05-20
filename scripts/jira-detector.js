'use strict';

const { execSync } = require('child_process');

function normalizeProjectKeys(projectKeys) {
  if (!Array.isArray(projectKeys)) return [];
  return projectKeys
    .map(k => String(k || '').trim().toUpperCase())
    .filter(Boolean);
}

function extractJiraKey(text, projectKeys) {
  const raw = String(text || '').toUpperCase();
  if (!raw) return null;

  const keys = normalizeProjectKeys(projectKeys);
  if (keys.length > 0) {
    for (const projectKey of keys) {
      const re = new RegExp(`\\b(${projectKey}-\\d+)\\b`, 'i');
      const match = raw.match(re);
      if (match) return match[1].toUpperCase();
    }
    return null;
  }

  const match = raw.match(/\b([A-Z]+-\d+)\b/);
  return match ? match[1].toUpperCase() : null;
}

function detectJiraKey(cwd, projectKeys) {
  const root = String(cwd || '').trim();
  if (!root) return null;

  try {
    const branch = execSync('git branch --show-current', {
      cwd: root,
      timeout: 500,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();

    if (!branch) return null;
    const key = extractJiraKey(branch, projectKeys);
    if (!key) return null;

    return { key, source: 'branch', branch };
  } catch (_) {
    return null;
  }
}

module.exports = { normalizeProjectKeys, extractJiraKey, detectJiraKey };
