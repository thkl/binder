import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  MessageEvent,
  Param,
  Post,
  Sse,
  UseGuards,
} from '@nestjs/common';
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
  @SkipThrottle()
  async list() {
    return { data: await this.inbox.list() };
  }

  @Post('ai-process')
  async processWithAi() {
    return { data: await this.inbox.processAllWithAi() };
  }

  @Delete(':uuid')
  @SkipThrottle()
  async remove(@Param('uuid') uuid: string) {
    return { data: await this.inbox.remove(uuid) };
  }

  @Delete('status/:status')
  @SkipThrottle()
  async removeByStatus(@Param('status') status: string) {
    if (status !== 'duplicate' && status !== 'rejected') {
      throw new BadRequestException(
        'Only duplicate or rejected inbox items can be removed in bulk',
      );
    }
    return { data: await this.inbox.removeByStatus(status) };
  }
}
