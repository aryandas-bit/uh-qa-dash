export type ModelName = 'grok' | 'gemini';
export type AgentName = string;
export type TicketClassification = 'normal' | 'defaulter';
export type TicketStatus = 'success' | 'fallback_success' | 'failed';

export interface TicketInput {
  ticketName: string;
  ticketNumber: number;
  content: string;
}

export interface TicketResult {
  ticketName: string;
  ticketNumber: number;
  agentName: AgentName;
  primaryModel: ModelName;
  fallbackModel: ModelName;
  finalModelUsed: ModelName | null;
  status: TicketStatus;
  response: string | null;
  errors: string[];
  classification: TicketClassification;
}

export interface BatchOutput {
  results: TicketResult[];
  defaulterTickets: Record<AgentName, TicketResult[]>;
  summary: {
    total: number;
    success: number;
    fallbackSuccess: number;
    failed: number;
    defaulters: number;
  };
}

export interface ModelCallOptions {
  prompt: string;
  timeoutMs: number;
  maxRetries: number;
}

export interface ModelCaller {
  readonly modelName: ModelName;
  call(options: ModelCallOptions): Promise<string>;
}

export interface RoutingRule {
  readonly pattern: RegExp;
  readonly agentName: AgentName;
  readonly primaryModel: ModelName;
  readonly fallbackModel: ModelName;
  readonly description: string;
}

export interface RouterConfig {
  readonly grokCaller: ModelCaller;
  readonly geminiCaller: ModelCaller;
  readonly defaulterThreshold?: number;
  readonly maxRetries?: number;
  readonly timeoutMs?: number;
}
