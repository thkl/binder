import { Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { PipelineJobMonitorQuerySchema } from '@binder/common';
import { AuthenticationGuard } from '../../authentication/guards/authentication.guard';
import { CurrentUser, ScopedUser } from '../../authentication/decorators/current-user.decorator';
import { PipelineService } from '../service/pipeline.service';

@Controller('pipeline')
@UseGuards(AuthenticationGuard)
export class PipelineController {
  constructor(private readonly pipeline: PipelineService) {}

  @Get('jobs')
  async listJobs(@Query() query: Record<string, unknown>, @CurrentUser() user: ScopedUser) {
    return {
      data: await this.pipeline.listJobs(user.userId, PipelineJobMonitorQuerySchema.parse(query)),
    };
  }

  @Post('jobs/:uuid/retry')
  async retryJob(@Param('uuid') uuid: string, @CurrentUser() user: ScopedUser) {
    return { data: await this.pipeline.retryJob(user.userId, uuid) };
  }
}
