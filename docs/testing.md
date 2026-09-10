# CodeVoice Testing Guide

This guide details the testing architecture, test execution workflows, test suite breakdown, and guidelines for writing new automated tests for CodeVoice.

For live validation matrices, evaluator checklists, and historical test run logs, refer to [Verification and Testing](verification.md).

---

## Testing Strategy

CodeVoice combines voice recognition, large language model intent routing, direct disk modifications, and Git subprocess execution. Because errors in file modifications or Git execution can impact source repositories, testing is divided into distinct, isolated layers:

```text
+-------------------------------------------------------------------------+
|                           Testing Strategy                              |
+-------------------------------------------------------------------------+
|                                                                         |
|  1. Static Type Checking        -> tsc --noEmit (TypeScript compiler)   |
|                                                                         |
|  2. Audio Pipeline Testing      -> npm run phase1 (SoX -> PCM16 -> WS)  |
|                                                                         |
|  3. Intent Routing Validation   -> scripts/test-agents.ts (Tests 1-4, 7)|
|                                                                         |
|  4. Agent Execution Testing     -> scripts/test-agents.ts (Tests 5-6)   |
|                                                                         |
|  5. Safety Interceptor Testing  -> scripts/test-agents.ts (Test 4)      |
|                                                                         |
+-------------------------------------------------------------------------+
```

---

## Test Suites and Execution Commands

| Test Target | Command | Primary Script | Purpose |
|---|---|---|---|
| **Agent & Intent Suite** | `npm run test:agents` | `scripts/test-agents.ts` | End-to-end routing, code generation, git execution, safety gates |
| **Microphone Pipeline** | `npm run phase1` | `scripts/phase1-mic-test.ts` | 15-second live capture, streaming partials, AssemblyAI WebSocket |
| **Endpoint Diagnostic** | `npm run phase0` | `scripts/phase0-probe.ts` | Diagnostic probe comparing HTTP dictation and WebSocket streaming |
| **Type Verification** | `npx tsc --noEmit` | N/A | Strict TypeScript compilation check without emitting output |
| **Production Build** | `npm run build` | `tsconfig.json` | Full transpile to dist/ directory |

---

## 1. Running the Agent Test Suite

The agent test suite validates real-world developer workflows using live API calls to Gemini and the local Git binary.

```bash
npm run test:agents
```

### What It Tests

1. **Hinglish Code Generation Routing**:
   - Utterance: `"Ek function banao jo email validate kare"`
   - Asserts: `type === "code_generation"`, instruction correctly translated to English intent.

2. **Hinglish Code Editing Routing**:
   - Utterance: `"useEffect ke andar API call add karo"`
   - Asserts: `type === "code_edit"`, instruction targets the existing hook.

3. **Hinglish Git Branch Routing**:
   - Utterance: `"Nayi branch banao feature-email"`
   - Asserts: `type === "git_branch"`, `name === "feature-email"` (properly slugified).

4. **Destructive Command Safety Interception**:
   - Utterance: `"force push master branch"`
   - Asserts: `DestructiveIntentError` is thrown prior to any LLM invocation, identifying the blocked token `"force push"`.

5. **Code Agent Disk Execution**:
   - Runs `generateCode("Create an email validation function...", "demo/sample.ts")`.
   - Asserts: `demo/sample.ts` is modified on disk, file size increases, and valid TypeScript syntax is present.

6. **Git Agent Subprocess Execution**:
   - Runs `executeGit({ type: "git_status" })`.
   - Asserts: `execFile` executes `git status`, returns exit code 0, and captures repository status.

7. **File Switching Intent Routing**:
   - Utterance: `"Switch to src/auth.ts"`
   - Asserts: `type === "file_switch"`, `path === "src/auth.ts"`.

---

## 2. Running the Hardware & Microphone Streaming Test

To verify audio hardware, SoX recording, and AssemblyAI's streaming WebSocket protocol without running the full CLI:

```bash
npm run phase1
```

