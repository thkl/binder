import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import { AuthenticationGuard } from '../../authentication/guards/authentication.guard';
import { RolesGuard } from '../../../shared/guards/roles.guard';
import { Roles } from '../../../shared/decorators/roles.decorator';
import { InboxService } from '../service/inbox.service';

@Controller('inbox')
@UseGuards(AuthenticationGuard, RolesGuard)
@Roles('admin')
export class InboxController {
  constructor(private readonly inbox: InboxService) {}

  @Get()
  async list() {
    return { data: await this.inbox.list() };
  }

  @Post('ai-process')
  async processWithAi() {
    return { data: await this.inbox.processAllWithAi() };
  }
}
