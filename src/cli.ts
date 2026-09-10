import * as dns from 'node:dns';
dns.setDefaultResultOrder('ipv4first');

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as readline from 'node:readline/promises';
import pc from 'picocolors';

import { config } from './utils/config';
import { logger } from './utils/logger';
import { MicCapture } from './voice/capture';
import { StreamingClient } from './voice/streaming';
import { routeIntent, UnknownIntentError, DestructiveIntentError } from './intent/router';
import { isCodeIntent, isGitIntent, isFileSwitchIntent } from './intent/schema';
import { handleCodeIntent } from './agents/codeAgent';
import { executeGit, resolveGitArgs } from './agents/gitAgent';

// ── CLI Options & Active State ────────────────────────────────────────────────

function parseActiveFile(): string {
  const args = process.argv.slice(2);
  const fileIndex = args.indexOf('--file');
  if (fileIndex !== -1 && args[fileIndex + 1]) {
    return path.resolve(args[fileIndex + 1]);
  }
  return config.app.targetFile;
}

let activeFile = parseActiveFile();
let isProcessing = false;

// ── Banner ───────────────────────────────────────────────────────────────────

function printBanner(): void {
  console.clear();
  console.log(pc.bold(pc.magenta('╔══════════════════════════════════════════════════════════════╗')));
  console.log(pc.bold(pc.magenta('║  🎙️  CodeVoice — Multilingual Voice Interface for Developers  ║')));
  console.log(pc.bold(pc.magenta('╚══════════════════════════════════════════════════════════════╝')));
  console.log();
  console.log(pc.cyan('  📄 Active File : ') + pc.bold(path.relative(process.cwd(), activeFile)));
  console.log(pc.cyan('  🌐 Engine      : ') + 'AssemblyAI universal-3-5-pro (Streaming)');
  console.log(pc.cyan('  🧠 LLM Router  : ') + `Gemini (${config.gemini.model})`);
  console.log(pc.cyan('  🗣️  Languages   : ') + 'English, Hindi, Hinglish (code-switched)');
  console.log(pc.dim('  ──────────────────────────────────────────────────────────────'));
  console.log(pc.dim('  Tips: Speak naturally into mic. Generated code writes to disk.'));
  console.log(pc.dim('  Commands: "Ek email validator banao", "Git status dikhao", etc.'));
  console.log(pc.dim('  Press Ctrl+C anytime to stop.'));
  console.log();
}

// ── Interactive Destructive Confirmation ──────────────────────────────────────

async function confirmDestructiveAction(keyword: string, rawText: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log();
  console.log(pc.bold(pc.yellow(`  ⚠️  Destructive action detected (${keyword}):`)));
  console.log(pc.dim(`     "${rawText}"`));

  try {
    const answer = await rl.question(pc.bold(pc.red('  ❓ Are you sure you want to execute this? (y/N): ')));
    rl.close();
    return answer.trim().toLowerCase() === 'y' || answer.trim().toLowerCase() === 'yes';
  } catch {
    rl.close();
    return false;
  }
}

// ── Main CLI Runner ──────────────────────────────────────────────────────────

