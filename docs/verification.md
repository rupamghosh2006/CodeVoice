# CodeVoice Verification and Testing

This document details the verification methodology, test suites, integration test matrices, and validation results across all phases of CodeVoice.

---

## Test Suites Overview

CodeVoice includes five distinct verification layers:

1. **Automated End-to-End Test Suite (`npm run test:agents`)**: Tests multilingual intent routing, destructive keyword interception, direct disk file writes, Git subprocess execution, active file switching, and branch deletion against live Gemini and Git binaries (9 tests).
2. **Transliteration & Latency Benchmark Suite (`npm run test:translit`)**: Validates Devanagari detection, Roman-script Hinglish transliteration via Gemini, zero-overhead passthrough on English, and technical identifier preservation.
3. **Real-time Microphone Pipeline Test (`npm run phase1`)**: Validates continuous 16kHz mono PCM16 microphone capture via SoX, WebSocket session handshake with AssemblyAI's `universal-3-5-pro`, streaming partial turns, and clean session termination.
4. **Beta Endpoint Diagnostic Probe (`npm run phase0`)**: Verifies HTTP multipart behavior on `https://dictation.assemblyai.com/transcribe` versus WebSocket streaming on `wss://streaming.assemblyai.com/v3/ws`.
5. **TypeScript Compiler Verification (`npm run build`)**: Verifies strict type-checking across all source modules without emitting errors.

---

## 1. Automated Integration Test Suite (`test:agents`)

The primary automated test runner is located in `scripts/test-agents.ts`. It executes nine real-world developer scenarios sequentially against live services.

### Test Matrix and Validation Results

| Test Number | Scenario | Input Utterance | Expected Intent | Actual Result | Status |
|---|---|---|---|---|---|
| **Test 1** | Hinglish Code Generation | "Ek function banao jo email validate kare" | `code_generation` | Routed to `code_generation` with instruction "Create a function that validates email" | PASSED |
| **Test 2** | Hinglish Code Editing | "useEffect ke andar API call add karo" | `code_edit` | Routed to `code_edit` with instruction "Add an API call inside useEffect" | PASSED |
| **Test 3** | Hinglish Git Branching | "Nayi branch banao feature-email" | `git_branch` (`name: "feature-email"`) | Routed to `git_branch`, sanitized to "feature-email" | PASSED |
| **Test 4** | Destructive Command Interception | "force push master branch" | Throws `DestructiveIntentError` | Intercepted pre-LLM with matched keyword "force push" | PASSED |
| **Test 5** | Code Agent Filesystem Write | Create `validateEmail` function | Generates TypeScript and appends to `demo/sample.ts` | File modified on disk, contains valid `validateEmail` declaration | PASSED |
| **Test 6** | Git Agent Subprocess Execution | `git_status` intent | Executes `git status` via `execFile` | Exit code 0, repository status output captured and displayed | PASSED |
| **Test 7** | Dynamic File Switching | "Switch to src/auth.ts" | `file_switch` (`path: "src/auth.ts"`) | Routed to `file_switch`, target file pointer updated | PASSED |
| **Test 8** | File Deletion Routing | "demo.ts ko delete kar do" | `file_delete` (`path: "demo.ts"`) | Intercepted pre-LLM, routed with bypass, path extracted | PASSED |
| **Test 9** | Git Branch Deletion & Safety | "Delete branch feature-temp" | `git_branch_delete` (`name: "feature-temp"`) | Intercepted pre-LLM, routed with bypass, executed `git branch -D` | PASSED |

### Execution Command
```bash
npm run test:agents
```

### Typical Test Output
```text
╔══════════════════════════════════════════════╗
║  CodeVoice -- Intent & Agent Pipeline Test    ║
╚══════════════════════════════════════════════╝

Test 1: Routing Hinglish Code Gen...
Result: {
  "type": "code_generation",
  "instruction": "Create a function that validates email"
}
[PASSED] Test 1

Test 2: Routing Hinglish Code Edit...
Result: {
  "type": "code_edit",
  "instruction": "Add an API call inside useEffect"
}
[PASSED] Test 2

Test 3: Routing Hinglish Git Branch...
Result: {
  "type": "git_branch",
  "name": "feature-email"
}
[PASSED] Test 3

Test 4: Destructive Intent Interception...
[PASSED] Successfully intercepted: "force push"
[PASSED] Test 4

Test 5: Executing Code Agent with Gemini...
Initial demo/sample.ts length: 425
Generated Code:
export function validateEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}
[PASSED] Test 5 (demo/sample.ts successfully written)

Test 6: Executing Git Agent (git status)...
Git output:
On branch main
nothing to commit, working tree clean
[PASSED] Test 6

Test 7: Routing File Switch Intent...
Result: {
  "type": "file_switch",
  "path": "src/auth.ts"
}
[PASS] Test 7 Passed

Test 8: File Delete (Safety Interception & Routing)...
[OK] Successfully intercepted file deletion: "delete"
Result: {
  "type": "file_delete",
  "path": "demo.ts"
}
[PASS] Test 8 Passed

Test 9: Git Branch Delete (Routing, Safety & Execution)...
[OK] Successfully intercepted branch deletion: "delete branch"
Result: {
  "type": "git_branch_delete",
  "name": "feature-temp"
}
Git branch delete output: Deleted branch feature-temp (was 23ca503).
[PASS] Test 9 Passed

[SUCCESS] ALL TESTS PASSED! Intent router, Code agent, Git agent, and File operations are fully functioning.
```

