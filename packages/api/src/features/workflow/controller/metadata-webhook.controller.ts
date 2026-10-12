import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  MetadataWebhookDeliveryListSchema,
  MetadataWebhookReviewInputSchema,
  MetadataWebhookTestResponseSchema,
  MetadataWebhookWorkflowInputSchema,
  MetadataWebhookWorkflowListSchema,
  MetadataWebhookWorkflowSchema,
} from '@binder/common';
import { AuthenticationGuard } from '../../authentication/guards/authentication.guard';
import { CurrentUser, ScopedUser } from '../../authentication/decorators/current-user.decorator';
import { ScopeGuard } from '../../../shared/guards/scope.guard';
import { RolesGuard } from '../../../shared/guards/roles.guard';
import { Roles } from '../../../shared/decorators/roles.decorator';
import { Scopes } from '../../../shared/decorators/scope.decorator';
import { MetadataWebhookService } from '../service/metadata-webhook.service';

/** Creates user workflows and provides the administrator review and delivery queue. */
@Controller('workflows/metadata-webhook')
@UseGuards(AuthenticationGuard, ScopeGuard)
@Scopes(['web'])
export class MetadataWebhookController {
  constructor(private readonly workflows: MetadataWebhookService) {}

  /** Lists the caller's workflows, or all workflows when the caller is an admin. */
  @Get()
  async list(@CurrentUser() user: ScopedUser) {
    return {
      data: MetadataWebhookWorkflowListSchema.parse(
        await this.workflows.listWorkflows(user.userId, user.isAdmin),
      ),
    };
  }

  /** Creates a user-owned workflow that waits for admin approval. */
  @Post()
  async create(@CurrentUser() user: ScopedUser, @Body() body: unknown) {
    const input = MetadataWebhookWorkflowInputSchema.parse(body);
    return {
      data: MetadataWebhookWorkflowSchema.parse(
        await this.workflows.createWorkflow(user.userId, input, user.isAdmin),
      ),
    };
  }

  /** Updates an owned workflow; user edits return it to the admin approval queue. */
  @Put(':uuid')
  async update(
    @CurrentUser() user: ScopedUser,
    @Param('uuid', ParseUUIDPipe) uuid: string,
    @Body() body: unknown,
  ) {
    const input = MetadataWebhookWorkflowInputSchema.parse(body);
    return {
      data: MetadataWebhookWorkflowSchema.parse(
        await this.workflows.updateWorkflow(uuid, user.userId, input, user.isAdmin),
      ),
    };
  }

  /** Deletes one workflow owned by the current user. */
  @Delete(':uuid')
  async remove(@CurrentUser() user: ScopedUser, @Param('uuid', ParseUUIDPipe) uuid: string) {
    await this.workflows.deleteWorkflow(uuid, user.userId);
    return { data: { deleted: true as const } };
  }

  /** Allows only admins to approve a pending workflow. */
  @Post(':uuid/approve')
  @UseGuards(RolesGuard)
  @Roles('admin')
  async approve(@CurrentUser() user: ScopedUser, @Param('uuid', ParseUUIDPipe) uuid: string) {
    return {
      data: MetadataWebhookWorkflowSchema.parse(
        await this.workflows.reviewWorkflow(uuid, user.userId, true),
      ),
    };
  }

  /** Allows only admins to reject a workflow and optionally leave a reason. */
  @Post(':uuid/reject')
  @UseGuards(RolesGuard)
  @Roles('admin')
  async reject(
    @CurrentUser() user: ScopedUser,
    @Param('uuid', ParseUUIDPipe) uuid: string,
    @Body() body: unknown,
  ) {
    const input = MetadataWebhookReviewInputSchema.parse(body ?? {});
    return {
      data: MetadataWebhookWorkflowSchema.parse(
        await this.workflows.reviewWorkflow(uuid, user.userId, false, input.note),
      ),
    };
  }

  /** Sends a sample only when the selected workflow has admin approval. */
  @Post(':uuid/test')
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  async test(@CurrentUser() user: ScopedUser, @Param('uuid', ParseUUIDPipe) uuid: string) {
    return {
      data: MetadataWebhookTestResponseSchema.parse(
        await this.workflows.testWorkflow(uuid, user.userId, user.isAdmin),
      ),
    };
  }

  /** Lists only the caller's delivery history unless an admin requests it. */
  @Get('deliveries')
  async listDeliveries(@CurrentUser() user: ScopedUser) {
    return {
      data: MetadataWebhookDeliveryListSchema.parse(
        await this.workflows.listDeliveries(user.userId, user.isAdmin),
      ),
    };
  }

  /** Retries a failed delivery for its owner or an administrator. */
  @Post('deliveries/:uuid/retry')
  async retry(@CurrentUser() user: ScopedUser, @Param('uuid', ParseUUIDPipe) uuid: string) {
    await this.workflows.retry(uuid, user.userId, user.isAdmin);
    return { data: { retried: true as const } };
  }
}
