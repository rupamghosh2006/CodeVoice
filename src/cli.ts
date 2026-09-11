#!/usr/bin/env node
import * as dns from 'node:dns';
dns.setDefaultResultOrder('ipv4first');

import * as fs from 'node:fs';
import * as path from 'node:path';

import { config } from './utils/config';
import { handleConfigCommand, ensureUserConfigInteractive } from './utils/userConfig';
import { logger } from './utils/logger';
import { MicCapture } from './voice/capture';
import { StreamingClient } from './voice/streaming';
import { transliterateIfNeeded } from './voice/transliterate';
import { routeIntent, UnknownIntentError, DestructiveIntentError } from './intent/router';
import {
  isCodeIntent,
  isGitIntent,
  isFileSwitchIntent,
  isFileDeleteIntent,
  isGitBranchDeleteIntent,
  type Intent,
  type GitIntent,
  type GitBranchDeleteIntent,
} from './intent/schema';
import { handleCodeIntent } from './agents/codeAgent';
import { executeGit, resolveGitArgs } from './agents/gitAgent';
import type { CodeVoiceView } from './tui/types';
import { CodeVoiceTui } from './tui/codeVoiceTui';
import { PlainCliView } from './tui/plainView';

// ── CLI Options & Active State ────────────────────────────────────────────────

function parseActiveFile(): string {
  const args = process.argv.slice(2);
  const fileIndex = args.indexOf('--file');
  if (fileIndex !== -1 && args[fileIndex + 1]) {
    return path.resolve(args[fileIndex + 1]);
  }
  return config.app.targetFile;
}

function showHelp(): void {
  console.log(`
CodeVoice — Multilingual voice interface for software development

Usage:
  codevoice [options]
  codevoice config <command>

Options:
  --file <path>    Target file to create/edit with voice commands (default: ./demo/sample.ts)
  --plain          Run in plain CLI output mode (no TUI)
  --debug          Write verbose debug logs to terminal in addition to codevoice.log
  -h, --help       Show help
  -v, --version    Show version

Config Commands:
  codevoice config set assemblyai <key>   Save AssemblyAI API key to config file
  codevoice config set gemini <key>       Save Gemini API key to config file
  codevoice config show                   Show currently configured keys and sources
  codevoice config clear                  Delete global config file (~/.codevoice/config.json)
`);
}

function showVersion(): void {
  try {
    const pkgPath = path.join(__dirname, '../package.json');
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      console.log(`codevoice v${pkg.version || '0.1.0'}`);
      return;
    }
  } catch {}
  console.log('codevoice v0.1.0');
}

let activeFile = '';
let isProcessing = false;
let isMicMuted = false;

