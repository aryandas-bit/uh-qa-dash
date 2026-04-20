const GROQ_API_BASE = 'https://api.groq.com/openai/v1';
// Use fastest available Groq models (mixtral-8x7b and llama-3.1 support tool use)
const GROQ_MODELS = ['mixtral-8x7b-32768', 'llama-3.1-70b-versatile', 'llama-3.1-8b-instant'];
const GROQ_TIMEOUT_MS = 15000;

export interface TriageDigest {
  issueCategory: 'billing' | 'connectivity' | 'app_crash' | 'health_sync' | 'wearable' | 'battery' | 'settings' | 'other';
  priority: 'urgent' | 'standard' | 'low';
  customerSentiment: 'positive' | 'neutral' | 'negative' | 'angry';
  hasTechnicalIssue: boolean;
  repeatIssueLikely: boolean;
  resolutionState: 'resolved' | 'unresolved' | 'unclear';
  keyFacts: string[];
  riskFlags: string[];
  shortDigest: string;
  analyzeTime: number;
}

export interface QuickAnalysis extends TriageDigest {}

const TRIAGE_PROMPT = `You are a fast support-ticket triage assistant for Ultrahuman.

Your job is NOT to score QA. Your job is to extract ONLY the minimum structured context needed for a deeper QA auditor.

Return ONLY valid JSON in this exact format (no markdown, no code blocks):
{
  "issueCategory": "billing|connectivity|app_crash|health_sync|wearable|battery|settings|other",
  "priority": "urgent|standard|low",
  "customerSentiment": "positive|neutral|negative|angry",
  "hasTechnicalIssue": true|false,
  "repeatIssueLikely": true|false,
  "resolutionState": "resolved|unresolved|unclear",
  "keyFacts": ["<fact 1>", "<fact 2>", "<fact 3>"],
  "riskFlags": ["<flag 1>", "<flag 2>"],
  "shortDigest": "<max 2 short sentences>"
}

RULES - be concise and factual:
1. Do NOT score QA or judge SOP compliance
2. Do NOT invent facts — use only clear evidence from the messages
3. issueCategory: most specific category or "other"
4. priority: urgent=escalation/refund needed, standard=normal, low=info only
5. customerSentiment: customer's emotional state from messages
6. hasTechnicalIssue: true if customer reports error/bug, false if info request
7. repeatIssueLikely: true if the subject or pattern appears to recur
8. resolutionState: resolved=fixed, unresolved=still pending, unclear=ambiguous
9. keyFacts: ≤5 short factual statements (not judgments)
10. riskFlags: ≤5 concrete risk signals (not speculations)
11. shortDigest: 1-2 sentences summarizing the ticket

Ticket data:
CUSTOMER MESSAGE: {customerMessage}
AGENT LATEST REPLY: {agentLatest}
CONVERSATION LENGTH: {turnCount} turns`;

