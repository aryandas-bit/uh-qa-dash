import { findMatchingSOP } from './sop.service.js';

const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

export interface CustomerTicketHistory {
  ticketId: string;
  subject: string;
  date: string;
  agentEmail: string;
  status: string;
  priority: string;
  csat?: number;
}

export interface QAAnalysis {
  qaScore: number;
  deductions: Array<{
    category: string;
    points: number;
    reason: string;
  }>;
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
  customerContext: {
    isRepeatIssue: boolean;
    repeatIssueDetails: string | null;
    totalPreviousTickets: number;
    previousAgents: string[];
    customerExperience: string;
    recommendation: string | null;
  };
  resolution: {
    wasAbandoned: boolean;
    wasAutoResolved: boolean;
    customerIssueResolved: boolean;
    abandonmentDetails: string | null;
  };
  suggestions: string[];
  summary: string;
}

const ANALYSIS_PROMPT = `You are a QA analyst for Ultrahuman customer support. Analyze this support conversation and score it using the rubric below.

IMPORTANT PRINCIPLES:
1. Only deduct points for CLEAR, OBVIOUS violations. Do NOT deduct for minor, borderline, or subjective issues. If the agent did a reasonable job, give them the benefit of the doubt. A well-handled ticket should score 100/100.
2. NEVER invent or assume issues that are not explicitly stated in the conversation. Only reference facts, problems, and topics that are actually present in the messages. Do NOT infer physical defects, complaints, or issues from context clues — only use what is directly written.

## Context Rules (read before scoring):
- The agent's job is to address ONLY what the customer explicitly raises in this conversation.
- Agent response time should be measured from when the agent JOINED the chat, not from when the customer first contacted the bot.
- If the customer's final message indicates satisfaction (e.g. "thank you", "that helps", "amazing"), the chat was resolved successfully regardless of whether the agent sent a formal farewell.
- The system automatically closes tickets after the agent provides a resolution and leaves — this is NOT abandonment.

## Scoring Rubric (start at 100 points, deduct per section):

### 1. Opening Issues — max -15 points
ONLY deduct if there is a CLEAR violation:
- Agent completely ignored greeting (no "hi", "hello", or any welcoming line at all)
- First response was totally irrelevant to the stated issue

### 2. Process Miss — max -40 points
ONLY deduct if there is a CLEAR violation:
- Agent gave clearly wrong or harmful information
- Agent gave only a partial fix when the full resolution was obviously available
- Agent failed to investigate when key context was available and they ignored it
- Agent skipped an obvious SOP step that was directly applicable
- Agent lacked probing ONLY when critical missing info wasn't captured by the bot note and the agent didn't ask
- Agent completely failed to provide any resolution

### 3. Chat Handling — max -30 points
ONLY deduct if there is a CLEAR violation:
- Obvious typos or grammar mistakes that affect readability or professionalism
- Clearly robotic/copy-paste response with zero personalisation that doesn't fit the situation
- Clear lack of empathy when the customer was visibly upset or frustrated

DO NOT deduct for:
- Repeating information that the customer explicitly asked about again — answering a direct question is always correct, even if the answer was already given earlier in the conversation

### 4. Closing — max -15 points
ONLY deduct if there is a CLEAR violation:
- Agent closed the chat while the customer's issue was clearly UNRESOLVED
- Agent gave no resolution at all before closing
- DO NOT deduct if: the customer said thank you / seemed satisfied, even if the agent didn't send a formal "is there anything else?" message
- DO NOT deduct if the system auto-closed after the agent gave a resolution

### 5. Fatal — score becomes 0 immediately
Apply ONLY if one of these critical violations CLEARLY occurred:
- Chat autoclosed WITHOUT any resolution being given (agent abandoned without helping)
- Rude/Abusive Behavior toward customer
- Manually resolved a workable chat without actually solving it
- Wrong refund initiated
- Repeating canned response without addressing the actual issue
- Not checking previous chat history when it was clearly and obviously relevant
- Wrong resolution given that could cause customer harm or confusion
- Sharing an internal update/screenshot with the customer
- Wrong SOP applied
- Flagged Incorrectly

## Detecting Abandoned Tickets (be careful — do NOT misclassify):
An agent ABANDONED the chat only if ALL of these are true:
1. The agent's last message was a question OR the agent gave no response at all
2. The customer's last message shows the issue is still unresolved (complaint, question, waiting)
3. The ticket then closed without resolution

DO NOT mark as abandoned if:
- The agent gave a resolution/instructions and then left (even without a formal goodbye)
- The customer's last message is positive (thank you, ok, got it, etc.)
- The system auto-closed after a proper resolution was given

## IMPORTANT - Customer History Context:
{customerHistory}

When analyzing, consider:
1. Is this a REPEAT ISSUE? If the customer has raised the same/similar issue before, this is critical context.
2. How many times has this customer contacted support? Frequent contact may indicate unresolved issues.
3. Has the customer been passed between multiple agents? This affects their experience.
4. What was their previous satisfaction? Low CSAT history means extra care is needed.

If this is a repeat issue, the agent SHOULD:
- Acknowledge they're aware of the previous tickets
- Reference what was tried before
- Escalate if the issue persists
- NOT provide the same basic troubleshooting steps that already failed

## Relevant SOP for this ticket:
{sopContent}

## Current Conversation:
{messages}

Analyze the conversation and respond ONLY with valid JSON in this exact format (no markdown, no code blocks, just raw JSON):
{
  "qaScore": <number 0-100>,
  "deductions": [
    { "category": "<opening|process|chat_handling|closing|fatal>", "points": <negative number, max -15 for opening, -40 for process, -30 for chat_handling, -15 for closing, fatal sets score to 0>, "reason": "<specific sub-violation from the rubric above>" }
  ],
  "sopCompliance": {
    "score": <number 0-100>,
    "missedSteps": ["<specific step missed>"],
    "correctlyFollowed": ["<step correctly done>"],
    "matchedSOP": "<SOP title or null>"
  },
  "sentiment": {
    "customer": "<frustrated|neutral|satisfied|angry|confused>",
    "progression": "<initial state> -> <final state>",
    "agentTone": "<professional|friendly|robotic|dismissive|empathetic>"
  },
  "customerContext": {
    "isRepeatIssue": <true if customer raised same/similar issue before>,
    "repeatIssueDetails": "<description of what was repeated, or null>",
    "totalPreviousTickets": <number>,
    "previousAgents": ["<agent names who handled this customer before>"],
    "customerExperience": "<good|neutral|poor based on history>",
    "recommendation": "<specific recommendation based on customer history, or null>"
  },
  "resolution": {
    "wasAbandoned": <true if agent left without resolving>,
    "wasAutoResolved": <true if ticket appears auto-resolved by system, not properly closed by agent>,
    "customerIssueResolved": <true/false - was the customer's actual issue addressed?>,
    "abandonmentDetails": "<what happened - e.g. 'Agent left after customer reported broken link' or null>"
  },
  "suggestions": ["<specific improvement suggestion>"],
  "summary": "<2-3 sentence summary of the interaction quality, mentioning if repeat issue was handled properly>"
}`;

