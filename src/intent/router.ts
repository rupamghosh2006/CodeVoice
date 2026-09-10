import * as dns from 'node:dns';
dns.setDefaultResultOrder('ipv4first');

import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';
import { config } from '../utils/config';
import { logger } from '../utils/logger';
import type { Intent } from './schema';
import { DESTRUCTIVE_KEYWORDS } from './schema';

const genAI = new GoogleGenerativeAI(config.gemini.apiKey);

const SYSTEM_PROMPT = `You are an intent router for CodeVoice, a voice-driven developer tool.
Your job: classify a developer voice command into a structured JSON intent.

RULES:
1. Return ONLY valid JSON matching the schema — no explanation, no markdown.
2. The developer may speak in English, Hindi, Hinglish (Hindi+English mixed), or any combination.
3. Preserve technical identifiers exactly: useEffect, useState, JWT, API, async, await, etc.
4. If the command is ambiguous between code and git, pick the most likely one.
5. If you truly cannot classify, return {"type":"unknown","instruction":"<raw text>"}.

EXAMPLES:
- "Create a function that validates email" → {"type":"code_generation","instruction":"Create a function that validates email"}
- "Ek email validator function banao" → {"type":"code_generation","instruction":"Create an email validator function"}
- "useEffect ke andar ek API call add karo" → {"type":"code_edit","instruction":"Add an API call inside useEffect"}
- "Yeh function kya karta hai" → {"type":"code_explain","instruction":"Explain this function"}
- "Nayi branch banao feature-login" → {"type":"git_branch","name":"feature-login"}
- "Commit karo add email validation" → {"type":"git_commit","message":"add email validation"}
- "Git status dikhao" → {"type":"git_status"}
- "Diff dikhao" → {"type":"git_diff"}
- "Git log dikhao" → {"type":"git_log"}
- "Sab files add karo" → {"type":"git_add"}
- "Checkout main" → {"type":"git_checkout","branch":"main"}
- "Switch to demo/sample.ts" → {"type":"file_switch","path":"demo/sample.ts"}
- "Open auth file" → {"type":"file_switch","path":"src/auth.ts"}
- "File badlo demo/sample.ts" → {"type":"file_switch","path":"demo/sample.ts"}`;

// Gemini response schema for structured output
const INTENT_SCHEMA = {
  type: SchemaType.OBJECT,
  properties: {
    type: {
      type: SchemaType.STRING,
      enum: [
        'code_generation',
        'code_edit',
        'code_explain',
        'git_branch',
        'git_commit',
        'git_status',
        'git_diff',
        'git_log',
        'git_add',
        'git_checkout',
        'file_switch',
        'unknown',
      ],
    },
    instruction: { type: SchemaType.STRING },
    name: { type: SchemaType.STRING },
    message: { type: SchemaType.STRING },
    branch: { type: SchemaType.STRING },
    path: { type: SchemaType.STRING },
  },
  required: ['type'],
};

const model = genAI.getGenerativeModel({
  model: config.gemini.model,
  systemInstruction: SYSTEM_PROMPT,
  generationConfig: {
    responseMimeType: 'application/json',
    responseSchema: INTENT_SCHEMA as any,
    temperature: 0.1,
    maxOutputTokens: 1024,
  },
});

export class UnknownIntentError extends Error {
  constructor(public readonly rawTranscript: string) {
    super(`Could not classify: "${rawTranscript}"`);
    this.name = 'UnknownIntentError';
  }
}

export class DestructiveIntentError extends Error {
  constructor(public readonly rawTranscript: string, public readonly matchedKeyword: string) {
    super(`Destructive intent detected ("${matchedKeyword}") in: "${rawTranscript}"`);
    this.name = 'DestructiveIntentError';
  }
}

/**
 * Classify a final transcript into a typed Intent.
 * Throws DestructiveIntentError for dangerous-sounding commands.
 * Throws UnknownIntentError if classification fails.
 */
export async function routeIntent(transcript: string): Promise<Intent> {
  logger.debug('Routing intent for:', transcript);

  // Safety gate: check for destructive patterns before even calling the LLM
  const lower = transcript.toLowerCase();
  for (const kw of DESTRUCTIVE_KEYWORDS) {
    if (lower.includes(kw)) {
      throw new DestructiveIntentError(transcript, kw);
    }
  }

  let result;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      result = await model.generateContent(transcript);
      break;
    } catch (err: any) {
      if ((err?.status === 429 || err?.status === 503 || String(err).includes('429') || String(err).includes('503')) && attempt < 4) {
        let wait = attempt * 4000;
        if (Array.isArray(err?.errorDetails)) {
          for (const d of err.errorDetails) {
            if (d?.retryDelay) {
              const sec = parseFloat(d.retryDelay);
              if (!isNaN(sec)) wait = Math.max(wait, Math.ceil(sec * 1000) + 1000);
            }
          }
        }
        logger.warn(`API backoff (${err?.status || 'rate-limited'}), waiting ${Math.round(wait / 1000)}s before retry ${attempt}...`);
        await new Promise((r) => setTimeout(r, wait));
      } else {
        throw err;
      }
    }
  }
  const text = result!.response.text().trim();

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(text);
  } catch {
    logger.error('LLM returned non-JSON:', text);
    throw new UnknownIntentError(transcript);
  }

  if (!parsed['type'] || parsed['type'] === 'unknown') {
    throw new UnknownIntentError(transcript);
  }

  logger.info('Routed intent:', JSON.stringify(parsed));
  return parsed as unknown as Intent;
}
