import { Controller, Delete, Get, MessageEvent, Param, Post, Sse, UseGuards } from '@nestjs/common';
import { Observable } from 'rxjs';
import { AuthenticationGuard } from '../../authentication/guards/authentication.guard';
import { RolesGuard } from '../../../shared/guards/roles.guard';
import { Roles } from '../../../shared/decorators/roles.decorator';
import { InboxService } from '../service/inbox.service';
import { SkipThrottle } from '@nestjs/throttler';

@Controller('inbox')
@UseGuards(AuthenticationGuard, RolesGuard)
@Roles('admin')
export class InboxController {
  constructor(private readonly inbox: InboxService) {}

  @Sse('events')
  @SkipThrottle()
  events(): Observable<MessageEvent> {
    return this.inbox.events();
  }

  @Get()
  async list() {
    return { data: await this.inbox.list() };
  }

  @Post('ai-process')
  async processWithAi() {
    return { data: await this.inbox.processAllWithAi() };
  }

  @Delete(':uuid')
  async remove(@Param('uuid') uuid: string) {
    return { data: await this.inbox.remove(uuid) };
  }
}
