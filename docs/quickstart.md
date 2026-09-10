# 🚀 CodeVoice — Quickstart Guide

Get **CodeVoice** up and running in your local development environment and VS Code integrated terminal in under 5 minutes.

---

## 📋 Prerequisites

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
   - **AssemblyAI API Key**: Obtain from [AssemblyAI Dashboard](https://www.assemblyai.com/dashboard/api-keys).
   - **Gemini API Key**: Obtain from [Google AI Studio](https://ai.google.dev/).

---

## ⚙️ Installation & Configuration

### 1. Clone the repository
```bash
git clone https://github.com/rupamghosh2006/CodeVoice.git
cd CodeVoice
```

### 2. Install dependencies
```bash
npm install
```

### 3. Set up environment variables
Copy the template `.env.example` to `.env`:
```bash
cp .env.example .env
```

Open `.env` and fill in your keys:
```env
# AssemblyAI Credentials
ASSEMBLYAI_API_KEY=your_assemblyai_api_key_here
ASSEMBLYAI_WS_URL=wss://streaming.assemblyai.com/v3/ws
ASSEMBLYAI_MODE=balanced
ASSEMBLYAI_SPEECH_MODEL=universal-3-5-pro

# Google Gemini Credentials
GEMINI_API_KEY=your_gemini_api_key_here
GEMINI_MODEL=gemini-3.6-flash

# Application Configuration
TARGET_FILE=./demo/sample.ts
GIT_CWD=.
LOG_LEVEL=info
```

---

## 🧪 Verification Tests

Before launching the full voice interface, run the automated diagnostic scripts to verify your microphone and API connectivity:

### 1. Verify Agent Pipeline & Intent Routing (Offline/Synthetic)
```bash
npm run test:agents
```
Runs 7/7 end-to-end integration tests:
- Hinglish code generation routing (`code_generation`)
- Code modification routing (`code_edit`)
- Git branch routing (`git_branch`)
- Destructive command interception (`DestructiveIntentError`)
- Filesystem write validation on `demo/sample.ts`
- Safe `git status` subprocess execution
- Active target file switching (`file_switch`)

### 2. Test Microphone & AssemblyAI Streaming
```bash
npm run phase1
```
Records 15 seconds from your microphone, streams live PCM16 audio to AssemblyAI, and prints real-time partials and formatted final turns to stdout.

---

## 💻 Running CodeVoice in VS Code

For the best developer experience, use CodeVoice directly inside VS Code's integrated terminal side-by-side with your code editor:

```
┌─────────────────────────────────────────────────────────────┐
│ Editor Tab: demo/sample.ts                                  │
│                                                             │
│ export function validateEmail(email: string): boolean {     │
│   return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);          │
│ }  ◄── Code appears live as you speak!                      │
├─────────────────────────────────────────────────────────────┤
│ Integrated Terminal (Ctrl + `)                              │
│                                                             │
│ $ npm run dev                                               │
│ 🎙️ CodeVoice — Multilingual Voice Interface                │
│ 📄 Active File : demo/sample.ts                             │
│ ● 🎙️ Listening continuously... (Speak now)                 │
└─────────────────────────────────────────────────────────────┘
```

### Step 1: Open VS Code
Open the project directory in VS Code:
```bash
code .
```

### Step 2: Open Target File in Editor
Open `demo/sample.ts` (or your preferred file) in the editor window.

### Step 3: Open Integrated Terminal & Launch
Press `` Ctrl + ` `` to open the VS Code terminal and run:
```bash
# Target default file (demo/sample.ts)
npm run dev

# Or target any specific file in your workspace
npm run dev -- --file src/utils/auth.ts
```

---

## 🎙️ Voice Commands Walkthrough

Speak naturally into your microphone. You can speak English, Hindi, or mixed Hinglish without changing any mode or dropdown:

### 1. Code Generation
- **Say**: *"Ek function banao jo email validate kare"*
- **Output**: Writes `validateEmail(email: string): boolean` directly to disk in `demo/sample.ts`.
- **Terminal prints**:
  ```text
  📝 [hi-en] Ek function banao jo email validate kare
  ✓ updated demo/sample.ts (Create an email validation function...)
  ```

### 2. Code Editing
- **Say**: *"Iss function me domain check ka logic bhi add karo"*
- **Output**: Modifies the existing file content on disk.
- **Terminal prints**:
  ```text
  📝 [hi-en] Iss function me domain check ka logic bhi add karo
  ✓ updated demo/sample.ts (Add domain check logic...)
  ```

### 3. File Switching
- **Say**: *"Switch to src/auth.ts"* or *"File badlo demo/sample.ts"*
- **Output**: Changes the active target file context.
- **Terminal prints**:
  ```text
  📂 Active file set to: src/auth.ts
  ```

### 4. Safe Git Operations
- **Branch**: *"Nayi branch banao feature-email"*
  ```text
  $ git checkout -b feature-email
    Switched to a new branch 'feature-email'
  ```
- **Stage**: *"Sab files add karo"*
  ```text
  $ git add .
  ```
- **Commit**: *"Commit karo: add email validation"*
  ```text
  $ git commit -m "add email validation"
    [feature-email 74b6601] add email validation
  ```
- **Status**: *"Git status dikhao"*
  ```text
  $ git status
  ```

### 5. Destructive Command Safety Confirmation
- **Say**: *"Force push master branch"*
- **Output**: Execution is paused, and an interactive confirmation prompt appears:
  ```text
  ⚠️  Destructive action detected (force push):
     "force push master branch"
  ❓ Are you sure you want to execute this? (y/N): 
  ```
  Type `n` to abort safely:
  ```text
  🛡️  Action cancelled by user.
  ```

---

## 🛑 Stopping CodeVoice

Press `Ctrl + C` in the terminal anytime. CodeVoice will send `{"type":"Terminate"}` to AssemblyAI to close the billable streaming session cleanly and release the audio hardware:
```text
  ⏹️  Stopping CodeVoice...
  👋 Goodbye!
```

---

## 🔧 Troubleshooting

| Symptom | Probable Cause | Solution |
|---|---|---|
| `Microphone Error: spawn sox ENOENT` | SoX is not installed or not in your system PATH | Run `choco install sox.portable` (Windows) or `brew install sox` (macOS). Restart your terminal. |
| `WS closed: 3006` | Invalid query parameter or keyterms format | Check your `ASSEMBLYAI_API_KEY` in `.env`. Ensure `keyterms_prompt` is formatted as a JSON string array. |
| `ConnectTimeoutError (443)` | Node.js 24 IPv6 resolution conflict on Windows | CodeVoice enforces `dns.setDefaultResultOrder('ipv4first')` in `src/utils/config.ts`. Ensure you're running the latest code. |
| `429 Too Many Requests` | Gemini API free-tier rate limits (15 RPM) | CodeVoice automatically applies exponential backoff retries. Wait a few seconds between heavy code generations. |
