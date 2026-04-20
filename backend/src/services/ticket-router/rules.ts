import type { ModelName, RoutingRule } from './types.js';

// Routing rules are evaluated in order; the first match wins.
export const ROUTING_RULES: readonly RoutingRule[] = [
  {
    pattern: /SHAE\s+NGN10\+/i,
    agentName: 'SHAE',
    primaryModel: 'grok',
    fallbackModel: 'gemini',
    description: 'SHAE NGN10+ messages → Grok (Gemini fallback)',
  },
  {
    pattern: /OnlyBeep\s+fdiving/i,
    agentName: 'OnlyBeep',
    primaryModel: 'gemini',
    fallbackModel: 'grok',
    description: 'OnlyBeep fdiving → Gemini (Grok fallback)',
  },
] as const;

export const DEFAULT_ROUTING = {
  agentName: 'Default',
  primaryModel: 'grok' as ModelName,
  fallbackModel: 'gemini' as ModelName,
  description: 'Default routing → Grok (Gemini fallback)',
} as const;

export interface ResolvedRoute {
  agentName: string;
  primaryModel: ModelName;
  fallbackModel: ModelName;
  matchedRule: string;
}

export function resolveRoute(content: string): ResolvedRoute {
  for (const rule of ROUTING_RULES) {
    if (rule.pattern.test(content)) {
      return {
        agentName: rule.agentName,
        primaryModel: rule.primaryModel,
        fallbackModel: rule.fallbackModel,
        matchedRule: rule.description,
      };
    }
  }
  return {
    agentName: DEFAULT_ROUTING.agentName,
    primaryModel: DEFAULT_ROUTING.primaryModel,
    fallbackModel: DEFAULT_ROUTING.fallbackModel,
    matchedRule: DEFAULT_ROUTING.description,
  };
}
