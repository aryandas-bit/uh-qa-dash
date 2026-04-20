import { findMatchingSOP } from './sop.service.js';
import type { AuditMemoryRecord } from './database.service.js';

const GROQ_API_BASE = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = process.env.GROQ_MODEL?.trim() || 'llama-3.1-8b-instant'; // 20k TPM free tier
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const CONFIGURED_GEMINI_MODEL = process.env.GEMINI_MODEL?.trim() || 'gemini-2.5-flash';
const DEFAULT_BATCH_CONCURRENCY = Math.max(1, Number(process.env.GEMINI_BATCH_MAX_CONCURRENT || '1'));
const MAX_SELECTED_MESSAGES = Math.max(1, Number(process.env.GEMINI_MAX_SELECTED_MESSAGES || '15'));
const MAX_MESSAGE_CHARS = Math.max(100, Number(process.env.GEMINI_MAX_MESSAGE_CHARS || '300'));
const MAX_TRANSCRIPT_CHARS = Math.max(500, Number(process.env.GEMINI_MAX_TRANSCRIPT_CHARS || '5000'));
const MAX_HISTORY_TICKETS = Math.max(1, Number(process.env.GEMINI_MAX_HISTORY_TICKETS || '3'));
const MAX_SOP_STEPS = Math.max(1, Number(process.env.GEMINI_MAX_SOP_STEPS || '5'));
const INTER_BATCH_DELAY_MS = Math.max(500, Number(process.env.GEMINI_INTER_BATCH_DELAY_MS || '3000'));
const RETRY_BACKOFF_MS = Math.max(500, Number(process.env.GEMINI_RETRY_BACKOFF_MS || '1000'));
const MAX_OUTPUT_TOKENS = Math.max(256, Number(process.env.GEMINI_MAX_OUTPUT_TOKENS || '800'));

const LEGACY_GEMINI_MODELS = new Set([
  'gemini-2.0-flash',
  'gemini-2.0-flash-lite',
  'gemini-1.5-flash',
  'gemini-1.5-pro',
]);

const GEMINI_MODEL_CANDIDATES = buildModelCandidates(CONFIGURED_GEMINI_MODEL);

console.log(
  `[LLM Config] provider=${process.env.GROQ_API_KEY ? 'groq' : 'gemini'} model=${process.env.GROQ_API_KEY ? GROQ_MODEL : CONFIGURED_GEMINI_MODEL} ` +
  `maxMessages=${MAX_SELECTED_MESSAGES} ` +
  `maxMsgChars=${MAX_MESSAGE_CHARS} maxTranscript=${MAX_TRANSCRIPT_CHARS} ` +
  `maxHistory=${MAX_HISTORY_TICKETS} maxSopSteps=${MAX_SOP_STEPS} ` +
  `batchDelay=${INTER_BATCH_DELAY_MS}ms maxOutputTokens=${MAX_OUTPUT_TOKENS}`
);

const KEYWORD_BOOSTS = [
  'not working', 'does not work', 'issue', 'problem', 'error', 'failed', 'failure',
  'refund', 'replace', 'replacement', 'escalate', 'escalation', 'callback', 'again',
  'same issue', 'previous', 'earlier', 'still', 'resolved', 'unresolved', 'done',
  'tried', 'already', 'checked', 'reset', 'sync', 'bluetooth', 'charging', 'battery',
  'doctor', 'investigate', 'update', 'timeline', 'csat', 'rating', 'tag'
];

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'been', 'but', 'by', 'for', 'from',
  'had', 'has', 'have', 'i', 'if', 'in', 'into', 'is', 'it', 'its', 'me', 'my',
  'of', 'on', 'or', 'our', 'so', 'that', 'the', 'their', 'them', 'there', 'they',
  'this', 'to', 'was', 'we', 'were', 'with', 'you', 'your'
]);

type MessageSender = 'CUSTOMER' | 'AGENT' | 'BOT' | 'INTERNAL_NOTE' | 'UNKNOWN';

