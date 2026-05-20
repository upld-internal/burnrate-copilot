'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');

const { extractJiraKey, detectJiraKey } = require('../scripts/jira-detector');

function tmpGitRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bcd-jira-detector-'));
  execSync('git init -q', { cwd: dir, stdio: 'ignore' });
  execSync('git config user.email "jira-detector@example.com"', { cwd: dir, stdio: 'ignore' });
  execSync('git config user.name "Jira Detector"', { cwd: dir, stdio: 'ignore' });
  fs.writeFileSync(path.join(dir, 'README.md'), '# test\n');
  execSync('git add README.md', { cwd: dir, stdio: 'ignore' });
  execSync('git commit -m "init" -q', { cwd: dir, stdio: 'ignore' });
  return dir;
}

describe('extractJiraKey', () => {
  test('matches configured project keys only', () => {
    assert.equal(extractJiraKey('feature/plat-123-thing', ['PLAT', 'ENG']), 'PLAT-123');
    assert.equal(extractJiraKey('feature/foo-123-thing', ['PLAT', 'ENG']), null);
  });

  test('uses broad fallback pattern when keys are not configured', () => {
    assert.equal(extractJiraKey('feature/abc-77-thing', null), 'ABC-77');
  });
});

describe('detectJiraKey', () => {
  test('detects jira key from git branch', () => {
    const dir = tmpGitRepo();
    execSync('git checkout -b feature/PLAT-4821-new-auth -q', { cwd: dir, stdio: 'ignore' });
    const got = detectJiraKey(dir, ['PLAT', 'ENG']);
    assert.ok(got);
    assert.equal(got.key, 'PLAT-4821');
    assert.equal(got.source, 'branch');
  });

  test('returns null when cwd is not a git repo', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bcd-jira-detector-non-git-'));
    assert.equal(detectJiraKey(dir, ['PLAT']), null);
  });

  test('returns null when branch has no configured key', () => {
    const dir = tmpGitRepo();
    execSync('git checkout -b feature/OPS-12-fix -q', { cwd: dir, stdio: 'ignore' });
    assert.equal(detectJiraKey(dir, ['PLAT', 'ENG']), null);
  });
});
