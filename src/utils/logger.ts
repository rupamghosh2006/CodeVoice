const LEVELS = ['debug', 'info', 'warn', 'error'] as const;
type Level = (typeof LEVELS)[number];

const currentLevel: Level = (process.env['LOG_LEVEL'] as Level) ?? 'info';
const currentIdx = LEVELS.indexOf(currentLevel);

function timestamp(): string {
  return new Date().toISOString();
}

function log(level: Level, ...args: unknown[]): void {
  if (LEVELS.indexOf(level) < currentIdx) return;
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
  debug: (...args: unknown[]) => log('debug', ...args),
  info: (...args: unknown[]) => log('info', ...args),
  warn: (...args: unknown[]) => log('warn', ...args),
  error: (...args: unknown[]) => log('error', ...args),
};
