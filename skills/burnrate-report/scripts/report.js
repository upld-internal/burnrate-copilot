#!/usr/bin/env node
'use strict';
// report.js — package copilot-hud user data into a zip for bug reports.
// Usage: node report.js [--output /path/to/output.zip]
// Writes burnrate-report-YYYY-MM-DD.zip to the current directory by default.

const fs   = require('fs');
const os   = require('os');
const path = require('path');
const zlib = require('zlib');
const { getCopilotConfigDir, getDataDir } = require('../../../scripts/paths');

// ─── ZIP writer (no npm deps, cross-platform) ─────────────────────────────────

function u16le(n) { const b = Buffer.alloc(2); b.writeUInt16LE(n, 0); return b; }
function u32le(n) { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0, 0); return b; }

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[i] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function dosDateTime(d) {
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
  return { date, time };
}

function buildZip(entries) {
  const parts = [];
  const central = [];
  let offset = 0;
  const now = new Date();
  const { date, time } = dosDateTime(now);

  for (const { name, data } of entries) {
    const compressed = zlib.deflateRawSync(data, { level: 6 });
    const crc        = crc32(data);
    const nameBuf    = Buffer.from(name, 'utf8');

    const localHeader = Buffer.concat([
      Buffer.from([0x50, 0x4B, 0x03, 0x04]),
      u16le(20), u16le(0), u16le(8),
      u16le(time), u16le(date),
      u32le(crc), u32le(compressed.length), u32le(data.length),
      u16le(nameBuf.length), u16le(0),
      nameBuf,
    ]);

    central.push(Buffer.concat([
      Buffer.from([0x50, 0x4B, 0x01, 0x02]),
      u16le(20), u16le(20), u16le(0), u16le(8),
      u16le(time), u16le(date),
      u32le(crc), u32le(compressed.length), u32le(data.length),
      u16le(nameBuf.length), u16le(0), u16le(0), u16le(0), u16le(0),
      u32le(0), u32le(offset),
      nameBuf,
    ]));

    parts.push(localHeader, compressed);
    offset += localHeader.length + compressed.length;
  }

  const centralBuf = Buffer.concat(central);
  const eocd = Buffer.concat([
    Buffer.from([0x50, 0x4B, 0x05, 0x06]),
    u16le(0), u16le(0),
    u16le(entries.length), u16le(entries.length),
    u32le(centralBuf.length), u32le(offset),
    u16le(0),
  ]);

  return Buffer.concat([...parts, centralBuf, eocd]);
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function readFileSafe(p) {
  try { return fs.readFileSync(p); } catch (_) { return null; }
}

function listFiles(dir) {
  try { return fs.readdirSync(dir); } catch (_) { return []; }
}

const SENSITIVE_PATTERN = /token|secret|password|credential|key|auth/i;
function redactSettings(obj, depth) {
  if (depth > 4 || typeof obj !== 'object' || obj === null) return obj;
  const out = Array.isArray(obj) ? [] : {};
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'string' && SENSITIVE_PATTERN.test(k)) {
      out[k] = '[REDACTED]';
    } else if (typeof v === 'object') {
      out[k] = redactSettings(v, depth + 1);
    } else {
      out[k] = v;
    }
  }
  return out;
}

// ─── arg parsing ──────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
let outputPath = null;
for (let i = 0; i < args.length; i++) {
  if ((args[i] === '--output' || args[i] === '-o') && args[i + 1]) {
    outputPath = args[++i];
  }
}

const today = new Date().toISOString().slice(0, 10);
if (!outputPath) {
  outputPath = path.join(process.cwd(), `burnrate-report-${today}.zip`);
}

// ─── collect files ────────────────────────────────────────────────────────────

const copilotConfigDir = getCopilotConfigDir();
const dataDir          = getDataDir();
const entries          = [];
const warnings         = [];

// 1. monthly JSONL records
const monthlyDir = path.join(dataDir, 'monthly');
for (const file of listFiles(monthlyDir)) {
  if (!file.endsWith('.jsonl') && !file.endsWith('.jsonl.bak')) continue;
  const data = readFileSafe(path.join(monthlyDir, file));
  if (data) entries.push({ name: `monthly/${file}`, data });
}

// 2. active session files (may be empty between sessions)
const sessionsDir = path.join(dataDir, 'sessions');
for (const file of listFiles(sessionsDir)) {
  if (!file.endsWith('.json')) continue;
  const data = readFileSafe(path.join(sessionsDir, file));
  if (data) entries.push({ name: `sessions/${file}`, data });
}

// 3. config.json (widget layout)
const configData = readFileSafe(path.join(dataDir, 'config.json'));
if (configData) {
  entries.push({ name: 'config.json', data: configData });
} else {
  warnings.push('config.json not found (user is using default layout)');
}

// 4. pricing.json (model pricing table, for cost computation audit)
const pricingData = readFileSafe(path.join(dataDir, 'pricing.json'))
  || readFileSafe(path.join(__dirname, '../../../pricing.json'));
if (pricingData) {
  entries.push({ name: 'pricing.json', data: pricingData });
} else {
  warnings.push('pricing.json not found');
}

// 5. settings.json — redact any token/secret keys
const settingsPath = path.join(copilotConfigDir, 'settings.json');
const settingsRaw  = readFileSafe(settingsPath);
if (settingsRaw) {
  try {
    const parsed   = JSON.parse(settingsRaw.toString('utf8'));
    const redacted = redactSettings(parsed, 0);
    entries.push({ name: 'settings.json', data: Buffer.from(JSON.stringify(redacted, null, 2)) });
  } catch (_) {
    entries.push({ name: 'settings.json', data: settingsRaw });
    warnings.push('settings.json could not be parsed — included as raw bytes');
  }
} else {
  warnings.push('settings.json not found');
}

// 6. debug/hooks.jsonl — last 200 lines when debug mode was active
const hooksDebugPath = path.join(dataDir, 'debug', 'hooks.jsonl');
if (fs.existsSync(hooksDebugPath)) {
  const lines = fs.readFileSync(hooksDebugPath, 'utf8').split('\n').filter(Boolean).slice(-200);
  entries.push({ name: 'debug/hooks.jsonl', data: Buffer.from(lines.join('\n') + '\n') });
}

// 7. sysinfo.json
const pluginRoot = process.env.PLUGIN_ROOT || '';
const sysinfo = {
  generated_at:  new Date().toISOString(),
  platform:      process.platform,
  arch:          process.arch,
  node_version:  process.version,
  plugin_root:   pluginRoot || 'not set',
  copilot_config: copilotConfigDir,
  data_dir:      dataDir,
  files_included: entries.map(e => e.name),
  warnings,
};
entries.push({ name: 'sysinfo.json', data: Buffer.from(JSON.stringify(sysinfo, null, 2)) });

// ─── write zip ────────────────────────────────────────────────────────────────

if (entries.length === 0) {
  console.error('No copilot-hud data found. Has the plugin been used yet?');
  process.exit(1);
}

const zipBuf = buildZip(entries);
fs.writeFileSync(outputPath, zipBuf);

const kb = (zipBuf.length / 1024).toFixed(1);
console.log(`Report saved: ${outputPath} (${kb} KB)`);
console.log(`Files included: ${entries.length}`);
for (const e of entries) {
  console.log(`  ${e.name}`);
}
if (warnings.length) {
  console.log('');
  console.log('Notes:');
  for (const w of warnings) console.log(`  - ${w}`);
}
console.log('');
console.log('Share this file with support along with a description of the issue.');
