import { EventEmitter } from 'events';
import { logger } from '../utils/logger';

// node-record-lpcm16 uses SoX (or arecord on Linux) as a subprocess —
// no native compilation needed. On Windows, install SoX: https://sox.sourceforge.net/
// Homebrew on mac: brew install sox
let record: any;
try {
  record = require('node-record-lpcm16');
} catch {
  logger.warn(
    'node-record-lpcm16 not installed. Run: npm install\n' +
    'Also install SoX: https://sox.sourceforge.net/ (Windows) or `brew install sox` (mac)\n' +
    'On Windows you can also try: choco install sox.portable'
  );
}

export interface CaptureConfig {
  sampleRate?: number; // default 16000
  channels?: number;   // default 1 (mono)
}

/**
 * MicCapture streams raw PCM16 audio from the default microphone.
 * Emits 'audio' events with Buffer chunks.
 * Uses node-record-lpcm16 (SoX subprocess) — no native compilation required.
 */
export class MicCapture extends EventEmitter {
  private readonly sampleRate: number;
  private readonly channels: number;
  private recording: any = null;
  private _running = false;

  constructor(cfg: CaptureConfig = {}) {
    super();
    this.sampleRate = cfg.sampleRate ?? 16000;
    this.channels = cfg.channels ?? 1;
  }

  get isRunning(): boolean {
    return this._running;
  }

  start(): void {
    if (this._running) return;
    if (!record) {
      this.emit('error', new Error(
        'node-record-lpcm16 not available. Install SoX and run npm install.'
      ));
      return;
    }

    try {
      this.recording = record.record({
        sampleRate: this.sampleRate,
        channels: this.channels,
        audioType: 'raw',
        recorder: 'sox',
        silence: '0',
      });

      const stream = this.recording.stream();

      stream.on('data', (chunk: Buffer) => {
        this.emit('audio', chunk);
      });

      stream.on('error', (err: Error) => {
        logger.error('Mic capture error:', err);
        this.emit('error', err);
      });

      stream.on('end', () => {
        this._running = false;
        this.emit('end');
      });

      this._running = true;
      logger.info(`Mic capture started: ${this.sampleRate}Hz, ${this.channels}ch`);
    } catch (err) {
      this.emit('error', err instanceof Error ? err : new Error(String(err)));
    }
  }

  stop(): void {
    if (!this._running || !this.recording) return;
    try {
      this.recording.stop();
    } catch (err) {
      logger.warn('Error stopping mic:', err);
    }
    this._running = false;
    this.emit('end');
    logger.info('Mic capture stopped.');
  }
}
