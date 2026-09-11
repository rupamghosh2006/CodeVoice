const LEVELS = ['debug', 'info', 'warn', 'error'] as const;
type Level = (typeof LEVELS)[number];

const currentLevel: Level = (process.env['LOG_LEVEL'] as Level) ?? 'info';
const currentIdx = LEVELS.indexOf(currentLevel);

function timestamp(): string {
  return new Date().toISOString();
}

type LogSink = (level: Level, message: string) => void;
let customSink: LogSink | null = null;

function log(level: Level, ...args: unknown[]): void {
  if (LEVELS.indexOf(level) < currentIdx) return;
  const message = args
    .map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg)))
    .join(' ');
  if (customSink) {
    customSink(level, message);
    return;
  }
  const prefix = `[${timestamp()}] [${level.toUpperCase()}]`;
  if (level === 'error') {
    console.error(prefix, ...args);
  } else if (level === 'warn') {
    console.warn(prefix, ...args);
  } else {
    console.log(prefix, ...args);
  }
}

export const logger = {
  setSink: (sink: LogSink | null) => {
    customSink = sink;
  },
  debug: (...args: unknown[]) => log('debug', ...args),
  info: (...args: unknown[]) => log('info', ...args),
  warn: (...args: unknown[]) => log('warn', ...args),
  error: (...args: unknown[]) => log('error', ...args),
};
