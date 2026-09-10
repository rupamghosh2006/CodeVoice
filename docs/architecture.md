# CodeVoice architecture

CodeVoice is a multilingual voice interface for software development running directly inside the VS Code integrated terminal. The application combines continuous low-latency microphone capture, real-time WebSocket streaming with AssemblyAI's `universal-3-5-pro` model, domain vocabulary steering via `keyterms_prompt`, multilingual intent routing powered by Gemini Flash, direct filesystem code generation and editing, and an allowlisted, sanitized Git execution engine.

---

## System context

```mermaid
flowchart TB
    DEV["Developer in VS Code"]
    
    subgraph Workstation ["Developer Workstation"]
        MIC["Microphone\nHardware Input"]
        VSC["VS Code Editor Tab\n(e.g. demo/sample.ts)"]
        
        subgraph CodeVoiceCLI ["CodeVoice Terminal Process"]
            CAP["AudioCapture\nSoX / node-record-lpcm16\n16kHz Mono PCM16"]
            WS["StreamingClient\nAssemblyAI WS Client\nwss://streaming.assemblyai.com/v3/ws"]
            CLI["CLI Presentation Layer\npicocolors / readline"]
            ROUTER["Intent Router\nGemini Flash\nJSON Schema + Hinglish Few-shots"]
            CODE["Code Agent\nDirect disk fs.writeFile\nTypeScript Gen & Edit"]
            GIT["Git Agent\nchild_process.execFile\nStrict Allowlist (7 Ops)"]
        end

        FS["Local Filesystem\nSource Code Repository"]
        GIT_SUB["Git Subprocess\nLocal Git Binary"]
    end

    subgraph CloudServices ["Cloud AI Infrastructure"]
        AAI["AssemblyAI Real-Time WebSocket API\nModel: universal-3-5-pro\nKeyterms & Prompt Steering"]
        GEMINI["Google Gemini API\nModel: gemini-3.6-flash\nStructured JSON Intent Classification"]
    end

    DEV -->|"Speaks English / Hindi / Hinglish"| MIC
    MIC -->|"Raw Audio Stream"| CAP
    CAP -->|"PCM16 Binary Chunks"| WS
    WS <-->|"Real-Time WebSocket Protocol"| AAI

    AAI -->|"Partial & Final Turns"| WS
    WS -->|"Transcript Events"| CLI
    CLI -->|"Final Text"| ROUTER
    ROUTER <-->|"JSON Structured Inference"| GEMINI

    ROUTER -->|"CodeIntent"| CODE
    ROUTER -->|"GitIntent"| GIT
    ROUTER -->|"FileSwitchIntent"| CLI

    CODE -->|"Direct Disk Write"| FS
    FS -->|"File Watcher Auto-Reload"| VSC
    DEV -.->|"Views Live Changes"| VSC

    GIT -->|"Array Arguments Only (execFile)"| GIT_SUB
    GIT_SUB -->|"Subprocess Output"| CLI
    CLI -->|"Formatted Terminal Output"| DEV
```

---

## Component responsibilities

| Component | Responsibility |
|---|---|
| **AudioCapture (`src/voice/capture.ts`)** | Streams 16kHz mono PCM16 audio from the default input device via a SoX child process. Buffers and emits binary audio chunks to the streaming client. |
| **StreamingClient (`src/voice/streaming.ts`)** | Manages WebSocket connection to `wss://streaming.assemblyai.com/v3/ws`. Sends raw API key authorization, applies URL parameters (`speech_model`, `mode`, `prompt`, `keyterms_prompt`), handles message turns, and sends `{"type":"Terminate"}` upon shutdown. |
| **Keyterms Vocabulary (`demo/keyterms.ts`)** | Curated catalog of 50+ programming terms, React hooks, authentication tokens, and Hinglish verb phrases passed to AssemblyAI on session start to boost recognition of technical identifiers. |
| **Intent Router (`src/intent/router.ts`)** | Classifies final speech transcripts into a strongly typed TypeScript discriminated union (`CodeIntent \| GitIntent \| FileSwitchIntent`) using Gemini Flash with JSON Schema enforcement and Hinglish few-shot examples. Enforces pre-LLM destructive keyword checks. |
| **Code Agent (`src/agents/codeAgent.ts`)** | Reads the active target file, constructs a structured code generation/editing prompt with TypeScript guidelines, queries Gemini Flash, and writes the output directly back to disk. Returns a one-line summary for terminal reporting. |
| **Git Agent (`src/agents/gitAgent.ts`)** | Translates structured `GitIntent` objects into an explicit command allowlist. Executes commands using `child_process.execFile` with argument arrays (never arbitrary shell strings) and applies parameter sanitization. |
| **CLI Presentation (`src/cli.ts`)** | Orchestrates the session lifecycle, renders real-time in-place partial transcripts (`\r● ...`), prints formatted turns with language badges, echoes Git commands, and handles interactive readline confirmation prompts for destructive commands. |
| **Configuration (`src/utils/config.ts`)** | Validates required environment variables, loads default paths, and configures global network settings (`dns.setDefaultResultOrder('ipv4first')`) to eliminate Node.js 24 IPv6 connection timeouts. |

