<p align="center">
  <img src="assets/logo.png" alt="CodeVoice Logo" width="220" />
</p>

<h1 align="center">CodeVoice</h1>

<p align="center">
  <strong>Multilingual voice interface for software development</strong><br>
  Speak naturally in Hinglish or English to generate code directly to disk and control Git inside your VS Code terminal.
</p>

<p align="center">
  <a href="https://www.assemblyai.com"><img src="https://img.shields.io/badge/Powered%20by-AssemblyAI%20universal--3--5--pro-7c3aed?style=flat-square" alt="AssemblyAI" /></a>
  <a href="https://ai.google.dev"><img src="https://img.shields.io/badge/Router-Gemini%20Flash-4285f4?style=flat-square" alt="Gemini" /></a>
  <a href="https://www.typescriptlang.org"><img src="https://img.shields.io/badge/Language-TypeScript%205.8-3178c6?style=flat-square" alt="TypeScript" /></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/Node.js-%3E%3D18.0.0-339933?style=flat-square" alt="Node.js" /></a>
  <a href="https://code.visualstudio.com"><img src="https://img.shields.io/badge/Environment-VS%20Code%20Terminal-007ACC?style=flat-square" alt="VS Code" /></a>
  <a href="#"><img src="https://img.shields.io/badge/Speech%20Protocol-WebSocket%20v3-blue?style=flat-square" alt="WebSocket v3" /></a>
  <a href="#"><img src="https://img.shields.io/badge/Languages-18%20%2B%20Hinglish-blueviolet?style=flat-square" alt="Languages" /></a>
  <a href="#"><img src="https://img.shields.io/badge/Vocabulary-50%2B%20Keyterms-informational?style=flat-square" alt="Keyterms" /></a>
  <a href="#"><img src="https://img.shields.io/badge/Tests-7%2F7%20Passing-brightgreen?style=flat-square" alt="Tests" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-green?style=flat-square" alt="License" /></a>
</p>

---

## Quick Navigation

- [Why CodeVoice Fits the Hackathon Criteria](#why-codevoice-fits-the-hackathon-criteria)
- [VS Code Integrated Terminal Workflow](#vs-code-integrated-terminal-workflow)
- [Architecture](#architecture)
- [Quick Start](#quick-start)
- [Voice Command Reference](#voice-command-reference)
- [Security Model](#security-model)
- [Verification and Testing](#verification-and-testing)
- [License](#license)

---

## Why CodeVoice Fits the Hackathon Criteria

1. **Real-time dictation and live transcription**: Continuous streaming via AssemblyAI's universal-3-5-pro with live in-place partial transcript display and instantaneous turn actions.
2. **Multi-language support (18 languages and Hinglish native)**: Speak naturally in Hindi, English, or mixed Hinglish ("Ek function banao jo email validate kare") without manual language switching.
3. **Filler-word removal and clean output**: AssemblyAI automatically removes disfluencies ("um, uh, like") and formats clean instructions before passing to intent routing.
4. **Custom vocabulary and keyterms**: 50+ domain-specific keyterms (useEffect, useState, JWT, PCM16, API, Hinglish verb phrases) steered on session connect.

---

## VS Code Integrated Terminal Workflow

```text
+------------------------------------------------------------------------+
| VS Code Editor Tab: demo/sample.ts                                     |
|                                                                        |
| export function validateEmail(email: string): boolean {                |
|   const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;                     |
|   return emailRegex.test(email);     <-- Updates live as you speak!    |
| }                                                                      |
+------------------------------------------------------------------------+
| Integrated Terminal (CodeVoice CLI)                                    |
|                                                                        |
| CodeVoice -- Multilingual Voice Interface for Developers               |
| Active File: demo/sample.ts                                            |
|                                                                        |
| [Listening continuously... Speak now]                                  |
|                                                                        |
| [Transcript: hi-en] Ek function banao jo email validate kare           |
| [Updated] demo/sample.ts (Create an email validation function...)      |
|                                                                        |
| [Transcript: hi-en] Nayi branch banao feature-email                    |
| $ git checkout -b feature-email                                        |
|   Switched to a new branch 'feature-email'                             |
+------------------------------------------------------------------------+
```

---

## Architecture

Detailed system context diagrams, component responsibilities, streaming WebSocket protocol flow, and security sandbox details are documented in [docs/architecture.md](docs/architecture.md).

---

## Quick Start

Step-by-step installation instructions, cross-platform SoX setup, configuration guides, and testing walkthroughs are documented in [docs/quickstart.md](docs/quickstart.md).

---

## Voice Command Reference

| Intent | Voice Command (English / Hinglish) | Result |
|---|---|---|
| **Code Generation** | "Ek function banao jo email validate kare" | Appends `validateEmail` directly to active file |
| **Code Editing** | "useEffect ke andar API call add karo" | Modifies active file on disk |
| **File Switching** | "Switch to demo/sample.ts" or "Open auth file" | Changes active file context |
| **Git Branch** | "Nayi branch banao feature-email" | `$ git checkout -b feature-email` |
| **Git Status** | "Git status dikhao" | `$ git status` |
| **Git Add** | "Sab files add karo" | `$ git add .` |
| **Git Commit** | "Commit karo add email validation" | `$ git commit -m "add email validation"` |
| **Git Log** | "Git log dikhao" | `$ git log -n 5 --oneline` |
| **Safety Gate** | "Force push master" | Intercepted. Prompts `(y/N)` before executing |

---

## Security Model

Detailed information regarding our kernel-level argument separation (`execFile`), 7-command Git allowlist, input sanitization, pre-LLM destructive command gate, and credential management is documented in [docs/security.md](docs/security.md).

---

## Verification and Testing

Comprehensive test suites, execution commands, test coverage breakdowns, and mocking strategies are documented in [docs/testing.md](docs/testing.md). Live validation matrices, end-to-end test results, and evaluator checklists are documented in [docs/verification.md](docs/verification.md).

---

## License

Distributed under the MIT License. See [LICENSE](LICENSE) for more information.
