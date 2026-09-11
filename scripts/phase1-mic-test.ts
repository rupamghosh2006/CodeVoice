/**
 * Phase 1 mic test — validates the voice pipeline end-to-end:
 *   Mic → 16kHz PCM16 → AssemblyAI WS → transcript in terminal
 *
 * Prerequisites:
 *   1. SoX installed: choco install sox.portable  (or scoop install sox)
 *   2. ASSEMBLYAI_API_KEY in .env
 *
 * Run: npx ts-node scripts/phase1-mic-test.ts
 * Speak for 15 seconds, then it stops automatically.
 * Watch for: partial transcripts (blue), final turns (green), filler word removal.
 */

import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.join(process.cwd(), '.env') });

// Validate key before doing anything
const key = process.env['ASSEMBLYAI_API_KEY'];
if (!key) {
  console.error('❌ Missing ASSEMBLYAI_API_KEY in .env');
  process.exit(1);
}

import { MicCapture } from '../src/voice/capture';
import { StreamingClient } from '../src/voice/streaming';

const DURATION_SEC = 15;
const RESET = '\x1b[0m';
const BLUE = '\x1b[34m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';

async function main(): Promise<void> {
  console.log(`\n${BOLD}╔══════════════════════════════════════╗${RESET}`);
  console.log(`${BOLD}║  CodeVoice — Phase 1 Mic Test        ║${RESET}`);
  console.log(`${BOLD}╚══════════════════════════════════════╝${RESET}`);
  console.log(`\nRecording for ${DURATION_SEC}s. Speak naturally (English or Hinglish).`);
  console.log(`Try: "useEffect ke andar ek API call add karo, um, like, JWT token ke saath"\n`);
  console.log(`${BLUE}● Partial (in progress)${RESET}`);
  console.log(`${GREEN}✓ Final turn (end_of_turn=true, formatted)${RESET}`);
  console.log(`${DIM}↳ Raw (pre-format, shows filler words)${RESET}\n`);

  const mic = new MicCapture({ sampleRate: 16000, channels: 1 });
  const streaming = new StreamingClient();

  let partialCount = 0;
  let finalCount = 0;

  streaming.on('ready', () => {
    console.log(`${GREEN}[OK] AssemblyAI session ready — speak now!${RESET}\n`);
    mic.start();
  });

  streaming.on('transcript', (event) => {
    if (!event.isFinal) {
      // Overwrite the partial line in place
      process.stdout.write(`\r${BLUE}* ${event.text.substring(0, 80)}${RESET}                `);
      partialCount++;
    } else {
      // Clear the partial line and print the final turn
      process.stdout.write('\r' + ' '.repeat(90) + '\r');

      console.log(`${GREEN}[FINAL]  ${event.text}${RESET}`);
      if (event.rawText && event.rawText !== event.text) {
        console.log(`${DIM}  ↳ Raw:   ${event.rawText}${RESET}`);
      }
      if (event.language) {
        console.log(`${YELLOW}  ↳ Lang:  ${event.language}${RESET}`);
      }
      console.log();
      finalCount++;
    }
  });

  streaming.on('error', (err) => {
    console.error(`\n[ERROR] Streaming error: ${err.message}`);
  });

  mic.on('audio', (chunk) => {
    streaming.sendAudio(chunk);
  });

  mic.on('error', (err) => {
    console.error(`\n[ERROR] Mic error: ${err.message}`);
    console.error('Make sure SoX is installed: choco install sox.portable');
    process.exit(1);
  });

  // Connect and let the 'ready' event start the mic
  streaming.connect();

  // Auto-stop after DURATION_SEC
  await new Promise<void>((resolve) => setTimeout(resolve, DURATION_SEC * 1000));

  console.log(`\n${BOLD}── Stopping… ──${RESET}`);
  mic.stop();
  streaming.terminate();

  // Give the WS a moment to send Terminate and receive Termination
  await new Promise<void>((resolve) => setTimeout(resolve, 1000));

  console.log(`\n${BOLD}── Phase 1 Results ──${RESET}`);
  console.log(`Partials received : ${partialCount}`);
  console.log(`Final turns       : ${finalCount}`);
  console.log(`\n${finalCount > 0 ? '[PASS]' : '[WARN] No finals — check mic/SoX setup'}`);
  console.log('\nNext: check that:');
  console.log('  1. Filler words (um, uh, like) are stripped from FINAL but may appear in Raw');
  console.log('  2. Technical terms (useEffect, JWT, API) appear correctly spelled');
  console.log('  3. Language field shows "hi-en" or similar for Hinglish speech\n');

  process.exit(0);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
