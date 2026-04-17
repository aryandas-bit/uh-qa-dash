const GROQ_API_BASE = 'https://api.groq.com/openai/v1';
// Use fastest available Groq models (mixtral-8x7b and llama-3.1 support tool use)
const GROQ_MODELS = ['mixtral-8x7b-32768', 'llama-3.1-70b-versatile', 'llama-3.1-8b-instant'];
const GROQ_TIMEOUT_MS = 15000;

export interface QuickAnalysis {
  sentiment: string; // positive|neutral|negative|angry
  priority: string; // urgent|standard|low
  hasError: boolean;
  issueCategory: string; // common category or 'other'
  analyzeTime: number; // milliseconds
}

const QUICK_ANALYSIS_PROMPT = `You are a fast QA triage system for Ultrahuman support tickets. Analyze this ticket in 2 seconds maximum.

Return ONLY valid JSON (no markdown, no code blocks, exactly this format):
{
  "sentiment": "positive|neutral|negative|angry",
  "priority": "urgent|standard|low",
  "hasError": true|false,
  "issueCategory": "billing|connectivity|app_crash|health_sync|wearable|battery|settings|other"
}

RULES - be concise:
1. Sentiment: customer's emotional state (positive=satisfied, neutral=asking, negative=frustrated, angry=hostile)
2. Priority: urgent=needs escalation/refund/replacement, standard=normal support, low=informational
3. hasError: true if customer reports any technical error/bug/issue, false if just info request
4. issueCategory: pick the most specific category from the list or use "other"

Ticket data:
CUSTOMER MESSAGE: {customerMessage}
AGENT LATEST REPLY: {agentLatest}
CONVERSATION LENGTH: {turnCount} turns`;

export async function analyzeQuick(
  ticketId: string,
  firstCustomerMessage: string,
  lastAgentMessage: string,
  totalTurns: number
): Promise<QuickAnalysis> {
  const startTime = Date.now();
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error('GROQ_API_KEY environment variable is not set');

  const prompt = QUICK_ANALYSIS_PROMPT
    .replace('{customerMessage}', truncateText(firstCustomerMessage, 300))
    .replace('{agentLatest}', truncateText(lastAgentMessage, 200))
    .replace('{turnCount}', String(totalTurns));

  // Try models in order until one succeeds
  for (const model of GROQ_MODELS) {
    try {
      const response = await fetch(`${GROQ_API_BASE}/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.3,
          max_tokens: 256,
        }),
        signal: AbortSignal.timeout(GROQ_TIMEOUT_MS),
      });

      if (!response.ok) {
        const errorText = await response.text();
        const statusCode = response.status;
        console.warn(`[Groq Quick] Model ${model} ${statusCode}, trying next...`, errorText.substring(0, 100));

        // 404 or 410 means model not available, try next one
        if (statusCode === 404 || statusCode === 410 || (statusCode === 400 && errorText.includes('decommissioned'))) {
          continue;
        }
        // For other errors, fail immediately
        throw new Error(`Groq API ${statusCode}`);
      }

      const data = await response.json() as any;
      const content = data.choices?.[0]?.message?.content;
      if (!content) {
        throw new Error('Empty response from Groq');
      }

      // Parse JSON from response (may have markdown wrapping)
      let jsonStr = content.trim();
      if (jsonStr.startsWith('```json')) jsonStr = jsonStr.slice(7);
      if (jsonStr.startsWith('```')) jsonStr = jsonStr.slice(3);
      if (jsonStr.endsWith('```')) jsonStr = jsonStr.slice(0, -3);

      const parsed = JSON.parse(jsonStr.trim()) as QuickAnalysis;
      parsed.analyzeTime = Date.now() - startTime;

      console.log(`[Groq Quick] ticket=${ticketId} model=${model} success in ${parsed.analyzeTime}ms`);
      return parsed;
    } catch (error) {
      console.warn(`[Groq Quick] Model ${model} failed:`, (error as Error).message);
      // Continue to next model
    }
  }

  // All models failed — return safe defaults
  console.error(`[Groq Quick] ticket=${ticketId} all models failed`);
  return {
    sentiment: 'neutral',
    priority: 'standard',
    hasError: false,
    issueCategory: 'other',
    analyzeTime: Date.now() - startTime,
  };
}

function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 3).trim()}...`;
}
