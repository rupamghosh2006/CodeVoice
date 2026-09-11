import * as path from 'node:path';
import type { ConvoTuiCtrl as ConvoTuiCtrlClass } from '@convo-lang/tui/ConvoTuiCtrl';
import type { ScreenDef, SpriteDef, TuiConsole, TuiTheme } from '@convo-lang/tui/tui-types';
import { logger } from '../utils/logger';
import { config } from '../utils/config';
import { patchConvoTuiCtrl } from './patchTui';
import type { CodeVoiceView, CodeVoiceTuiCallbacks, ActivityLogEntry, NarrativeEvent, NarrativeEventType } from './types';

export async function loadConvoTuiCtrl(): Promise<typeof ConvoTuiCtrlClass> {
  const mod = await (new Function('return import("@convo-lang/tui/ConvoTuiCtrl")')());
  patchConvoTuiCtrl(mod.ConvoTuiCtrl);
  return mod.ConvoTuiCtrl;
}

export { ActivityLogEntry, CodeVoiceTuiCallbacks, CodeVoiceView, NarrativeEvent, NarrativeEventType };

export class CodeVoiceTui implements CodeVoiceView {
  private ctrl!: ConvoTuiCtrlClass;
  private activeFile: string;
  private callbacks: CodeVoiceTuiCallbacks;
  private isMuted = false;
  private isDisposed = false;
  private exitCleanupHandler: (() => void) | null = null;
  private narrativeEvents: NarrativeEvent[] = [];
  private confirmationResolver: ((confirmed: boolean) => void) | null = null;
  private fileSwitchResolver: ((filePath: string | null) => void) | null = null;
  private maxLogs = 60;

  constructor(initialFile: string, callbacks: CodeVoiceTuiCallbacks = {}) {
    this.activeFile = initialFile;
    this.callbacks = callbacks;
  }