export async function triageTicket(
  ticketId: string,
  firstCustomerMessage: string,
  lastAgentMessage: string,
  totalTurns: number
): Promise<TriageDigest> {
  const startTime = Date.now();
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error('GROQ_API_KEY environment variable is not set');

  const prompt = TRIAGE_PROMPT
    .replace('{customerMessage}', truncateText(firstCustomerMessage, 300))
    .replace('{agentLatest}', truncateText(lastAgentMessage, 200))
    .replace('{turnCount}', String(totalTurns));

  let attempt = 0;
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
          max_tokens: 512,
        }),
        signal: AbortSignal.timeout(GROQ_TIMEOUT_MS),
      });

      if (!response.ok) {
        const errorText = await response.text();
        const statusCode = response.status;
        console.warn(`[Groq Triage] Model ${model} ${statusCode}, trying next...`, errorText.substring(0, 100));

        if (statusCode === 401 || statusCode === 403) {
          throw new Error(`Groq auth error ${statusCode}`);
        }
        if (statusCode === 404 || statusCode === 410 || (statusCode === 400 && errorText.includes('decommissioned'))) {
          continue;
        }
        if (statusCode === 429) {
          throw new Error(`Groq rate limited ${statusCode}`);
        }
        throw new Error(`Groq API ${statusCode}`);
      }

      const data = await response.json() as any;
      const content = data.choices?.[0]?.message?.content;
      if (!content) {
        throw new Error('Empty response from Groq');
      }

      const digest = parseTriageJSON(content);
      digest.analyzeTime = Date.now() - startTime;

      console.log(`[Groq Triage] ticket=${ticketId} model=${model} success in ${digest.analyzeTime}ms`);
      return digest;
    } catch (error) {
      const msg = (error as Error).message;
      console.warn(`[Groq Triage] Model ${model} failed:`, msg);

      // Retry once with repair prompt on parse errors
      if (msg.includes('JSON') && attempt === 0) {
        attempt++;
        try {
          const repairPrompt = `Fix this invalid JSON and return ONLY the corrected JSON object:\n${msg}`;
          const response = await fetch(`${GROQ_API_BASE}/chat/completions`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model,
              messages: [{ role: 'user', content: repairPrompt }],
              temperature: 0,
              max_tokens: 512,
            }),
            signal: AbortSignal.timeout(GROQ_TIMEOUT_MS),
          });
          const repairData = await response.json() as any;
          const repairContent = repairData.choices?.[0]?.message?.content;
          if (repairContent) {
            const digest = parseTriageJSON(repairContent);
            digest.analyzeTime = Date.now() - startTime;
            console.log(`[Groq Triage] ticket=${ticketId} repair succeeded`);
            return digest;
          }
        } catch (repairError) {
          console.warn(`[Groq Triage] Repair failed:`, (repairError as Error).message);
        }
      }
    }
  }

  console.error(`[Groq Triage] ticket=${ticketId} all models failed`);
  return {
    issueCategory: 'other',
    priority: 'standard',
    customerSentiment: 'neutral',
    hasTechnicalIssue: false,
    repeatIssueLikely: false,
    resolutionState: 'unclear',
    keyFacts: [],
    riskFlags: [],
    shortDigest: 'Unable to triage ticket',
    analyzeTime: Date.now() - startTime,
  };
}

export async function analyzeQuick(
  ticketId: string,
  firstCustomerMessage: string,
  lastAgentMessage: string,
  totalTurns: number
): Promise<QuickAnalysis> {
  return triageTicket(ticketId, firstCustomerMessage, lastAgentMessage, totalTurns);
}

function parseTriageJSON(content: string): TriageDigest {
  let jsonStr = content.trim();
  if (jsonStr.startsWith('```json')) jsonStr = jsonStr.slice(7);
  if (jsonStr.startsWith('```')) jsonStr = jsonStr.slice(3);
  if (jsonStr.endsWith('```')) jsonStr = jsonStr.slice(0, -3);

  const parsed = JSON.parse(jsonStr.trim());

  // Validate required fields
  if (!parsed.issueCategory || !parsed.priority || !parsed.customerSentiment) {
    throw new Error('Invalid triage JSON: missing required fields');
  }

  // Ensure arrays
  parsed.keyFacts = (parsed.keyFacts || []).slice(0, 5);
  parsed.riskFlags = (parsed.riskFlags || []).slice(0, 5);

  return parsed as TriageDigest;
}

export function convertDigestToProvisionalAnalysis(digest: TriageDigest): any {
  const baseScore = digest.hasTechnicalIssue ? 50 : 85;
  const adjustedScore = digest.priority === 'urgent' ? Math.max(0, baseScore - 15) : baseScore;

  return {
    qaScore: adjustedScore,
    deductions: [],
    sopCompliance: {
      score: 50,
      missedSteps: [],
      correctlyFollowed: [],
      matchedSOP: null,
    },
    sentiment: {
      customer: digest.customerSentiment,
      progression: 'unknown',
      agentTone: 'unknown',
    },
    customerContext: {
      isRepeatIssue: digest.repeatIssueLikely,
      repeatIssueDetails: null,
      totalPreviousTickets: 0,
      previousAgents: [],
      customerExperience: 'unknown',
      recommendation: null,
    },
    resolution: {
      wasAbandoned: digest.resolutionState === 'unresolved',
      wasAutoResolved: false,
      customerIssueResolved: digest.resolutionState === 'resolved',
      abandonmentDetails: null,
    },
    suggestions: [],
    summary: digest.shortDigest,
  };
}

function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 3).trim()}...`;
}
