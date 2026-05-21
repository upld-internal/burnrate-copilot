#!/usr/bin/env node
'use strict';
/**
 * update-pricing.js — maintainer tool to refresh pricing.json.
 *
 * Fetches the GitHub Copilot docs pricing page, parses the HTML tables, and
 * prints a diff against the current pricing.json. Optionally writes changes.
 *
 * Usage:
 *   node scripts/update-pricing.js            # dry-run: print diff only
 *   node scripts/update-pricing.js --apply    # write changes to pricing.json
 *
 * No external dependencies — uses Node.js built-in https.
 */

const https = require('https');
const http  = require('http');
const fs    = require('fs');
const path  = require('path');

const PRICING_URL  = 'https://docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing';
const PRICING_FILE = path.join(__dirname, '..', 'pricing.json');

/**
 * Normalize a model display name to a pricing.json key.
 *   "Claude Sonnet 4.6"  → "claude-sonnet-4.6"
 *   "GPT-5 mini"         → "gpt-5-mini"
 *   "GPT-5.2-Codex[1]"  → "gpt-5.2-codex"
 */
function normalizeModelId(displayName) {
  return displayName
    .replace(/\[.*?\]/g, '')   // strip footnote refs like [1]
    .replace(/<[^>]+>/g, '')   // strip residual HTML tags
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-');
}

/** Parse a USD price cell like "$1.25" or "$0.025" → number. Returns null if unparseable. */
function parsePrice(raw) {
  const m = raw.replace(/<[^>]+>/g, '').match(/\$([\d.]+)/);
  return m ? parseFloat(m[1]) : null;
}

/** Decode common HTML entities and strip tags, collapsing whitespace. */
function stripTags(html) {
  return html
    .replace(/<sup[^>]*>[\s\S]*?<\/sup>/gi, '')  // remove superscript footnotes entirely
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#\d+;/g, '')
    .replace(/&[a-z]+;/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Fetch a URL following up to 5 redirects. Returns body as string. */
function fetchUrl(url, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    if (redirectsLeft === 0) return reject(new Error('Too many redirects'));
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, {
      headers: {
        'User-Agent': 'burnrate-copilot/update-pricing (node.js)',
        'Accept':     'text/html,application/xhtml+xml',
      },
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return resolve(fetchUrl(res.headers.location, redirectsLeft - 1));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    });
    req.on('error', reject);
    req.setTimeout(20000, () => { req.destroy(); reject(new Error('Request timed out')); });
  });
}

/**
 * Parse a single <table>…</table> HTML block.
 * Detects column positions from <th> headers; handles Anthropic's extra cache_write column.
 * Returns array of { id, displayName, input, cache_read, cache_write, output }.
 */
function parseTable(tableHtml) {
  // Extract header row from <thead> or first <tr>
  const theadM = tableHtml.match(/<thead[^>]*>([\s\S]*?)<\/thead>/i);
  const headerSrc = theadM
    ? theadM[1]
    : (tableHtml.match(/<tr[^>]*>([\s\S]*?)<\/tr>/i) || [])[1] || '';

  const headers = [];
  const thRe = /<th[^>]*>([\s\S]*?)<\/th>/gi;
  let m;
  while ((m = thRe.exec(headerSrc)) !== null) {
    headers.push(stripTags(m[1]).toLowerCase());
  }
  if (headers.length < 4) return [];

  // Map column names to indices
  const col = {
    model:      headers.findIndex(h => h === 'model'),
    input:      headers.findIndex(h => h === 'input'),
    cachedIn:   headers.findIndex(h => h.includes('cached') && h.includes('input')),
    cacheWrite: headers.findIndex(h => h.includes('cache') && h.includes('write')),
    output:     headers.findIndex(h => h === 'output'),
  };
  if (col.model < 0 || col.input < 0 || col.output < 0) return [];

  // Extract data rows from <tbody> (or fall back to entire table body)
  const tbodyM = tableHtml.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/i);
  const bodySrc = tbodyM ? tbodyM[1] : tableHtml;

  const rows = [];
  const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  while ((m = trRe.exec(bodySrc)) !== null) {
    const cells = [];
    const tdRe = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    let tdM;
    while ((tdM = tdRe.exec(m[1])) !== null) {
      cells.push(tdM[1]);
    }
    const maxRequired = Math.max(col.model, col.input, col.output);
    if (cells.length <= maxRequired) continue;

    const displayName = stripTags(cells[col.model]);
    if (!displayName || displayName.toLowerCase() === 'model') continue;

    const input      = parsePrice(cells[col.input]);
    const output     = parsePrice(cells[col.output]);
    const cacheRead  = col.cachedIn   >= 0 && col.cachedIn   < cells.length ? parsePrice(cells[col.cachedIn])   : null;
    const cacheWrite = col.cacheWrite >= 0 && col.cacheWrite < cells.length ? parsePrice(cells[col.cacheWrite]) : null;

    if (input === null || output === null) continue;

    rows.push({
      id:          normalizeModelId(displayName),
      displayName,
      input,
      output,
      cache_read:  cacheRead  ?? 0,
      cache_write: cacheWrite ?? 0,
    });
  }
  return rows;
}

