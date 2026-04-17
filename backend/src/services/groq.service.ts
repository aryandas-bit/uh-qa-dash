const GROQ_API_BASE = 'https://api.groq.com/openai/v1';
const GROQ_MODEL = 'mixtral-8x7b-32768';
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

  try {
    const response = await fetch(`${GROQ_API_BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        max_tokens: 256,
      }),
      signal: AbortSignal.timeout(GROQ_TIMEOUT_MS),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Groq Quick] ${response.status} error:`, errorText);
      throw new Error(`Groq API ${response.status}`);
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

    return parsed;
  } catch (error) {
    console.error(`[Groq Quick] ticket=${ticketId} error:`, error);
    // Return safe defaults on error
    return {
      sentiment: 'neutral',
      priority: 'standard',
      hasError: false,
      issueCategory: 'other',
      analyzeTime: Date.now() - startTime,
    };
  }
}

function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 3).trim()}...`;
}
