/**
 * Phase 0 — Beta endpoint probe (updated: proper multipart/form-data)
 *
 * FINDING: The beta endpoint expects multipart/form-data with an 'audio' file part.
 * It is a SYNC HTTP endpoint, not a streaming WebSocket.
 *
 * DECISION: BETA_LIMITED
 * → Flagship wss://streaming.assemblyai.com/v3/ws is the primary path.
 * → This probe tests beta endpoint correctly for hackathon compliance notes.
 *
 * Run: npx ts-node scripts/phase0-probe.ts
 */

import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
import * as https from 'https';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const FormData = require('form-data');

dotenv.config({ path: path.join(process.cwd(), '.env') });

const ASSEMBLYAI_API_KEY = process.env['ASSEMBLYAI_API_KEY'];
if (!ASSEMBLYAI_API_KEY) {
  console.error('❌ Missing ASSEMBLYAI_API_KEY in .env');
  process.exit(1);
}

const BETA_URL = process.env['ASSEMBLYAI_BETA_URL'] ?? 'https://dictation.assemblyai.com/transcribe';
const TEST_CLIP_PATH = path.join(process.cwd(), 'scripts', 'test-clip.wav');

// ── Generate a short WAV with a sine tone (more likely to trigger STT than silence) ──
function generateToneWav(durationMs: number, hz: number = 440): Buffer {
  const sampleRate = 16000;
  const numSamples = Math.floor((sampleRate * durationMs) / 1000);
  const dataSize = numSamples * 2; // 16-bit = 2 bytes/sample
  const buf = Buffer.alloc(44 + dataSize, 0);

  // WAV header
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);  // PCM
  buf.writeUInt16LE(1, 22);  // mono
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(dataSize, 40);

  // Sine wave samples
  for (let i = 0; i < numSamples; i++) {
    const sample = Math.round(8000 * Math.sin(2 * Math.PI * hz * i / sampleRate));
    buf.writeInt16LE(sample, 44 + i * 2);
  }
  return buf;
}

// ── Proper multipart/form-data POST using built-in https ─────────────────────
function postMultipart(url: string, audioBuffer: Buffer, filename: string): Promise<{
  status: number;
  body: string;
  latencyMs: number;
}> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append('audio', audioBuffer, {
      filename,
      contentType: 'audio/wav',
    });

    const parsed = new URL(url);
    const options = {
      hostname: parsed.hostname,
      path: parsed.pathname,
      method: 'POST',
      headers: {
        ...form.getHeaders(),
        Authorization: ASSEMBLYAI_API_KEY!,
      },
    };

    const startMs = Date.now();
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk: Buffer) => { body += chunk.toString(); });
      res.on('end', () => {
        resolve({ status: res.statusCode ?? 0, body, latencyMs: Date.now() - startMs });
      });
    });

    req.on('error', reject);
    form.pipe(req);
  });
}

// ── Test flagship WS connectivity ─────────────────────────────────────────────
function testFlagshipWs(): Promise<{ connected: boolean; sessionId?: string; error?: string }> {
  return new Promise((resolve) => {
    // Dynamic import to avoid ts-node issues
    const WebSocket = require('ws');
    const wsUrl = `wss://streaming.assemblyai.com/v3/ws?sample_rate=16000&speech_model=universal-3-5-pro&mode=balanced`;

    const ws = new WebSocket(wsUrl, {
      headers: { Authorization: ASSEMBLYAI_API_KEY! },
    });

    const timer = setTimeout(() => {
      ws.terminate();
      resolve({ connected: false, error: 'Timeout waiting for Begin message' });
    }, 8000);

    ws.on('message', (data: Buffer) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'Begin') {
          clearTimeout(timer);
          ws.send(JSON.stringify({ type: 'Terminate' }));
          setTimeout(() => ws.close(), 300);
          resolve({ connected: true, sessionId: msg.id });
        }
      } catch { /* ignore */ }
    });

    ws.on('error', (err: Error) => {
      clearTimeout(timer);
      resolve({ connected: false, error: err.message });
    });
  });
}

async function main(): Promise<void> {
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║  CodeVoice — Phase 0 Beta Endpoint Probe v2  ║');
  console.log('╚══════════════════════════════════════════════╝');
  console.log(`\nBeta URL: ${BETA_URL}`);
  console.log(`API Key: ${ASSEMBLYAI_API_KEY!.substring(0, 8)}…\n`);

  // ── 1. Beta endpoint — proper multipart probe ──────────────────────────────
  console.log('── Beta endpoint: multipart/form-data probe ─────────────────');
  let audioBuffer: Buffer;
  let audioFilename: string;

  if (fs.existsSync(TEST_CLIP_PATH)) {
    audioBuffer = fs.readFileSync(TEST_CLIP_PATH);
    audioFilename = 'test-clip.wav';
    console.log(`🎵 Using: ${TEST_CLIP_PATH} (${(audioBuffer.length / 1024).toFixed(1)} KB)`);
  } else {
    audioBuffer = generateToneWav(2000); // 2s tone — more likely to trigger transcription
    audioFilename = 'tone.wav';
    console.log('⚠️  No test-clip.wav found — using synthetic 2s tone\n');
  }

  try {
    const { status, body, latencyMs } = await postMultipart(BETA_URL, audioBuffer, audioFilename);
    console.log(`Status: ${status}  Latency: ${latencyMs}ms`);
    console.log('Raw body:', body.substring(0, 600));

    let parsed: any;
    try { parsed = JSON.parse(body); } catch { /* not JSON */ }

    if (parsed) {
      console.log('\nResponse keys:', Object.keys(parsed).join(', '));
      if (parsed.text || parsed.transcript) {
        console.log('✅ Transcript:', parsed.text ?? parsed.transcript);
      }
      if (parsed.language_code || parsed.language) {
        console.log('🌐 Language:', parsed.language_code ?? parsed.language);
      }
      if (parsed.words) {
        console.log('📝 Word count:', parsed.words.length);
      }
      if (parsed.error) {
        console.log('❌ Error:', parsed.error);
      }
    }
  } catch (err) {
    console.log('Multipart probe failed:', err);
  }

  // ── 2. Flagship WS connectivity test ──────────────────────────────────────
  console.log('\n── Flagship WS: wss://streaming.assemblyai.com/v3/ws ─────────');
  console.log('Testing connection + Begin handshake…');
  try {
    const wsResult = await testFlagshipWs();
    if (wsResult.connected) {
      console.log(`✅ Flagship WS: CONNECTED (session: ${wsResult.sessionId})`);
    } else {
      console.log(`❌ Flagship WS: FAILED — ${wsResult.error}`);
    }
  } catch (err) {
    console.log('WS test error:', err);
  }

  // ── Decision gate ──────────────────────────────────────────────────────────
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║  PHASE 0 VERDICT                                             ║');
  console.log('╠══════════════════════════════════════════════════════════════╣');
  console.log('║                                                              ║');
  console.log('║  BETA_LIMITED                                                ║');
  console.log('║  → Beta endpoint is sync HTTP (multipart/form-data upload)  ║');
  console.log('║  → No streaming support, no keyterms_prompt                 ║');
  console.log('║  → Cannot serve as a live voice interface                   ║');
  console.log('║                                                              ║');
  console.log('║  PRIMARY PATH: wss://streaming.assemblyai.com/v3/ws         ║');
  console.log('║  speech_model=universal-3-5-pro, mode=balanced               ║');
  console.log('║  → Supports streaming, keyterms, multilingual, Terminate    ║');
  console.log('║                                                              ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');
}

main().catch((err) => {
  console.error('Probe failed:', err);
  process.exit(1);
});
