import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as readline from 'node:readline';

export type KeySource = 'env' | 'config' | 'local_env' | 'none';

export interface KeyResolution {
  key: string | null;
  source: KeySource;
  envVar: string;
}

export function getConfigDir(): string {
  return path.join(os.homedir(), '.codevoice');
}

export function getConfigFilePath(): string {
  return path.join(getConfigDir(), 'config.json');
}

export function readConfigFile(): Record<string, string> {
  const filePath = getConfigFilePath();
  if (!fs.existsSync(filePath)) {
    return {};
  }
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      return parsed as Record<string, string>;
    }
  } catch {
    // If the file is malformed, return empty record
  }
  return {};
}

export function saveConfigFile(data: Record<string, string>): void {
  const dir = getConfigDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }

  const filePath = getConfigFilePath();
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), {
    encoding: 'utf-8',
    mode: 0o600,
  });

  // POSIX permissions (0600) on macOS/Linux; no-op/best-effort on Windows
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    // Graceful fallback for filesystems/platforms without POSIX permission support
  }
}

export function setConfigKey(service: 'assemblyai' | 'gemini', value: string): void {
  const current = readConfigFile();
  current[service] = value.trim();
  saveConfigFile(current);
}

export function clearConfigFile(): boolean {
  const filePath = getConfigFilePath();
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    return true;
  }
  return false;
}

/**
 * Parses a key from local .env in process.cwd() without mutating process.env.
 */
function readLocalEnvValue(key: string): string | null {
  try {
    const envPath = path.join(process.cwd(), '.env');
    if (!fs.existsSync(envPath)) return null;

    const content = fs.readFileSync(envPath, 'utf-8');
    const lines = content.split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx !== -1) {
        const k = trimmed.slice(0, eqIdx).trim();
        let val = trimmed.slice(eqIdx + 1).trim();
        // Remove surrounding quotes if present
        if (
          (val.startsWith('"') && val.endsWith('"')) ||
          (val.startsWith("'") && val.endsWith("'"))
        ) {
          val = val.slice(1, -1);
        }
        if (k === key && val) {
          return val;
        }
      }
    }
  } catch {
    // Ignore read errors
  }
  return null;
}

/**
 * Resolves an API key based on priority:
 * 1. Environment variable (process.env)
 * 2. Global config file (~/.codevoice/config.json)
 * 3. Local .env file in cwd (fallback for local dev)
 */
export function resolveApiKey(service: 'assemblyai' | 'gemini'): KeyResolution {
  const envVar = service === 'assemblyai' ? 'ASSEMBLYAI_API_KEY' : 'GEMINI_API_KEY';

  // 1. Environment variable
  const envVal = process.env[envVar]?.trim();
  if (envVal) {
    return { key: envVal, source: 'env', envVar };
  }

  // 2. Global config file
  const fileConfig = readConfigFile();
  const fileVal = (fileConfig[service] || fileConfig[envVar])?.trim();
  if (fileVal) {
    return { key: fileVal, source: 'config', envVar };
  }

  // 3. Local .env fallback
  const localEnvVal = readLocalEnvValue(envVar);
  if (localEnvVal) {
    return { key: localEnvVal, source: 'local_env', envVar };
  }

  return { key: null, source: 'none', envVar };
}

/**
 * Securely masks an API key, showing only a small prefix and the last 4 characters.
 * Example: "sk-...ab12" or "7ab...8901"
 */
export function maskApiKey(key: string | null | undefined): string {
  if (!key) return '(not set)';
  const trimmed = key.trim();
  if (trimmed.length <= 6) return '******';
  const prefix = trimmed.slice(0, 3);
  const suffix = trimmed.slice(-4);
  return `${prefix}...${suffix}`;
}

/**
 * Interactively prompts for a masked secret in the terminal.
 * Masks with '*' in interactive TTY mode; falls back to standard readline in non-TTY.
 */
export function promptSecret(promptMsg: string): Promise<string> {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    const stdout = process.stdout;

    if (!stdin.isTTY) {
      const rl = readline.createInterface({
        input: stdin,
        output: stdout,
      });
      rl.question(promptMsg, (answer) => {
        rl.close();
        resolve(answer.trim());
      });
      return;
    }

    stdout.write(promptMsg);
    const wasRaw = stdin.isRaw;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf-8');

    let input = '';

    const onData = (chunk: string) => {
      for (const char of chunk) {
        // Ctrl+C
        if (char === '\u0003') {
          stdin.setRawMode(wasRaw);
          stdin.removeListener('data', onData);
          stdout.write('\n');
          process.exit(130);
        }

        // Enter key (\r or \n)
        if (char === '\r' || char === '\n') {
          stdin.setRawMode(wasRaw);
          stdin.removeListener('data', onData);
          stdout.write('\n');
          resolve(input.trim());
          return;
        }

        // Backspace (\u0008 or \u007f)
        if (char === '\u0008' || char === '\u007f') {
          if (input.length > 0) {
            input = input.slice(0, -1);
            stdout.write('\b \b');
          }
          continue;
        }

        // Ignore control codes
        if (char < ' ') {
          continue;
        }

        input += char;
        stdout.write('*');
      }
    };

    stdin.on('data', onData);
  });
}

/**
 * Ensures valid API keys are available before running CodeVoice.
 * If keys are missing, triggers interactive first-run setup.
 */
