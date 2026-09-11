# CodeVoice Security Model

This document outlines the security architecture, defensive boundaries, and threat mitigation strategies implemented in CodeVoice.

---

## Threat Model and Core Principles

Voice-driven developer tools introduce unique security risks:
1. **Acoustic Ambiguity and Disfluency**: Misrecognized speech tokens or disfluent background audio could accidentally trigger unintended commands.
2. **Indirect Prompt Injection**: Malicious instructions embedded in spoken inputs or manipulated target files could attempt to trick the language model into executing arbitrary system commands.
3. **Destructive Command Execution**: Unintended modifications such as deleting repositories, discarding uncommitted work, or force-pushing to remote branches.

To eliminate these attack surfaces, CodeVoice enforces a **zero-trust architecture between the LLM and the operating system**. The model is strictly treated as an intent classifier and code generator; it is never granted access to a shell.

---

## 1. Zero Arbitrary Shell Execution

CodeVoice strictly forbids raw shell execution:

- **Forbidden Pattern**: `child_process.exec('git ' + userInput)`
- **Enforced Pattern**: `child_process.execFile('git', argumentArray, options)`

### Kernel-Level Argument Separation

When commands are executed through `child_process.exec`, the command string is passed to `/bin/sh` or `cmd.exe`. This exposes the process to command injection via shell metacharacters (such as `;`, `&&`, `|`, `` ` ``, `$()`, or `>`).

By contrast, `child_process.execFile` invokes the Git executable directly via OS kernel system calls (`execve` on POSIX, `CreateProcess` on Windows). Each argument in the array is passed as an isolated memory pointer:

```typescript
// src/agents/gitAgent.ts
await execFileAsync('git', args, {
  cwd: config.app.gitCwd,
  maxBuffer: 1024 * 1024,
});
```

Even if an input contains `; rm -rf /` or `& calc.exe`, the operating system treats the entire string as a literal argument value to Git (for example, as a branch name or commit message), making shell injection structurally impossible.

---

## 2. Strict Subprocess Command Allowlist

The LLM cannot invent or execute arbitrary Git subcommands. Every action must map to one of exactly eight allowlisted operations:

| Operation Type | Invocation Arguments | Purpose |
|---|---|---|
| `git_branch` | `['checkout', '-b', <name>]` | Create and checkout a new local branch |
| `git_branch_delete` | `['branch', '-D', <name>]` | Delete a local branch (requires safety confirmation) |
| `git_commit` | `['commit', '-m', <message>]` | Commit staged changes with message |
| `git_status` | `['status']` | Display repository working tree status |
| `git_diff` | `['diff']` | Display working directory modifications |
| `git_log` | `['log', '-n', '5', '--oneline']` | Display recent commit history |
| `git_add` | `['add', '.']` | Stage modified files |
| `git_checkout` | `['checkout', <branch>]` | Switch to an existing branch |

Any intent not recognized within this dispatch table is rejected immediately:

```typescript
export function resolveGitArgs(intent: GitIntent): string[] {
  switch (intent.type) {
    case 'git_branch': return ['checkout', '-b', sanitizeBranchName(intent.name)];
    case 'git_branch_delete': return ['branch', '-D', sanitizeBranchName(intent.name)];
    case 'git_commit': return ['commit', '-m', sanitizeCommitMessage(intent.message)];
    case 'git_status': return ['status'];
    case 'git_diff': return ['diff'];
    case 'git_log': return ['log', '-n', '5', '--oneline'];
    case 'git_add': return ['add', '.'];
    case 'git_checkout': return ['checkout', sanitizeBranchName(intent.branch)];
    default:
      throw new Error(`Git operation not in allowlist: ${(intent as any).type}`);
  }
}
```

---

## 3. Parameter Sanitization and Bounded Inputs

All dynamic arguments passed to allowlisted commands are sanitized and bounded before invocation:

### Branch Name Sanitization
Branch names are strictly restricted to alphanumeric characters, slashes, dashes, dots, and underscores. All other characters (including whitespace, control characters, and shell delimiters) are stripped:

```typescript
function sanitizeBranchName(name: string): string {
  return name
    .trim()
    .replace(/[^a-zA-Z0-9/_.-]/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 100);
}
```

### Commit Message Bounding
Commit messages are trimmed and hard-capped at 500 characters to prevent buffer exhaustion:

```typescript
function sanitizeCommitMessage(msg: string): string {
  return msg.trim().slice(0, 500);
}
```

---

## 4. Pre-LLM Destructive Command Interception

To guard against catastrophic data loss (e.g., accidental branch deletion, hard resets, or force-pushes), CodeVoice implements a synchronous heuristic safety gate that executes **before the LLM is invoked**:

```typescript
export const DESTRUCTIVE_KEYWORDS = [
  'delete',
  'remove branch',
  'delete branch',
  'branch delete',
  'force push',
  'force-push',
  'reset --hard',
  'rebase -i',
  'drop commit',
];
```

If a spoken transcript matches any keyword in this catalog:
1. A `DestructiveIntentError` is thrown immediately.
2. The speech-to-text pipeline pauses microphone capture.
3. The terminal displays a high-visibility warning and pauses on `process.stdin`:
   ```text
   [Warning] Destructive action detected (force push):
      "force push master branch"
   Are you sure you want to execute this? (y/N): 
   ```
4. Only an explicit affirmative response (`y` or `yes`) from the developer permits execution. Any other input or timeout cancels the operation safely.
5. Microphone capture resumes only after the prompt is resolved.

---

## 5. File Modification Boundaries

Code modification actions are restricted to explicit target files on the local filesystem:
- **Controlled File Paths**: By default, CodeVoice operates on `demo/sample.ts` or a file path explicitly designated by the developer via the `--file` startup argument.
- **Path Resolution**: Target paths are resolved using `path.resolve` within the workspace boundary.
- **Non-Execution Policy**: CodeVoice writes code to disk; it **never executes** the generated code or compiles it automatically in the background. The developer reviews changes directly in their VS Code editor buffer before executing tests or builds.

---

## 6. Secret and Credential Management

CodeVoice uses a **per-user global configuration system** to store and resolve API keys securely, decoupled from any project directory.

### Key Resolution Priority

API keys are resolved in the following strict priority order at runtime:

| Priority | Source | Description |
|---|---|---|
| 1 | **Shell environment variable** | `ASSEMBLYAI_API_KEY` / `GEMINI_API_KEY` — used directly with no disk access |
| 2 | **User config file** | `~/.codevoice/config.json` — set once via `codevoice config set` |
| 3 | **Local `.env` file** | Development fallback when running from a cloned source directory |
| 4 | **Interactive prompt** | First-run wizard with masked terminal input, saves to config file |

### Config File Security

- **Location**: `~/.codevoice/config.json` (e.g. `C:\Users\<name>\.codevoice\config.json` on Windows).
- **File permissions**: Created with mode `0600` (owner-read-only) on macOS and Linux via `fs.chmodSync`. On Windows, the file is protected by user profile directory ownership; POSIX chmod is silently skipped.
- **Directory permissions**: `~/.codevoice/` is created with mode `0700`.
- **Never printed in full**: `codevoice config show` displays only a masked preview (e.g. `efe...3ad5`). Full key values are never echoed to the terminal, written to logs, or included in diagnostics.

### Published Package Security

- **`.env` excluded from npm tarball**: The `.npmignore` file and `"files": ["dist"]` field in `package.json` jointly ensure that `.env`, `.env.*`, source code, and test scripts are never shipped in the published package.
- **No hardcoded credentials**: The published package at `@rupamghosh2006/codevoice` contains only compiled `dist/` output — no secrets, no dev tokens, no internal tooling.

### WebSocket Authentication

The AssemblyAI API key is passed strictly as a WebSocket upgrade header:
```
Authorization: <api-key>
```
It is never embedded in URL query parameters where it could appear in server access logs or browser history.



---

## Summary

By combining:
- Kernel-level argument array passing (`execFile`)
- A hard allowlist of 7 Git commands
- Comprehensive input sanitization
- Pre-LLM destructive keyword interception with interactive confirmation
- Local filesystem write boundaries with zero automated code execution

CodeVoice ensures that developers can speak freely and rapidly without risking security breaches or repository corruption.

---

[Back to README](../README.md)

