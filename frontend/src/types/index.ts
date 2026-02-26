// Agent types
export interface AgentSummary {
  agentEmail: string;
  totalTickets: number;
  avgCsat: number | null;
  avgResponseTime: number;
  resolvedCount: number;
  lowCsatCount: number;
  qaScore?: number;
}

// Ticket types
export interface Ticket {
  TICKET_ID: string;
  VISITOR_NAME: string;
  VISITOR_EMAIL: string;
  SUBJECT: string;
  TAGS: string;
  TICKET_STATUS: string;
  PRIORITY: string;
  AGENT_EMAIL: string;
  RESOLVED_BY: string;
  FIRST_RESPONSE_DURATION_SECONDS: number;
  AVG_RESPONSE_TIME_SECONDS: number;
  SPENT_TIME_SECONDS: number;
  TICKET_CSAT: number;
  AGENT_RATING: number;
  MESSAGES_JSON: string;
  MESSAGE_COUNT: number;
  USER_MESSAGE_COUNT: number;
  AGENT_MESSAGE_COUNT: number;
  DAY: string;
  GROUP_NAME: string;
  INITIALIZED_TIME: string;
  RESOLVED_TIME: string;
  messages?: Message[];
}

export interface Message {
  sender_type: 'user' | 'agent' | 'bot';
  message: string;
  created_at: string;
}

// Analysis types
export interface QAAnalysis {
  qaScore: number;
  deductions: Deduction[];
  sopCompliance: {
    score: number;
    missedSteps: string[];
    correctlyFollowed: string[];
    matchedSOP: string | null;
  };
  sentiment: {
    customer: string;
    progression: string;
    agentTone: string;
  };
  suggestions: string[];
  summary: string;
}

export interface Deduction {
  category: 'opening' | 'quality' | 'grammar' | 'closing' | 'fatal';
  points: number;
  reason: string;
}

// Daily summary
export interface DailySummary {
  totalTickets: number;
  activeAgents: number;
  avgCsat: number | null;
  avgResponseTime: number;
  resolvedCount: number;
  lowCsatCount: number;
}

// Defaulter
export interface Defaulter {
  agentEmail: string;
  totalTickets: number;
  lowCsatCount: number;
  avgCsat: number | null;
  lowCsatPercent: number;
}

// Customer history
export interface CustomerHistory {
  customerEmail: string;
  totalTickets: number;
  avgCsat: number | null;
  agentSummary: Record<string, number>;
  tickets: Ticket[];
}
