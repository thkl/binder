import { Body, Controller, Delete, Get, Put, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { AuthenticationGuard } from '../../authentication/guards/authentication.guard';
import { CurrentUser, ScopedUser } from '../../authentication/decorators/current-user.decorator';
import { ScopeGuard } from '../../../shared/guards/scope.guard';
import { Scopes } from '../../../shared/decorators/scope.decorator';
import { EmailImportConfigService } from '../service/email-import-config.service';

const EmailImportConfigInputSchema = z.object({
  enabled: z.boolean(),
  host: z.string().trim().max(255),
  port: z.number().int().min(1).max(65535),
  secure: z.boolean(),
  username: z.string().trim().min(1).max(320),
  password: z.string().max(2048).nullable().optional(),
  mailbox: z.string().trim().min(1).max(255),
  pollIntervalMs: z.number().int().min(60_000).max(86_400_000),
  deleteAfterImport: z.boolean(),
  trustedSenders: z.array(z.string().email().max(320)).max(100),
});

@Controller('email-import')
@UseGuards(AuthenticationGuard, ScopeGuard)
@Scopes(['web'])
export class EmailImportController {
  constructor(private readonly configs: EmailImportConfigService) {}

  @Get('config')
  async getConfig(
    @CurrentUser() user: ScopedUser,
  ): Promise<{ data: Record<string, unknown> | null }> {
    return { data: await this.configs.get(user.userId) };
  }

  @Put('config')
  async saveConfig(
    @CurrentUser() user: ScopedUser,
    @Body() body: unknown,
  ): Promise<{ data: Record<string, unknown> }> {
    const input = EmailImportConfigInputSchema.parse(body);
    return { data: await this.configs.save(user.userId, input) };
  }

  @Delete('config')
  async deleteConfig(@CurrentUser() user: ScopedUser): Promise<{ data: null }> {
    await this.configs.delete(user.userId);
    return { data: null };
  }
}
