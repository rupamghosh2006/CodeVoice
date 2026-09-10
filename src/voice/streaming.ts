import WebSocket from 'ws';
import { EventEmitter } from 'events';
import { config } from '../utils/config';
import { logger } from '../utils/logger';
import { KEYTERMS } from '../../demo/keyterms';

// ── Server message types (per AssemblyAI streaming v3 protocol) ───────────────

interface BeginMessage {
  type: 'Begin';
  id: string;
  expires_at: number;
}

interface SpeechStartedMessage {
  type: 'SpeechStarted';
  audio_start: number;
}

interface TurnMessage {
  type: 'Turn';
  /** The current best-guess transcript (partial or final) */
  transcript: string;
  /** When true, this is the final formatted transcript for this turn */
  end_of_turn: boolean;
  /** Detected language code e.g. "hi", "en", "hi-en" */
  language?: string;
  /** Raw (pre-formatting) transcript — shown alongside clean for demo */
  raw_transcript?: string;
  /** Turn ID */
  turn_order?: number;
}

interface TerminationMessage {
  type: 'Termination';
  audio_duration_seconds: number;
  session_duration_seconds: number;
}

type ServerMessage = BeginMessage | SpeechStartedMessage | TurnMessage | TerminationMessage;

// ── Events emitted by StreamingClient ────────────────────────────────────────

export interface TranscriptEvent {
  /** Cleaned, formatted transcript text */
  text: string;
  /** Raw disfluent text for before/after demo panel */
  rawText?: string;
  /** Detected language code */
  language?: string;
  /** True = final turn; false = partial */
  isFinal: boolean;
}

export type StreamingClientEvents = {
  ready: [];
  transcript: [event: TranscriptEvent];
  error: [err: Error];
  closed: [];
};

/**
 * AssemblyAI real-time streaming client.
 *
 * Key protocol facts (from live docs):
 * - Auth: raw API key in Authorization header — NO Bearer prefix
 * - Send binary PCM16 frames as audio
 * - Send {"type":"Terminate"} on shutdown — ALWAYS, or session stays billable
 * - Turn.end_of_turn=true means finalized + formatted transcript
 * - keyterms_prompt steers recognition toward project vocabulary
 */
export class StreamingClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private _terminated = false;
  private _sessionId: string | null = null;

  connect(): void {
    if (this.ws) return;

    // Build query string — speech_model is singular (not speech_models array)
    // keyterms_prompt: JSON-stringified array of strings per AssemblyAI docs
    const params = new URLSearchParams({
      sample_rate: '16000',
      speech_model: config.assemblyai.speechModel,
      mode: config.assemblyai.mode,
      prompt: 'Software development voice commands in English and Hindi for code generation and Git actions.',
      keyterms_prompt: JSON.stringify(KEYTERMS.slice(0, 50)),
    });

    const url = `${config.assemblyai.wsUrl}?${params.toString()}`;

    logger.info(`Connecting to AssemblyAI streaming (${KEYTERMS.length} keyterms)`);

    this.ws = new WebSocket(url, {
      headers: {
        // Raw API key — NO "Bearer" prefix (Voice Agent API is the only exception)
        Authorization: config.assemblyai.apiKey,
      },
    });

    this.ws.on('open', () => {
      logger.info('AssemblyAI WS connected — waiting for Begin…');
    });

    this.ws.on('message', (data: WebSocket.RawData) => {
      this._handleMessage(data.toString());
    });

    this.ws.on('error', (err) => {
      logger.error('WS error:', err);
      this.emit('error', err);
    });

    this.ws.on('close', (code, reason) => {
      logger.info(`WS closed: ${code} ${reason.toString()}`);
      this.ws = null;
      this._terminated = false;
      this._sessionId = null;
      this.emit('closed');
    });

    // Always terminate on process exit
    const terminate = () => this.terminate();
    process.once('exit', terminate);
    process.once('SIGINT', () => { terminate(); process.exit(0); });
    process.once('SIGTERM', () => { terminate(); process.exit(0); });
  }

  get isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  /** Send a PCM16 audio chunk to AssemblyAI */
  sendAudio(chunk: Buffer): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(chunk);
    }
  }

  /**
   * Send Terminate and close the connection.
   * MUST be called on session end — abandoned sessions keep accruing charges.
   */
  terminate(): void {
    if (this._terminated || !this.ws) return;
    this._terminated = true;
    logger.info('Sending Terminate to AssemblyAI…');
    try {
      if (this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'Terminate' }));
        setTimeout(() => {
          if (this.ws) {
            try { this.ws.close(); } catch { /* ignore */ }
            this.ws = null;
            this._terminated = false;
          }
        }, 500);
      } else {
        this.ws = null;
        this._terminated = false;
      }
    } catch (err) {
      logger.warn('Error sending Terminate:', err);
      this.ws = null;
      this._terminated = false;
    }
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private _handleMessage(raw: string): void {
    let msg: ServerMessage;
    try {
      msg = JSON.parse(raw) as ServerMessage;
    } catch {
      logger.warn('Non-JSON WS message:', raw);
      return;
    }

    switch (msg.type) {
      case 'Begin':
        this._sessionId = msg.id;
        logger.info(`Session started: ${msg.id}`);
        this.emit('ready');
        break;

      case 'SpeechStarted':
        logger.debug('Speech detected at', msg.audio_start, 'ms');
        break;

      case 'Turn':
        this.emit('transcript', {
          text: msg.transcript,
          rawText: msg.raw_transcript,
          language: msg.language,
          isFinal: msg.end_of_turn,
        } satisfies TranscriptEvent);
        break;

      case 'Termination':
        logger.info(
          `Session terminated. Audio: ${msg.audio_duration_seconds}s, Session: ${msg.session_duration_seconds}s`
        );
        break;

      default:
        logger.debug('Unknown message type:', (msg as any).type);
    }
  }
}
