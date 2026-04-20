import type { ModelCaller, ModelCallOptions } from './types.js';
import { logger } from './logger.js';

const GROQ_API_BASE = 'https://api.groq.com/openai/v1/chat/completions';
const DEFAULT_GROQ_MODEL = process.env.GROQ_MODEL?.trim() || 'llama-3.1-8b-instant';

export function createGrokCaller(apiKey?: string): ModelCaller {
  const key = apiKey ?? process.env.GROQ_API_KEY ?? '';

  return {
    modelName: 'grok',

    async call({ prompt, timeoutMs, maxRetries }: ModelCallOptions): Promise<string> {
      if (!key) throw new Error('GROQ_API_KEY is not set');
      let lastError: Error | null = null;

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);

        try {
          const response = await fetch(GROQ_API_BASE, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${key}`,
            },
            body: JSON.stringify({
              model: DEFAULT_GROQ_MODEL,
              messages: [{ role: 'user', content: prompt }],
              temperature: 0.2,
            }),
            signal: controller.signal,
          });
          clearTimeout(timer);

          if (response.ok) {
            const data = await response.json() as {
              choices: Array<{ message: { content: string } }>;
            };
            return data.choices?.[0]?.message?.content ?? '';
          }

          const errText = await response.text();
          lastError = new Error(`Grok HTTP ${response.status}: ${errText.slice(0, 200)}`);

          const isRetryable = response.status === 429 || response.status >= 500;
          if (!isRetryable) throw lastError;
          if (attempt < maxRetries) {
            logger.warn('model.retry', { model: 'grok', attempt, status: response.status });
            await sleep(500 * attempt);
          }
        } catch (err: any) {
          clearTimeout(timer);
          if (err.name === 'AbortError') {
            lastError = new Error(`Grok timed out after ${timeoutMs}ms (attempt ${attempt}/${maxRetries})`);
            logger.warn('model.timeout', { model: 'grok', attempt, timeoutMs });
            if (attempt < maxRetries) await sleep(500);
          } else {
            throw err;
          }
        }
      }

      throw lastError ?? new Error('Grok failed after max retries');
    },
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
