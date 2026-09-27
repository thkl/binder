import { Injectable, NotFoundException } from '@nestjs/common';
import { LogFileListResponseSchema } from '@binder/common';
import { LoggingService } from '../../../shared/service/logging.service';

@Injectable()
export class LogsService {
  constructor(private readonly logging: LoggingService) {}

  list() {
    return LogFileListResponseSchema.parse({
      items: this.logging.listLogFiles().map(({ path: _, ...file }) => ({
        ...file,
        modifiedAt: file.modifiedAt.toISOString()
      }))
    });
  }

  getFile(filename: string) {
    const file = this.logging.getLogFile(filename);
    if (!file) throw new NotFoundException('Log file not found');
    return file;
  }
}
