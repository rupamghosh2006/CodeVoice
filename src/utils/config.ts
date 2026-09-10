import * as dns from 'node:dns';
dns.setDefaultResultOrder('ipv4first');

import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.join(process.cwd(), '.env') });

function require_env(key: string): string {
  const val = process.env[key];
  if (!val || val.trim() === '') {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return val.trim();
}

function optional_env(key: string, fallback: string): string {
  return (process.env[key] ?? fallback).trim();
}

export const config = {
  assemblyai: {
    apiKey: require_env('ASSEMBLYAI_API_KEY'),
    wsUrl: optional_env('ASSEMBLYAI_WS_URL', 'wss://streaming.assemblyai.com/v3/ws'),
    betaUrl: optional_env('ASSEMBLYAI_BETA_URL', 'https://dictation.assemblyai.com/transcribe'),
    mode: optional_env('ASSEMBLYAI_MODE', 'balanced') as 'min_latency' | 'balanced' | 'max_accuracy',
    speechModel: optional_env('ASSEMBLYAI_SPEECH_MODEL', 'universal-3-5-pro'),
  },
  gemini: {
    apiKey: require_env('GEMINI_API_KEY'),
    model: optional_env('GEMINI_MODEL', 'gemini-3.6-flash'),
  },
  app: {
    port: parseInt(optional_env('PORT', '3000'), 10),
    targetFile: path.resolve(optional_env('TARGET_FILE', './demo/sample.ts')),
    gitCwd: path.resolve(optional_env('GIT_CWD', '.')),
  },
} as const;
