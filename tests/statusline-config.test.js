'use strict';
// tests/statusline-config.test.js
// Tests for scripts/statusline-config.js
// Run: node tests/statusline-config.test.js

const { test } = require('node:test');
const assert   = require('node:assert/strict');
const fs       = require('fs');
const os       = require('os');
const path     = require('path');

const { ensureStatusLineConfig } = require('../scripts/statusline-config');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mkTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'burnrate-copilot-test-'));
}

function rmDir(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
}

function readSettings(dir) {
  const raw = fs.readFileSync(path.join(dir, 'settings.json'), 'utf8');
  return JSON.parse(raw);
}

// ---------------------------------------------------------------------------
// Test cases
// ---------------------------------------------------------------------------

test('No existing settings.json → creates file with statusLine entry, returns notification', () => {
  const copilotDir = mkTmpDir();
  const pluginRoot = mkTmpDir();

  // Create the script file so sameFile checks don't fail due to missing file
  const scriptsDir = path.join(pluginRoot, 'scripts');
  fs.mkdirSync(scriptsDir);
  fs.writeFileSync(path.join(scriptsDir, 'statusline.js'), '#!/usr/bin/env node\n');

  try {
    const result = ensureStatusLineConfig(pluginRoot, copilotDir);

    assert.ok(result !== null, 'should return a notification string');
    assert.ok(typeof result === 'string', 'notification should be a string');

    const settings = readSettings(copilotDir);
    assert.ok(settings.statusLine, 'statusLine should be written');
    assert.equal(settings.statusLine.type, 'command');
    assert.equal(
      settings.statusLine.command,
      path.join(pluginRoot, 'scripts', 'statusline.js')
    );
  } finally {
    rmDir(copilotDir);
    rmDir(pluginRoot);
  }
});

test('Already pointing to our script → returns null (idempotent no-op)', () => {
  const copilotDir = mkTmpDir();
  const pluginRoot = mkTmpDir();

  const scriptsDir = path.join(pluginRoot, 'scripts');
  fs.mkdirSync(scriptsDir);
  const ourScript = path.join(scriptsDir, 'statusline.js');
  fs.writeFileSync(ourScript, '#!/usr/bin/env node\n');

  // Write settings.json already pointing to our script
  const settings = { statusLine: { type: 'command', command: ourScript } };
  fs.writeFileSync(
    path.join(copilotDir, 'settings.json'),
    JSON.stringify(settings, null, 2)
  );

  try {
    const result = ensureStatusLineConfig(pluginRoot, copilotDir);
    assert.equal(result, null, 'should return null when already configured');

    // settings.json should be unchanged
    const reread = readSettings(copilotDir);
    assert.equal(reread.statusLine.command, ourScript);
  } finally {
    rmDir(copilotDir);
    rmDir(pluginRoot);
  }
});

test('Different command present → migrates to custom_command, replaces statusLine, returns notification', () => {
  const copilotDir = mkTmpDir();
  const pluginRoot = mkTmpDir();
  const dataDir    = path.join(copilotDir, 'burnrate-copilot');

  const scriptsDir = path.join(pluginRoot, 'scripts');
  fs.mkdirSync(scriptsDir);
  fs.writeFileSync(path.join(scriptsDir, 'statusline.js'), '#!/usr/bin/env node\n');

  // An existing different statusline command
  const oldCmd = '/usr/local/bin/some-other-statusline.sh';
  const settings = {
    experimental: true,
    statusLine: { type: 'command', command: oldCmd },
  };
  fs.writeFileSync(
    path.join(copilotDir, 'settings.json'),
    JSON.stringify(settings, null, 2)
  );

  try {
    const result = ensureStatusLineConfig(pluginRoot, copilotDir, dataDir);

    assert.ok(result !== null, 'should return a notification string');
    assert.ok(result.includes('updated') || result.includes('statusLine'), 'notification describes the change');

    // settings.json should now point to our script
    const updated = readSettings(copilotDir);
    assert.equal(
      updated.statusLine.command,
      path.join(pluginRoot, 'scripts', 'statusline.js')
    );
    assert.equal(updated.experimental, true, 'other settings preserved');

    // Old command should be in hud config as custom_command
    const hudConfig = JSON.parse(
      fs.readFileSync(path.join(dataDir, 'config.json'), 'utf8')
    );
    const migrated = hudConfig.segments.find(s => s.widget === 'custom_command');
    assert.ok(migrated, 'migrated segment should exist in hud config');
    assert.equal(migrated.command, oldCmd);
  } finally {
    rmDir(copilotDir);
    rmDir(pluginRoot);
  }
});

test('Malformed settings.json → returns null (does not throw or corrupt)', () => {
  const copilotDir = mkTmpDir();
  const pluginRoot = mkTmpDir();

  const scriptsDir = path.join(pluginRoot, 'scripts');
  fs.mkdirSync(scriptsDir);
  fs.writeFileSync(path.join(scriptsDir, 'statusline.js'), '#!/usr/bin/env node\n');

  const settingsPath = path.join(copilotDir, 'settings.json');
  const badContent = '{ this is not valid json !!!';
  fs.writeFileSync(settingsPath, badContent);

  try {
    let result;
    assert.doesNotThrow(() => {
      result = ensureStatusLineConfig(pluginRoot, copilotDir);
    });
    assert.equal(result, null, 'should return null on malformed JSON');

    // File should be unchanged
    const stillBad = fs.readFileSync(settingsPath, 'utf8');
    assert.equal(stillBad, badContent, 'malformed file should be left untouched');
  } finally {
    rmDir(copilotDir);
    rmDir(pluginRoot);
  }
});

test('Missing pluginRoot → returns null (cannot act without plugin path)', () => {
  const copilotDir = mkTmpDir();

  try {
    const result = ensureStatusLineConfig(null, copilotDir);
    assert.equal(result, null);
  } finally {
    rmDir(copilotDir);
  }
});

test('Migration is idempotent — running twice does not duplicate custom_command', () => {
  const copilotDir = mkTmpDir();
  const pluginRoot = mkTmpDir();
  const dataDir    = path.join(copilotDir, 'burnrate-copilot');

  const scriptsDir = path.join(pluginRoot, 'scripts');
  fs.mkdirSync(scriptsDir);
  fs.writeFileSync(path.join(scriptsDir, 'statusline.js'), '#!/usr/bin/env node\n');

  const oldCmd = '/usr/local/bin/some-other-statusline.sh';
  const settings = { statusLine: { type: 'command', command: oldCmd } };
  fs.writeFileSync(
    path.join(copilotDir, 'settings.json'),
    JSON.stringify(settings, null, 2)
  );

  try {
    // First call — migrates
    ensureStatusLineConfig(pluginRoot, copilotDir, dataDir);

    // Second call — already configured with our script, should no-op
    const result2 = ensureStatusLineConfig(pluginRoot, copilotDir, dataDir);
    assert.equal(result2, null, 'second call should be a no-op');

    // Hud config should have exactly one custom_command for oldCmd
    const hudConfig = JSON.parse(
      fs.readFileSync(path.join(dataDir, 'config.json'), 'utf8')
    );
    const migrations = hudConfig.segments.filter(
      s => s.widget === 'custom_command' && s.command === oldCmd
    );
    assert.equal(migrations.length, 1, 'should have exactly one migration entry');
  } finally {
    rmDir(copilotDir);
    rmDir(pluginRoot);
  }
});
