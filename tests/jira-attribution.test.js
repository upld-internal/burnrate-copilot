'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeJiraCosts,
  applyJiraDelta,
  selectPrimaryJiraKey,
} = require('../scripts/jira-attribution');

describe('normalizeJiraCosts', () => {
  test('keeps only positive numeric values', () => {
    const out = normalizeJiraCosts({
      'ABC-1': 1.23456789,
      'ABC-2': 0,
      'ABC-3': -1,
      'ABC-4': 'bad',
    });
    assert.deepEqual(out, { 'ABC-1': 1.234568 });
  });
});

describe('applyJiraDelta', () => {
  test('attributes first delta to current jira key', () => {
    const session = {};
    applyJiraDelta(session, 2.5, 'PLAT-101');
    assert.equal(session.last_jira_cost_checkpoint, 2.5);
    assert.equal(session.jira_costs['PLAT-101'], 2.5);
    assert.equal(session.last_known_jira_key, 'PLAT-101');
    assert.equal(session.last_known_jira_source, 'branch');
    assert.deepEqual(session.jira_keys_seen, ['PLAT-101']);
  });

  test('attributes subsequent delta to new jira key after branch change', () => {
    const session = {};
    applyJiraDelta(session, 1.0, 'PLAT-101');
    applyJiraDelta(session, 3.0, 'PLAT-202');
    assert.equal(session.jira_costs['PLAT-101'], 1.0);
    assert.equal(session.jira_costs['PLAT-202'], 2.0);
    assert.deepEqual(session.jira_keys_seen, ['PLAT-101', 'PLAT-202']);
  });

  test('attributes delta to unattributed when jira key is missing', () => {
    const session = {};
    applyJiraDelta(session, 0.4, null);
    applyJiraDelta(session, 1.4, null);
    assert.equal(session.jira_costs.unattributed, 1.4);
    assert.equal(session.last_known_jira_key, undefined);
  });

  test('clamps negative deltas to zero', () => {
    const session = {};
    applyJiraDelta(session, 2.0, 'PLAT-1');
    applyJiraDelta(session, 1.0, 'PLAT-1');
    assert.equal(session.jira_costs['PLAT-1'], 2.0);
  });
});

describe('selectPrimaryJiraKey', () => {
  test('picks highest cost jira key', () => {
    const key = selectPrimaryJiraKey({
      'PLAT-1': 2.1,
      'PLAT-2': 4.5,
      unattributed: 9.0,
    });
    assert.equal(key, 'PLAT-2');
  });

  test('uses last known key as tie-breaker', () => {
    const key = selectPrimaryJiraKey({
      'PLAT-1': 2,
      'PLAT-2': 2,
    }, 'PLAT-2');
    assert.equal(key, 'PLAT-2');
  });
});
