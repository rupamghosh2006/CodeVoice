import * as path from 'node:path';
import type { ConvoTuiCtrl as ConvoTuiCtrlClass } from '@convo-lang/tui/ConvoTuiCtrl';
import type { ScreenDef, SpriteDef, TuiConsole, TuiTheme, Sprite } from '@convo-lang/tui/tui-types';
import { logger } from '../utils/logger';
import { patchConvoTuiCtrl } from './patchTui';
import type { CodeVoiceView, CodeVoiceTuiCallbacks, ActivityLogEntry } from './types';

export async function loadConvoTuiCtrl(): Promise<typeof ConvoTuiCtrlClass> {
  const mod = await (new Function('return import("@convo-lang/tui/ConvoTuiCtrl")')());
  patchConvoTuiCtrl(mod.ConvoTuiCtrl);
  return mod.ConvoTuiCtrl;
}

export { ActivityLogEntry, CodeVoiceTuiCallbacks, CodeVoiceView };

export class CodeVoiceTui implements CodeVoiceView {
  private ctrl!: ConvoTuiCtrlClass;
  private activeFile: string;
  private callbacks: CodeVoiceTuiCallbacks;
  private isMuted = false;
  private isDisposed = false;
  private exitCleanupHandler: (() => void) | null = null;
  private logEntries: ActivityLogEntry[] = [];
  private confirmationResolver: ((confirmed: boolean) => void) | null = null;
  private fileSwitchResolver: ((filePath: string | null) => void) | null = null;
  private maxLogs = 80;

  constructor(initialFile: string, callbacks: CodeVoiceTuiCallbacks = {}) {
    this.activeFile = initialFile;
    this.callbacks = callbacks;
  }

  async init(): Promise<void> {
    const ConvoTuiCtrl = await loadConvoTuiCtrl();

    const theme: TuiTheme = {
      foreground: '#e2e8f0',
      background: '#090d16',
      panel: '#131b2e',
      accent: '#38bdf8',
      active: '#fbbf24',
      success: '#22c55e',
      warning: '#f59e0b',
      danger: '#ef4444',
      muted: '#64748b',
    };

    const mainScreen: ScreenDef = {
      id: 'main',
      defaultSprite: 'btn-mute',
      root: this.buildMainRoot(),
    };

    const confirmScreen: ScreenDef = {
      id: 'confirm-destructive',
      defaultSprite: 'btn-confirm-no',
      root: this.buildConfirmRoot(),
    };

    const fileSwitchScreen: ScreenDef = {
      id: 'file-switch',
      defaultSprite: 'file-switch-input',
      root: this.buildFileSwitchRoot(),
    };

    const tuiConsole: TuiConsole = {
      stdout: process.stdout,
      stdin: process.stdin,
    };

    this.ctrl = new ConvoTuiCtrl({
      console: tuiConsole,
      theme,
      defaultScreen: 'main',
      screens: [mainScreen, confirmScreen, fileSwitchScreen],
    });

    // Wire logger to TUI activity log
    logger.setSink((level, msg) => {
      let tag = 'LOG';
      let color = 'muted';
      if (level === 'error') {
        tag = 'ERR';
        color = 'danger';
      } else if (level === 'warn') {
        tag = 'WARN';
        color = 'warning';
      } else if (level === 'info') {
        tag = 'INFO';
        color = 'accent';
      }
      this.logActivity(tag, msg, color);
    });

    this.exitCleanupHandler = () => this.dispose();
    process.once('exit', this.exitCleanupHandler);
    process.once('SIGINT', this.exitCleanupHandler);
    process.once('SIGTERM', this.exitCleanupHandler);

    this.ctrl.init();
  }

  private formatTime(): string {
    const d = new Date();
    return d.toTimeString().split(' ')[0] ?? '';
  }