interface NormalizedMessage {
  index: number;
  sender: MessageSender;
  content: string;
  timestamp: string;
  salience: number;
}

interface ConversationDigest {
  summary: string;
  transcript: string;
  totalMessages: number;
  selectedMessages: number;
}

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
5. The conversation below may contain the full transcript or a compressed selection. Use the summary and transcript together. If turns were omitted, do not assume they contain new evidence.

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

## Persistent Audit Memory:
{auditMemory}

When analyzing, consider:
1. Is this a REPEAT ISSUE? If the customer has raised the same/similar issue before, this is critical context.
2. How many times has this customer contacted support? Frequent contact may indicate unresolved issues.
3. Has the customer been passed between multiple agents? This affects their experience.
4. What was their previous satisfaction? Low CSAT history means extra care is needed.
5. If the persistent memory shows the same issue or same failure pattern, treat that as strong prior context even if the raw prior transcript is not included here.

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

## Conversation Summary:
{conversationSummary}

## Selected Transcript:
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
    "correctlyFollowed": ["<specific step correctly done>"],
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
  ticketId: string,
  messagesJson: string,
  category?: string,
  tags?: string,
  customerHistory?: CustomerTicketHistory[],
  auditMemories?: AuditMemoryRecord[]
): Promise<QAAnalysis> {
  let sopContent = 'No specific SOP matched for this ticket category.';
  let matchedSOP: string | null = null;

  const normalizedMessages = parseMessages(messagesJson);
  const conversationDigest = buildConversationDigest(normalizedMessages);
  const formattedHistory = formatCustomerHistory(customerHistory || []);
  const formattedAuditMemory = formatAuditMemories(auditMemories || []);
  const formattedTags = formatTagsForPrompt(tags);
  const formattedCategory = category?.trim() || 'Unknown';

  if (category || tags) {
    const sop = findMatchingSOP(category, tags);
    if (sop) {
      matchedSOP = sop.title;
      sopContent = formatSOPForPrompt(
        sop,
        formattedCategory,
        formattedTags,
        normalizedMessages.map((message) => message.content).join('\n')
      );
    }
  }

  const prompt = ANALYSIS_PROMPT
    .replace('{customerHistory}', formattedHistory)
    .replace('{auditMemory}', formattedAuditMemory)
    .replace('{sopContent}', sopContent)
    .replace('{category}', formattedCategory)
    .replace('{tags}', formattedTags)
    .replace('{conversationSummary}', conversationDigest.summary)
    .replace('{messages}', conversationDigest.transcript);

  console.log(
    `[Gemini] ticket=${ticketId} models=${GEMINI_MODEL_CANDIDATES.join(',')} ` +
    `rawTurns=${normalizedMessages.length} selectedTurns=${conversationDigest.selectedMessages}`
  );

  try {
    const data = await callLLM(prompt);
    const content = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!content) {
      console.error('Unexpected Gemini response structure:', JSON.stringify(data, null, 2));
      throw new Error('Empty response from Gemini');
    }

    let cleanedContent = content.trim();
    if (cleanedContent.startsWith('```json')) {
      cleanedContent = cleanedContent.slice(7);
    } else if (cleanedContent.startsWith('```')) {
      cleanedContent = cleanedContent.slice(3);
    }
    if (cleanedContent.endsWith('```')) {
      cleanedContent = cleanedContent.slice(0, -3);
    }

    const analysis = JSON.parse(cleanedContent.trim()) as QAAnalysis;
    analysis.sopCompliance.matchedSOP = matchedSOP;
    return analysis;
  } catch (error: any) {
    console.error('Gemini analysis error:', error?.message || error);
    throw error; // re-throw original so callers see the real Gemini error
  }
}