export async function analyzeTicket(
  _ticketId: string,
  messagesJson: string,
  category?: string,
  tags?: string,
  customerHistory?: CustomerTicketHistory[]
): Promise<QAAnalysis> {
  // Find matching SOP based on category or tags
  let sopContent = 'No specific SOP matched for this ticket category.';
  let matchedSOP: string | null = null;

  if (category || tags) {
    const sop = findMatchingSOP(category, tags);
    if (sop) {
      matchedSOP = sop.title;
      sopContent = formatSOPForPrompt(sop);
    }
  }

  // Parse and format messages
  let messages: any[] = [];
  try {
    messages = JSON.parse(messagesJson || '[]');
  } catch (e) {
    console.warn('Failed to parse messages JSON');
  }

  const formattedMessages = formatMessagesForPrompt(messages);
  const formattedHistory = formatCustomerHistory(customerHistory || []);

  // Build the prompt
  const prompt = ANALYSIS_PROMPT
    .replace('{customerHistory}', formattedHistory)
    .replace('{sopContent}', sopContent)
    .replace('{messages}', formattedMessages);

  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error('GEMINI_API_KEY environment variable is not set');

    const response = await fetch(GEMINI_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-goog-api-key': apiKey
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 2500,
          responseMimeType: 'application/json'
        }
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Gemini API error response:', errorText);
      throw new Error(`Gemini API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    const content = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!content) {
      console.error('Unexpected Gemini response structure:', JSON.stringify(data, null, 2));
      throw new Error('Empty response from Gemini');
    }

    // Clean up the response - remove markdown code blocks if present
    let cleanedContent = content.trim();
    if (cleanedContent.startsWith('```json')) {
      cleanedContent = cleanedContent.slice(7);
    } else if (cleanedContent.startsWith('```')) {
      cleanedContent = cleanedContent.slice(3);
    }
    if (cleanedContent.endsWith('```')) {
      cleanedContent = cleanedContent.slice(0, -3);
    }
    cleanedContent = cleanedContent.trim();

    const analysis = JSON.parse(cleanedContent) as QAAnalysis;
    analysis.sopCompliance.matchedSOP = matchedSOP;

    return analysis;
  } catch (error) {
    console.error('Gemini analysis error:', error);
    throw new Error('Failed to analyze ticket with AI');
  }
}

