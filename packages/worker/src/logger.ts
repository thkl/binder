import * as winston from 'winston';
import { format, transports } from 'winston';
import * as fs from 'node:fs';
import * as path from 'node:path';
import 'winston-daily-rotate-file';

const logDirectory = path.resolve(process.cwd(), process.env.LOG_DIR ?? 'logs');
const logLevel = process.env.LOG_LEVEL ?? 'info';
const maxSize = process.env.LOG_FILE_MAX_SIZE ?? '20m';
const maxFiles = process.env.LOG_FILE_MAX_FILES ?? '14d';
const useConsole = process.env.LOG_CONSOLE !== 'false';
const logFormat =
  process.env.LOG_JSON === 'true'
    ? format.combine(format.timestamp(), format.json())
    : format.combine(
        format.timestamp(),
        format.printf((info) => `${info.timestamp} | ${info.level} | ${info.message}`),
      );

fs.mkdirSync(logDirectory, { recursive: true });

const logTransports: winston.transport[] = [
  new transports.DailyRotateFile({
    filename: path.join(logDirectory, 'worker-%DATE%.log'),
    datePattern: 'YYYY-MM-DD',
    zippedArchive: true,
    maxSize,
    maxFiles,
    format: logFormat,
  }),
  new transports.DailyRotateFile({
    level: 'error',
    filename: path.join(logDirectory, 'worker-error-%DATE%.log'),
    datePattern: 'YYYY-MM-DD',
    zippedArchive: true,
    maxSize,
    maxFiles,
    format: logFormat,
  }),
];

if (useConsole) {
  logTransports.push(new transports.Console({ level: logLevel, format: logFormat }));
}

export const logger = winston.createLogger({
  level: logLevel,
  transports: logTransports,
});
