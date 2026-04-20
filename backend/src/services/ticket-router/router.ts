import type {
  TicketInput,
  TicketResult,
  BatchOutput,
  ModelCaller,
  ModelCallOptions,
  ModelName,
  RouterConfig,
  TicketClassification,
  TicketStatus,
} from './types.js';
import { resolveRoute } from './rules.js';
import { logger } from './logger.js';

const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_DEFAULTER_THRESHOLD = 50;

export class TicketRouter {
  private readonly callers: Record<ModelName, ModelCaller>;
  private readonly defaulterThreshold: number;
  private readonly maxRetries: number;
  private readonly timeoutMs: number;

  constructor(config: RouterConfig) {
    this.callers = {
      grok: config.grokCaller,
      gemini: config.geminiCaller,
    };
    this.defaulterThreshold = config.defaulterThreshold ?? DEFAULT_DEFAULTER_THRESHOLD;
    this.maxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async route(ticket: TicketInput): Promise<TicketResult> {
    const { agentName, primaryModel, fallbackModel, matchedRule } = resolveRoute(ticket.content);
    const classification: TicketClassification =
      ticket.ticketNumber < this.defaulterThreshold ? 'defaulter' : 'normal';

    logger.info('ticket.routing', {
      ticketName: ticket.ticketName,
      ticketNumber: ticket.ticketNumber,
      agentName,
      primaryModel,
      fallbackModel,
      matchedRule,
      classification,
    });

    const errors: string[] = [];
    const callOptions: ModelCallOptions = {
      prompt: buildPrompt(ticket),
      timeoutMs: this.timeoutMs,
      maxRetries: this.maxRetries,
    };

    const primaryAttempt = await this.tryModel(primaryModel, callOptions, ticket);
    if (primaryAttempt.success) {
      logger.info('ticket.resolved', {
        ticketName: ticket.ticketName,
        ticketNumber: ticket.ticketNumber,
        agentName,
        model: primaryModel,
        status: 'success',
        classification,
      });
      return makeResult({
        ticket, agentName, primaryModel, fallbackModel,
        finalModelUsed: primaryModel, status: 'success',
        response: primaryAttempt.text, errors, classification,
      });
    }

    errors.push(`primary(${primaryModel}): ${primaryAttempt.error}`);
    logger.warn('ticket.primary_failed', {
      ticketName: ticket.ticketName,
      ticketNumber: ticket.ticketNumber,
      model: primaryModel,
      error: primaryAttempt.error,
    });

    const fallbackAttempt = await this.tryModel(fallbackModel, callOptions, ticket);
    if (fallbackAttempt.success) {
      logger.info('ticket.resolved', {
        ticketName: ticket.ticketName,
        ticketNumber: ticket.ticketNumber,
        agentName,
        model: fallbackModel,
        status: 'fallback_success',
        classification,
      });
      return makeResult({
        ticket, agentName, primaryModel, fallbackModel,
        finalModelUsed: fallbackModel, status: 'fallback_success',
        response: fallbackAttempt.text, errors, classification,
      });
    }

    errors.push(`fallback(${fallbackModel}): ${fallbackAttempt.error}`);
    logger.error('ticket.failed', {
      ticketName: ticket.ticketName,
      ticketNumber: ticket.ticketNumber,
      agentName,
      errors,
    });

    return makeResult({
      ticket, agentName, primaryModel, fallbackModel,
      finalModelUsed: null, status: 'failed',
      response: null, errors, classification,
    });
  }

  async batchRoute(tickets: TicketInput[]): Promise<BatchOutput> {
    logger.info('batch.start', { total: tickets.length });
    const start = Date.now();

    const results = await Promise.all(tickets.map(t => this.route(t)));

    const defaulterTickets: Record<string, TicketResult[]> = {};
    let success = 0, fallbackSuccess = 0, failed = 0, defaulters = 0;

    for (const r of results) {
      if (r.status === 'success') success++;
      else if (r.status === 'fallback_success') fallbackSuccess++;
      else failed++;

      if (r.classification === 'defaulter') {
        defaulters++;
        (defaulterTickets[r.agentName] ??= []).push(r);
      }
    }

    const output: BatchOutput = {
      results,
      defaulterTickets,
      summary: { total: results.length, success, fallbackSuccess, failed, defaulters },
    };

    logger.info('batch.complete', { durationMs: Date.now() - start, ...output.summary });
    return output;
  }

  private async tryModel(
    model: ModelName,
    options: ModelCallOptions,
    ticket: TicketInput,
  ): Promise<{ success: true; text: string } | { success: false; error: string }> {
    try {
      const text = await this.callers[model].call(options);
      return { success: true, text };
    } catch (err: any) {
      return { success: false, error: err?.message ?? String(err) };
    }
  }
}

function buildPrompt(ticket: TicketInput): string {
  return (
    `You are a customer support assistant. Process the following ticket and provide a resolution.\n\n` +
    `Ticket #${ticket.ticketNumber}: ${ticket.ticketName}\n\n${ticket.content}`
  );
}

function makeResult(params: {
  ticket: TicketInput;
  agentName: string;
  primaryModel: ModelName;
  fallbackModel: ModelName;
  finalModelUsed: ModelName | null;
  status: TicketStatus;
  response: string | null;
  errors: string[];
  classification: TicketClassification;
}): TicketResult {
  return {
    ticketName: params.ticket.ticketName,
    ticketNumber: params.ticket.ticketNumber,
    agentName: params.agentName,
    primaryModel: params.primaryModel,
    fallbackModel: params.fallbackModel,
    finalModelUsed: params.finalModelUsed,
    status: params.status,
    response: params.response,
    errors: params.errors,
    classification: params.classification,
  };
}