export async function ensureUserConfigInteractive(): Promise<{
  assemblyaiKey: string;
  geminiKey: string;
}> {
  let aaiRes = resolveApiKey('assemblyai');
  let geminiRes = resolveApiKey('gemini');

  if (aaiRes.key && geminiRes.key) {
    process.env.ASSEMBLYAI_API_KEY = aaiRes.key;
    process.env.GEMINI_API_KEY = geminiRes.key;
    return {
      assemblyaiKey: aaiRes.key,
      geminiKey: geminiRes.key,
    };
  }

  // If non-interactive and missing keys, exit with instructions
  if (!process.stdin.isTTY) {
    console.error('\n[Error] CodeVoice requires AssemblyAI and Gemini API keys.');
    console.error('Set them via environment variables:');
    console.error('  export ASSEMBLYAI_API_KEY="your-key"');
    console.error('  export GEMINI_API_KEY="your-key"');
    console.error('Or configure them using:');
    console.error('  codevoice config set assemblyai <key>');
    console.error('  codevoice config set gemini <key>\n');
    process.exit(1);
  }

  // Interactive first-run setup
  console.log("\nWelcome to CodeVoice! Let's get you set up.\n");

  const updates: Record<string, string> = { ...readConfigFile() };

  if (!aaiRes.key) {
    console.log(
      'Enter your AssemblyAI API key (get one at https://www.assemblyai.com/dashboard/api-keys):'
    );
    let entered = '';
    while (!entered) {
      entered = await promptSecret('> ');
      if (!entered) {
        console.log('Key cannot be empty. Please enter your AssemblyAI API key:');
      }
    }
    updates.assemblyai = entered;
    process.env.ASSEMBLYAI_API_KEY = entered;
    aaiRes = { key: entered, source: 'config', envVar: 'ASSEMBLYAI_API_KEY' };
    console.log();
  } else {
    process.env.ASSEMBLYAI_API_KEY = aaiRes.key;
  }

  if (!geminiRes.key) {
    console.log('Enter your Gemini API key (get one at https://aistudio.google.com/apikey):');
    let entered = '';
    while (!entered) {
      entered = await promptSecret('> ');
      if (!entered) {
        console.log('Key cannot be empty. Please enter your Gemini API key:');
      }
    }
    updates.gemini = entered;
    process.env.GEMINI_API_KEY = entered;
    geminiRes = { key: entered, source: 'config', envVar: 'GEMINI_API_KEY' };
    console.log();
  } else {
    process.env.GEMINI_API_KEY = geminiRes.key;
  }

  saveConfigFile(updates);
  console.log(`✓ Saved to ~/.codevoice/config.json`);
  console.log('Starting CodeVoice...\n');

  return {
    assemblyaiKey: aaiRes.key!,
    geminiKey: geminiRes.key!,
  };
}

/**
 * Handles explicit `codevoice config <subcommand>` invocations.
 */
export async function handleConfigCommand(args: string[]): Promise<void> {
  const sub = args[0]?.toLowerCase();

  if (sub === 'set') {
    const service = args[1]?.toLowerCase();
    const key = args[2]?.trim();

    if (!service || (service !== 'assemblyai' && service !== 'gemini')) {
      console.error('Usage: codevoice config set <assemblyai|gemini> <key>');
      process.exit(1);
    }
    if (!key) {
      console.error(`Error: Missing key argument.`);
      console.error(`Usage: codevoice config set ${service} <key>`);
      process.exit(1);
    }

    setConfigKey(service, key);
    const serviceLabel = service === 'assemblyai' ? 'AssemblyAI' : 'Gemini';
    console.log(`✓ ${serviceLabel} API key saved to ~/.codevoice/config.json`);
    process.exit(0);
  }

  if (sub === 'show') {
    const aai = resolveApiKey('assemblyai');
    const gem = resolveApiKey('gemini');
    const configPath = getConfigFilePath();
    const configExists = fs.existsSync(configPath);

    console.log('\nCodeVoice Configuration');
    console.log('──────────────────────────────────────────────────');
    console.log(`Config file:  ${configPath} (${configExists ? 'exists' : 'not found'})`);
    console.log();

    const formatSource = (res: KeyResolution) => {
      switch (res.source) {
        case 'env':
          return `(from environment variable ${res.envVar})`;
        case 'config':
          return '(from ~/.codevoice/config.json)';
        case 'local_env':
          return '(from local .env file)';
        case 'none':
        default:
          return '(not set)';
      }
    };

    console.log(`AssemblyAI Key:  ${maskApiKey(aai.key).padEnd(16)} ${formatSource(aai)}`);
    console.log(`Gemini Key:      ${maskApiKey(gem.key).padEnd(16)} ${formatSource(gem)}`);
    console.log('──────────────────────────────────────────────────\n');
    process.exit(0);
  }

  if (sub === 'clear') {
    const deleted = clearConfigFile();
    if (deleted) {
      console.log('✓ Cleared CodeVoice config (~/.codevoice/config.json deleted)');
    } else {
      console.log('ℹ No config file found at ~/.codevoice/config.json');
    }
    process.exit(0);
  }

  console.error(`Unknown config command: ${sub || '(none)'}`);
  console.error('\nAvailable commands:');
  console.error('  codevoice config set assemblyai <key>   Save AssemblyAI API key');
  console.error('  codevoice config set gemini <key>       Save Gemini API key');
  console.error('  codevoice config show                   View key status and sources');
  console.error('  codevoice config clear                  Delete global config file\n');
  process.exit(1);
}
