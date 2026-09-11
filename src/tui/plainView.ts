import * as readline from 'node:readline';
import * as path from 'node:path';
import pc from 'picocolors';
import type { CodeVoiceView } from './types';

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
    console.log(`  Router:  ${pc.blue('Gemini 2.5 Flash')}`);
    console.log(`  Target:  ${pc.yellow(path.relative(process.cwd(), this.activeFile))}`);
    console.log(pc.dim('  ─────────────────────────────────────────────────────────────\n'));
  }

  setStatus(status: 'CONNECTING' | 'LISTENING' | 'PROCESSING' | 'MUTED' | 'ERROR'): void {
    if (status === 'CONNECTING') {
      process.stdout.write(pc.yellow('  ⏳ Connecting to AssemblyAI WebSocket...\n'));
    } else if (status === 'LISTENING') {
      process.stdout.write(pc.green('  ● 🎙️  Listening continuously... (Speak now)\n\n'));
    } else if (status === 'PROCESSING') {
      process.stdout.write(pc.dim('  ⚡ Routing intent...\r'));
    } else if (status === 'MUTED') {
      process.stdout.write(pc.yellow('  ⏸️  Microphone paused.\n'));
    } else if (status === 'ERROR') {
      process.stdout.write(pc.red('  ❌ Error encountered.\n'));
    }
  }

  updateLiveTranscript(text: string): void {
    const trimmed = text.trim();
    if (trimmed) {
      process.stdout.write(`\r  ${pc.blue('●')} ${pc.dim(trimmed.substring(0, 90))} \x1b[K`);
    }
  }

  setFinalTranscript(finalText: string, language?: string, rawText?: string): void {
    process.stdout.write('\r\x1b[K');
    const langBadge = language ? pc.yellow(`[${language.toUpperCase()}] `) : '';
    console.log(`  ${pc.magenta('📝')} ${langBadge}${pc.bold(finalText)}`);
    if (rawText && rawText.trim() !== finalText.trim()) {
      console.log(`     ${pc.dim(`↳ Raw (disfluent): "${rawText.trim()}"`)}`);
    }
  }

  setActiveFile(newPath: string): void {
    this.activeFile = newPath;
    console.log(`  ${pc.cyan('📂')} Active target file set to: ${pc.bold(path.relative(process.cwd(), newPath))}`);
  }

  getActiveFile(): string {
    return this.activeFile;
  }

  logActivity(tag: string, message: string, color?: string): void {
    const timestamp = new Date().toTimeString().split(' ')[0] ?? '';
    let formattedTag = `[${tag}]`;
    if (tag === 'CODE') {
      formattedTag = pc.green(`✓ [${tag}]`);
    } else if (tag === 'GIT' || tag === 'GIT_OUT') {
      formattedTag = pc.cyan(`$ [${tag}]`);
    } else if (tag === 'SAFETY' || tag === 'WARN') {
      formattedTag = pc.yellow(`⚠️ [${tag}]`);
    } else if (tag === 'ERR' || tag === 'DANGER') {
      formattedTag = pc.red(`✗ [${tag}]`);
    } else {
      formattedTag = pc.dim(`[${tag}]`);
    }

    console.log(`  ${pc.dim(timestamp)} ${formattedTag} ${message}`);
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