// ── Main Entrypoint ──────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const rawArgs = process.argv.slice(2);

  if (rawArgs.includes('--debug')) {
    process.env.CODEVOICE_DEBUG = '1';
  }

  if (rawArgs[0] === 'config') {
    await handleConfigCommand(rawArgs.slice(1));
    return;
  }

  if (rawArgs.includes('--help') || rawArgs.includes('-h') || rawArgs[0] === 'help') {
    showHelp();
    return;
  }

  if (rawArgs.includes('--version') || rawArgs.includes('-v')) {
    showVersion();
    return;
  }

  // Verify or interactively prompt for API keys
  await ensureUserConfigInteractive();

  activeFile = parseActiveFile();

  // Ensure active file directory and target file exist
  const activeDir = path.dirname(activeFile);
  if (!fs.existsSync(activeDir)) {
    fs.mkdirSync(activeDir, { recursive: true });
  }
  if (!fs.existsSync(activeFile)) {
    fs.writeFileSync(activeFile, '// CodeVoice target file\n', 'utf-8');
  }


  const mic = new MicCapture({ sampleRate: 16000, channels: 1 });
  const streaming = new StreamingClient();

  let isClosing = false;
  const shutdown = async () => {
    if (isClosing) return;
    isClosing = true;
    ui.logActivity('SHUTDOWN', 'Terminating CodeVoice session...', 'warning');
    mic.stop();
    streaming.terminate();
    await new Promise((r) => setTimeout(r, 400));
    ui.dispose();
    process.exit(0);
  };

  const isPlain =
    process.env.CODEVOICE_UI === 'plain' ||
    rawArgs.includes('--plain') ||
    (!process.stdout.isTTY && process.env.CODEVOICE_UI !== 'tui');

  const ui: CodeVoiceView = isPlain
    ? new PlainCliView(activeFile)
    : new CodeVoiceTui(activeFile, {
        onMuteToggle: (muted) => {
          isMicMuted = muted;
          if (muted) {
            mic.stop();
          } else {
            mic.start();
          }
        },
        onFileSwitch: (newPath) => {
          activeFile = newPath;
          const targetDir = path.dirname(activeFile);
          if (!fs.existsSync(targetDir)) {
            fs.mkdirSync(targetDir, { recursive: true });
          }
          if (!fs.existsSync(activeFile)) {
            fs.writeFileSync(activeFile, '// CodeVoice target file\n', 'utf-8');
          }
        },
        onQuit: () => {
          shutdown();
        },
      });

  // Initialize UI
  await ui.init();
  ui.setStatus('CONNECTING');
  logger.info(`Initializing CodeVoice (${isPlain ? 'Plain CLI' : 'TUI'})...`);
  logger.info(`Connecting to WebSocket: ${config.assemblyai.wsUrl}`);
  logger.info(`LLM Router model: ${config.gemini.model}`);

  function formatGitNarrativeSummary(intent: GitIntent, output: string): string {
    const trimmed = output.trim();
    const firstLine = trimmed.split('\n')[0]?.trim() ?? '';

    switch (intent.type) {
      case 'git_status': {
        if (trimmed.includes('nothing to commit, working tree clean')) {
          return 'working tree clean';
        }
        const branchMatch = trimmed.match(/On branch (.+)/);
        const branchName = branchMatch ? branchMatch[1] : 'main';
        const modifiedCount = (trimmed.match(/modified:/g) || []).length;
        const untrackedMatch = trimmed.includes('Untracked files:');
        const details: string[] = [];
        if (modifiedCount > 0) details.push(`${modifiedCount} file${modifiedCount > 1 ? 's' : ''} modified`);
        if (untrackedMatch) details.push('untracked files');
        if (details.length === 0) details.push('changes detected');
        return `On branch ${branchName} (${details.join(', ')})`;
      }
      case 'git_commit': {
        const commitMatch = trimmed.match(/\[([^\]]+)\]/);
        if (commitMatch) {
          return `[${commitMatch[1]}] "${intent.message}"`;
        }
        return `"${intent.message}"`;
      }
      case 'git_branch': {
        return `Switched to branch "${intent.name}"`;
      }
      case 'git_branch_delete': {
        return `Deleted branch "${intent.name}"`;
      }
      case 'git_checkout': {
        return `Switched to branch "${intent.branch}"`;
      }
      case 'git_add': {
        return 'Staged all changes';
      }
      case 'git_diff': {
        if (!trimmed) return 'No unstaged changes';
        const filesCount = (trimmed.match(/diff --git/g) || []).length;
        return filesCount > 0 ? `${filesCount} file(s) with diff` : firstLine.substring(0, 60);
      }
      case 'git_log': {
        const commits = trimmed.split('\n').filter(Boolean);
        return `${commits.length} recent commit(s): ${commits[0] ?? ''}`;
      }
      default:
        return firstLine || 'Success';
    }
  }

  // ── Intent Dispatcher ───────────────────────────────────────────────────────

  async function dispatchIntent(intent: Intent): Promise<void> {
    if (isFileSwitchIntent(intent)) {
      const sanitized = intent.path.trim().replace(/\.+$/, '');
      const resolvedPath = path.resolve(sanitized || intent.path);
      activeFile = resolvedPath;
      const targetDir = path.dirname(activeFile);
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }
      if (!fs.existsSync(activeFile)) {
        fs.writeFileSync(activeFile, '// CodeVoice target file\n', 'utf-8');
      }
      ui.setActiveFile(activeFile);
      const rel = path.relative(process.cwd(), activeFile);
      ui.recordAction(`✓  Switched active target to ${rel}`, 'file');
      logger.info(`File switch intent: target set to ${activeFile}`);
    } else if (isFileDeleteIntent(intent)) {
      const sanitized = intent.path.trim().replace(/\.+$/, '');
      const targetToDelete = sanitized === 'current' ? activeFile : path.resolve(sanitized || intent.path);
      const cwd = process.cwd();
      const rel = path.relative(cwd, targetToDelete);
      if (rel.startsWith('..') || (path.isAbsolute(rel) && !targetToDelete.startsWith(cwd))) {
        ui.recordAction(`⚠️  Cannot delete file outside workspace (${targetToDelete})`, 'warning');
        logger.warn(`Security blocked deletion: ${targetToDelete}`);
        return;
      }
      if (!fs.existsSync(targetToDelete)) {
        ui.recordAction(`⚠️  File does not exist: ${rel || targetToDelete}`, 'warning');
        logger.warn(`File does not exist for deletion: ${targetToDelete}`);
        return;
      }
      fs.unlinkSync(targetToDelete);
      ui.recordAction(`✓  Deleted ${rel}`, 'file');
      logger.info(`Deleted file: ${targetToDelete}`);
      if (path.resolve(activeFile) === path.resolve(targetToDelete)) {
        activeFile = config.app.targetFile;
        if (!fs.existsSync(activeFile)) {
          fs.writeFileSync(activeFile, '// CodeVoice target file\n', 'utf-8');
        }
        ui.setActiveFile(activeFile);
        ui.recordAction(`✓  Active target reset to: ${path.relative(cwd, activeFile)}`, 'file');
      }
    } else if (isCodeIntent(intent)) {
      logger.info(`Running code intent [${intent.type}] on ${activeFile}`);
      try {
        const result = await handleCodeIntent(intent, activeFile);
        const relPath = path.relative(process.cwd(), result.targetFile);
        if (intent.type === 'code_explain') {
          ui.recordAction(`💡  ${result.summary || 'Code explanation complete'}`, 'code');
        } else {
          ui.recordAction(`✓  Generated code in ${relPath} (${result.summary})`, 'code');
        }
        logger.info(`Code intent succeeded: ${result.summary}`);
      } catch (codeErr: any) {
        const errMsg = codeErr?.message ?? String(codeErr);
        ui.recordAction(`✗  Code error: ${errMsg}`, 'error');
        logger.error(`Code intent error: ${errMsg}`);
      }
    } else if (isGitIntent(intent)) {
      const args = resolveGitArgs(intent);
      const cmdString = `git ${args.join(' ')}`;
      logger.info(`Running git: ${cmdString}`);

      const result = await executeGit(intent);
      logger.info(`Git output for [${cmdString}]:\n${result.output}`);
      if (result.success) {
        const summary = formatGitNarrativeSummary(intent, result.output);
        ui.recordAction(`$  ${cmdString} → ${summary}`, 'git');
      } else {
        const errFirstLine = (result.output || 'Command failed').split('\n')[0]?.trim();
        ui.recordAction(`✗  git ${args[0]} failed: ${errFirstLine}`, 'error');
      }
    }
  }

  // ── AssemblyAI Streaming Handlers ──────────────────────────────────────────

  streaming.on('ready', () => {
    ui.setStatus('LISTENING');
    logger.info('Session active -- Universal-3-5-Pro streaming ready');
    if (!isMicMuted) {
      mic.start();
      logger.info('Microphone capture active (16kHz PCM16)');
    }
  });

  streaming.on('transcript', async (event) => {
    // 1. Partial updates (streamed live in real-time)
    if (!event.isFinal) {
      ui.updateLiveTranscript(event.text);
      return;
    }

    // 2. Final turn
    const rawTranscript = event.text.trim();
    if (!rawTranscript) return;

    // Transliterate Devanagari to Roman script Hinglish if present
    const translit = await transliterateIfNeeded(rawTranscript);
    const romanizedTranscript = translit.text;

    logger.info(
      `[STT] Final: "${rawTranscript}" -> Romanized: "${romanizedTranscript}" (lang: ${event.language || 'en'}, ${translit.latencyMs}ms)`
    );
    if (event.rawText && event.rawText !== rawTranscript) {
      logger.info(`[STT] Disfluent: "${event.rawText}"`);
    }

    // Record human-readable speech in narrative view
    ui.recordHeard(romanizedTranscript);

    // Avoid parallel concurrent intent executions
    if (isProcessing) return;
    isProcessing = true;
    ui.setStatus('PROCESSING');

    try {
      // 3. Route Intent via Gemini using romanized text
      const intent = await routeIntent(romanizedTranscript);
      logger.info(`Intent matched: [${intent.type}]`);

      // Extra guard: If classified as file_delete without tripping keyword gate
      if (isFileDeleteIntent(intent)) {
        mic.stop();
        ui.setStatus('MUTED');
        ui.recordAction('⚠️  Destructive confirmation required: file deletion', 'warning');
        const confirmed = await ui.promptDestructiveConfirmation('file delete', romanizedTranscript);
        if (confirmed) {
          ui.recordAction('✓  Confirmed file deletion', 'file');
          await dispatchIntent(intent);
        } else {
          ui.recordAction('—  Action cancelled by user', 'info');
        }
        if (!isMicMuted) {
          mic.start();
          ui.setStatus('LISTENING');
        }
        return;
      }

      // Extra guard: If classified as git_branch_delete without tripping keyword gate
      if (isGitBranchDeleteIntent(intent)) {
        mic.stop();
        ui.setStatus('MUTED');
        ui.recordAction(`⚠️  Destructive confirmation required: delete branch "${intent.name}"`, 'warning');
        const confirmed = await ui.promptDestructiveConfirmation(`delete branch ${intent.name}`, romanizedTranscript);
        if (confirmed) {
          ui.recordAction(`✓  Confirmed deletion of branch "${intent.name}"`, 'git');
          await dispatchIntent(intent);
        } else {
          ui.recordAction('—  Action cancelled by user', 'info');
        }
        if (!isMicMuted) {
          mic.start();
          ui.setStatus('LISTENING');
        }
        return;
      }

      // 4. Dispatch Intent
      await dispatchIntent(intent);
    } catch (err: any) {
      if (err instanceof DestructiveIntentError) {
        mic.stop();
        ui.setStatus('MUTED');
        ui.recordAction(`⚠️  Destructive action intercepted: "${err.matchedKeyword}"`, 'warning');
        const confirmed = await ui.promptDestructiveConfirmation(
          err.matchedKeyword,
          romanizedTranscript
        );
        if (confirmed) {
          ui.recordAction('✓  Confirmed destructive execution', 'warning');
          try {
            const intent = await routeIntent(romanizedTranscript, { skipSafetyGate: true });
            await dispatchIntent(intent);
          } catch (execErr: any) {
            ui.recordAction(`✗  Execution error: ${execErr?.message ?? execErr}`, 'error');
            logger.error('Safety execution error:', execErr);
          }
        } else {
          ui.recordAction('—  Action cancelled by user', 'info');
        }
        if (!isMicMuted) {
          mic.start();
          ui.setStatus('LISTENING');
        }
      } else if (err instanceof UnknownIntentError) {
        ui.recordAction(`⚠️  Couldn't understand: "${romanizedTranscript}"`, 'warning');
        logger.warn(`Unknown intent for utterance: "${romanizedTranscript}"`);
      } else {
        ui.recordAction(`✗  Error: ${err?.message ?? err}`, 'error');
        logger.error('Pipeline error:', err);
      }
    } finally {
      isProcessing = false;
      if (!isMicMuted) {
        ui.setStatus('LISTENING');
      }
    }
  });

  mic.on('audio', (chunk: Buffer) => {
    streaming.sendAudio(chunk);
  });

  mic.on('error', (err) => {
    ui.setStatus('ERROR');
    ui.recordAction(`✗  Microphone error: ${err.message}`, 'error');
    logger.error('Mic error:', err);
  });

  streaming.on('error', (err) => {
    ui.setStatus('ERROR');
    ui.recordAction(`✗  Streaming STT error: ${err.message}`, 'error');
    logger.error('Streaming STT error:', err);
  });

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Connect to AssemblyAI WebSocket
  streaming.connect();
}

main().catch((err) => {
  console.error('[FATAL]', err);
  process.exit(1);
});
