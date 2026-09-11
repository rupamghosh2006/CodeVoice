import * as dns from 'node:dns';
dns.setDefaultResultOrder('ipv4first');

import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.join(process.cwd(), '.env') });

import { transliterateIfNeeded, hasDevanagari } from '../src/voice/transliterate';
import { routeIntent, DestructiveIntentError } from '../src/intent/router';

interface LatencyRecord {
  input: string;
  output: string;
  latencyMs: number;
}

async function runTransliterationTests() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║  CodeVoice — Devanagari Transliteration & Latency Benchmark  ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  const records: LatencyRecord[] = [];

  // ── Test 1: Devanagari Detection ──────────────────────────────────────────
  console.log('--- Test 1: hasDevanagari Unicode Detector ---');
  if (!hasDevanagari('एक फंक्शन बनाओ')) throw new Error('Failed to detect pure Devanagari');
  if (!hasDevanagari('useEffect के अंदर call add करो')) throw new Error('Failed to detect mixed Devanagari');
  if (hasDevanagari('create a function that validates email')) throw new Error('False positive on pure English');
  if (hasDevanagari('git checkout -b feature-login')) throw new Error('False positive on pure Git command');
  console.log('[PASS] Detector correctly distinguishes Devanagari vs Roman/English text.\n');

  // ── Test 2: Pure English Skip (Zero Latency) ──────────────────────────────
  console.log('--- Test 2: Pure English Skip (Zero Latency) ---');
  const englishInput = 'Create an email validation function';
  const englishResult = await transliterateIfNeeded(englishInput);
  console.log(`Input:        "${englishInput}"`);
  console.log(`Output:       "${englishResult.text}"`);
  console.log(`Transliterated: ${englishResult.transliterated}`);
  console.log(`Latency:      ${englishResult.latencyMs}ms`);
  if (englishResult.transliterated || englishResult.latencyMs !== 0 || englishResult.text !== englishInput) {
    throw new Error('English text was not properly skipped!');
  }
  console.log('[PASS] Pure English bypassed transliteration with 0ms added latency.\n');

  // ── Test 3: Pure Hindi in Devanagari ───────────────────────────────────────
  console.log('--- Test 3: Pure Hindi in Devanagari ---');
  const hindiInput = 'एक फंक्शन बनाओ';
  const hindiResult = await transliterateIfNeeded(hindiInput);
  records.push({ input: hindiInput, output: hindiResult.text, latencyMs: hindiResult.latencyMs });
  console.log(`Original:     "${hindiResult.original}"`);
  console.log(`Romanized:    "${hindiResult.text}"`);
  console.log(`Latency:      ${hindiResult.latencyMs}ms`);
  if (!hindiResult.transliterated || hasDevanagari(hindiResult.text)) {
    throw new Error('Failed to transliterate pure Hindi Devanagari text');
  }
  console.log('[PASS] Pure Hindi successfully romanized.\n');
  await new Promise((r) => setTimeout(r, 1500));

  // ── Test 4: Mixed Hinglish with Code Identifiers ─────────────────────────
  console.log('--- Test 4: Mixed Hinglish with Technical Terms ---');
  const mixedInput = 'useEffect के अंदर एक API call add करो';
  const mixedResult = await transliterateIfNeeded(mixedInput);
  records.push({ input: mixedInput, output: mixedResult.text, latencyMs: mixedResult.latencyMs });
  console.log(`Original:     "${mixedResult.original}"`);
  console.log(`Romanized:    "${mixedResult.text}"`);
  console.log(`Latency:      ${mixedResult.latencyMs}ms`);
  if (!mixedResult.text.toLowerCase().includes('useeffect') || !mixedResult.text.toLowerCase().includes('api')) {
    throw new Error(`Technical identifiers lost in: "${mixedResult.text}"`);
  }
  if (hasDevanagari(mixedResult.text)) {
    throw new Error('Devanagari characters remaining in transliteration');
  }
  console.log('[PASS] Mixed Hinglish transliterated while preserving technical terms.\n');
  await new Promise((r) => setTimeout(r, 1500));

  // ── Test 5: Git Command in Devanagari ──────────────────────────────────────
  console.log('--- Test 5: Git Command in Devanagari ---');
  const gitInput = 'नयी branch बनाओ feature-login';
  const gitResult = await transliterateIfNeeded(gitInput);
  records.push({ input: gitInput, output: gitResult.text, latencyMs: gitResult.latencyMs });
  console.log(`Original:     "${gitResult.original}"`);
  console.log(`Romanized:    "${gitResult.text}"`);
  console.log(`Latency:      ${gitResult.latencyMs}ms`);
  if (!gitResult.text.includes('feature-login')) {
    throw new Error('Branch name altered in transliteration');
  }
  // Route with the romanized text
  const intent = await routeIntent(gitResult.text);
  console.log(`Routed Intent: [${intent.type}] ${JSON.stringify(intent)}`);
  if (intent.type !== 'git_branch' || !('name' in intent) || !intent.name.includes('feature-login')) {
    throw new Error(`Expected git_branch with name feature-login, got: ${JSON.stringify(intent)}`);
  }
  console.log('[PASS] Devanagari Git command romanized and correctly routed.\n');
  await new Promise((r) => setTimeout(r, 1500));

  // ── Test 6: Destructive Safety Gate with Devanagari Input ────────────────
  console.log('--- Test 6: Destructive Safety Gate Integration ---');
  const destructiveInput = 'force push करो master branch pe';
  const destructiveResult = await transliterateIfNeeded(destructiveInput);
  records.push({ input: destructiveInput, output: destructiveResult.text, latencyMs: destructiveResult.latencyMs });
  console.log(`Original:     "${destructiveResult.original}"`);
  console.log(`Romanized:    "${destructiveResult.text}"`);
  console.log(`Latency:      ${destructiveResult.latencyMs}ms`);
  let intercepted = false;
  try {
    await routeIntent(destructiveResult.text);
  } catch (err) {
    if (err instanceof DestructiveIntentError) {
      intercepted = true;
      console.log(`[OK] Intercepted destructive keyword "${err.matchedKeyword}" on romanized text.`);
    } else {
      throw err;
    }
  }
  if (!intercepted) throw new Error('Safety gate failed to intercept destructive command');
  console.log('[PASS] Destructive command safety-gate verified on romanized text.\n');
  await new Promise((r) => setTimeout(r, 1500));

  // ── Test 7: Additional Developer Vocabulary Test ─────────────────────────
  console.log('--- Test 7: Git Status in Devanagari ---');
  const statusInput = 'गिट स्टेटस दिखाओ';
  const statusResult = await transliterateIfNeeded(statusInput);
  records.push({ input: statusInput, output: statusResult.text, latencyMs: statusResult.latencyMs });
  console.log(`Original:     "${statusResult.original}"`);
  console.log(`Romanized:    "${statusResult.text}"`);
  console.log(`Latency:      ${statusResult.latencyMs}ms`);
  const statusIntent = await routeIntent(statusResult.text);
  console.log(`Routed Intent: [${statusIntent.type}]`);
  if (statusIntent.type !== 'git_status') {
    throw new Error(`Expected git_status, got ${statusIntent.type}`);
  }
  console.log('[PASS] "गिट स्टेटस दिखाओ" correctly romanized and routed to git_status.\n');

  // ── Summary & Latency Benchmark ──────────────────────────────────────────
  console.log('================================================================');
  console.log('           TRANSLITERATION LATENCY BENCHMARK REPORT             ');
  console.log('================================================================');
  console.log('| Original Devanagari                     | Romanized Script                      | Latency (ms) |');
  console.log('|-----------------------------------------|---------------------------------------|--------------|');
  let totalLatency = 0;
  for (const r of records) {
    totalLatency += r.latencyMs;
    const origPad = r.input.padEnd(39, ' ');
    const outPad = r.output.padEnd(37, ' ');
    const latPad = `${r.latencyMs}ms`.padStart(12, ' ');
    console.log(`| ${origPad} | ${outPad} | ${latPad} |`);
  }
  const avgLatency = Math.round(totalLatency / records.length);
  console.log('|-----------------------------------------|---------------------------------------|--------------|');
  console.log(`| AVERAGE ADDED LATENCY FOR DEVANAGARI:                           | ${`${avgLatency}ms`.padStart(12, ' ')} |`);
  console.log(`| ADDED LATENCY FOR ENGLISH TURNS:                                | ${'0ms'.padStart(12, ' ')} |`);
  console.log('================================================================\n');

  console.log('[SUCCESS] All transliteration and pipeline tests passed successfully!');
}

runTransliterationTests().catch((err) => {
  console.error('[FAIL] Transliteration test failed:', err);
  process.exit(1);
});