---

## Audio ingestion & streaming pipeline

```mermaid
flowchart LR
    MIC["Default Mic"] -->|"Hardware Audio"| SOX["SoX Process\n16kHz, 1-channel, 16-bit PCM"]
    SOX -->|"stdout pipe"| STREAM["MicCapture Stream"]
    STREAM -->|"Buffer Chunks"| WS_SEND["WebSocket send(chunk)"]
    WS_SEND -->|"Binary Frame"| AAI_WS["AssemblyAI v3 Endpoint"]
```

1. **Low-Latency Hardware Streaming**:
   `node-record-lpcm16` spawns `sox` as a background process configured for:
   - Sample Rate: `16,000 Hz`
   - Channels: `1` (Mono)
   - Encoding: `Signed 16-bit Little-Endian PCM`
2. **Backpressure & Clean Teardown**:
   When the session terminates (via `Ctrl+C`), `MicCapture.stop()` terminates the SoX subprocess immediately to prevent orphaned audio recording locks.

---

## AssemblyAI real-time speech engine

CodeVoice connects to the AssemblyAI streaming WebSocket v3 endpoint:
```text
wss://streaming.assemblyai.com/v3/ws?sample_rate=16000&speech_model=universal-3-5-pro&mode=balanced&prompt=...&keyterms_prompt=[...]
```

### Protocol implementation details

1. **Authentication**:
   Raw API key passed in the `Authorization` HTTP header on WebSocket upgrade (without `Bearer` prefix).
2. **Model Selection**:
   Singular `speech_model=universal-3-5-pro` (real-time streaming uses singular string, distinct from async API arrays).
3. **Contextual Steering (`prompt`)**:
   URL query parameter providing domain-level guidance:
   `"Software development voice commands in English and Hindi for code generation and Git actions."`
4. **Keyterm Boosting (`keyterms_prompt`)**:
   JSON-stringified array of up to 100 terms (`JSON.stringify(["useEffect", "useState", "JWT", "API", ...])`). Injects vocabulary hints that bias acoustic-to-text token probability for technical acronyms and Hinglish developer phrases.
5. **Session Message Lifecycle**:
   - **`Begin`**: Handshake confirmed; server yields `session_id`. Mic streaming commences.
   - **`SpeechStarted`**: Ambient voice trigger.
   - **`Turn`**: Streaming updates. `end_of_turn: false` delivers live partials; `end_of_turn: true` delivers the finalized, formatted transcript with filler words stripped.
   - **`Terminate`**: CodeVoice sends `{"type":"Terminate"}` on exit, ensuring sessions close cleanly and do not accrue idle billing charges.

---

## Intent routing & multilingual understanding

```mermaid
flowchart TD
    RAW["Final Transcript\ne.g. 'Ek function banao jo email validate kare'"]
    
    GATE{"Contains Destructive Keyword?\n(force push, delete, reset --hard)"}
    RAW --> GATE
    
    GATE -->|"Yes"| ERR["Throw DestructiveIntentError\nTrigger Interactive Terminal Prompt"]
    GATE -->|"No"| LLM["Gemini Flash (Temperature 0.1)\nStructured JSON Schema Mode"]
    
    LLM --> PARSE{"Parse Schema"}
    PARSE -->|"type: code_generation / code_edit"| CA["Code Agent"]
    PARSE -->|"type: git_*"| GA["Git Agent"]
    PARSE -->|"type: file_switch"| FS["CLI File Switcher"]
    PARSE -->|"type: unknown"| UNK["Log Unknown Command"]
```

1. **Zero-Latency Safety Gate**:
   Transcripts are evaluated against `DESTRUCTIVE_KEYWORDS` *before* invoking the LLM. If a destructive pattern is matched, a `DestructiveIntentError` is thrown immediately, bypassing external API latency and guarding against prompt manipulation.
2. **Hinglish Few-Shot Conditioning**:
   The system prompt equips the model with canonical English, Hindi, and code-switched Hinglish patterns:
   - `"Ek email validator function banao"` ➔ `code_generation`
   - `"useEffect ke andar API call add karo"` ➔ `code_edit`
   - `"Nayi branch banao feature-login"` ➔ `git_branch`
   - `"Sab files add karo"` ➔ `git_add`
   - `"Commit karo add validation"` ➔ `git_commit`
3. **Resilient Rate-Limit Backoff**:
   API calls automatically catch HTTP 429 quota exhaustion and apply exponential retry backoff, preserving session continuity during rapid voice inputs.

---

## Code agent & filesystem integration

Unlike conventional voice assistants that emit code into chat widgets, CodeVoice uses a **direct disk write pattern**:

```mermaid
sequenceDiagram
    participant Dev as Developer (VS Code)
    participant CLI as CodeVoice CLI
    participant Agent as Code Agent
    participant Disk as Local File (demo/sample.ts)
    participant Tab as VS Code Editor Tab

    Dev->>CLI: "Ek function banao jo email validate kare"
    CLI->>Agent: handleCodeIntent(intent, activeFile)
    Agent->>Disk: fs.readFile(activeFile)
    Agent->>Agent: Generate TypeScript code (Gemini)
    Agent->>Disk: fs.writeFile(activeFile, updatedContent)
    Disk-->>Tab: FileSystemWatcher Trigger
    Note over Tab: Editor tab updates instantly on screen!
    Agent-->>CLI: return { summary: "Create email validation..." }
    CLI-->>Dev: ✓ updated demo/sample.ts (Create email validation...)
```