  private buildMainRoot(): SpriteDef {
    return {
      id: 'main-root',
      layout: 'column',
      bg: 'background',
      children: [
        // ── Header ──────────────────────────────────────────
        {
          id: 'header-box',
          layout: 'column',
          bg: 'panel',
          border: { bottom: 'accent' },
          borderStyle: 'rounded',
          padding: { left: 1, right: 1, top: 0, bottom: 0 },
          children: [
            {
              id: 'header-title-row',
              layout: 'row',
              children: [
                {
                  id: 'app-title',
                  text: ' [ CodeVoice ] -- Multilingual Voice Development Interface ',
                  color: 'accent',
                  flex: 1,
                },
                {
                  id: 'status-badge',
                  text: ' [ CONNECTING ] ',
                  color: 'warning',
                  border: 'warning',
                },
              ],
            },
            {
              id: 'header-meta-row',
              layout: 'row',
              gap: 2,
              children: [
                {
                  id: 'engine-label',
                  text: 'Engine: AssemblyAI universal-3-5-pro (Streaming)',
                  color: 'muted',
                },
                {
                  id: 'router-label',
                  text: 'Router: Gemini 2.5 Flash',
                  color: 'muted',
                },
                {
                  id: 'lang-label',
                  text: 'Languages: English, Hindi, Hinglish',
                  color: 'muted',
                },
              ],
            },
          ],
        },

        // ── Toolbar ─────────────────────────────────────────
        {
          id: 'toolbar-box',
          layout: 'row',
          gap: 1,
          margin: { top: 1, bottom: 1 },
          padding: { left: 1, right: 1, top: 0, bottom: 0 },
          children: [
            {
              id: 'active-file-display',
              text: ` Target: ${path.relative(process.cwd(), this.activeFile)} `,
              color: 'accent',
              border: 'muted',
            },
            {
              id: 'btn-mute',
              text: ' [ Mute Mic ] ',
              border: 'accent',
              activeBg: 'accent',
              activeColor: 'background',
              onClick: () => this.toggleMute(),
            },
            {
              id: 'btn-switch-file',
              text: ' [ Switch File ] ',
              border: 'accent',
              activeBg: 'accent',
              activeColor: 'background',
              onClick: () => this.openFileSwitchDialog(),
            },
            {
              id: 'btn-clear-logs',
              text: ' [ Clear Logs ] ',
              border: 'muted',
              activeBg: 'muted',
              activeColor: 'background',
              onClick: () => this.clearLogs(),
            },
            {
              id: 'btn-quit',
              text: ' [ Quit ] ',
              border: 'danger',
              color: 'danger',
              activeBg: 'danger',
              activeColor: 'background',
              onClick: () => this.quit(),
            },
          ],
        },

        // ── Live Voice Panel ────────────────────────────────
        {
          id: 'voice-box',
          layout: 'column',
          border: 'accent',
          borderStyle: 'rounded',
          bg: 'panel',
          padding: { left: 1, right: 1, top: 0, bottom: 0 },
          margin: { bottom: 1 },
          children: [
            {
              id: 'voice-header-row',
              layout: 'row',
              children: [
                {
                  id: 'voice-header-title',
                  text: 'LIVE VOICE TRANSCRIPTION',
                  color: 'accent',
                  flex: 1,
                },
                {
                  id: 'audio-meter',
                  text: '[===|===] STREAM ACTIVE',
                  color: 'success',
                },
              ],
            },
            {
              id: 'interim-transcript',
              text: '>> (Listening for speech...)',
              color: 'foreground',
              textWrap: 'wrap',
            },
            {
              id: 'final-transcript',
              text: 'Last Turn: (None)',
              color: 'active',
              textWrap: 'wrap',
            },
            {
              id: 'disfluent-transcript',
              text: '',
              color: 'muted',
              textWrap: 'wrap',
            },
          ],
        },

        // ── Activity Log Panel ──────────────────────────────
        {
          id: 'activity-panel',
          layout: 'column',
          flex: 1,
          border: 'muted',
          borderStyle: 'rounded',
          bg: 'panel',
          padding: 1,
          scrollable: true,
          isButton: true,
          children: [
            {
              id: 'activity-header',
              text: '--- ACTIVITY AND EXECUTION LOG ---',
              color: 'muted',
              align: 'center',
            },
          ],
        },

        // ── Footer ──────────────────────────────────────────
        {
          id: 'footer-row',
          layout: 'row',
          padding: { left: 1, right: 1, top: 0, bottom: 0 },
          children: [
            {
              id: 'footer-shortcuts',
              text: 'Shortcuts: Tab / Shift+Tab = Navigate | Enter = Activate | Scroll = Mouse Wheel or Arrows',
              color: 'muted',
              flex: 1,
            },
            {
              id: 'footer-exit',
              text: 'Exit: Click [Quit] or Ctrl+C',
              color: 'muted',
            },
          ],
        },
      ],
    };
  }