### Verification Steps

1. **Audio Device Check**: Verifies that SoX captures mono 16kHz signed 16-bit PCM samples.
2. **WebSocket Handshake**: Confirms connection to `wss://streaming.assemblyai.com/v3/ws` using raw API key authorization.
3. **Keyterms Steering**: Validates that technical terms (`useEffect`, `TypeScript`, `JWT`) are loaded via `keyterms_prompt`.
4. **Live Partials**: Speak into the microphone; verify that partial transcript lines update in real time (`\r`).
5. **Final Turn & Disfluency Removal**: Stop speaking; verify the clean transcript is returned with filler words stripped.
6. **Graceful Shutdown**: The test runs for 15 seconds, sends `{"type":"Terminate"}`, and closes the WebSocket connection cleanly.

---

## 3. How to Add New Test Cases

New integration test cases should be added to `scripts/test-agents.ts`.

### Adding an Intent Routing Test

```typescript
// scripts/test-agents.ts

console.log("Test N: Routing New Scenario...");
const newResult = await routeIntent("Utterance in Hindi, English, or Hinglish");
console.log("Result:", JSON.stringify(newResult, null, 2));

if (newResult.type !== "expected_type") {
  throw new Error(`Expected expected_type, got ${newResult.type}`);
}
console.log("[PASSED] Test N\n");
```

### Adding a Git Subprocess Test

To test a new Git command within the allowlist:

```typescript
// scripts/test-agents.ts

console.log("Test N: Executing Git Command...");
const gitResult = await executeGit({
  type: "git_log",
  count: 3
});
console.log("Git output:\n" + gitResult);
if (!gitResult) {
  throw new Error("Git command produced empty output");
}
console.log("[PASSED] Test N\n");
```

---

## 4. Mocking and Offline Testing

For environments without live audio input or active network connections:

### Mocking Audio Input
You can pipe a pre-recorded 16kHz PCM16 `.wav` or raw binary file directly into `AudioStreamer` instead of spawning `sox`:

```typescript
import { createReadStream } from "fs";
import { AudioStreamer } from "./src/audio/streamer";

// Instantiate streamer with mock file stream
const audioStream = createReadStream("test/fixtures/sample-utterance.pcm");
// Pipe to WebSocket client session
```

### Mocking Gemini Intent Routing
To test downstream agent execution without consuming Gemini API tokens, instantiate mock intent objects conforming to `UserIntent` in `src/intent/schema.ts`:

```typescript
import { UserIntent } from "./src/intent/schema";

const mockCodeIntent: UserIntent = {
  type: "code_generation",
  instruction: "Create a debounce utility function"
};

const mockGitIntent: UserIntent = {
  type: "git_add",
  all: true
};
```

---

## 5. Troubleshooting Test Failures

### 1. DestructiveIntentError Triggered Unexpectedly
- Cause: Input utterance contains a blacklisted keyword (`force push`, `delete`, `reset --hard`, `drop`).
- Solution: This is intended safety behavior. Wrap the call in a `try/catch` block to assert interception.

### 2. ETIMEDOUT or FetchError on Gemini API
- Cause: Node.js 24 on Windows prioritizes IPv6 resolution, causing external API calls to hang.
- Solution: Ensure `dns.setDefaultResultOrder("ipv4first")` is called at script initialization. All CodeVoice scripts and modules include this by default.

### 3. Rate Limit (HTTP 429) on Gemini Free-Tier
- Cause: Exceeding 15 requests per minute.
- Solution: The `routeIntent` and `generateCode` modules contain built-in 3-attempt exponential backoff retry loops. When running test suites repeatedly, allow a brief pause between runs.

### 4. SoX Exit Code Non-Zero
- Cause: Default microphone device not detected or SoX not in system PATH.
- Solution: Verify `sox --version` in your terminal. On Windows, check Windows Settings > Privacy & Security > Microphone permissions for terminal applications.

---

[Back to README](../README.md)

