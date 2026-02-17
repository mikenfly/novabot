const OPENAI_EMBEDDING_MODEL = 'text-embedding-3-small';
const OPENAI_EMBEDDING_URL = 'https://api.openai.com/v1/embeddings';

export async function generateEmbedding(
  text: string,
): Promise<Float32Array> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY not set — required for memory embeddings');
  }

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
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `OpenAI embedding failed (${response.status}): ${body}`,
    );
  }

  const json = (await response.json()) as {
    data: Array<{ embedding: number[] }>;
  };

  const values = json.data[0].embedding;
  return new Float32Array(values);
}

export function embeddingToBuffer(embedding: Float32Array): Buffer {
  return Buffer.from(embedding.buffer, embedding.byteOffset, embedding.byteLength);
}