function parseMessages(messagesJson: string): NormalizedMessage[] {
  let rawMessages: any[] = [];

  try {
    rawMessages = JSON.parse(messagesJson || '[]');
  } catch {
    console.warn('Failed to parse messages JSON');
  }

  return rawMessages
    .map((rawMessage, index) => normalizeMessage(rawMessage, index))
    .filter((message): message is NormalizedMessage => message !== null)
    .map((message, index, allMessages) => ({
      ...message,
      salience: scoreMessageSalience(message, index, allMessages.length),
    }));
}

function normalizeMessage(rawMessage: any, index: number): NormalizedMessage | null {
  const content = truncateText(extractMessageContent(rawMessage), MAX_MESSAGE_CHARS);
  if (!content || content === '{ }') {
    return null;
  }

  let sender: MessageSender = 'UNKNOWN';
  if (rawMessage.s === 'U') sender = 'CUSTOMER';
  else if (rawMessage.s === 'A') sender = 'AGENT';
  else if (rawMessage.s === 'B') sender = 'BOT';
  else if (rawMessage.s === 'N') sender = 'INTERNAL_NOTE';
  else if (typeof rawMessage.sender_type === 'string') sender = rawMessage.sender_type.toUpperCase() as MessageSender;

  return {
    index: index + 1,
    sender,
    content,
    timestamp: rawMessage.t || rawMessage.created_at || rawMessage.timestamp || '',
    salience: 0,
  };
}

function extractMessageContent(rawMessage: any): string {
  if (typeof rawMessage?.m === 'string') {
    try {
      let parsed = JSON.parse(rawMessage.m);
      // Handle array-wrapped messages (e.g. [{"quickReplies":...}])
      if (Array.isArray(parsed)) parsed = parsed[0] || {};
      if (parsed.message) return String(parsed.message);
      if (parsed.text) return String(parsed.text);
      if (parsed.quickReplies?.title) {
        const options = Array.isArray(parsed.quickReplies.options)
          ? parsed.quickReplies.options.map((option: any) => option.title).filter(Boolean).join(', ')
          : '';
        return options ? `${parsed.quickReplies.title} Options: ${options}` : String(parsed.quickReplies.title);
      }
      if (parsed.image) return `[Image attachment] ${parsed.caption || ''}`.trim();
      if (parsed.event?.data?.message) return String(parsed.event.data.message);
      return rawMessage.m;
    } catch {
      return rawMessage.m;
    }
  }

  if (rawMessage?.message) return String(rawMessage.message);
  if (rawMessage?.content) return String(rawMessage.content);
  if (rawMessage?.text) return String(rawMessage.text);
  return '';
}

function scoreMessageSalience(message: NormalizedMessage, index: number, totalMessages: number): number {
  let score = 0;
  const content = message.content.toLowerCase();

  if (message.sender === 'CUSTOMER' || message.sender === 'AGENT') score += 3;
  if (message.sender === 'INTERNAL_NOTE') score += 2;
  if (index < 3 || index >= totalMessages - 4) score += 4;
  if (content.includes('?')) score += 1;
  if (content.length > 180) score += 1;

  KEYWORD_BOOSTS.forEach((keyword) => {
    if (content.includes(keyword)) score += 2;
  });

  if (/thank|resolved|working now|done|fixed|perfect|great/i.test(content)) score += 2;
  if (/hello|hi|thank you for reaching out|please allow me/i.test(content) && message.sender === 'BOT') score -= 1.5;

  return score;
}

