# 🎙️ CodeVoice

> **Multilingual voice interface for software development** — speak naturally (including Hinglish / code-switched speech) to generate code and control Git, running directly inside your VS Code integrated terminal.

Built for the [AssemblyAI Voice Hackathon Week: Hack into Dictation](https://www.assemblyai.com) · Sept 9–13, 2026

[![AssemblyAI](https://img.shields.io/badge/Powered%20by-AssemblyAI%20universal--3--5--pro-7c3aed)](https://www.assemblyai.com)
[![TypeScript](https://img.shields.io/badge/Language-TypeScript-3178c6)](https://www.typescriptlang.org)
[![Gemini](https://img.shields.io/badge/Router-Gemini%20Flash-4285f4)](https://ai.google.dev)

---

## 📚 Documentation

- 🚀 **[Quickstart Guide](docs/quickstart.md)** — Step-by-step installation, prerequisites, SoX setup, and voice command walkthrough.
- 🏗️ **[System Architecture](docs/architecture.md)** — Deep-dive system architecture, Mermaid diagrams, streaming protocol, and security model.

---

## 💡 Why CodeVoice Fits the Hackathon Criteria

1. **Real-time dictation & live transcription** — Continuous streaming via AssemblyAI's `universal-3-5-pro` with live in-place partial transcript display and instantaneous turn actions.
2. **Multi-language support (18 languages & Hinglish native)** — Speak naturally in Hindi, English, or mixed Hinglish (*"Ek function banao jo email validate kare"*) without manual language switching.
3. **Filler-word removal & clean output** — AssemblyAI automatically removes disfluencies (*"um, uh, like"*) and formats clean instructions before passing to intent routing.
4. **Custom vocabulary & keyterms** — 50+ domain-specific keyterms (`useEffect`, `useState`, `JWT`, `PCM16`, `API`, Hinglish verb phrases) steered on session connect.

---

## 🖥️ VS Code Integrated Terminal Workflow

```
┌────────────────────────────────────────────────────────────────────────┐
│ VS Code Editor Tab: demo/sample.ts                                     │
│                                                                        │
│ export function validateEmail(email: string): boolean {                │
│   const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;                     │
│   return emailRegex.test(email);     ◄── Updates live as you speak!   │
│ }                                                                      │
├────────────────────────────────────────────────────────────────────────┤
│ Integrated Terminal (CodeVoice CLI)                                    │
│                                                                        │
│ 🎙️ CodeVoice — Multilingual Voice Interface for Developers            │
│ 📄 Active File: demo/sample.ts                                         │
│                                                                        │
│ ● 🎙️ Listening continuously... (Speak now)                            │
│                                                                        │
│ 📝 [hi-en] Ek function banao jo email validate kare                   │
│ ✓ updated demo/sample.ts (Create an email validation function...)      │
│                                                                        │
│ 📝 [hi-en] Nayi branch banao feature-email                            │
│ $ git checkout -b feature-email                                        │
│   Switched to a new branch 'feature-email'                             │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 🛠️ Architecture

```
🎙️ Microphone (16kHz PCM16 Mono via SoX)
     │
     ▼ Binary chunks
AssemblyAI Real-Time WebSocket (`wss://streaming.assemblyai.com/v3/ws`)
  • Model: universal-3-5-pro
  • keyterms_prompt: 50+ JSON-stringified developer terms
  • prompt: Contextual developer domain steering
  • Terminate: Clean session termination on Ctrl+C
     │
     ▼ Partial & Final Turns
Terminal Output & Intent Router (Gemini)
     │
     ├──▶ Code Intent ──▶ Writes code directly to disk (active file)
     │                    └─ VS Code editor tab updates live!
     │                    └─ Terminal prints: `✓ updated <file> (<summary>)`
     │
     ├──▶ Git Intent  ──▶ Echoes `$ git <command>`
     │                    └─ Executes via child_process.execFile allowlist
     │                    └─ Streams output directly to terminal
     │
     └──▶ Destructive ──▶ Interactive prompt: `⚠️ Are you sure? (y/N)`
```

---

## 🚀 Quick Start

### 1. Prerequisites
- **Node.js 18+**
- **SoX (Sound eXchange)** for mic capture:
  - Windows: `choco install sox.portable` or `scoop install sox`
  - macOS: `brew install sox`
  - Linux: `sudo apt-get install sox libsox-fmt-all`
- **AssemblyAI API Key** ([assemblyai.com](https://www.assemblyai.com))
- **Gemini API Key** ([ai.google.dev](https://ai.google.dev))

### 2. Setup
```bash
# Clone and install dependencies
npm install

# Configure environment keys
cp .env.example .env
# Fill in ASSEMBLYAI_API_KEY and GEMINI_API_KEY in .env
```

### 3. Run CodeVoice
Inside **VS Code's Integrated Terminal** (`Ctrl+` `):

```bash
# Start with default target file (demo/sample.ts)
npm run dev

# Or specify a custom target file
npm run dev -- --file src/auth.ts
```

Open your target file in a VS Code editor tab beside the terminal and speak!

---

## 🗣️ Voice Command Cheat Sheet

| Intent | Voice Command (English / Hinglish) | Result |
|---|---|---|
| **Code Gen** | *"Ek function banao jo email validate kare"* | Appends `validateEmail` directly to active file |
| **Code Edit** | *"useEffect ke andar API call add karo"* | Modifies active file on disk |
| **File Switch** | *"Switch to demo/sample.ts"* or *"Open auth file"* | Changes active file context |
| **Git Branch** | *"Nayi branch banao feature-email"* | `$ git checkout -b feature-email` |
| **Git Status** | *"Git status dikhao"* | `$ git status` |
| **Git Add** | *"Sab files add karo"* | `$ git add .` |
| **Git Commit** | *"Commit karo add email validation"* | `$ git commit -m "add email validation"` |
| **Git Log** | *"Git log dikhao"* | `$ git log -n 5 --oneline` |
| **Safety Gate** | *"Force push master"* | Intercepted! Prompts `(y/N)` before executing |

---

## 🔒 Security Model

- **Zero Arbitrary Shell Injection**: Git commands are **never** generated as raw shell strings by the LLM. Every command routes through a strict 7-command allowlist and executes via `child_process.execFile` with arguments passed as an array.
- **Input Sanitization**: Branch names are stripped of shell characters (`[a-zA-Z0-9/_.-]` only). Commit messages are sanitized and bounded.
- **Safety Confirmation**: Destructive patterns (`force push`, `delete`, `reset --hard`) trigger an interactive terminal prompt before execution.

---

## 🧪 Verification & Testing

Run all automated integration tests:
```bash
# Run 7/7 automated intent, code, and git tests
npm run test:agents

# Run 15-second standalone mic test
npm run phase1

# Compile TypeScript
npm run build
```

---

## 📄 License

MIT
