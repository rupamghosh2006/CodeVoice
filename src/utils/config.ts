import * as dns from 'node:dns';
dns.setDefaultResultOrder('ipv4first');

import * as path from 'path';
import { resolveApiKey } from './userConfig';

function optional_env(key: string, fallback: string): string {
  return (process.env[key] ?? fallback).trim();
}

function getResolvedKey(service: 'assemblyai' | 'gemini'): string {
  const envVar = service === 'assemblyai' ? 'ASSEMBLYAI_API_KEY' : 'GEMINI_API_KEY';
  const fromEnv = process.env[envVar]?.trim();
  if (fromEnv) return fromEnv;

  const resolved = resolveApiKey(service);
  if (resolved.key) {
    process.env[envVar] = resolved.key;
    return resolved.key;
  }
  return '';
}

export const config = {
  get assemblyai() {
    return {
      get apiKey(): string {
        const key = getResolvedKey('assemblyai');
        if (!key) {
          throw new Error('Missing AssemblyAI API key. Set ASSEMBLYAI_API_KEY or run `codevoice config set assemblyai <key>`.');
        }
        return key;
      },
      wsUrl: optional_env('ASSEMBLYAI_WS_URL', 'wss://streaming.assemblyai.com/v3/ws'),
      betaUrl: optional_env('ASSEMBLYAI_BETA_URL', 'https://dictation.assemblyai.com/transcribe'),
      mode: optional_env('ASSEMBLYAI_MODE', 'balanced') as 'min_latency' | 'balanced' | 'max_accuracy',
      speechModel: optional_env('ASSEMBLYAI_SPEECH_MODEL', 'universal-3-5-pro'),
    };
  },
  get gemini() {
    return {
      get apiKey(): string {
        const key = getResolvedKey('gemini');
        if (!key) {
          throw new Error('Missing Gemini API key. Set GEMINI_API_KEY or run `codevoice config set gemini <key>`.');
        }
        return key;
      },
      model: optional_env('GEMINI_MODEL', 'gemini-3.7-flash'),
    };
  },
  get app() {
    return {
      port: parseInt(optional_env('PORT', '3000'), 10),
      targetFile: path.resolve(optional_env('TARGET_FILE', './demo/sample.ts')),
      gitCwd: path.resolve(optional_env('GIT_CWD', '.')),
    };
  },
};