function formatCustomerHistory(history: CustomerTicketHistory[]): string {
  if (!history || history.length === 0) {
    return 'This is a NEW CUSTOMER with no previous support history.';
  }

  const agentNames = [...new Set(history.map(t => {
    const name = t.agentEmail?.split('@')[0]?.replace(/[._]/g, ' ') || 'Unknown';
    return name;
  }))];

  // Group similar subjects to detect repeat issues
  const subjectGroups: Record<string, CustomerTicketHistory[]> = {};
  history.forEach(t => {
    const normalizedSubject = t.subject?.toLowerCase().trim() || 'unknown';
    if (!subjectGroups[normalizedSubject]) {
      subjectGroups[normalizedSubject] = [];
    }
    subjectGroups[normalizedSubject].push(t);
  });

  const repeatIssues = Object.entries(subjectGroups)
    .filter(([_, tickets]) => tickets.length > 1)
    .map(([subject, tickets]) => `"${subject}" (${tickets.length} times)`);

  let historyText = `## Customer Support History (${history.length} previous tickets)\n\n`;

  if (repeatIssues.length > 0) {
    historyText += `⚠️ REPEAT ISSUES DETECTED:\n${repeatIssues.join('\n')}\n\n`;
  }

  historyText += `Previous agents: ${agentNames.join(', ')}\n\n`;
  historyText += `Recent tickets:\n`;

  history.slice(0, 10).forEach(t => {
    const agentName = t.agentEmail?.split('@')[0]?.replace(/[._]/g, ' ') || 'Unknown';
    const csatDisplay = t.csat && t.csat > 0 ? ` | CSAT: ${t.csat}` : '';
    historyText += `- [${t.date}] #${t.ticketId}: "${t.subject}" | ${agentName} | ${t.status} | ${t.priority}${csatDisplay}\n`;
  });

  if (history.length > 10) {
    historyText += `... and ${history.length - 10} more tickets\n`;
  }

  return historyText;
}

function formatMessagesForPrompt(messages: any[]): string {
  if (!messages || messages.length === 0) {
    return 'No messages available for analysis.';
  }

  return messages.filter((msg) => msg.s !== 'N').map((msg, idx) => {
    // Handle the s/m/t format from the database
    let sender = 'unknown';
    if (msg.s === 'U') sender = 'CUSTOMER';
    else if (msg.s === 'A') sender = 'AGENT';
    else if (msg.s === 'B') sender = 'BOT';
    else if (msg.sender_type) sender = msg.sender_type.toUpperCase();

    // Get the message content
    let content = '';
    if (typeof msg.m === 'string') {
      try {
        const parsed = JSON.parse(msg.m);
        if (parsed.message) content = parsed.message;
        else if (parsed.text) content = parsed.text;
        else if (parsed.quickReplies?.title) content = parsed.quickReplies.title;
        else content = msg.m;
      } catch {
        content = msg.m;
      }
    } else if (msg.message) {
      content = msg.message;
    } else if (msg.content) {
      content = msg.content;
    }

    const timestamp = msg.t || msg.created_at || msg.timestamp || '';

    // Skip empty messages
    if (!content || content.trim() === '' || content === '{ }') {
      return null;
    }

    return `[${idx + 1}] ${sender}: ${content}${timestamp ? ` (${timestamp})` : ''}`;
  }).filter(Boolean).join('\n\n');
}

function formatSOPForPrompt(sop: any): string {
  let content = `SOP: ${sop.title}\n`;
  content += `Case: ${sop.caseIdentifier || 'N/A'}\n`;
  content += `Description: ${sop.description || 'N/A'}\n\n`;

  if (sop.steps && sop.steps.length > 0) {
    content += 'Steps:\n';
    sop.steps.forEach((step: any, idx: number) => {
      content += `${idx + 1}. ${step.title}: ${step.description || ''}\n`;
      if (step.instructions && step.instructions.length > 0) {
        step.instructions.forEach((inst: string) => {
          content += `   - ${inst}\n`;
        });
      }
    });
  }

  return content;
}

// Batch analyze multiple tickets
export async function batchAnalyze(
  tickets: Array<{ ticketId: string; messagesJson: string; category?: string; tags?: string; customerHistory?: CustomerTicketHistory[] }>,
  maxConcurrent = 3
): Promise<Map<string, QAAnalysis | Error>> {
  const results = new Map<string, QAAnalysis | Error>();
  const chunks = [];

  // Split into chunks for concurrent processing
  for (let i = 0; i < tickets.length; i += maxConcurrent) {
    chunks.push(tickets.slice(i, i + maxConcurrent));
  }

  for (const chunk of chunks) {
    const promises = chunk.map(async (ticket) => {
      try {
        const analysis = await analyzeTicket(
          ticket.ticketId,
          ticket.messagesJson,
          ticket.category,
          ticket.tags,
          ticket.customerHistory
        );
        results.set(ticket.ticketId, analysis);
      } catch (error) {
        results.set(ticket.ticketId, error as Error);
      }
    });

    await Promise.all(promises);

    // Small delay between chunks to avoid rate limits
    if (chunks.indexOf(chunk) < chunks.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  return results;
}
