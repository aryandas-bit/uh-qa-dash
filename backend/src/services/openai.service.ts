import OpenAI from 'openai';
import { findMatchingSOP } from './sop.service.js';

// Lazy initialization of OpenAI client
let openai: OpenAI | null = null;

function getOpenAI(): OpenAI {
  if (!openai) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY environment variable is not set');
    }
    openai = new OpenAI({ apiKey });
  }
  return openai;
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
  suggestions: string[];
  summary: string;
}

const ANALYSIS_PROMPT = `You are a QA analyst for Ultrahuman customer support. Analyze this support conversation and score it.

## Scoring Rubric (100 points starting score):
- Issue with opening (-15 points): Missing greeting, unprofessional start, no acknowledgment of customer
- Response Quality Issue (-50 points): Wrong information, missed SOP steps, incomplete solution, didn't address the issue
- Grammatical Mistakes/AI-authorship artifacts (-20 points): Spelling errors, grammar issues, robotic/templated language, awkward phrasing
- Closing (-15 points): No proper sign-off, missing next steps, no follow-up offer
- Fatal/Intent (-100 points = 0 total): Rude behavior, completely wrong advice, policy violation, unprofessional conduct

## Relevant SOP for this ticket:
{sopContent}

## Conversation:
{messages}

Analyze the conversation and respond ONLY with valid JSON in this exact format:
{
  "qaScore": <number 0-100>,
  "deductions": [
    { "category": "<opening|quality|grammar|closing|fatal>", "points": <negative number>, "reason": "<specific reason>" }
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
  "suggestions": ["<specific improvement suggestion>"],
  "summary": "<2-3 sentence summary of the interaction quality>"
}`;

export async function analyzeTicket(
  ticketId: string,
  messagesJson: string,
  category?: string,
  tags?: string
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

  // Build the prompt
  const prompt = ANALYSIS_PROMPT
    .replace('{sopContent}', sopContent)
    .replace('{messages}', formattedMessages);

  try {
    const response = await getOpenAI().chat.completions.create({
      model: 'gpt-4-turbo-preview',
      messages: [
        {
          role: 'system',
          content: 'You are a QA analyst. Respond ONLY with valid JSON, no other text.'
        },
        { role: 'user', content: prompt }
      ],
      response_format: { type: 'json_object' },
      temperature: 0.3,
      max_tokens: 1500
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error('Empty response from OpenAI');
    }

    const analysis = JSON.parse(content) as QAAnalysis;
    analysis.sopCompliance.matchedSOP = matchedSOP;

    return analysis;
  } catch (error) {
    console.error('OpenAI analysis error:', error);
    throw new Error('Failed to analyze ticket with AI');
  }
}

function formatMessagesForPrompt(messages: any[]): string {
  if (!messages || messages.length === 0) {
    return 'No messages available for analysis.';
  }

  return messages.map((msg, idx) => {
    const sender = msg.sender_type || msg.type || 'unknown';
    const content = msg.message || msg.content || msg.text || '';
    const timestamp = msg.created_at || msg.timestamp || '';

    return `[${idx + 1}] ${sender.toUpperCase()}: ${content}${timestamp ? ` (${timestamp})` : ''}`;
  }).join('\n\n');
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
  tickets: Array<{ ticketId: string; messagesJson: string; category?: string; tags?: string }>,
  maxConcurrent = 5
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
          ticket.tags
        );
        results.set(ticket.ticketId, analysis);
      } catch (error) {
        results.set(ticket.ticketId, error as Error);
      }
    });

    await Promise.all(promises);

    // Small delay between chunks to avoid rate limits
    if (chunks.indexOf(chunk) < chunks.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  return results;
}
