import * as fs from 'node:fs';
import * as path from 'node:path';

const LEVELS = ['debug', 'info', 'warn', 'error'] as const;
type Level = (typeof LEVELS)[number];

const currentLevel: Level = (process.env['LOG_LEVEL'] as Level) ?? 'debug';
const currentIdx = LEVELS.indexOf(currentLevel);

function timestamp(): string {
  return new Date().toISOString();
}

const logFilePath = path.resolve(process.cwd(), 'codevoice.log');
let fileInitialized = false;

function initLogFile(): void {
  if (fileInitialized) return;
  fileInitialized = true;
  try {
    const banner = `\n================================================================================\nCodeVoice Session Started: ${new Date().toISOString()}\nTarget Working Directory: ${process.cwd()}\n================================================================================\n`;
    fs.appendFileSync(logFilePath, banner, 'utf-8');
  } catch {}
}

type LogSink = (level: Level, message: string) => void;
let customSink: LogSink | null = null;

function log(level: Level, ...args: unknown[]): void {
  if (LEVELS.indexOf(level) < currentIdx) return;
  const message = args
    .map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg)))
    .join(' ');
  const formattedLine = `[${timestamp()}] [${level.toUpperCase()}] ${message}`;

  // Always write full debug details to codevoice.log
  initLogFile();
  try {
    fs.appendFileSync(logFilePath, `${formattedLine}\n`, 'utf-8');
  } catch {}

  // If a custom sink is registered
  if (customSink) {
    customSink(level, message);
    return;
  }

  // If debug flag is passed or explicitly enabled in terminal
  if (process.env.DEBUG || process.env.CODEVOICE_DEBUG) {
    if (level === 'error') {
      console.error(formattedLine);
    } else if (level === 'warn') {
      console.warn(formattedLine);
    } else {
      console.log(formattedLine);
    }
  }
}

export const logger = {
  getLogFilePath: () => logFilePath,
  setSink: (sink: LogSink | null) => {
    customSink = sink;
  },
  debug: (...args: unknown[]) => log('debug', ...args),
  info: (...args: unknown[]) => log('info', ...args),
  warn: (...args: unknown[]) => log('warn', ...args),
  error: (...args: unknown[]) => log('error', ...args),
};

