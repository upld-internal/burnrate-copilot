'use strict';

const UNATTRIBUTED = 'unattributed';

function round6(v) {
  return Math.round((Number(v) || 0) * 1e6) / 1e6;
}

function normalizeJiraCosts(jiraCosts) {
  if (!jiraCosts || typeof jiraCosts !== 'object' || Array.isArray(jiraCosts)) {
    return {};
  }

  const out = {};
  for (const [key, val] of Object.entries(jiraCosts)) {
    const amount = Number(val);
    if (!key || !isFinite(amount) || amount <= 0) continue;
    out[key] = round6(amount);
  }
  return out;
}

function applyJiraDelta(sessionRaw, currentCost, jiraKey) {
  const raw = Number(currentCost);
  const cost = isFinite(raw) ? round6(raw) : 0;
  const prevRaw = Number(sessionRaw.last_jira_cost_checkpoint || 0);
  const prev = isFinite(prevRaw) ? round6(prevRaw) : 0;
  const delta = Math.max(0, round6(cost - prev));

  const bucket = jiraKey || UNATTRIBUTED;
  const costs = normalizeJiraCosts(sessionRaw.jira_costs);

  if (delta > 0) {
    costs[bucket] = round6((costs[bucket] || 0) + delta);
  }

  sessionRaw.jira_costs = costs;
  sessionRaw.last_jira_cost_checkpoint = cost;

  if (jiraKey) {
    sessionRaw.last_known_jira_key = jiraKey;
    sessionRaw.last_known_jira_source = 'branch';
    const seen = new Set(Array.isArray(sessionRaw.jira_keys_seen) ? sessionRaw.jira_keys_seen : []);
    seen.add(jiraKey);
    sessionRaw.jira_keys_seen = [...seen].sort();
  } else {
    delete sessionRaw.last_known_jira_key;
    delete sessionRaw.last_known_jira_source;
  }
}

function selectPrimaryJiraKey(jiraCosts, lastKnownJiraKey) {
  const costs = normalizeJiraCosts(jiraCosts);
  const candidates = Object.entries(costs)
    .filter(([key]) => key !== UNATTRIBUTED);
  if (!candidates.length) return null;

  candidates.sort((a, b) => b[1] - a[1]);
  const topCost = candidates[0][1];
  const ties = candidates.filter(([, val]) => val === topCost).map(([key]) => key);

  if (lastKnownJiraKey && ties.includes(lastKnownJiraKey)) return lastKnownJiraKey;
  return ties.sort()[0];
}

module.exports = {
  UNATTRIBUTED,
  round6,
  normalizeJiraCosts,
  applyJiraDelta,
  selectPrimaryJiraKey,
};
