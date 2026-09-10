import * as dns from 'node:dns';
dns.setDefaultResultOrder('ipv4first');

import * as fs from 'fs/promises';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { config } from '../utils/config';
import { logger } from '../utils/logger';
import type { CodeIntent } from '../intent/schema';

const genAI = new GoogleGenerativeAI(config.gemini.apiKey);

const CODE_SYSTEM_PROMPT = `You are a TypeScript/Node.js expert coding assistant integrated into CodeVoice.
You receive:
1. A voice instruction (already classified as a code task)
2. The current content of the target file

Your job:
- For code_generation: write new TypeScript code and APPEND it after the existing content
- For code_edit: modify the existing code as instructed, return the FULL updated file
- For code_explain: return a concise explanation (do NOT modify the file)

RULES:
- Output ONLY raw TypeScript code (no markdown fences, no explanation) for generation/edit tasks
- For explain tasks, output plain English explanation only
- Follow TypeScript best practices: typed params, return types, error handling
- Use async/await, not callbacks
- Export all top-level functions
- Keep code concise and production-quality`;

const model = genAI.getGenerativeModel({
  model: config.gemini.model,
  systemInstruction: CODE_SYSTEM_PROMPT,
  generationConfig: {
    temperature: 0.2,
    maxOutputTokens: 2048,
  },
});

export interface CodeAgentResult {
  /** What operation was performed */
  operation: CodeIntent['type'];
  /** The target file path */
  targetFile: string;
  /** Short summary of what was done (for CLI one-line confirmation) */
  summary: string;
  /** The generated/edited code (or explanation for code_explain) */
  output: string;
  /** Previous file content (for diff display) */
  previousContent?: string;
}

/**
 * Handles code generation, editing, and explanation.
 * For generation/edit: reads the target file, runs LLM, writes back directly to disk.
 * For explain: reads the file, returns explanation without writing.
 */
export async function handleCodeIntent(
  intent: CodeIntent,
  targetFile: string = config.app.targetFile
): Promise<CodeAgentResult> {
  logger.info(`Code agent: ${intent.type} on "${targetFile}" — "${intent.instruction}"`);

  // Read current file content
  let currentContent = '';
  try {
    currentContent = await fs.readFile(targetFile, 'utf-8');
  } catch {
    // File doesn't exist yet — start fresh
    currentContent = '';
  }

  const prompt = buildPrompt(intent, currentContent);
  logger.debug('Sending to Gemini:', prompt.substring(0, 200) + '...');

  let result;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      result = await model.generateContent(prompt);
      break;
    } catch (err: any) {
      if ((err?.status === 429 || String(err).includes('429')) && attempt < 3) {
        const wait = attempt * 3000;
        logger.warn(`Rate limit hit in code agent, retrying in ${wait}ms...`);
        await new Promise((r) => setTimeout(r, wait));
      } else {
        throw err;
      }
    }
  }
  const output = result!.response.text().trim();

  // Strip accidental markdown fences if returned
  const cleanedOutput = output
    .replace(/^```[a-z]*\n/i, '')
    .replace(/\n```$/i, '');

  if (intent.type === 'code_explain') {
    return {
      operation: intent.type,
      targetFile,
      summary: `explained: ${intent.instruction}`,
      output: cleanedOutput,
      previousContent: currentContent,
    };
  }

  // Write the new content back to the file
  let newContent: string;
  if (intent.type === 'code_generation') {
    // Append new code after existing content
    const separator = currentContent.trim() ? '\n\n' : '';
    newContent = currentContent + separator + cleanedOutput;
  } else {
    // code_edit: LLM returns the full updated file
    newContent = cleanedOutput;
  }

  await fs.writeFile(targetFile, newContent, 'utf-8');
  logger.info(`File written: ${targetFile}`);

  const summary = intent.instruction.length > 50
    ? intent.instruction.substring(0, 47) + '...'
    : intent.instruction;

  return {
    operation: intent.type,
    targetFile,
    summary,
    output: newContent,
    previousContent: currentContent,
  };
}

function buildPrompt(intent: CodeIntent, currentContent: string): string {
  const fileSection = currentContent.trim()
    ? `CURRENT FILE CONTENT:\n\`\`\`typescript\n${currentContent}\n\`\`\``
    : 'CURRENT FILE CONTENT: (empty)';

  return `${fileSection}

INSTRUCTION: ${intent.instruction}

Task type: ${intent.type}`;
}