---

## 2. Transliteration & Latency Benchmark Suite (`test:translit`)

The transliteration benchmark suite is located in `scripts/test-transliteration.ts`. It verifies bilingual Hindi/English handling and benchmarks the added latency.

### Test Matrix and Validation Results

| Test Number | Scenario | Input Utterance | Expected Result | Status |
|---|---|---|---|---|
| **Test 1** | Devanagari Detection | "एक फंक्शन बनाओ", "useEffect के अंदर call add करो" | `hasDevanagari() === true`; zero false positives on English / Git | PASSED |
| **Test 2** | Pure English Bypass | "Create an email validation function" | `transliterated: false`, latency: `0ms` | PASSED |
| **Test 3** | Pure Hindi Devanagari | "एक फंक्शन बनाओ" | Romanized: "Ek function banao" | PASSED |
| **Test 4** | Mixed Hinglish & Technical Terms | "useEffect के अंदर एक API call add करो" | Preserves `useEffect` and `API` | PASSED |
| **Test 5** | Devanagari Git Routing | "नयी branch बनाओ feature-login" | Romanized and routed to `git_branch` (`feature-login`) | PASSED |
| **Test 6** | Safety Gate on Transliterated Input | "force push करो master branch pe" | Romanized and trips `force push` pre-LLM gate | PASSED |

### Execution Command
```bash
npm run test:translit
```

---

## 3. Real-Time Microphone & AssemblyAI Streaming (`phase1`)

The standalone microphone pipeline test is located in `scripts/phase1-mic-test.ts`.

### Verification Objectives
- Confirm that `sox` captures audio at 16,000 Hz, mono channel, signed 16-bit PCM.
- Verify the WebSocket handshake with `wss://streaming.assemblyai.com/v3/ws`.
- Validate that the `universal-3-5-pro` model receives audio and emits `Turn` events.
- Verify that `keyterms_prompt` query parameter successfully biases recognition for technical identifiers (`useEffect`, `JWT`, `TypeScript`).
- Verify that session termination (`{"type":"Terminate"}`) closes the connection cleanly with code `1005` or `1000`.

### Execution Command
```bash
npm run phase1
```

### Verification Criteria
1. **Handshake**: Terminal displays `AssemblyAI session ready -- speak now!`.
2. **Live Partials**: Blue partial line (`● ...`) updates in real-time as you speak.
3. **Final Turn**: Green final block displays formatted text with filler words stripped.
4. **Disfluency Comparison**: If filler words were present, raw transcript displays below the clean transcript.
5. **Clean Shutdown**: Audio recording stops, `Terminate` is acknowledged, and session closes without orphaned background tasks.

---

## 4. Beta Endpoint Diagnostic Probe (`phase0`)

The diagnostic script `scripts/phase0-probe.ts` was used during Phase 0 to evaluate endpoint architecture.

### Findings Matrix

| Dimension | Beta Endpoint (`/transcribe`) | Flagship WebSocket (`/v3/ws`) |
|---|---|---|
| **Protocol** | Synchronous HTTP POST (`multipart/form-data`) | Real-time bidirectional WebSocket |
| **Model** | Default dictation model | `universal-3-5-pro` |
| **Latency** | ~1,600 ms (batch clip roundtrip) | Sub-second streaming partials |
| **Custom Vocabulary** | Not supported via request parameters | Supported via `keyterms_prompt` (up to 100 terms) |
| **Domain Steering** | Not supported via request parameters | Supported via `prompt` query parameter |
| **Use Case in CodeVoice** | Clip analysis benchmark | **Primary real-time voice streaming engine** |

---

## 5. TypeScript Compiler and Build Verification

CodeVoice enforces strict TypeScript compilation rules (`strict: true`, `noImplicitAny: true`, `target: ES2022`).

### Type-Check Command
```bash
npx tsc --noEmit
```
Returns exit code `0` with zero diagnostic errors.

### Build Command
```bash
npm run build
```
Compiles source files into `dist/` and ensures all module resolution paths resolve properly in production Node.js runtimes.

---

## 5. Verification Checklist for Hackathon Evaluators

When evaluating CodeVoice locally, follow this sequence:

1. **Environment Setup**:
   - Verify Node.js: `node -v` (>= 18.0.0)
   - Verify SoX: `sox --version`
   - Verify Keys: Ensure `ASSEMBLYAI_API_KEY` and `GEMINI_API_KEY` are present in `.env`.
2. **Automated Validation**:
   - Run `npm run test:agents` -> verify all 7 tests output `[PASSED]`.
3. **Live Hardware Validation**:
   - Run `npm run phase1` -> speak for 15 seconds -> verify partials and final transcript.
4. **Interactive VS Code Session**:
   - Run `npm run dev` in the terminal beside an open `demo/sample.ts` tab.
   - Speak: "Ek function banao jo email validate kare".
   - Confirm the editor tab updates immediately with the generated function.
   - Speak: "Force push master".
   - Confirm the terminal pauses and requests interactive `(y/N)` confirmation before proceeding.

---

[Back to README](../README.md)