  private buildConfirmRoot(): SpriteDef {
    return {
      id: 'confirm-root',
      layout: 'column',
      bg: 'background',
      align: 'center',
      justify: 'center',
      children: [
        {
          id: 'confirm-box',
          layout: 'column',
          width: 70,
          border: 'danger',
          borderStyle: 'double',
          bg: 'panel',
          padding: 1,
          gap: 1,
          children: [
            {
              id: 'confirm-header',
              text: '[!] DESTRUCTIVE ACTION INTERCEPTED',
              color: 'danger',
              align: 'center',
            },
            {
              id: 'confirm-keyword-label',
              text: 'Trigger Keyword: (unknown)',
              color: 'warning',
            },
            {
              id: 'confirm-utterance-label',
              text: 'Utterance: ""',
              color: 'foreground',
              textWrap: 'wrap',
            },
            {
              id: 'confirm-warning-text',
              text: 'Warning: This action can delete files or discard Git changes.',
              color: 'muted',
            },
            {
              id: 'confirm-question',
              text: 'Are you sure you want to execute this operation?',
              color: 'active',
              align: 'center',
            },
            {
              id: 'confirm-buttons-row',
              layout: 'row',
              justify: 'center',
              gap: 2,
              children: [
                {
                  id: 'btn-confirm-yes',
                  text: ' [ YES, EXECUTE (Enter) ] ',
                  border: 'danger',
                  activeBg: 'danger',
                  activeColor: 'background',
                  onClick: () => this.resolveConfirmation(true),
                },
                {
                  id: 'btn-confirm-no',
                  text: ' [ CANCEL (Tab then Enter) ] ',
                  border: 'accent',
                  activeBg: 'accent',
                  activeColor: 'background',
                  onClick: () => this.resolveConfirmation(false),
                },
              ],
            },
          ],
        },
      ],
    };
  }

