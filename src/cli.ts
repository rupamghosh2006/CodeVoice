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
import { routeIntent, UnknownIntentError, DestructiveIntentError } from './intent/router';
import {
  isCodeIntent,
  isGitIntent,
  isFileSwitchIntent,
  isFileDeleteIntent,
  type Intent,
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
  ui.logActivity('SYSTEM', `Initializing CodeVoice (${isPlain ? 'Plain CLI' : 'TUI'})...`, 'accent');
  ui.logActivity('ASSEMBLYAI', `Connecting to WebSocket: ${config.assemblyai.wsUrl}`, 'muted');
  ui.logActivity('ROUTER', `LLM Router model: ${config.gemini.model}`, 'muted');

  // ── Intent Dispatcher ───────────────────────────────────────────────────────

  async function dispatchIntent(intent: Intent): Promise<void> {
    if (isFileSwitchIntent(intent)) {
      const resolvedPath = path.resolve(intent.path);
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
      ui.logActivity('FILE', `Active file set to: ${rel}`, 'accent');
    } else if (isFileDeleteIntent(intent)) {
      const targetToDelete = intent.path === 'current' ? activeFile : path.resolve(intent.path);
      const cwd = process.cwd();
      const rel = path.relative(cwd, targetToDelete);
      if (rel.startsWith('..') || (path.isAbsolute(rel) && !targetToDelete.startsWith(cwd))) {
        ui.logActivity(
          'SECURITY',
          `Cannot delete file outside workspace (${targetToDelete})`,
          'danger'
        );
        return;
      }
      if (!fs.existsSync(targetToDelete)) {
        ui.logActivity(
          'FILE',
          `File does not exist: ${path.relative(cwd, targetToDelete) || targetToDelete}`,
          'warning'
        );
        return;
      }
      fs.unlinkSync(targetToDelete);
      ui.logActivity('FILE', `Deleted file: ${path.relative(cwd, targetToDelete)}`, 'success');
      if (path.resolve(activeFile) === path.resolve(targetToDelete)) {
        activeFile = config.app.targetFile;
        if (!fs.existsSync(activeFile)) {
          fs.writeFileSync(activeFile, '// CodeVoice target file\n', 'utf-8');
        }
        ui.setActiveFile(activeFile);
        ui.logActivity('FILE', `Active file reset to: ${path.relative(cwd, activeFile)}`, 'accent');
      }
    } else if (isCodeIntent(intent)) {
      ui.logActivity(
        'CODE',
        `Running ${intent.type} on ${path.basename(activeFile)}...`,
        'accent'
      );
      try {
        const result = await handleCodeIntent(intent, activeFile);
        const relPath = path.relative(process.cwd(), result.targetFile);
        ui.logActivity('CODE', `Updated ${relPath} (${result.summary})`, 'success');
      } catch (codeErr: any) {
        ui.logActivity('CODE_ERR', codeErr?.message ?? String(codeErr), 'danger');
      }
    } else if (isGitIntent(intent)) {
      const args = resolveGitArgs(intent);
      const cmdString = `git ${args.join(' ')}`;
      ui.logActivity('GIT', `$ ${cmdString}`, 'accent');

      const result = await executeGit(intent);
      if (result.output) {
        const lines = result.output.split('\n');
        for (const line of lines) {
          if (line.trim()) {
            ui.logActivity('GIT_OUT', line.trimEnd(), 'muted');
          }
        }
      }
      if (result.success) {
        ui.logActivity('GIT', 'Command succeeded', 'success');
      } else {
        ui.logActivity('GIT', 'Command failed', 'danger');
      }
    }
  }

  // ── AssemblyAI Streaming Handlers ──────────────────────────────────────────

  streaming.on('ready', () => {
    ui.setStatus('LISTENING');
    ui.logActivity('ASSEMBLYAI', 'Session active -- Universal-3-5-Pro streaming ready', 'success');
    if (!isMicMuted) {
      mic.start();
      ui.logActivity('MIC', 'Microphone capture active (16kHz PCM16)', 'success');
    }
  });

  streaming.on('transcript', async (event) => {
    // 1. Partial updates (streamed live in real-time)
    if (!event.isFinal) {
      ui.updateLiveTranscript(event.text);
      return;
    }

    // 2. Final turn
    const finalText = event.text.trim();
    if (!finalText) return;

    ui.setFinalTranscript(finalText, event.language, event.rawText);
    ui.logActivity('STT', `[${event.language || 'en'}] "${finalText}"`, 'active');

    if (event.rawText && event.rawText.trim() !== finalText) {
      ui.logActivity('RAW_STT', `↳ Disfluent: "${event.rawText.trim()}"`, 'muted');
    }

    // Avoid parallel concurrent intent executions
    if (isProcessing) return;
    isProcessing = true;
    ui.setStatus('PROCESSING');

    try {
      // 3. Route Intent via Gemini
      const intent = await routeIntent(finalText);
      ui.logActivity('ROUTER', `Intent matched: [${intent.type}]`, 'accent');

      // Extra guard: If classified as file_delete without tripping keyword gate
      if (isFileDeleteIntent(intent)) {
        mic.stop();
        ui.setStatus('MUTED');
        const confirmed = await ui.promptDestructiveConfirmation('file delete', finalText);
        if (confirmed) {
          ui.logActivity('SAFETY', 'Executing confirmed file deletion...', 'warning');
          await dispatchIntent(intent);
        } else {
          ui.logActivity('SAFETY', 'Action cancelled by user', 'muted');
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
        const confirmed = await ui.promptDestructiveConfirmation(
          err.matchedKeyword,
          err.rawTranscript
        );
        if (confirmed) {
          ui.logActivity('SAFETY', 'Executing confirmed destructive action...', 'warning');
          try {
            const intent = await routeIntent(err.rawTranscript, { skipSafetyGate: true });
            await dispatchIntent(intent);
          } catch (execErr: any) {
            ui.logActivity('SAFETY_ERR', execErr?.message ?? String(execErr), 'danger');
          }
        } else {
          ui.logActivity('SAFETY', 'Action cancelled by user', 'muted');
        }
        if (!isMicMuted) {
          mic.start();
          ui.setStatus('LISTENING');
        }
      } else if (err instanceof UnknownIntentError) {
        ui.logActivity('ROUTER', `Couldn't route intent: "${err.rawTranscript}"`, 'warning');
      } else {
        ui.logActivity('ERROR', `Pipeline error: ${err?.message ?? err}`, 'danger');
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
    ui.logActivity('MIC_ERROR', `${err.message} (Ensure SoX is installed)`, 'danger');
  });

  streaming.on('error', (err) => {
    ui.setStatus('ERROR');
    ui.logActivity('STT_ERROR', `Streaming Error: ${err.message}`, 'danger');
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