1. **State Consistency**:
   The Code Agent always inspects the latest disk state before generating or editing code, ensuring incremental modifications append or refactor existing declarations without clobbering uncommitted work.
2. **Editor Transparency**:
   Because the file is updated natively through standard OS filesystem calls, VS Code's internal file system watcher triggers an instant buffer refresh in the open editor tab without requiring extension plugins or IPC protocols.

---

## Git agent & execution sandbox

Security is enforced through a strict separation between LLM inference and system execution:

```mermaid
flowchart TD
    subgraph IntentLayer ["LLM Intent Boundary"]
        INTENT["GitIntent\n{ type: 'git_branch', name: 'feature/auth; rm -rf /' }"]
    end

    subgraph SanitizationLayer ["Sanitization & Validation"]
        MAP{"Allowlist Table"}
        SAN["sanitizeBranchName()\nStrips characters outside [a-zA-Z0-9/_.-]\nResult: 'feature/auth-rm-rf-'"]
    end

    subgraph ExecutionLayer ["Process Boundary"]
        EXEC["child_process.execFile('git', ['checkout', '-b', 'feature/auth-rm-rf-'])"]
        SHELL["Raw Shell (NEVER USED)"]
    end

    INTENT --> MAP
    INTENT --> SAN
    MAP --> EXEC
    SAN --> EXEC
    EXEC -.->|"Bypasses Shell Entirely"| SHELL
```

### The 7 allowlisted Git operations

| Intent Type | Sanitization Applied | Invocation (`execFile`) |
|---|---|---|
| `git_branch` | `sanitizeBranchName()`: `[a-zA-Z0-9/_.-]`, max 100 chars | `['checkout', '-b', <name>]` |
| `git_commit` | `sanitizeCommitMessage()`: whitespace trimmed, max 500 chars | `['commit', '-m', <message>]` |
| `git_status` | None (fixed arguments) | `['status']` |
| `git_diff` | None (fixed arguments) | `['diff']` |
| `git_log` | None (fixed arguments) | `['log', '-n', '5', '--oneline']` |
| `git_add` | None (fixed arguments) | `['add', '.']` |
| `git_checkout` | `sanitizeBranchName()`: `[a-zA-Z0-9/_.-]`, max 100 chars | `['checkout', <branch>]` |

---

## End-to-end event sequence

```mermaid
sequenceDiagram
    autonumber
    actor User as Developer
    participant Mic as MicCapture (SoX)
    participant AAI as AssemblyAI WS
    participant CLI as Terminal CLI
    participant Router as Intent Router
    participant Agent as Code / Git Agent
    participant Disk as File / Git Subprocess

    User->>Mic: Speaks command into microphone
    Mic->>AAI: Binary PCM16 audio frames (16kHz)
    AAI-->>CLI: Turn (end_of_turn: false)
    Note over CLI: Live in-place update: \r● <partial>
    AAI-->>CLI: Turn (end_of_turn: true)
    CLI->>CLI: Print final turn: 📝 <text>
    CLI->>Router: routeIntent(transcript)
    
    alt Destructive Keyword Detected
        Router-->>CLI: DestructiveIntentError
        CLI->>User: ⚠️ Prompt: Are you sure? (y/N)
        User-->>CLI: 'y' or 'N'
    else Normal Command
        Router-->>CLI: Intent Object (JSON)
        alt Code Intent
            CLI->>Agent: handleCodeIntent(intent)
            Agent->>Disk: fs.writeFile(activeFile)
            CLI-->>User: ✓ updated <file> (<summary>)
        else Git Intent
            CLI-->>User: $ git <command>
            CLI->>Agent: executeGit(intent)
            Agent->>Disk: execFile('git', args)
            Disk-->>CLI: stdout / stderr
            CLI-->>User: Streamed git output
        else File Switch Intent
            CLI->>CLI: activeFile = newPath
            CLI-->>User: 📂 Active file set to <file>
        end
    end
```

---

## Security model & defensive boundaries

1. **No Raw Shell Interpolation**:
   `child_process.execFile` is utilized exclusively instead of `exec`. Arguments are passed as individual array elements directly to the OS kernel, making shell injection via semicolons, backticks, pipes, or dollar expansions mathematically impossible.
2. **Pre-LLM Destructive Command Interception**:
   Destructive keywords (`force push`, `delete`, `remove branch`, `reset --hard`, `rebase -i`) cannot be executed silently regardless of LLM reasoning. The process stops listening and demands manual `(y/N)` confirmation on `process.stdin`.
3. **Isolated Secret Management**:
   API keys are loaded via `.env` into private memory structures. Neither keys nor authorization tokens are logged to stdout, included in commit histories, or serialized into client-side responses.
