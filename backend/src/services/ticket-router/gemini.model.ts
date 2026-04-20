import type { ModelCaller, ModelCallOptions } from './types.js';
import { logger } from './logger.js';

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const DEFAULT_GEMINI_MODEL = process.env.GEMINI_MODEL?.trim() || 'gemini-2.5-flash';

export function createGeminiCaller(apiKey?: string): ModelCaller {
  const key = apiKey ?? process.env.GEMINI_API_KEY ?? '';

  return {
    modelName: 'gemini',

    async call({ prompt, timeoutMs, maxRetries }: ModelCallOptions): Promise<string> {
      if (!key) throw new Error('GEMINI_API_KEY is not set');
      let lastError: Error | null = null;

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);

        try {
          const response = await fetch(
            `${GEMINI_API_BASE}/${DEFAULT_GEMINI_MODEL}:generateContent`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'X-goog-api-key': key,
              },
              body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: { temperature: 0.2, maxOutputTokens: 1024 },
              }),
              signal: controller.signal,
            },
          );
          clearTimeout(timer);

          if (response.ok) {
            const data = await response.json() as {
              candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
            };
            return data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
          }

          const errText = await response.text();
          lastError = new Error(`Gemini HTTP ${response.status}: ${errText.slice(0, 200)}`);

          const isRetryable = response.status === 429 || response.status >= 500;
          if (!isRetryable) throw lastError;
          if (attempt < maxRetries) {
            logger.warn('model.retry', { model: 'gemini', attempt, status: response.status });
            await sleep(500 * attempt);
          }
        } catch (err: any) {
          clearTimeout(timer);
          if (err.name === 'AbortError') {
            lastError = new Error(`Gemini timed out after ${timeoutMs}ms (attempt ${attempt}/${maxRetries})`);
            logger.warn('model.timeout', { model: 'gemini', attempt, timeoutMs });
            if (attempt < maxRetries) await sleep(500);
          } else {
            throw err;
          }
        }
      }

      throw lastError ?? new Error('Gemini failed after max retries');
    },
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