function buildConversationDigest(messages: NormalizedMessage[]): ConversationDigest {
  if (messages.length === 0) {
    return {
      summary: 'No usable conversation messages were present.',
      transcript: 'No messages available for analysis.',
      totalMessages: 0,
      selectedMessages: 0,
    };
  }

  const selectedMessages = selectSalientMessages(messages);
  const customerMessages = messages.filter((message) => message.sender === 'CUSTOMER');
  const agentMessages = messages.filter((message) => message.sender === 'AGENT');
  const internalNotes = messages.filter((message) => message.sender === 'INTERNAL_NOTE');
  const botMessages = messages.filter((message) => message.sender === 'BOT');
  const firstCustomerMessage = customerMessages[0]?.content || 'No customer message found.';
  const lastCustomerMessage = customerMessages.at(-1)?.content || 'No final customer update.';
  const lastAgentMessage = agentMessages.at(-1)?.content || 'No agent response.';
  const selectedIndexes = new Set(selectedMessages.map((message) => message.index));
  const omittedTurns = messages.length - selectedMessages.length;

  const summaryLines = [
    `Conversation profile: ${messages.length} total turns (${customerMessages.length} customer, ${agentMessages.length} agent, ${botMessages.length} bot, ${internalNotes.length} internal notes).`,
    `Initial customer issue: ${truncateText(firstCustomerMessage, 260)}`,
    `Latest customer state: ${truncateText(lastCustomerMessage, 220)}`,
    `Latest agent action: ${truncateText(lastAgentMessage, 220)}`,
  ];

  if (internalNotes.length > 0) {
    summaryLines.push(
      `Internal-note context: ${internalNotes.slice(0, 2).map((message) => truncateText(message.content, 160)).join(' | ')}`
    );
  }

  const transcript = selectedMessages
    .map((message) => {
      const timestamp = message.timestamp ? ` (${message.timestamp})` : '';
      return `[${message.index}] ${message.sender}: ${message.content}${timestamp}`;
    })
    .join('\n\n');

  const omissionNote = omittedTurns > 0
    ? `${selectedMessages.length} turns kept for audit focus; ${omittedTurns} lower-signal turns omitted.`
    : `Full conversation included (${selectedMessages.length} turns).`;

  return {
    summary: `${summaryLines.join('\n')}\nSelected evidence: ${omissionNote}`,
    transcript,
    totalMessages: messages.length,
    selectedMessages: selectedIndexes.size,
  };
}

function selectSalientMessages(messages: NormalizedMessage[]): NormalizedMessage[] {
  if (messages.length <= MAX_SELECTED_MESSAGES) {
    return messages;
  }

  const selectedIndexes = new Set<number>();
  const pinned = [
    ...messages.slice(0, 6),
    ...messages.slice(-10),
  ];

  pinned.forEach((message) => selectedIndexes.add(message.index));

  const rankedMiddle = messages
    .filter((message) => !selectedIndexes.has(message.index))
    .sort((left, right) => right.salience - left.salience || left.index - right.index);

  for (const message of rankedMiddle) {
    if (selectedIndexes.size >= MAX_SELECTED_MESSAGES) break;
    selectedIndexes.add(message.index);
  }

  const selected = messages
    .filter((message) => selectedIndexes.has(message.index))
    .sort((left, right) => left.index - right.index);

  let totalChars = 0;
  const trimmed: NormalizedMessage[] = [];
  for (const message of selected) {
    const messageChars = message.content.length + message.sender.length + message.timestamp.length + 10;
    if (trimmed.length >= 20 && totalChars + messageChars > MAX_TRANSCRIPT_CHARS) {
      continue;
    }
    trimmed.push(message);
    totalChars += messageChars;
  }

  return trimmed;
}