  async init(): Promise<void> {
    const ConvoTuiCtrl = await loadConvoTuiCtrl();

    const theme: TuiTheme = {
      foreground: '#e2e8f0', // off-white
      background: '#090d16', // deep dark
      panel: '#131b2e',      // navy
      accent: '#38bdf8',     // cyan / sky blue ("Heard")
      active: '#fbbf24',     // amber
      success: '#22c55e',    // emerald green ("Action Taken")
      warning: '#f59e0b',    // amber warning
      danger: '#ef4444',     // red ("Error")
      muted: '#64748b',      // slate gray
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
    const relFile = path.relative(process.cwd(), this.activeFile);
    return {
      id: 'main-root',
      layout: 'column',
      bg: 'background',
      children: [
        // ── Minimal Header ───────────────────────────────────────
        {
          id: 'header-box',
          layout: 'column',
          bg: 'panel',
          border: { bottom: 'muted' },
          borderStyle: 'rounded',
          padding: { left: 1, right: 1, top: 0, bottom: 0 },
          children: [
            {
              id: 'header-title-row',
              layout: 'row',
              children: [
                {
                  id: 'app-title',
                  text: ' [ CodeVoice ]  Voice Development Interface ',
                  color: 'accent',
                  flex: 1,
                },
                {
                  id: 'status-badge',
                  text: ' [ ● LISTENING ] ',
                  color: 'success',
                  border: 'success',
                },
              ],
            },
            {
              id: 'header-meta-row',
              layout: 'row',
              children: [
                {
                  id: 'engine-label',
                  text: `Target: ${relFile}  •  AssemblyAI universal-3-5-pro  •  Gemini (${config.gemini.model})`,
                  color: 'muted',
                  flex: 1,
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
              text: ` Target: ${relFile} `,
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

        // ── Live Speech Status Bar ────────────────────────────────
        {
          id: 'live-speech-box',
          layout: 'row',
          padding: { left: 1, right: 1, top: 0, bottom: 0 },
          margin: { top: 0, bottom: 0 },
          children: [
            {
              id: 'live-transcript',
              text: '🎙  Listening... (speak naturally in English or Hindi)',
              color: 'muted',
              textWrap: 'wrap',
              flex: 1,
            },
          ],
        },

        // ── Narrative Event Feed (The demo surface) ───────────────
        {
          id: 'narrative-panel',
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
              id: 'narrative-header',
              text: '── NARRATIVE LOG ─────────────────────────────────────────────────────────────',
              color: 'muted',
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
              text: 'Shortcuts: Tab / Shift+Tab = Navigate | Enter = Click | Scroll = Mouse Wheel or Arrows',
              color: 'muted',
              flex: 1,
            },
            {
              id: 'footer-log-status',
              text: 'Logs: codevoice.log',
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
      text = ' [ ● LISTENING ] ';
    } else if (status === 'PROCESSING') {
      color = 'active';
      text = ' [ ⚡ PROCESSING ] ';
    } else if (status === 'MUTED') {
      color = 'warning';
      text = ' [ ⏸ MUTED ] ';
    } else if (status === 'ERROR') {
      color = 'danger';
      text = ' [ ❌ ERROR ] ';
    } else if (status === 'CONNECTING') {
      color = 'warning';
      text = ' [ ⏳ CONNECTING ] ';
    }

    this.ctrl.updateSprite('status-badge', (sprite) => {
      sprite.text = text;
      sprite.color = color;
      sprite.border = color;
    });

    if (status === 'MUTED') {
      this.ctrl.updateSprite('btn-mute', (sprite) => {
        sprite.text = ' [ Resume Mic ] ';
        sprite.border = 'warning';
      });
    } else if (status === 'LISTENING') {
      this.ctrl.updateSprite('btn-mute', (sprite) => {
        sprite.text = ' [ Mute Mic ] ';
        sprite.border = 'accent';
      });
    }

    if (status === 'LISTENING') {
      this.ctrl.updateSprite('live-transcript', (sprite) => {
        sprite.text = '🎙  Listening... (speak naturally in English or Hindi)';
        sprite.color = 'muted';
      });
    } else if (status === 'PROCESSING') {
      this.ctrl.updateSprite('live-transcript', (sprite) => {
        sprite.text = '⚡  Processing instruction...';
        sprite.color = 'active';
      });
    }
  }

  updateLiveTranscript(text: string): void {
    const trimmed = text.trim();
    this.ctrl.updateSprite('live-transcript', (sprite) => {
      if (trimmed) {
        sprite.text = `🎙  >> "${trimmed}"`;
        sprite.color = 'accent';
      } else {
        sprite.text = '🎙  Listening... (speak naturally in English or Hindi)';
        sprite.color = 'muted';
      }
    });
  }

  recordHeard(text: string): void {
    const trimmed = text.trim();
    if (!trimmed) return;
    this.narrativeEvents.push({
      text: `🎙  Heard: "${trimmed}"`,
      type: 'heard',
      timestamp: this.formatTime(),
    });
    if (this.narrativeEvents.length > this.maxLogs) {
      this.narrativeEvents.shift();
    }
    this.ctrl.updateSprite('live-transcript', (sprite) => {
      sprite.text = '⚡  Executing instruction...';
      sprite.color = 'active';
    });
    this.renderNarrativePanel();
  }

  recordAction(actionText: string, type: NarrativeEventType = 'code'): void {
    const trimmed = actionText.trim();
    if (!trimmed) return;
    this.narrativeEvents.push({
      text: trimmed,
      type,
      timestamp: this.formatTime(),
    });
    if (this.narrativeEvents.length > this.maxLogs) {
      this.narrativeEvents.shift();
    }
    this.renderNarrativePanel();
  }

  setFinalTranscript(finalText: string, _language?: string, rawText?: string, originalDevanagari?: string): void {
    this.recordHeard(finalText);
    if (originalDevanagari && originalDevanagari.trim() !== finalText.trim()) {
      logger.info(`Devanagari transcript: "${originalDevanagari.trim()}"`);
    }
    if (rawText && rawText.trim() !== finalText.trim()) {
      logger.info(`Raw disfluent transcript: "${rawText.trim()}"`);
    }
  }

  setActiveFile(newPath: string): void {
    this.activeFile = newPath;
    const rel = path.relative(process.cwd(), newPath);
    this.ctrl.updateSprite('active-file-display', (sprite) => {
      sprite.text = ` Target: ${rel} `;
    });
    this.ctrl.updateSprite('engine-label', (sprite) => {
      sprite.text = `Target: ${rel}  •  AssemblyAI universal-3-5-pro  •  Gemini (${config.gemini.model})`;
    });
  }

  getActiveFile(): string {
    return this.activeFile;
  }

  logActivity(tag: string, message: string, _color: string = 'foreground'): void {
    // Internal logs are preserved in codevoice.log to keep the screen narrative clean
    logger.info(`[${tag}] ${message}`);
  }

  private renderNarrativePanel(): void {
    const children: SpriteDef[] = [
      {
        id: 'narrative-header',
        text: '── NARRATIVE LOG ─────────────────────────────────────────────────────────────',
        color: 'muted',
      },
    ];

    for (let i = 0; i < this.narrativeEvents.length; i++) {
      const entry = this.narrativeEvents[i]!;
      let color = 'foreground';
      if (entry.type === 'heard') {
        color = 'accent';
      } else if (entry.type === 'code' || entry.type === 'git' || entry.type === 'file') {
        color = 'success';
      } else if (entry.type === 'warning') {
        color = 'warning';
      } else if (entry.type === 'error') {
        color = 'danger';
      }

      children.push({
        id: `narrative-item-${i}`,
        text: entry.text,
        color,
        textWrap: 'wrap',
      });
    }

    this.ctrl.updateSprite({
      id: 'narrative-panel',
      children,
    });

    // Auto-scroll to keep newest logs visible
    const panel = this.ctrl.findSpriteById('narrative-panel');
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
    this.narrativeEvents = [];
    this.renderNarrativePanel();
  }

  toggleMute(): void {
    this.isMuted = !this.isMuted;
    this.ctrl.updateSprite('btn-mute', (sprite) => {
      sprite.text = this.isMuted ? ' [ Resume Mic ] ' : ' [ Mute Mic ] ';
      sprite.border = this.isMuted ? 'warning' : 'accent';
      sprite.activeBg = this.isMuted ? 'warning' : 'accent';
    });
    if (this.isMuted) {
      this.setStatus('MUTED');
      this.recordAction('⏸  Microphone muted by user', 'warning');
    } else {
      this.setStatus('LISTENING');
      this.recordAction('▶  Microphone resumed', 'file');
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
      this.recordAction(`✓  Switched active target to ${path.relative(process.cwd(), filePath) || filePath}`, 'file');
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
  }
}
