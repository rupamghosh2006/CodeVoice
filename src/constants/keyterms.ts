/**
 * Project-specific keyterms passed to AssemblyAI on session start.
 * These steer the speech model toward exact recognition of technical identifiers.
 * Max 100 terms per AssemblyAI docs.
 *
 * Format: each string is passed as a keyterm prompt entry.
 * AssemblyAI uses these as "hints" — they increase probability of these tokens
 * being recognized correctly in the transcript.
 */
export const KEYTERMS: string[] = [
  // React hooks
  'useEffect',
  'useState',
  'useCallback',
  'useMemo',
  'useRef',
  'useContext',
  'useReducer',
  'useLayoutEffect',

  // TypeScript / JS
  'async',
  'await',
  'Promise',
  'TypeScript',
  'interface',
  'enum',
  'readonly',
  'typeof',
  'keyof',

  // Web APIs
  'WebSocket',
  'fetch',
  'AbortController',
  'EventEmitter',
  'PCM16',

  // Node / Express
  'Express',
  'middleware',
  'endpoint',
  'Router',
  'Socket.IO',
  'cors',
  'dotenv',
  'tsconfig',
  'eslint',
  'prettier',
  'npm',
  'npx',

  // AssemblyAI
  'AssemblyAI',
  'universal-3-5-pro',
  'keyterms_prompt',
  'streaming',
  'Terminate',
  'SpeechStarted',

  // Auth / API
  'JWT',
  'API',
  'REST',
  'OAuth',
  'Bearer',
  'Authorization',
  'CORS',

  // CodeVoice-specific function names in demo/sample.ts
  'validateEmail',
  'emailValidator',
  'authMiddleware',
  'gitAgent',
  'codeAgent',
  'intentRouter',
  'routeIntent',
  'executeGit',

  // Common coding terms that get mangled by STT
  'boolean',
  'string',
  'number',
  'null',
  'undefined',
  'void',
  'console.log',
  'try-catch',
  'callback',
  'refactor',
  'linter',

  // Git
  'branch',
  'delete branch',
  'branch delete',
  'checkout',
  'commit',
  'stash',
  'rebase',
  'feature',
  'hotfix',

  // Hinglish developer vocabulary (common code-switching terms)
  'function banao',
  'add karo',
  'dikhao',
  'badlo',
];
