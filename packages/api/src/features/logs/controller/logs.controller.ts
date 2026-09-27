import { Controller, Get, Param, Query, Res, StreamableFile, UseGuards } from '@nestjs/common';
import { createReadStream } from 'node:fs';
import { createGunzip } from 'node:zlib';
import type { Response } from 'express';
import { AuthenticationGuard } from '../../authentication/guards/authentication.guard';
import { RolesGuard } from '../../../shared/guards/roles.guard';
import { Roles } from '../../../shared/decorators/roles.decorator';
import { LogsService } from '../service/logs.service';

@Controller('logs')
@UseGuards(AuthenticationGuard, RolesGuard)
@Roles('admin')
export class LogsController {
  constructor(private readonly logs: LogsService) {}

  @Get()
  async list() {
    return { data: this.logs.list() };
  }

  @Get(':filename')
  file(
    @Param('filename') filename: string,
    @Query('view') view: string | undefined,
    @Res({ passthrough: true }) response: Response
  ) {
    const file = this.logs.getFile(filename);

    if (view === 'true') {
      const stream = file.compressed
        ? createReadStream(file.path).pipe(createGunzip())
        : createReadStream(file.path);

      response.setHeader('Cache-Control', 'private, no-store');
      response.setHeader('Content-Disposition', `inline; filename="${file.name.replace(/\.gz$/, '')}"`);

      return new StreamableFile(stream, {
        type: 'text/plain; charset=utf-8'
      });
    }

    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('Content-Disposition', `attachment; filename="${file.name}"`);
    return new StreamableFile(createReadStream(file.path), {
      type: file.compressed ? 'application/gzip' : 'text/plain; charset=utf-8'
    });
  }
}
