import { ConfigService } from '@nestjs/config';
import { Injectable, LoggerService } from '@nestjs/common';
import { WinstonModule } from 'nest-winston';
import * as winston from 'winston';
import 'winston-daily-rotate-file';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { BinderConfig, ConfigKeys } from '../config/config.keys';

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
    const logDir = this.getLogDirectory();
    if (!fs.existsSync(logDir)) {
      return [];
    }

    return fs.readdirSync(logDir, { withFileTypes: true })
      .filter((item) => item.isFile() && item.name.startsWith('application-') && !item.name.includes('error'))
      .map((item) => item.name)
      .sort();
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
