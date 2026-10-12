import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  MetadataWebhookDeliveryListSchema,
  MetadataWebhookConfigResponseSchema,
  MetadataWebhookConfigSchema,
  MetadataWebhookTestResponseSchema,
} from '@binder/common';
import { AuthenticationGuard } from '../../authentication/guards/authentication.guard';
import { ScopeGuard } from '../../../shared/guards/scope.guard';
import { RolesGuard } from '../../../shared/guards/roles.guard';
import { Roles } from '../../../shared/decorators/roles.decorator';
import { Scopes } from '../../../shared/decorators/scope.decorator';
import { MetadataWebhookService } from '../service/metadata-webhook.service';

@Controller('workflows/metadata-webhook')
@UseGuards(AuthenticationGuard, ScopeGuard, RolesGuard)
@Roles('admin')
@Scopes(['web'])
export class MetadataWebhookController {
  constructor(private readonly workflows: MetadataWebhookService) {}

  /** Reads the active rule without returning its stored bearer token. */
  @Get('config')
  async getConfig() {
    return { data: MetadataWebhookConfigResponseSchema.parse(await this.workflows.getConfigForAdmin()) };
  }

  /** Saves the metadata condition, target URL, and payload template. */
  @Put('config')
  async saveConfig(@Body() body: unknown) {
    const input = MetadataWebhookConfigSchema.parse(body);
    await this.workflows.saveConfig(input);
    return { data: MetadataWebhookConfigResponseSchema.parse(await this.workflows.getConfigForAdmin()) };
  }

  /** Lists recent requests so administrators can inspect delivery and retry state. */
  @Get('deliveries')
  async listDeliveries() {
    return { data: MetadataWebhookDeliveryListSchema.parse(await this.workflows.listDeliveries()) };
  }

  /** Sends one sample request using the current settings without adding a queue entry. */
  @Post('test')
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  async test() {
    return { data: MetadataWebhookTestResponseSchema.parse(await this.workflows.test()) };
  }

  /** Requeues a failed delivery for another background attempt. */
  @Post('deliveries/:uuid/retry')
  async retry(@Param('uuid', ParseUUIDPipe) uuid: string) {
    await this.workflows.retry(uuid);
    return { data: { retried: true as const } };
  }
}
