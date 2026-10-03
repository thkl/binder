import { Controller, Get, Param, Post, Res, StreamableFile, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { AuthenticationGuard } from '../../authentication/guards/authentication.guard';
import { CurrentUser, ScopedUser } from '../../authentication/decorators/current-user.decorator';
import { CalendarService } from '../service/calendar.service';
import { createContentDisposition } from '../../../shared/http/content-disposition';

@Controller('calendar')
@UseGuards(AuthenticationGuard)
export class CalendarController {
  constructor(private readonly calendar: CalendarService) {}

  @Get()
  async list(@CurrentUser() user: ScopedUser) {
    return { data: await this.calendar.list(user.userId) };
  }

  @Get('documents/:uuid')
  async get(@Param('uuid') uuid: string, @CurrentUser() user: ScopedUser) {
    return { data: await this.calendar.get(user.userId, uuid) };
  }

  @Post('documents/:uuid/sync')
  async synchronize(@Param('uuid') uuid: string, @CurrentUser() user: ScopedUser) {
    return { data: await this.calendar.synchronizeFromUser(user.userId, uuid) };
  }

  @Get('documents/:uuid/ics')
  async download(
    @Param('uuid') uuid: string,
    @CurrentUser() user: ScopedUser,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.calendar.download(user.userId, uuid);
    response.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    response.setHeader(
      'Content-Disposition',
      createContentDisposition('attachment', result.filename),
    );
    return new StreamableFile(Buffer.from(result.content, 'utf8'));
  }
}
