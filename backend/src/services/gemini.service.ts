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

const ANALYSIS_PROMPT = `You are a QA analyst for Ultrahuman customer support. Score this ticket using the CX audit standard taken from the manual QA sheet.

IMPORTANT PRINCIPLES:
1. Use the sheet's scoring behavior, not a generic QA rubric.
2. Only mark an issue when it is clearly supported by the ticket messages, timestamps, internal notes, current tags, SOP, or customer history shown below.
3. Give the agent credit for reasonable handling. Do not invent misses, hidden intent, or unsupported SOP failures.
4. Prefer the common score anchors used in the audit sheet: 100, 85, 80, 50, 35, 20, and 0.

## Context Rules (read before scoring):
- Score first response timing from when the agent joined the chat, not from when the bot first engaged the customer.
- The agent only needs to address issues actually raised in this conversation.
- If the customer's final message shows satisfaction or acceptance, treat the issue as resolved even if the agent did not send a textbook farewell.
- System auto-close after a valid resolution is NOT abandonment.
- Internal notes can contain context already collected before the agent replied. Do not penalize lack of probing if those details were already captured in the notes.

## Sheet-Aligned QC Rubric

### 1. Opening issues -> category "opening"
Default anchor when opening is the only problem: score 85 (-15).
Apply when there is a clear opening miss such as:
- Greetings not used
- Late first response / FR missed
- Did not acknowledge the concern
- Irrelevant first response

### 2. Response quality / process issues -> category "process"
Default anchor when a pure process issue exists: score 50 (-50).
Apply when the agent clearly made a workflow or handling miss such as:
- Wrong tag used / tag not used
- Incorrect resolution or irrelevant response
- Protocol / SOP miss
- Poor investigation or missed relevant customer details
- Missing important information or lack of elaboration
- Lack of probing or unnecessary probing
- Delayed response after agent joined
- Partial resolution
- Resolution not provided
- Not checking previous conversation when clearly needed

### 3. Grammar and tonality -> category "chat_handling"
Default anchor when this is the only problem: score 80 (-20).
Apply for:
- Incorrect or incomplete sentence formation
- Spelling, punctuation, or typo issues
- Robotic response
- Over-empathy or lack of empathy when it clearly affects quality

### 4. Closing issues -> category "closing"
Default anchor when closing is the only problem: score 85 (-15).
Apply for:
- Didn't send closing response
- Didn't mark conversation as done
- Didn't share the rating / CSAT link
- Did not offer further assistance
- Missing or improper resolution summary during closure

### 5. Fatal / intent -> category "fatal"
Any fatal issue forces score 0.
Apply only for clear critical failures such as:
- Wrong resolution
- Resolving without resolution
- Closing a workable chat
- Wrong SOP
- Not following the set of protocols / SOP in a severe way
- Not checking previous chat when clearly required for resolution
- Repeating canned response instead of solving the issue
- Sharing internal content with the customer
- Rude or abusive behavior
- Flagged incorrectly

## How to combine issues
- Start from 100.
- Use the sheet's anchored deductions:
  - opening: usually -15
  - process / response quality: usually -50
  - chat handling / grammar: usually -20
  - closing: usually -15
  - fatal: score becomes 0
- When multiple non-fatal categories appear, combine the anchored deductions and clamp the result to 0-100.
- This means common combinations should often land at:
  - opening only -> 85
  - grammar only -> 80
  - process only -> 50
  - opening + process -> 35
  - process + closing + opening -> 20
  - any fatal -> 0
- Do not create tiny custom deductions like -5 or -7 unless the evidence is unusually specific and the sheet pattern strongly supports it. Prefer the standard anchors.

## Tag and closure guidance from the audit sheet
- If current tags shown below are clearly missing, wrong, stale, or unresolved for the case, treat that as a process miss.
- Missing CSAT link, not marking done, or no proper closing response are closing misses, not fatal by themselves.
- APTC / associate-fault context supports why the miss matters, but it is not a separate deduction category in the JSON.

## Detecting Abandoned Tickets (be careful - do NOT misclassify):
An agent ABANDONED the chat only if ALL of these are true:
1. The agent's last meaningful message was a question OR the agent gave no meaningful response at all
2. The customer's final state still shows the issue is unresolved
3. The ticket then closed without a resolution

DO NOT mark as abandoned if:
- The agent gave a resolution or next steps and then left
- The customer's last message is positive or accepting
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

## Ticket Metadata:
Category / Group: {category}
Current Tags: {tags}

## Current Conversation:
{messages}

Analyze the conversation and respond ONLY with valid JSON in this exact format (no markdown, no code blocks, just raw JSON):
{
  "qaScore": <number 0-100>,
  "deductions": [
    { "category": "<opening|process|chat_handling|closing|fatal>", "points": <negative number using the sheet anchors when possible: opening -15, process -50, chat_handling -20, closing -15, fatal makes total score 0>, "reason": "<specific sub-violation from the rubric above>" }
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
  const formattedTags = formatTagsForPrompt(tags);
  const formattedCategory = category?.trim() || 'Unknown';

  // Build the prompt
  const prompt = ANALYSIS_PROMPT
    .replace('{customerHistory}', formattedHistory)
    .replace('{sopContent}', sopContent)
    .replace('{category}', formattedCategory)
    .replace('{tags}', formattedTags)
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

  return messages.map((msg, idx) => {
    // Preserve internal notes because they can contain context already captured before the agent replies.
    let sender = 'unknown';
    if (msg.s === 'U') sender = 'CUSTOMER';
    else if (msg.s === 'A') sender = 'AGENT';
    else if (msg.s === 'B') sender = 'BOT';
    else if (msg.s === 'N') sender = 'INTERNAL_NOTE';
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

function formatTagsForPrompt(tags?: string): string {
  if (!tags || tags.trim() === '') {
    return 'No tags present.';
  }

  try {
    const parsed = JSON.parse(tags);
    if (Array.isArray(parsed)) {
      return parsed.join(', ') || 'No tags present.';
    }
  } catch {
    // Keep raw tag string if it is not JSON.
  }

  return tags;
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
