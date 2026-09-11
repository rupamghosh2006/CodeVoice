# CodeVoice - Quickstart Guide

Get CodeVoice up and running in under 5 minutes — either by installing the global npm package, or by cloning the source repository for local development.

---

## Prerequisites

Before starting, ensure you have the following installed:

1. **Node.js**: Version 18.0.0 or higher.
   ```bash
   node -v
   ```
2. **Git**: Installed and initialized in your project folder.
   ```bash
   git --version
   ```
3. **SoX (Sound eXchange)**: Required for capturing low-latency 16kHz mono PCM16 audio.
   - **Windows**:
     ```powershell
     choco install sox.portable
     # Or via Scoop:
     scoop install sox
     ```
   - **macOS**:
     ```bash
     brew install sox
     ```
   - **Linux (Ubuntu/Debian)**:
     ```bash
     sudo apt-get update && sudo apt-get install -y sox libsox-fmt-all
     ```
   Verify SoX is accessible in your PATH:
   ```bash
   sox --version
   ```
4. **API Keys**:
   - **AssemblyAI API Key**: Obtain from the [AssemblyAI Dashboard](https://www.assemblyai.com/dashboard/api-keys).
   - **Gemini API Key**: Obtain from [Google AI Studio](https://aistudio.google.com/apikey).

---

## Installation

### Option A: Global npm Package (Recommended for end-users)

Install CodeVoice globally from npm:

```bash
npm install -g @rupamghosh2006/codevoice
```

On first run, CodeVoice will interactively prompt you for your API keys and save them securely to `~/.codevoice/config.json`:

```bash
codevoice
```

```text
Welcome to CodeVoice! Let's get you set up.

Enter your AssemblyAI API key (get one at https://www.assemblyai.com/dashboard/api-keys):
> ************************************

Enter your Gemini API key (get one at https://aistudio.google.com/apikey):
> ************************************

✓ Saved to ~/.codevoice/config.json
Starting CodeVoice...
```

After initial setup, subsequent runs start immediately without prompting.

### Option B: Clone from Source (For contributors and local development)

```bash
git clone https://github.com/rupamghosh2006/CodeVoice.git
cd CodeVoice
npm install
npm run build
```

---

## Managing API Keys

CodeVoice resolves API keys in this priority order:

| Priority | Source | Example |
|---|---|---|
| 1 | Shell environment variable | `export ASSEMBLYAI_API_KEY="..."` |
| 2 | Global config file | `~/.codevoice/config.json` |
| 3 | Local `.env` file (dev fallback) | `.env` in current directory |
| 4 | Interactive first-run prompt | Shown once on first launch |

### Config Commands

```bash
# Set your AssemblyAI API key
codevoice config set assemblyai <key>

# Set your Gemini API key
codevoice config set gemini <key>

# View configured keys and their sources (safely masked)
codevoice config show

# Delete global config file
codevoice config clear
```

**Example output of `codevoice config show`:**
```text
CodeVoice Configuration
──────────────────────────────────────────────────
Config file:  C:\Users\you\.codevoice\config.json (exists)

AssemblyAI Key:  efe...3ad5       (from ~/.codevoice/config.json)
Gemini Key:      AQ....hRuA       (from ~/.codevoice/config.json)
──────────────────────────────────────────────────
```

Keys are **never printed in full** — only the first 3 and last 4 characters are shown.

> **Note on file permissions**: On macOS and Linux, `~/.codevoice/config.json` is created with mode `0600` (owner-read-only). On Windows, the file is protected by your user profile directory; POSIX permissions are not meaningful and are silently skipped.

### For Local Development (source clone only)

Copy the template and fill in your keys:
```bash
cp .env.example .env
```

```env
ASSEMBLYAI_API_KEY=your_assemblyai_api_key_here
ASSEMBLYAI_WS_URL=wss://streaming.assemblyai.com/v3/ws
ASSEMBLYAI_MODE=balanced
ASSEMBLYAI_SPEECH_MODEL=universal-3-5-pro
GEMINI_API_KEY=your_gemini_api_key_here
GEMINI_MODEL=gemini-3.7-flash
TARGET_FILE=./demo/sample.ts
GIT_CWD=.
LOG_LEVEL=info
```

---

## Verification Tests

Before launching the full voice interface, run the automated diagnostic scripts to verify your setup:

### 1. Verify Agent Pipeline and Intent Routing (Automated Test Suite)
```bash
npm run test:agents
```
Runs 8/8 end-to-end integration tests:
- Hinglish code generation routing (`code_generation`)
- Code modification routing (`code_edit`)
- Git branch routing (`git_branch`)
- Destructive command interception (`DestructiveIntentError`)
- Filesystem write validation on `demo/sample.ts`
- Safe `git status` subprocess execution
- Active target file switching (`file_switch`)
- File deletion routing with safety bypass (`file_delete`)

### 2. Test Microphone and AssemblyAI Streaming
```bash
npm run phase1
```
Records 15 seconds from your microphone, streams live PCM16 audio to AssemblyAI, and prints real-time partials and formatted final turns to stdout.

---

## Running CodeVoice

### As a global CLI (from any directory)

```bash
# Default TUI mode
codevoice

# Target a specific file
codevoice --file src/utils/auth.ts

# Plain terminal output (no TUI)
codevoice --plain

# Show help
codevoice --help
```

### In VS Code Integrated Terminal

For the best developer experience, run CodeVoice inside VS Code's integrated terminal side-by-side with your code editor:

```text
+-------------------------------------------------------------+
| Editor Tab: demo/sample.ts                                  |
|                                                             |
| export function validateEmail(email: string): boolean {     |
|   return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);          |
| }  <-- Code appears live as you speak!                      |
+-------------------------------------------------------------+
| Integrated Terminal (Ctrl + `)                              |
|                                                             |
| $ codevoice --file demo/sample.ts                           |
| CodeVoice -- Multilingual Voice Interface                   |
| Active File : demo/sample.ts                                |
| [Listening continuously... Speak now]                       |
+-------------------------------------------------------------+
```

Press `Ctrl + ` `` to open the VS Code terminal and run:
```bash
# Installed globally
codevoice --file demo/sample.ts

# Or from source
npm run dev -- --file demo/sample.ts
```

---

## Voice Commands Walkthrough

Speak naturally into your microphone. You can speak English, Hindi, or mixed Hinglish without changing any mode or dropdown:

### 1. Code Generation
- **Say**: "Ek function banao jo email validate kare"
- **Output**: Writes `validateEmail(email: string): boolean` directly to disk.
- **Terminal prints**:
  ```text
  [Transcript: hi-en] Ek function banao jo email validate kare
  [Updated] demo/sample.ts (Create an email validation function...)
  ```

### 2. Code Editing
- **Say**: "Iss function me domain check ka logic bhi add karo"
- **Output**: Modifies the existing file content on disk.

### 3. File Switching
- **Say**: "Switch to src/auth.ts" or "File badlo demo/sample.ts"
- **Output**: Changes the active target file context.

### 4. Safe Git Operations
- **Branch**: "Nayi branch banao feature-email" → `git checkout -b feature-email`
- **Stage**: "Sab files add karo" → `git add .`
- **Commit**: "Commit karo: add email validation" → `git commit -m "add email validation"`
- **Status**: "Git status dikhao" → `git status`

### 5. Destructive Command Safety Confirmation
- **Say**: "Force push master branch"
- **Output**: Execution is paused and an interactive confirmation appears:
  ```text
  [Warning] Destructive action detected (force push):
     "force push master branch"
  Are you sure you want to execute this? (y/N):
  ```

---

## Stopping CodeVoice

Press `Ctrl + C` anytime. CodeVoice sends `{"type":"Terminate"}` to AssemblyAI to close the billable streaming session cleanly and release the audio hardware.

---

## Troubleshooting

| Symptom | Probable Cause | Solution |
|---|---|---|
| `Microphone Error: spawn sox ENOENT` | SoX not installed or not in PATH | Run `choco install sox.portable` (Windows) or `brew install sox` (macOS). Restart terminal. |
| `WS closed: 3006` | Invalid API key or keyterms format | Run `codevoice config show` to verify keys are set. |
| `ConnectTimeoutError (443)` | Node.js IPv6 resolution conflict on Windows | CodeVoice enforces `dns.setDefaultResultOrder('ipv4first')`. Ensure you are on the latest version. |
| `429 Too Many Requests` | Gemini API free-tier rate limits (15 RPM) | CodeVoice applies automatic exponential backoff. Wait a few seconds between commands. |
| Keys not found on first run | No `~/.codevoice/config.json` and no env vars | Run `codevoice config set assemblyai <key>` and `codevoice config set gemini <key>`. |

---

[Back to README](../README.md)
