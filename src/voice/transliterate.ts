import * as dns from 'node:dns';
dns.setDefaultResultOrder('ipv4first');

import { GoogleGenerativeAI } from '@google/generative-ai';
import { config } from '../utils/config';
import { logger } from '../utils/logger';

const TRANSLITERATE_SYSTEM_PROMPT = `You are a specialized transliteration engine for CodeVoice, a voice-driven developer tool.
Your job is to transliterate mixed Hindi/English text written in Devanagari script into natural Roman-script Hinglish, the way Indian developers casually type in chat and code comments (not strict academic phonetic ITRANS-style).

RULES:
1. Keep any English words, function names, variable names, keywords, and technical terms (e.g. useEffect, useState, API, JWT, async, await, Git, branch, commit, checkout, etc.) exactly as-is, unchanged.
2. Convert Hindi words written in Devanagari script into natural Roman-script Hinglish (e.g. "एक फंक्शन बनाओ" -> "ek function banao", "नयी branch बनाओ" -> "nayi branch banao", "गिट स्टेटस दिखाओ" -> "git status dikhao", "हटा दो" -> "hata do", "कोड एक्सप्लेन करो" -> "code explain karo").
3. Preserve punctuation, casing of code identifiers, and numbers.
4. Return ONLY the transliterated text. Do NOT add quotes, markdown formatting, explanations, or notes.`;

export interface TransliterationResult {
  /** The transliterated Roman text (or original if not transliterated) */
  text: string;
  /** The original input transcript */
  original: string;
  /** Whether transliteration was performed */
  transliterated: boolean;
  /** Latency in milliseconds (0 if transliteration was skipped) */
  latencyMs: number;
}

/**
 * Checks whether a string contains any Devanagari Unicode characters (\u0900–\u097F).
 */
export function hasDevanagari(text: string): boolean {
  return /[\u0900-\u097F]/.test(text);
}

let _transliterateModel: ReturnType<GoogleGenerativeAI['getGenerativeModel']> | null = null;
function getTransliterateModel() {
  if (!_transliterateModel) {
    const genAI = new GoogleGenerativeAI(config.gemini.apiKey);
    _transliterateModel = genAI.getGenerativeModel({
      model: config.gemini.model,
      systemInstruction: TRANSLITERATE_SYSTEM_PROMPT,
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 512,
      },
    });
  }
  return _transliterateModel;
}

/**
 * Transliterates Devanagari text into natural Roman-script Hinglish via Gemini.
 * Only calls Gemini if Devanagari characters (\u0900–\u097F) are present.
 * If pure English / Roman script, skips LLM call entirely with 0ms added latency.
 */
export async function transliterateIfNeeded(text: string): Promise<TransliterationResult> {
  const trimmed = text.trim();
  if (!trimmed || !hasDevanagari(trimmed)) {
    return {
      text: trimmed,
      original: trimmed,
      transliterated: false,
      latencyMs: 0,
    };
  }

  const startTime = Date.now();
  let result;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      result = await getTransliterateModel().generateContent(trimmed);
      break;
    } catch (err: any) {
      if ((err?.status === 429 || err?.status === 503 || String(err).includes('429') || String(err).includes('503')) && attempt < 4) {
        let wait = attempt * 3000;
        if (Array.isArray(err?.errorDetails)) {
          for (const d of err.errorDetails) {
            if (d?.retryDelay) {
              const sec = parseFloat(d.retryDelay);
              if (!isNaN(sec)) wait = Math.max(wait, Math.ceil(sec * 1000) + 1000);
            }
          }
        }
        logger.warn(`API backoff in transliterator (${err?.status || 'rate-limited'}), retrying in ${Math.round(wait / 1000)}s...`);
        await new Promise((r) => setTimeout(r, wait));
      } else {
        throw err;
      }
    }
  }

  const rawOutput = result!.response.text().trim();
  // Strip any accidental markdown formatting or surrounding quotes
  const cleaned = rawOutput
    .replace(/^```[a-z]*\n?/i, '')
    .replace(/\n?```$/i, '')
    .replace(/^["'`]+|["'`]+$/g, '')
    .trim();

  const latencyMs = Date.now() - startTime;
  logger.info(`Transliterated Devanagari [${latencyMs}ms]: "${trimmed}" → "${cleaned}"`);

  return {
    text: cleaned || trimmed,
    original: trimmed,
    transliterated: true,
    latencyMs,
  };
}