/** Load current pricing.json or exit with error. */
function loadCurrent() {
  try {
    return JSON.parse(fs.readFileSync(PRICING_FILE, 'utf8'));
  } catch (e) {
    console.error(`Cannot read ${PRICING_FILE}: ${e.message}`);
    process.exit(1);
  }
}

async function main() {
  const applyFlag = process.argv.includes('--apply');

  console.log(`Fetching pricing page …\n  ${PRICING_URL}\n`);
  let html;
  try {
    html = await fetchUrl(PRICING_URL);
  } catch (e) {
    console.error(`Failed to fetch page: ${e.message}`);
    process.exit(1);
  }

  // Parse all <table> blocks
  const fetched = {};
  const tableRe = /<table[^>]*>[\s\S]*?<\/table>/gi;
  let tM;
  while ((tM = tableRe.exec(html)) !== null) {
    for (const row of parseTable(tM[0])) {
      if (row.id) fetched[row.id] = row;
    }
  }

  if (Object.keys(fetched).length === 0) {
    console.error('No model rows parsed — page structure may have changed.');
    console.error(`Check: ${PRICING_URL}`);
    process.exit(1);
  }

  console.log(`Parsed ${Object.keys(fetched).length} models from docs page:`);
  for (const [id, r] of Object.entries(fetched)) {
    const cw = r.cache_write > 0 ? `  cache_write=$${r.cache_write}` : '';
    console.log(`  ${id}  input=$${r.input}  output=$${r.output}  cache_read=$${r.cache_read}${cw}`);
  }
  console.log();

  const current      = loadCurrent();
  const currentModels = Object.keys(current).filter(k => !k.startsWith('_'));
  const fetchedIds   = Object.keys(fetched);

  const added   = fetchedIds.filter(id => !currentModels.includes(id));
  const removed = currentModels.filter(id => !fetchedIds.includes(id));
  const changed = fetchedIds.filter(id => {
    if (!current[id]) return false;
    const c = current[id], f = fetched[id];
    return c.input !== f.input || c.output !== f.output ||
           c.cache_read !== f.cache_read || c.cache_write !== f.cache_write;
  });

  if (added.length === 0 && removed.length === 0 && changed.length === 0) {
    console.log('✅  pricing.json is up to date — no changes needed.');
    return;
  }

  const fmt = v => `$${v}`;

  if (added.length > 0) {
    console.log('ADDED (new models in docs):');
    for (const id of added) {
      const f = fetched[id];
      const cw = f.cache_write > 0 ? `  cache_write=${fmt(f.cache_write)}` : '';
      console.log(`  + ${id}  input=${fmt(f.input)}  output=${fmt(f.output)}  cache_read=${fmt(f.cache_read)}${cw}`);
    }
    console.log();
  }

  if (removed.length > 0) {
    console.log('REMOVED (in pricing.json but not in docs):');
    for (const id of removed) {
      console.log(`  - ${id}`);
    }
    console.log('  (removed models are flagged for review; not auto-deleted)\n');
  }

  if (changed.length > 0) {
    console.log('CHANGED (pricing updated):');
    for (const id of changed) {
      const c = current[id], f = fetched[id];
      console.log(`  ~ ${id}:`);
      if (c.input       !== f.input)       console.log(`      input:       ${fmt(c.input)} → ${fmt(f.input)}`);
      if (c.output      !== f.output)      console.log(`      output:      ${fmt(c.output)} → ${fmt(f.output)}`);
      if (c.cache_read  !== f.cache_read)  console.log(`      cache_read:  ${fmt(c.cache_read)} → ${fmt(f.cache_read)}`);
      if (c.cache_write !== f.cache_write) console.log(`      cache_write: ${fmt(c.cache_write)} → ${fmt(f.cache_write)}`);
    }
    console.log();
  }

  if (!applyFlag) {
    console.log('Run with --apply to write changes to pricing.json.');
    return;
  }

  // Apply: update in place, preserve structure and comments
  const today = new Date().toISOString().slice(0, 10);
  current._meta.last_verified = today;
  for (const id of [...added, ...changed]) {
    const f = fetched[id];
    current[id] = { input: f.input, output: f.output, cache_write: f.cache_write, cache_read: f.cache_read };
  }
  // Removed models are NOT auto-deleted — flag for human review

  fs.writeFileSync(PRICING_FILE, JSON.stringify(current, null, 2) + '\n', 'utf8');
  console.log(`✅  pricing.json updated (${today}).`);
  if (removed.length > 0) {
    console.log(`\n⚠️   Still in pricing.json but not in docs: ${removed.join(', ')}`);
    console.log('    Review and manually remove if no longer needed.');
  }
}

main().catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});
