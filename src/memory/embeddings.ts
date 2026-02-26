const OPENAI_EMBEDDING_MODEL = 'text-embedding-3-small';
const OPENAI_EMBEDDING_URL = 'https://api.openai.com/v1/embeddings';

const TIMEOUT_MS = 10_000; // 10s per attempt
const MAX_RETRIES = 2; // 3 attempts total
const BACKOFF_BASE_MS = 1000; // 1s, 2s, 4s

function embeddingLog(msg: string): void {
  const ts = new Date().toISOString().slice(11, 23);
  console.log(`[${ts}] [embedding] ${msg}`);
}

export async function generateEmbedding(
  text: string,
): Promise<Float32Array> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY not set — required for memory embeddings');
  }

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const backoffMs = BACKOFF_BASE_MS * Math.pow(2, attempt - 1);
      embeddingLog(`Retry ${attempt}/${MAX_RETRIES} after ${backoffMs}ms backoff`);
      await new Promise(r => setTimeout(r, backoffMs));
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const response = await fetch(OPENAI_EMBEDDING_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: OPENAI_EMBEDDING_MODEL,
          input: text,
        }),
        signal: controller.signal,
      });

      if (response.ok) {
        const json = (await response.json()) as {
          data: Array<{ embedding: number[] }>;
        };
        return new Float32Array(json.data[0].embedding);
      }

      // Rate limit (429) or server error (5xx) → retry
      if (response.status === 429 || response.status >= 500) {
        const body = await response.text().catch(() => '');
        lastError = new Error(`OpenAI ${response.status}: ${body.slice(0, 200)}`);
        embeddingLog(`${response.status} error (attempt ${attempt + 1}/${MAX_RETRIES + 1}): ${body.slice(0, 100)}`);
        continue;
      }

      // Client error (4xx except 429) → fail immediately
      const body = await response.text();
      throw new Error(`OpenAI embedding failed (${response.status}): ${body}`);
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        lastError = new Error(`OpenAI embedding timeout after ${TIMEOUT_MS}ms`);
        embeddingLog(`Timeout (attempt ${attempt + 1}/${MAX_RETRIES + 1})`);
        continue;
      }
      // Network error → retry
      if (err instanceof TypeError && (err as any).cause) {
        lastError = err;
        embeddingLog(`Network error (attempt ${attempt + 1}/${MAX_RETRIES + 1}): ${err.message}`);
        continue;
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError || new Error('OpenAI embedding failed after retries');
}

export function embeddingToBuffer(embedding: Float32Array): Buffer {
  return Buffer.from(embedding.buffer, embedding.byteOffset, embedding.byteLength);
}
