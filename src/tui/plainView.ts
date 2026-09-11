import * as readline from 'node:readline';
import * as path from 'node:path';
import pc from 'picocolors';
import { config } from '../utils/config';
import { logger } from '../utils/logger';
import type { CodeVoiceView, NarrativeEventType } from './types';

export class PlainCliView implements CodeVoiceView {
  private activeFile: string;
  private isDisposed = false;

  constructor(initialFile: string) {
    this.activeFile = initialFile;
  }

  async init(): Promise<void> {
    console.log();
    console.log(pc.bold(pc.cyan('  🎙️  CodeVoice -- Multilingual Voice Development Interface')));
    console.log(pc.dim('  ─────────────────────────────────────────────────────────────'));
    console.log(`  Engine:  ${pc.magenta('AssemblyAI Universal-3-5-Pro (Streaming)')}`);
    console.log(`  Router:  ${pc.blue(`Gemini (${config.gemini.model})`)}`);
    console.log(`  Target:  ${pc.yellow(path.relative(process.cwd(), this.activeFile))}`);
    console.log(pc.dim(`  Logs:    ${pc.dim('codevoice.log')}`));
    console.log(pc.dim('  ─────────────────────────────────────────────────────────────\n'));
  }

  setStatus(status: 'CONNECTING' | 'LISTENING' | 'PROCESSING' | 'MUTED' | 'ERROR'): void {
    if (status === 'CONNECTING') {
      process.stdout.write(pc.yellow('  ⏳ Connecting to AssemblyAI WebSocket...\n'));
    } else if (status === 'LISTENING') {
      process.stdout.write(pc.green('  ● 🎙️  Listening continuously... (Speak now in English or Hindi)\n\n'));
    } else if (status === 'PROCESSING') {
      process.stdout.write(pc.dim('  ⚡ Processing instruction...\r'));
    } else if (status === 'MUTED') {
      process.stdout.write(pc.yellow('  ⏸️  Microphone paused.\n'));
    } else if (status === 'ERROR') {
      process.stdout.write(pc.red('  ❌ Error encountered.\n'));
    }
  }

  updateLiveTranscript(text: string): void {
    const trimmed = text.trim();
    if (trimmed) {
      process.stdout.write(`\r  ${pc.cyan('●')} ${pc.dim(trimmed.substring(0, 90))} \x1b[K`);
    }
  }

  recordHeard(text: string): void {
    process.stdout.write('\r\x1b[K');
    console.log(pc.cyan(`  🎙  Heard: "${text}"`));
  }

  recordAction(actionText: string, type: NarrativeEventType = 'code'): void {
    if (type === 'error') {
      console.log(pc.red(`  ${actionText}`));
    } else if (type === 'warning') {
      console.log(pc.yellow(`  ${actionText}`));
    } else if (type === 'info') {
      console.log(pc.dim(`  ${actionText}`));
    } else {
      console.log(pc.green(`  ${actionText}`));
    }
  }

  setFinalTranscript(finalText: string, _language?: string, rawText?: string, originalDevanagari?: string): void {
    this.recordHeard(finalText);
    if (originalDevanagari && originalDevanagari.trim() !== finalText.trim()) {
      logger.info(`Devanagari: "${originalDevanagari.trim()}"`);
    }
    if (rawText && rawText.trim() !== finalText.trim()) {
      logger.info(`Raw (disfluent): "${rawText.trim()}"`);
    }
  }

  setActiveFile(newPath: string): void {
    this.activeFile = newPath;
    console.log(`  ${pc.cyan('📂')} Target file set to: ${pc.bold(path.relative(process.cwd(), newPath))}`);
  }

  getActiveFile(): string {
    return this.activeFile;
  }

  logActivity(tag: string, message: string, _color?: string): void {
    // Preserve internal activity logs in codevoice.log
    logger.info(`[${tag}] ${message}`);
  }

  async promptDestructiveConfirmation(keyword: string, rawTranscript: string): Promise<boolean> {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    console.log(pc.red(`\n  ⚠️  DESTRUCTIVE ACTION INTERCEPTED: "${keyword}"`));
    console.log(pc.yellow(`     Utterance: "${rawTranscript}"`));
    return new Promise((resolve) => {
      rl.question(pc.bold('     Are you sure you want to execute this? (y/N): '), (ans) => {
        rl.close();
        resolve(ans.trim().toLowerCase() === 'y');
      });
    });
  }

  dispose(): void {
    if (this.isDisposed) return;
    this.isDisposed = true;
    console.log(pc.yellow('\n  ⏹️  CodeVoice session ended. Goodbye!\n'));
  }
}
