export { TicketRouter } from './router.js';
export { createGrokCaller } from './grok.model.js';
export { createGeminiCaller } from './gemini.model.js';
export { ROUTING_RULES, DEFAULT_ROUTING, resolveRoute } from './rules.js';
export type {
  TicketInput,
  TicketResult,
  BatchOutput,
  ModelCaller,
  ModelCallOptions,
  RouterConfig,
  RoutingRule,
  ModelName,
  TicketClassification,
  TicketStatus,
} from './types.js';

import { TicketRouter } from './router.js';
import { createGrokCaller } from './grok.model.js';
import { createGeminiCaller } from './gemini.model.js';
import type { RouterConfig } from './types.js';

export function createProductionRouter(
  opts?: Partial<Pick<RouterConfig, 'defaulterThreshold' | 'maxRetries' | 'timeoutMs'>>,
): TicketRouter {
  return new TicketRouter({
    grokCaller: createGrokCaller(),
    geminiCaller: createGeminiCaller(),
    ...opts,
  });
}
