/**
 * Ticket Routing System — Demo
 * Run: npx tsx src/services/ticket-router/demo.ts
 *
 * Demonstrates all routing scenarios using mock model callers
 * so no real API keys are required.
 */
import { TicketRouter } from './router.js';
import type { ModelCaller, ModelCallOptions, ModelName, TicketInput } from './types.js';

// ─── Mock Callers ────────────────────────────────────────────────────────────

function mockCaller(name: ModelName, mode: 'success' | 'fail'): ModelCaller {
  return {
    modelName: name,
    async call(_: ModelCallOptions): Promise<string> {
      await new Promise(r => setTimeout(r, 30)); // simulate network latency
      if (mode === 'fail') throw new Error(`${name} service unavailable (simulated)`);
      return `Resolution from ${name}: Issue acknowledged. Escalated to the product team for further investigation. Customer will receive a follow-up within 24 hours.`;
    },
  };
}

function makeRouter(grok: 'success' | 'fail', gemini: 'success' | 'fail'): TicketRouter {
  return new TicketRouter({
    grokCaller: mockCaller('grok', grok),
    geminiCaller: mockCaller('gemini', gemini),
    maxRetries: 1,
    timeoutMs: 5_000,
  });
}

// ─── Ticket Fixtures ─────────────────────────────────────────────────────────

const TICKETS = {
  shaePrimary: {
    ticketName: 'SHAE NGN10+ message - ring connectivity',
    ticketNumber: 78,
    content: 'SHAE NGN10+ message: Customer unable to sync ring device after firmware v2.4 update.',
  } satisfies TicketInput,

  shaeFallback: {
    ticketName: 'SHAE NGN10+ message - battery drain',
    ticketNumber: 92,
    content: 'SHAE NGN10+ message: Severe battery drain reported post-update, device dies within 4 hours.',
  } satisfies TicketInput,

  onlyBeepFallback: {
    ticketName: 'OnlyBeep fdiving - app crash on pairing',
    ticketNumber: 115,
    content: 'OnlyBeep fdiving: App crashes on device pairing screen with NullPointerException.',
  } satisfies TicketInput,

  shaeDefaulter: {
    ticketName: 'SHAE NGN10+ message - setup failure',
    ticketNumber: 23,
    content: 'SHAE NGN10+ message: First-time device setup fails with error code E-401.',
  } satisfies TicketInput,

  onlyBeepDefaulter: {
    ticketName: 'OnlyBeep fdiving - dashboard glitch',
    ticketNumber: 45,
    content: 'OnlyBeep fdiving: Minor UI glitch on the analytics dashboard.',
  } satisfies TicketInput,
};

// ─── Runner ──────────────────────────────────────────────────────────────────

function heading(label: string): void {
  const line = '─'.repeat(60);
  console.log(`\n${line}`);
  console.log(`  ${label}`);
  console.log(line);
}

async function main(): Promise<void> {
  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║         Ticket Routing System — Demo Output              ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');
  console.log('(Structured logs go to stderr; JSON results go to stdout)\n');

  // Example 1: Normal Grok execution
  heading('Example 1: Normal Grok Execution  [SHAE NGN10+ → Grok ✓]');
  {
    const result = await makeRouter('success', 'success').route(TICKETS.shaePrimary);
    console.log(JSON.stringify(result, null, 2));
  }

  // Example 2: Grok fails → Gemini fallback
  heading('Example 2: Grok Fallback to Gemini  [SHAE NGN10+ → Grok ✗ → Gemini ✓]');
  {
    const result = await makeRouter('fail', 'success').route(TICKETS.shaeFallback);
    console.log(JSON.stringify(result, null, 2));
  }

  // Example 3: Gemini fails → Grok fallback
  heading('Example 3: Gemini Fallback to Grok  [OnlyBeep fdiving → Gemini ✗ → Grok ✓]');
  {
    const result = await makeRouter('success', 'fail').route(TICKETS.onlyBeepFallback);
    console.log(JSON.stringify(result, null, 2));
  }

  // Example 4: Batch with defaulter grouping
  heading('Example 4: Batch — Defaulter Tickets Grouped by Agent  [#23 & #45 < 50]');
  {
    const batchOutput = await makeRouter('success', 'success').batchRoute([
      TICKETS.shaePrimary,
      TICKETS.onlyBeepFallback,
      TICKETS.shaeDefaulter,
      TICKETS.onlyBeepDefaulter,
    ]);
    console.log(JSON.stringify(batchOutput, null, 2));
  }
}

main().catch(err => {
  console.error('Demo failed:', err);
  process.exit(1);
});
