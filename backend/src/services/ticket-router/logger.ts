export type LogLevel = 'info' | 'warn' | 'error' | 'debug';

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  event: string;
  [key: string]: unknown;
}

export function log(
  level: LogLevel,
  event: string,
  context: Record<string, unknown> = {},
): void {
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    event,
    ...context,
  };
  const line = JSON.stringify(entry);
  if (level === 'error' || level === 'warn') {
    process.stderr.write(line + '\n');
  } else {
    process.stdout.write(line + '\n');
  }
}

export const logger = {
  info:  (event: string, ctx?: Record<string, unknown>) => log('info', event, ctx),
  warn:  (event: string, ctx?: Record<string, unknown>) => log('warn', event, ctx),
  error: (event: string, ctx?: Record<string, unknown>) => log('error', event, ctx),
  debug: (event: string, ctx?: Record<string, unknown>) => log('debug', event, ctx),
};