function formatCustomerHistory(history: CustomerTicketHistory[]): string {
  if (history.length === 0) {
    return 'This is a new customer with no previous support history.';
  }

  const uniqueAgents = [...new Set(
    history
      .map((ticket) => humanizeAgentName(ticket.agentEmail))
      .filter(Boolean)
  )];

  const lowCsatCount = history.filter((ticket) => typeof ticket.csat === 'number' && ticket.csat > 0 && ticket.csat < 3).length;
  const normalizedSubjects = new Map<string, CustomerTicketHistory[]>();
  history.forEach((ticket) => {
    const key = normalizeForMatching(ticket.subject || 'unknown');
    const group = normalizedSubjects.get(key) || [];
    group.push(ticket);
    normalizedSubjects.set(key, group);
  });

  const repeatIssues = [...normalizedSubjects.values()]
    .filter((tickets) => tickets.length > 1)
    .sort((left, right) => right.length - left.length)
    .slice(0, 3)
    .map((tickets) => `${truncateText(tickets[0].subject || 'unknown', 80)} (${tickets.length} tickets)`);

  const recentTickets = history
    .slice(0, MAX_HISTORY_TICKETS)
    .map((ticket) => {
      const csat = typeof ticket.csat === 'number' && ticket.csat > 0 ? `, CSAT ${ticket.csat}` : '';
      return `- ${ticket.date || 'Unknown date'}: "${truncateText(ticket.subject || 'No subject', 90)}" handled by ${humanizeAgentName(ticket.agentEmail)} [${ticket.status || 'Unknown'}${csat}]`;
    })
    .join('\n');

  const lines = [
    `Previous tickets: ${history.length}`,
    `Unique previous agents: ${uniqueAgents.length > 0 ? uniqueAgents.join(', ') : 'Unknown'}`,
    `Low CSAT history count: ${lowCsatCount}`,
    repeatIssues.length > 0 ? `Repeat patterns: ${repeatIssues.join(' | ')}` : 'Repeat patterns: none clearly detected',
    'Most recent previous tickets:',
    recentTickets,
  ];

  return lines.join('\n');
}

function formatAuditMemories(memories: AuditMemoryRecord[]): string {
  if (memories.length === 0) {
    return 'No persistent audit memory exists yet for this customer/issue.';
  }

  return memories
    .slice(0, 3)
    .map((memory, index) => {
      const lines = [
        `Memory ${index + 1}: issue "${truncateText(memory.issueSignature, 120)}" seen ${memory.totalSeen} time(s), last ticket ${memory.lastTicketId}${memory.lastTicketDate ? ` on ${memory.lastTicketDate}` : ''}.`,
        `Subject: ${truncateText(memory.subject || 'Unknown', 100)}.`,
        `Prior outcome: QA ${memory.qaScore ?? 'unknown'}, resolution=${memory.resolutionState || 'unknown'}, repeatIssue=${memory.repeatIssue ? 'yes' : 'no'}.`,
      ];

      if (memory.customerContext) {
        lines.push(`Customer context: ${truncateText(memory.customerContext, 180)}.`);
      }
      if (memory.deductionSummary) {
        lines.push(`Past misses: ${truncateText(memory.deductionSummary, 180)}.`);
      }
      if (memory.missedSteps) {
        lines.push(`Missed SOP/process points: ${truncateText(memory.missedSteps, 160)}.`);
      }
      if (memory.suggestions) {
        lines.push(`Carry-forward recommendation: ${truncateText(memory.suggestions, 160)}.`);
      }

      return lines.join('\n');
    })
    .join('\n\n');
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
    return tags;
  }

  return tags;
}

function formatSOPForPrompt(sop: any, category: string, tags: string, conversationText: string): string {
  const searchText = `${category} ${tags} ${conversationText}`.toLowerCase();
  const searchTerms = extractKeywords(searchText);

  const rankedSteps = Array.isArray(sop.steps)
    ? sop.steps
        .map((step: any) => ({
          step,
          score: scoreSopStep(step, searchTerms),
        }))
        .sort((left: any, right: any) => right.score - left.score || left.step.stepNumber - right.step.stepNumber)
        .slice(0, MAX_SOP_STEPS)
    : [];

  const lines = [
    `SOP: ${sop.title}`,
    `Case: ${sop.caseIdentifier || 'N/A'}`,
    `Description: ${truncateText(sop.description || 'N/A', 180)}`,
    'Relevant steps:',
  ];

  if (rankedSteps.length === 0) {
    lines.push('- No specific steps available.');
  } else {
    rankedSteps.forEach(({ step }: any, index: number) => {
      const instructions = Array.isArray(step.instructions)
        ? step.instructions.slice(0, 2).map((instruction: string) => truncateText(instruction, 120)).join(' | ')
        : '';
      lines.push(
        `${index + 1}. ${truncateText(step.title || `Step ${step.stepNumber || index + 1}`, 80)}: ` +
        `${truncateText(step.description || '', 150)}${instructions ? ` | ${instructions}` : ''}`
      );
    });
  }

  return lines.join('\n');
}

