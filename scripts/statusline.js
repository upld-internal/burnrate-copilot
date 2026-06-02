#!/usr/bin/env node
'use strict';
// statusline.js — Copilot CLI statusLine entry point.
// Called on every turn. Reads session JSON from stdin, delegates all rendering
// to compositor.js, and writes one line to stdout.
//
// Configure in ~/.copilot/settings.json:
//   "statusLine": { "type": "command", "command": "/path/to/scripts/statusline.js" }
// (The command must be an executable path — not "node /path/..." — and this file
// must be chmod +x. Run /burnrate:setup to configure automatically.)
//
// Fallback on stdin parse failure: [burnrate-copilot error]

const fs   = require('fs');
const path = require('path');
const { render } = require('./compositor');
const { getDataDir } = require('./paths');

const dataDir = getDataDir();

// DEBUG: set COPILOT_HUD_DEBUG=1 to append full stdin to dataDir/stdin-debug.jsonl
// stdin-last.json is always written (single overwrite) for easy schema inspection.
const DEBUG = process.env.COPILOT_HUD_DEBUG === '1';

let raw = fs.readFileSync(0, 'utf8');
  let data;
  try {
    raw = raw.trim();
    if (!raw) { process.stdout.write('\n'); process.exit(0); }
    data = JSON.parse(raw);
  } catch (_) {
    process.stdout.write('[burnrate-copilot error]\n');
    process.exit(0);
  }

  if (DEBUG) {
    try {
      const logPath = path.join(dataDir, 'stdin-debug.jsonl');
      fs.appendFileSync(logPath, JSON.stringify({ ts: new Date().toISOString(), data }) + '\n');
    } catch (_) {}
  }

  // Always write last stdin for schema inspection (single file, always overwritten).
  try {
    fs.writeFileSync(path.join(dataDir, 'stdin-last.json'),
      JSON.stringify({ ts: new Date().toISOString(), data }, null, 2) + '\n');
  } catch (_) {}

  try {
    const output = render(data, dataDir, __dirname);
    process.stdout.write(output + '\n');

    // Spawn background quota refresh if cache is stale and circuit is closed.
    // Must happen after stdout write so it never adds latency to the render.
    try {
      const { readQuotaCache, readQuotaState, shouldRefresh, writeQuotaState } = require('./quota-api');
      const cacheResult = readQuotaCache(dataDir);
      const state = readQuotaState(dataDir);
      if (shouldRefresh(cacheResult, state)) {
        writeQuotaState(dataDir, { ...state, refresh_pending_since: new Date().toISOString() });
        const { spawn } = require('child_process');
        const child = spawn(process.execPath,
          [path.join(__dirname, 'quota-fetch.js')],
          { detached: true, stdio: 'ignore', env: process.env, windowsHide: true });
        child.unref();
      }
    } catch (_) {}
  } catch (_) {
    process.stdout.write('[burnrate-copilot error]\n');
  }