async function main(): Promise<void> {
  printBanner();

  // Ensure active file directory exists
  const activeDir = path.dirname(activeFile);
  if (!fs.existsSync(activeDir)) {
    fs.mkdirSync(activeDir, { recursive: true });
  }
  if (!fs.existsSync(activeFile)) {
    fs.writeFileSync(activeFile, '// CodeVoice target file\n', 'utf-8');
  }

  const mic = new MicCapture({ sampleRate: 16000, channels: 1 });
  const streaming = new StreamingClient();

  // ── AssemblyAI Streaming Handlers ──────────────────────────────────────────

  streaming.on('ready', () => {
    process.stdout.write(pc.green('  ● 🎙️  Listening continuously... (Speak now)\n\n'));
    mic.start();
  });

  streaming.on('transcript', async (event) => {
    // 1. Partial updates (streamed live in-place)
    if (!event.isFinal) {
      const partialText = event.text.trim();
      if (partialText) {
        process.stdout.write(`\r  ${pc.blue('●')} ${pc.dim(partialText.substring(0, 90))} \x1b[K`);
      }
      return;
    }

    // 2. Final turn (end_of_turn = true)
    const finalText = event.text.trim();
    if (!finalText) return;

    // Clear partial line
    process.stdout.write('\r\x1b[K');

    const langBadge = event.language ? pc.yellow(`[${event.language}] `) : '';
    console.log(`  ${pc.magenta('📝')} ${langBadge}${pc.bold(finalText)}`);

    // Show filler word removal demo if raw text differed
    if (event.rawText && event.rawText.trim() !== finalText) {
      console.log(`     ${pc.dim(`↳ Raw (disfluent): "${event.rawText.trim()}"`)}`);
    }

    // Avoid parallel concurrent intent executions
    if (isProcessing) return;
    isProcessing = true;

    try {
      // 3. Route Intent via Gemini
      const intent = await routeIntent(finalText);

      // 4. Dispatch Intent
      if (isFileSwitchIntent(intent)) {
        const resolvedPath = path.resolve(intent.path);
        activeFile = resolvedPath;
        if (!fs.existsSync(activeFile)) {
          fs.writeFileSync(activeFile, '// CodeVoice target file\n', 'utf-8');
        }
        console.log(`  ${pc.cyan('📂')} Active file set to: ${pc.bold(path.relative(process.cwd(), activeFile))}`);
      } else if (isCodeIntent(intent)) {
        process.stdout.write(`  ${pc.dim('⚙️  Writing code to ' + path.basename(activeFile) + '...')}\r`);
        const result = await handleCodeIntent(intent, activeFile);
        process.stdout.write('\r\x1b[K');
        const relPath = path.relative(process.cwd(), result.targetFile);
        console.log(`  ${pc.green('✓')} updated ${pc.bold(relPath)} ${pc.dim(`(${result.summary})`)}`);
      } else if (isGitIntent(intent)) {
        // Echo git command
        const args = resolveGitArgs(intent);
        const cmdString = `git ${args.join(' ')}`;
        console.log(`  ${pc.cyan('$')} ${pc.bold(cmdString)}`);

        // Execute allowlisted git command
        const result = await executeGit(intent);
        if (result.output) {
          const lines = result.output.split('\n');
          for (const line of lines) {
            console.log(`    ${pc.dim(line)}`);
          }
        }
        if (!result.success) {
          console.log(`  ${pc.red('✗')} Git command failed.`);
        }
      }
    } catch (err: any) {
      if (err instanceof DestructiveIntentError) {
        // Pause mic during confirmation prompt
        mic.stop();
        const confirmed = await confirmDestructiveAction(err.matchedKeyword, err.rawTranscript);
        if (confirmed) {
          console.log(pc.yellow('  ⚡ Executing confirmed destructive action...'));
          try {
            const intent = await routeIntent(err.rawTranscript);
            if (isGitIntent(intent)) {
              const result = await executeGit(intent);
              if (result.output) console.log(pc.dim(result.output));
            }
          } catch (execErr: any) {
            console.log(pc.red(`  ✗ ${execErr?.message ?? execErr}`));
          }
        } else {
          console.log(pc.dim('  🛡️  Action cancelled by user.'));
        }
        // Resume mic
        mic.start();
      } else if (err instanceof UnknownIntentError) {
        console.log(`  ${pc.dim(`❓ Couldn't route intent: "${err.rawTranscript}"`)}`);
      } else {
        logger.error('Pipeline error:', err?.message ?? err);
      }
    } finally {
      isProcessing = false;
      console.log();
    }
  });

  mic.on('audio', (chunk: Buffer) => {
    streaming.sendAudio(chunk);
  });

  mic.on('error', (err) => {
    console.error(pc.red(`\n  ❌ Microphone Error: ${err.message}`));
    console.error(pc.dim('  Ensure SoX is installed (choco install sox.portable or brew install sox)\n'));
    process.exit(1);
  });

  streaming.on('error', (err) => {
    console.error(pc.red(`\n  ❌ Streaming Error: ${err.message}`));
  });

  // ── Graceful Shutdown ───────────────────────────────────────────────────────

  let isClosing = false;
  const shutdown = async () => {
    if (isClosing) return;
    isClosing = true;
    console.log(pc.yellow('\n\n  ⏹️  Stopping CodeVoice...'));
    mic.stop();
    streaming.terminate();
    await new Promise((r) => setTimeout(r, 600));
    console.log(pc.green('  👋 Goodbye!\n'));
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Connect to AssemblyAI WebSocket
  streaming.connect();
}

main().catch((err) => {
  console.error(pc.red('Fatal:'), err);
  process.exit(1);
});
