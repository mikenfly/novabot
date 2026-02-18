/**
 * OpenAI TTS (Text-to-Speech) and STT (Speech-to-Text) via Whisper.
 *
 * Requires OPENAI_API_KEY in .env.
 */

import fs from 'fs';
import path from 'path';
import { logger } from './logger.js';

const OPENAI_API_URL = 'https://api.openai.com/v1';

function getApiKey(): string {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('OPENAI_API_KEY is not set in .env');
  return key;
}

/**
 * Transcribe an audio file using OpenAI Whisper.
 * Returns the transcribed text.
 */
export async function transcribeAudio(audioFilePath: string): Promise<string> {
  const apiKey = getApiKey();

  const form = new FormData();
  const audioBuffer = fs.readFileSync(audioFilePath);
  const ext = path.extname(audioFilePath).slice(1) || 'webm';
  const blob = new Blob([audioBuffer], { type: `audio/${ext}` });
  form.append('file', blob, `audio.${ext}`);
  form.append('model', 'whisper-1');

  const response = await fetch(`${OPENAI_API_URL}/audio/transcriptions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });

  if (!response.ok) {
    const error = await response.text();
    logger.error({ status: response.status, error }, 'Whisper transcription failed');
    throw new Error(`Whisper API error: ${response.status} ${error}`);
  }

  const result = (await response.json()) as { text: string };
  return result.text;
}

/**
 * Generate speech from text using OpenAI TTS.
 * Returns the path to the generated audio file.
 */
export async function generateSpeech(
  text: string,
  outputPath: string,
  voice: string = 'alloy',
): Promise<string> {
  const apiKey = getApiKey();

  const response = await fetch(`${OPENAI_API_URL}/audio/speech`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'tts-1',
      input: text,
      voice,
      response_format: 'mp3',
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    logger.error({ status: response.status, error }, 'TTS generation failed');
    throw new Error(`TTS API error: ${response.status} ${error}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, Buffer.from(arrayBuffer));

  return outputPath;
}
