# AssemblyAI Integration Rules
# See: https://www.assemblyai.com/docs/agent-instructions.md

Before writing any AssemblyAI code, fetch:
  https://www.assemblyai.com/docs/agent-instructions.md
  https://www.assemblyai.com/docs/llms.txt

The API changes — do NOT rely on memorized parameter names.

## Project-specific notes

- Mode: Real-time streaming STT (NOT pre-recorded)
- Endpoint: wss://streaming.assemblyai.com/v3/ws
- Model: universal-3-5-pro (singular string, NOT speech_models array)
- Auth: raw API key in Authorization header — NO Bearer prefix
- Always send {"type":"Terminate"} on session end
- Use keyterms_prompt (up to 100 terms) for project vocabulary
- mode param: balanced (switch to min_latency if latency feels sluggish)
- Git: execFile only, never exec — all args passed as array, no shell
- LLM: Gemini 2.5 Flash for intent routing and code generation