  private buildFileSwitchRoot(): SpriteDef {
    return {
      id: 'file-switch-root',
      layout: 'column',
      bg: 'background',
      align: 'center',
      justify: 'center',
      children: [
        {
          id: 'file-switch-box',
          layout: 'column',
          width: 64,
          border: 'accent',
          borderStyle: 'rounded',
          bg: 'panel',
          padding: 1,
          gap: 1,
          children: [
            {
              id: 'file-switch-header',
              text: '[ SWITCH ACTIVE TARGET FILE ]',
              color: 'accent',
              align: 'center',
            },
            {
              id: 'file-switch-instruction',
              text: 'Type the target file path and press Enter (or click OK):',
              color: 'muted',
            },
            {
              id: 'file-switch-input',
              text: '',
              placeholder: 'e.g. demo.ts or src/test.ts',
              isInput: true,
              border: 'accent',
              activeBorder: 'active',
              onSubmit: (evt) => {
                const val = (evt.value ?? '').trim();
                this.resolveFileSwitch(val.length > 0 ? val : null);
              },
            },
            {
              id: 'file-switch-buttons',
              layout: 'row',
              justify: 'center',
              gap: 2,
              children: [
                {
                  id: 'btn-file-ok',
                  text: ' [ OK ] ',
                  border: 'accent',
                  activeBg: 'accent',
                  activeColor: 'background',
                  onClick: () => {
                    const inputSprite = this.ctrl.findSpriteById('file-switch-input');
                    const val = (inputSprite?.state?.inputValue ?? '').trim();
                    this.resolveFileSwitch(val.length > 0 ? val : null);
                  },
                },
                {
                  id: 'btn-file-cancel',
                  text: ' [ CANCEL ] ',
                  border: 'muted',
                  activeBg: 'muted',
                  activeColor: 'background',
                  onClick: () => this.resolveFileSwitch(null),
                },
              ],
            },
          ],
        },
      ],
    };
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  setStatus(status: 'CONNECTING' | 'LISTENING' | 'PROCESSING' | 'MUTED' | 'ERROR'): void {
    let color = 'warning';
    let text = ` [ ${status} ] `;
    if (status === 'LISTENING') {
      color = 'success';
    } else if (status === 'PROCESSING') {
      color = 'accent';
    } else if (status === 'MUTED') {
      color = 'warning';
    } else if (status === 'ERROR') {
      color = 'danger';
    }

    this.ctrl.updateSprite('status-badge', (sprite) => {
      sprite.text = text;
      sprite.color = color;
      sprite.border = color;
    });
  }

  updateLiveTranscript(text: string): void {
    const trimmed = text.trim();
    this.ctrl.updateSprite('interim-transcript', (sprite) => {
      sprite.text = trimmed ? `>> ${trimmed}` : '>> (Listening for speech...)';
    });
  }

  setFinalTranscript(finalText: string, language?: string, rawText?: string): void {
    const langTag = language ? `[${language.toUpperCase()}] ` : '';
    this.ctrl.updateSprite('interim-transcript', (sprite) => {
      sprite.text = '>> (Processing turn...)';
      return false; // batch render
    });
    this.ctrl.updateSprite('final-transcript', (sprite) => {
      sprite.text = `Last Turn: ${langTag}"${finalText}"`;
      return false; // batch render
    });

    if (rawText && rawText.trim() !== finalText.trim()) {
      this.ctrl.updateSprite('disfluent-transcript', (sprite) => {
        sprite.text = `Disfluent: "${rawText.trim()}"`;
      });
    } else {
      this.ctrl.updateSprite('disfluent-transcript', (sprite) => {
        sprite.text = '';
      });
    }
  }

  setActiveFile(newPath: string): void {
    this.activeFile = newPath;
    const rel = path.relative(process.cwd(), newPath);
    this.ctrl.updateSprite('active-file-display', (sprite) => {
      sprite.text = ` Target: ${rel} `;
    });
  }

  getActiveFile(): string {
    return this.activeFile;
  }

  logActivity(tag: string, message: string, color: string = 'foreground'): void {
    const time = this.formatTime();
    this.logEntries.push({ timestamp: time, tag, message, color });
    if (this.logEntries.length > this.maxLogs) {
      this.logEntries.shift();
    }
    this.renderActivityPanel();
  }

  private renderActivityPanel(): void {
    const children: SpriteDef[] = [
      {
        id: 'activity-header',
        text: '--- ACTIVITY AND EXECUTION LOG ---',
        color: 'muted',
        align: 'center',
      },
    ];

    for (let i = 0; i < this.logEntries.length; i++) {
      const entry = this.logEntries[i]!;
      children.push({
        id: `log-item-${i}`,
        text: `[${entry.timestamp}] [${entry.tag}] ${entry.message}`,
        color: entry.color ?? 'foreground',
        textWrap: 'wrap',
      });
    }

    this.ctrl.updateSprite({
      id: 'activity-panel',
      children,
    });

    // Auto-scroll to keep newest logs visible
    const panel = this.ctrl.findSpriteById('activity-panel');
    if (panel) {
      const height = panel.state?.renderRect?.height ?? 15;
      const total = children.length;
      if (total > height) {
        panel.state.scrollY = Math.max(0, total - height + 2);
        this.ctrl.render();
      }
    }
  }

  clearLogs(): void {
    this.logEntries = [];
    this.renderActivityPanel();
    this.logActivity('SYSTEM', 'Activity logs cleared', 'muted');
  }

  toggleMute(): void {
    this.isMuted = !this.isMuted;
    this.ctrl.updateSprite('btn-mute', (sprite) => {
      sprite.text = this.isMuted ? ' [ Resume Mic ] ' : ' [ Mute Mic ] ';
      sprite.border = this.isMuted ? 'warning' : 'accent';
    });

    this.ctrl.updateSprite('audio-meter', (sprite) => {
      sprite.text = this.isMuted ? '[---X---] MIC MUTED' : '[===|===] STREAM ACTIVE';
      sprite.color = this.isMuted ? 'warning' : 'success';
    });

    if (this.isMuted) {
      this.setStatus('MUTED');
      this.logActivity('MIC', 'Microphone paused by user', 'warning');
    } else {
      this.setStatus('LISTENING');
      this.logActivity('MIC', 'Microphone resumed', 'success');
    }

    this.callbacks.onMuteToggle?.(this.isMuted);
  }

  async promptDestructiveConfirmation(keyword: string, rawTranscript: string): Promise<boolean> {
    return new Promise((resolve) => {
      this.confirmationResolver = resolve;

      // Update dialog text
      this.ctrl.updateSprite('confirm-keyword-label', (sprite) => {
        sprite.text = `Trigger Keyword: "${keyword}"`;
      });
      this.ctrl.updateSprite('confirm-utterance-label', (sprite) => {
        sprite.text = `Utterance: "${rawTranscript}"`;
      });

      this.ctrl.activateScreen('confirm-destructive');
    });
  }

  private resolveConfirmation(confirmed: boolean): void {
    if (this.confirmationResolver) {
      const cb = this.confirmationResolver;
      this.confirmationResolver = null;
      cb(confirmed);
    }
    this.ctrl.activateScreen('main');
  }

  async openFileSwitchDialog(): Promise<string | null> {
    return new Promise((resolve) => {
      this.fileSwitchResolver = resolve;
      this.ctrl.updateSprite('file-switch-input', (sprite) => {
        if (sprite.state) {
          sprite.state.inputValue = '';
          sprite.state.inputCaret = 0;
        }
      });
      this.ctrl.activateScreen('file-switch');
    });
  }

  private resolveFileSwitch(filePath: string | null): void {
    if (this.fileSwitchResolver) {
      const cb = this.fileSwitchResolver;
      this.fileSwitchResolver = null;
      cb(filePath);
    }
    this.ctrl.activateScreen('main');
    if (filePath) {
      this.setActiveFile(path.resolve(filePath));
      this.callbacks.onFileSwitch?.(path.resolve(filePath));
      this.logActivity('FILE', `Active file switched to: ${filePath}`, 'accent');
    }
  }

  quit(): void {
    if (this.callbacks.onQuit) {
      this.callbacks.onQuit();
    } else {
      this.dispose();
      process.exit(0);
    }
  }

  dispose(): void {
    if (this.isDisposed) return;
    this.isDisposed = true;

    if (this.exitCleanupHandler) {
      process.removeListener('exit', this.exitCleanupHandler);
      process.removeListener('SIGINT', this.exitCleanupHandler);
      process.removeListener('SIGTERM', this.exitCleanupHandler);
      this.exitCleanupHandler = null;
    }

    try {
      if (this.ctrl && !this.ctrl.isDisposed) {
        this.ctrl.dispose();
      }
    } catch {
      // Fallback ANSI restore in case ctrl.dispose encountered an error
      process.stdout.write('\x1b[0m\x1b[?1000l\x1b[?1006l\x1b[?2004l\x1b[?25h\x1b[?1049l');
    }
    logger.setSink(null);
  }
}
