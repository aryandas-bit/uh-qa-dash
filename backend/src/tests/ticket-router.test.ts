import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { TicketRouter } from '../services/ticket-router/router.js';
import { resolveRoute } from '../services/ticket-router/rules.js';
import type {
  ModelCaller,
  ModelCallOptions,
  ModelName,
  TicketInput,
} from '../services/ticket-router/types.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function mockCaller(name: ModelName, mode: 'success' | 'fail'): ModelCaller {
  return {
    modelName: name,
    async call(_: ModelCallOptions): Promise<string> {
      if (mode === 'fail') throw new Error(`${name} simulated failure`);
      return `{"result":"${name} response ok"}`;
    },
  };
}

function makeRouter(
  grok: 'success' | 'fail',
  gemini: 'success' | 'fail',
): TicketRouter {
  return new TicketRouter({
    grokCaller: mockCaller('grok', grok),
    geminiCaller: mockCaller('gemini', gemini),
    maxRetries: 1,
    timeoutMs: 5_000,
  });
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

const shaeNormal: TicketInput = {
  ticketName: 'SHAE NGN10+ message - connectivity',
  ticketNumber: 78,
  content: 'SHAE NGN10+ message: sync failure after firmware update.',
};

const onlyBeepNormal: TicketInput = {
  ticketName: 'OnlyBeep fdiving - app crash',
  ticketNumber: 102,
  content: 'OnlyBeep fdiving: crash on pairing screen.',
};

const shaeDefaulter: TicketInput = {
  ticketName: 'SHAE NGN10+ message - setup fail',
  ticketNumber: 23,
  content: 'SHAE NGN10+ message: first-time setup fails with E-401.',
};

const onlyBeepDefaulter: TicketInput = {
  ticketName: 'OnlyBeep fdiving - ui glitch',
  ticketNumber: 45,
  content: 'OnlyBeep fdiving: minor UI glitch on dashboard.',
};

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('resolveRoute', () => {
  it('matches SHAE NGN10+ to grok/gemini', () => {
    const r = resolveRoute('SHAE NGN10+ message: device issue');
    assert.equal(r.agentName, 'SHAE');
    assert.equal(r.primaryModel, 'grok');
    assert.equal(r.fallbackModel, 'gemini');
  });

  it('matches OnlyBeep fdiving to gemini/grok', () => {
    const r = resolveRoute('OnlyBeep fdiving: crash');
    assert.equal(r.agentName, 'OnlyBeep');
    assert.equal(r.primaryModel, 'gemini');
    assert.equal(r.fallbackModel, 'grok');
  });

  it('uses default routing when no rule matches', () => {
    const r = resolveRoute('generic support request');
    assert.equal(r.agentName, 'Default');
    assert.equal(r.primaryModel, 'grok');
    assert.equal(r.fallbackModel, 'gemini');
  });

  it('matches case-insensitively', () => {
    const r = resolveRoute('shae ngn10+ message: test');
    assert.equal(r.agentName, 'SHAE');
  });
});

describe('TicketRouter — normal routing', () => {
  it('Example 1: routes SHAE NGN10+ to Grok (normal execution)', async () => {
    const result = await makeRouter('success', 'success').route(shaeNormal);

    assert.equal(result.ticketName, shaeNormal.ticketName);
    assert.equal(result.ticketNumber, 78);
    assert.equal(result.agentName, 'SHAE');
    assert.equal(result.primaryModel, 'grok');
    assert.equal(result.fallbackModel, 'gemini');
    assert.equal(result.finalModelUsed, 'grok');
    assert.equal(result.status, 'success');
    assert.ok(result.response !== null);
    assert.equal(result.errors.length, 0);
    assert.equal(result.classification, 'normal');
  });

  it('routes OnlyBeep fdiving to Gemini (normal execution)', async () => {
    const result = await makeRouter('success', 'success').route(onlyBeepNormal);

    assert.equal(result.agentName, 'OnlyBeep');
    assert.equal(result.primaryModel, 'gemini');
    assert.equal(result.fallbackModel, 'grok');
    assert.equal(result.finalModelUsed, 'gemini');
    assert.equal(result.status, 'success');
    assert.equal(result.errors.length, 0);
    assert.equal(result.classification, 'normal');
  });
});

describe('TicketRouter — fallback behavior', () => {
  it('Example 2: falls back to Gemini when Grok fails (SHAE ticket)', async () => {
    const result = await makeRouter('fail', 'success').route(shaeNormal);

    assert.equal(result.agentName, 'SHAE');
    assert.equal(result.primaryModel, 'grok');
    assert.equal(result.fallbackModel, 'gemini');
    assert.equal(result.finalModelUsed, 'gemini');
    assert.equal(result.status, 'fallback_success');
    assert.ok(result.response !== null);
    assert.equal(result.errors.length, 1);
    assert.ok(result.errors[0].startsWith('primary(grok):'));
    assert.ok(result.errors[0].includes('simulated failure'));
  });

  it('Example 3: falls back to Grok when Gemini fails (OnlyBeep ticket)', async () => {
    const result = await makeRouter('success', 'fail').route(onlyBeepNormal);

    assert.equal(result.agentName, 'OnlyBeep');
    assert.equal(result.primaryModel, 'gemini');
    assert.equal(result.fallbackModel, 'grok');
    assert.equal(result.finalModelUsed, 'grok');
    assert.equal(result.status, 'fallback_success');
    assert.ok(result.response !== null);
    assert.equal(result.errors.length, 1);
    assert.ok(result.errors[0].startsWith('primary(gemini):'));
    assert.ok(result.errors[0].includes('simulated failure'));
  });

  it('returns failed status when both primary and fallback fail', async () => {
    const result = await makeRouter('fail', 'fail').route(shaeNormal);

    assert.equal(result.status, 'failed');
    assert.equal(result.finalModelUsed, null);
    assert.equal(result.response, null);
    assert.equal(result.errors.length, 2);
    assert.ok(result.errors[0].startsWith('primary(grok):'));
    assert.ok(result.errors[1].startsWith('fallback(gemini):'));
  });
});

describe('TicketRouter — defaulter classification', () => {
  it('Example 4: classifies ticket #23 (< 50) as defaulter', async () => {
    const result = await makeRouter('success', 'success').route(shaeDefaulter);

    assert.equal(result.classification, 'defaulter');
    assert.equal(result.ticketNumber, 23);
    assert.equal(result.agentName, 'SHAE');
    assert.equal(result.status, 'success');
  });

  it('classifies ticket #45 (< 50) as defaulter', async () => {
    const result = await makeRouter('success', 'success').route(onlyBeepDefaulter);

    assert.equal(result.classification, 'defaulter');
    assert.equal(result.ticketNumber, 45);
    assert.equal(result.agentName, 'OnlyBeep');
  });

  it('classifies ticket #50 as normal (boundary)', async () => {
    const result = await makeRouter('success', 'success').route({
      ...shaeNormal,
      ticketNumber: 50,
    });
    assert.equal(result.classification, 'normal');
  });

  it('classifies ticket >= 50 as normal', async () => {
    const result = await makeRouter('success', 'success').route(shaeNormal);
    assert.equal(result.classification, 'normal');
    assert.equal(result.ticketNumber, 78);
  });
});

describe('TicketRouter — batch routing and defaulter grouping', () => {
  it('Example 4: groups defaulter tickets by agent name', async () => {
    const router = makeRouter('success', 'success');
    const out = await router.batchRoute([
      shaeNormal,          // normal, SHAE
      onlyBeepNormal,      // normal, OnlyBeep
      shaeDefaulter,       // defaulter #23, SHAE
      onlyBeepDefaulter,   // defaulter #45, OnlyBeep
    ]);

    assert.equal(out.summary.total, 4);
    assert.equal(out.summary.success, 4);
    assert.equal(out.summary.fallbackSuccess, 0);
    assert.equal(out.summary.failed, 0);
    assert.equal(out.summary.defaulters, 2);

    assert.ok('SHAE' in out.defaulterTickets, 'SHAE should have defaulter group');
    assert.equal(out.defaulterTickets['SHAE'].length, 1);
    assert.equal(out.defaulterTickets['SHAE'][0].ticketNumber, 23);
    assert.equal(out.defaulterTickets['SHAE'][0].classification, 'defaulter');

    assert.ok('OnlyBeep' in out.defaulterTickets, 'OnlyBeep should have defaulter group');
    assert.equal(out.defaulterTickets['OnlyBeep'].length, 1);
    assert.equal(out.defaulterTickets['OnlyBeep'][0].ticketNumber, 45);
    assert.equal(out.defaulterTickets['OnlyBeep'][0].classification, 'defaulter');

    // Normal tickets should not appear in defaulterTickets
    const defaulterIds = Object.values(out.defaulterTickets)
      .flat()
      .map(r => r.ticketNumber);
    assert.ok(!defaulterIds.includes(78), 'ticket #78 should not be a defaulter');
    assert.ok(!defaulterIds.includes(102), 'ticket #102 should not be a defaulter');
  });

  it('tracks fallbackSuccess count in batch summary', async () => {
    const router = makeRouter('fail', 'success');
    const out = await router.batchRoute([
      shaeNormal,       // SHAE: grok(primary) fails → gemini fallback
      onlyBeepNormal,   // OnlyBeep: gemini(primary) succeeds
    ]);

    assert.equal(out.summary.fallbackSuccess, 1); // SHAE used fallback
    assert.equal(out.summary.success, 1);          // OnlyBeep succeeded on primary
    assert.equal(out.summary.failed, 0);
  });

  it('produces valid structured JSON output', async () => {
    const router = makeRouter('success', 'success');
    const out = await router.batchRoute([shaeNormal, shaeDefaulter]);

    const reparsed = JSON.parse(JSON.stringify(out));
    assert.ok(Array.isArray(reparsed.results));
    assert.equal(reparsed.results.length, 2);
    assert.ok(typeof reparsed.summary === 'object');
    assert.ok(typeof reparsed.summary.total === 'number');
    assert.ok(typeof reparsed.defaulterTickets === 'object');

    // Every result has the required output fields
    for (const r of reparsed.results) {
      assert.ok('ticketName' in r);
      assert.ok('ticketNumber' in r);
      assert.ok('agentName' in r);
      assert.ok('primaryModel' in r);
      assert.ok('fallbackModel' in r);
      assert.ok('finalModelUsed' in r);
      assert.ok('status' in r);
      assert.ok('response' in r);
      assert.ok('errors' in r);
      assert.ok('classification' in r);
    }
  });
});