function scoreSopStep(step: any, searchTerms: string[]): number {
  const stepText = normalizeForMatching([
    step.title,
    step.description,
    step.macroName,
    ...(Array.isArray(step.instructions) ? step.instructions : []),
  ].filter(Boolean).join(' '));

  return searchTerms.reduce((score, term) => score + (stepText.includes(term) ? 2 : 0), 0);
}

function extractKeywords(text: string): string[] {
  return [...new Set(
    normalizeForMatching(text)
      .split(' ')
      .filter((word) => word.length >= 4 && !STOP_WORDS.has(word))
  )];
}

function normalizeForMatching(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function humanizeAgentName(agentEmail?: string): string {
  if (!agentEmail) return 'Unknown';
  return agentEmail
    .split('@')[0]
    .replace(/_ext$/, '')
    .replace(/[._]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim() || 'Unknown';
}

function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 3).trim()}...`;
}

async function callLLM(prompt: string): Promise<{ candidates: { content: { parts: { text: string }[] } }[] }> {
  const groqKey = process.env.GROQ_API_KEY;
  if (groqKey) {
    return callGroq(prompt, groqKey);
  }
  const geminiKey = process.env.GEMINI_API_KEY;
  if (!geminiKey) throw new Error('No AI API key set (GROQ_API_KEY or GEMINI_API_KEY required)');
  return callGemini(prompt, geminiKey);
}

async function callGroq(prompt: string, apiKey: string): Promise<{ candidates: { content: { parts: { text: string }[] } }[] }> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);

    try {
      const response = await fetch(GROQ_API_BASE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: GROQ_MODEL,
          messages: [{ role: 'user', content: prompt }],
          response_format: { type: 'json_object' },
          temperature: 0.2,
          max_tokens: MAX_OUTPUT_TOKENS,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (response.ok) {
        const data = await response.json();
        const text = data.choices?.[0]?.message?.content || '';
        // Normalise to Gemini-like shape so the caller works unchanged
        return { candidates: [{ content: { parts: [{ text }] } }] };
      }

      const errorText = await response.text();
      lastError = new Error(`Groq ${GROQ_MODEL} HTTP ${response.status}: ${errorText.slice(0, 300)}`);

      if (response.status !== 429 && response.status < 500) {
        console.error(`Groq error (non-retryable) status=${response.status}:`, errorText);
        throw lastError;
      }

      const backoff = RETRY_BACKOFF_MS * attempt;
      console.warn(`Groq ${response.status}, retry ${attempt}/2 in ${backoff}ms`);
      await sleep(backoff);
    } catch (err: any) {
      clearTimeout(timeout);
      if (err.name === 'AbortError') {
        lastError = new Error(`Groq timed out after 20s (attempt ${attempt}/2)`);
        console.warn(lastError.message);
        if (attempt < 2) await sleep(RETRY_BACKOFF_MS);
      } else {
        throw err;
      }
    }
  }

  throw lastError || new Error('Groq API failed after 2 attempts');
}

const GEMINI_TIMEOUT_MS = 60000; / 60 second timeout per request
const MAX_RETRIES_PER_MODEL = 3;

async function callGemini(prompt: string, apiKey: string) {
  const requestBody = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      responseMimeType: 'application/json',
      thinkingConfig: { thinkingBudget: 0 },
    },
  };

  let lastError: Error | null = null;

  // Outer loop: try each model candidate
  for (const model of GEMINI_MODEL_CANDIDATES) {
    // Inner loop: retry same model on transient errors (429/5xx)
    for (let attempt = 1; attempt <= MAX_RETRIES_PER_MODEL; attempt += 1) {
      try {
        const response = await fetch(`${GEMINI_API_BASE}/${model}:generateContent`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-goog-api-key': apiKey,
          },
          body: JSON.stringify(requestBody),
          signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS),
        });

        if (response.ok) {
          return response.json();
        }

        const errorText = await response.text();
        lastError = new Error(`Gemini ${model}: ${response.status}`);

        // Model-level issue: skip to next model immediately
        if (shouldTryNextModel(response.status, errorText)) {
          console.warn(`[Gemini] ${model} unavailable (${response.status}), trying next model`);
          break;
        }

        // Non-retryable client error: throw immediately
        if (response.status !== 429 && response.status < 500) {
          console.error(`[Gemini] ${model} non-retryable ${response.status}:`, errorText.substring(0, 200));
          throw lastError;
        }

        // Retryable (429/5xx): backoff and retry same model
        const retryMatch = errorText.match(/retryDelay.*?(\d+)/);
        const backoff = retryMatch ? Math.min(parseInt(retryMatch[1], 10) * 1000, 10000) : RETRY_BACKOFF_MS * attempt;
        console.warn(`[Gemini] ${model} ${response.status}, retry ${attempt}/${MAX_RETRIES_PER_MODEL} in ${backoff}ms`);
        await sleep(backoff);
      } catch (err) {
        // Timeout or network error
        if (err instanceof Error && err.name === 'TimeoutError') {
          console.warn(`[Gemini] ${model} timed out after ${GEMINI_TIMEOUT_MS}ms, attempt ${attempt}`);
          lastError = new Error(`Gemini ${model}: timeout`);
        } else if (lastError === null || !(err instanceof Error && err.message.includes('Gemini'))) {
          lastError = err instanceof Error ? err : new Error(String(err));
        }
        // On timeout, try next attempt or next model
      }
    }
  }

  throw lastError || new Error(`Gemini API failed after all models exhausted`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildModelCandidates(configuredModel: string): string[] {
  return [...new Set([
    configuredModel,
    'gemini-2.5-flash',
  ].filter(Boolean))];
}

function shouldTryNextModel(status: number, errorText: string): boolean {
  if (status === 404) return true;
  if (status === 400 && /not found|unsupported|deprecated|legacy/i.test(errorText)) return true;
  if (status === 429 && /limit:\s*0|quota exceeded|free_tier|RESOURCE_EXHAUSTED/i.test(errorText)) return true;
  return false;
}

export async function batchAnalyze(
  tickets: Array<{ ticketId: string; messagesJson: string; category?: string; tags?: string; customerHistory?: CustomerTicketHistory[]; auditMemories?: AuditMemoryRecord[] }>,
  maxConcurrent = DEFAULT_BATCH_CONCURRENCY
): Promise<Map<string, QAAnalysis | Error>> {
  const results = new Map<string, QAAnalysis | Error>();
  const concurrency = Math.max(1, maxConcurrent);

  for (let index = 0; index < tickets.length; index += concurrency) {
    const chunk = tickets.slice(index, index + concurrency);
    const chunkResults = await Promise.all(chunk.map(async (ticket) => {
      try {
        const analysis = await analyzeTicket(
          ticket.ticketId,
          ticket.messagesJson,
          ticket.category,
          ticket.tags,
          ticket.customerHistory,
          ticket.auditMemories
        );
        return [ticket.ticketId, analysis] as const;
      } catch (error) {
        return [ticket.ticketId, error as Error] as const;
      }
    }));

    chunkResults.forEach(([ticketId, result]) => {
      results.set(ticketId, result);
    });

    if (index + concurrency < tickets.length) {
      await sleep(INTER_BATCH_DELAY_MS);
    }
  }

  return results;
}
