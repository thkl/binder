import { ConfigService } from '@nestjs/config';
import { Injectable, LoggerService } from '@nestjs/common';
import { WinstonModule } from 'nest-winston';
import * as winston from 'winston';
import 'winston-daily-rotate-file';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { BinderConfig, ConfigKeys } from '../config/config.keys';

export interface LogFileDescriptor {
  name: string;
  source: 'application' | 'worker';
  isError: boolean;
  compressed: boolean;
  sizeBytes: number;
  modifiedAt: Date;
  path: string;
}

const LOG_FILE_PATTERN = /^(application|worker)(-error)?-\d{4}-\d{2}-\d{2}\.log(?:\.gz)?$/;

@Injectable()
export class LoggingService {
  constructor(private readonly config: ConfigService<BinderConfig>) {}

  initializeLogging(): LoggerService {
    const logDir = this.getLogDirectory();
    const logLevel = this.config.get<string>(ConfigKeys.LOG_LEVEL) ?? 'info';
    const maxSize = this.config.get<string>(ConfigKeys.LOG_FILE_MAX_SIZE) ?? '20m';
    const maxFiles = this.config.get<string>(ConfigKeys.LOG_FILE_MAX_FILES) ?? '14d';
    const useConsole = this.config.get<string>(ConfigKeys.LOG_CONSOLE) !== 'false';
    const useJson = this.config.get<string>(ConfigKeys.LOG_JSON) === 'true';

    fs.mkdirSync(logDir, { recursive: true });

    const textFormat = winston.format.combine(
      winston.format.timestamp(),
      winston.format.splat(),
      winston.format.printf((info) => {
        const context = typeof info.context === 'string' ? info.context : 'Nest';
        return `${info.timestamp} | ${info.level} | [${context}]: ${info.message}`;
      })
    );
    const logFormat = useJson
      ? winston.format.combine(winston.format.timestamp(), winston.format.json())
      : textFormat;

    const transports: winston.transport[] = [
      new winston.transports.DailyRotateFile({
        filename: path.join(logDir, 'application-%DATE%.log'),
        datePattern: 'YYYY-MM-DD',
        zippedArchive: true,
        maxSize,
        maxFiles,
        format: logFormat
      }),
      new winston.transports.DailyRotateFile({
        level: 'error',
        filename: path.join(logDir, 'application-error-%DATE%.log'),
        datePattern: 'YYYY-MM-DD',
        zippedArchive: true,
        maxSize,
        maxFiles,
        format: logFormat
      })
    ];

    if (useConsole) {
      transports.push(
        new winston.transports.Console({
          level: logLevel,
          format: logFormat
        })
      );
    }

    return WinstonModule.createLogger({
      level: logLevel,
      transports
    });
  }

  getLogs(): string[] {
    return this.listLogFiles().map((file) => file.name);
  }

  listLogFiles(): LogFileDescriptor[] {
    const logDir = this.getLogDirectory();
    if (!fs.existsSync(logDir)) return [];

    return fs.readdirSync(logDir, { withFileTypes: true })
      .filter((item) => item.isFile() && LOG_FILE_PATTERN.test(item.name))
      .flatMap((item) => {
        try {
          const filePath = path.join(logDir, item.name);
          const stats = fs.statSync(filePath);
          const match = LOG_FILE_PATTERN.exec(item.name);
          if (!match) return [];
          return [{
            name: item.name,
            source: match[1] as 'application' | 'worker',
            isError: Boolean(match[2]),
            compressed: item.name.endsWith('.gz'),
            sizeBytes: stats.size,
            modifiedAt: stats.mtime,
            path: filePath
          }];
        } catch {
          return [];
        }
      })
      .sort((left, right) => right.modifiedAt.getTime() - left.modifiedAt.getTime());
  }

  getLogFile(filename: string): LogFileDescriptor | null {
    if (path.basename(filename) !== filename || !LOG_FILE_PATTERN.test(filename)) return null;
    return this.listLogFiles().find((file) => file.name === filename) ?? null;
  }

  getLogFileForDate(date: Date, filePrefix: string): string {
    const datePart = date.toISOString().slice(0, 10);
    return path.join(this.getLogDirectory(), `${filePrefix}-${datePart}.log`);
  }

  private getLogDirectory(): string {
    return path.resolve(
      process.cwd(),
      this.config.get<string>(ConfigKeys.LOG_DIR) ?? 'logs'
    );
  }
}
