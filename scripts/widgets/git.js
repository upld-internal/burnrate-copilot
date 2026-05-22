'use strict';
// widgets/git.js — git_branch and git_status widgets for burnrate-copilot.
//
// Enhancement vs cost-display:
//   git_branch includes ahead/behind counts (↑2 ↓1) when the branch
//   has a remote tracking ref.

const { execSync } = require('child_process');
const { R, B, D }  = require('../themes');

const GIT_TIMEOUT = 500;

function runGit(args, cwd) {
  return execSync(`git ${args}`, {
    cwd,
    timeout: GIT_TIMEOUT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
}

// Parse ahead/behind counts from `git rev-list --count --left-right @{upstream}...HEAD`.
// Returns { ahead: N, behind: N } or null on any error.
function getAheadBehind(cwd) {
  try {
    const out = runGit('rev-list --count --left-right @{upstream}...HEAD', cwd);
    const [behind, ahead] = out.split('\t').map(Number);
    if (!isNaN(ahead) && !isNaN(behind)) return { ahead, behind };
  } catch (_) {}
  return null;
}

// git_branch — current branch name with optional ahead/behind annotation.
// opts.show_ahead_behind: boolean (default true)
// Returns null if not in a git repo.
function git_branch(stdinData, sessionData, opts) {
  const cwd = stdinData.cwd;
  if (!cwd) return null;

  let branch;
  try {
    branch = runGit('branch --show-current', cwd);
  } catch (_) {
    return null;
  }
  if (!branch) return null;

  const showAB = opts.show_ahead_behind !== false; // default: true
  let annotation = '';
  if (showAB) {
    const ab = getAheadBehind(cwd);
    if (ab) {
      const parts = [];
      if (ab.ahead  > 0) parts.push(`↑${ab.ahead}`);
      if (ab.behind > 0) parts.push(`↓${ab.behind}`);
      if (parts.length) annotation = ` ${D}${parts.join(' ')}${R}`;
    }
  }

  if (opts._powerline) return ` ${branch}`;
  return ` ${B}${branch}${R}${annotation}`;
}

// git_status — dirty working tree indicator.
// Returns "✎" when there are uncommitted changes, null when clean.
function git_status(stdinData, sessionData, opts) {
  const cwd = stdinData.cwd;
  if (!cwd) return null;

  let output;
  try {
    output = runGit('status --porcelain', cwd);
  } catch (_) {
    return null;
  }

  if (!output) return null;

  if (opts._powerline) return '✎';
  return `${B}✎${R}`;
}

module.exports = { git_branch, git_status };
