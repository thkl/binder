import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { CreateApiTokenInputSchema } from '@binder/common';
import { AuthenticationGuard } from '../../../authentication/guards/authentication.guard';
import { CurrentUser, ScopedUser } from '../../../authentication/decorators/current-user.decorator';
import { ApiTokenService } from '../service/api-token.service';
import { McpEnabledGuard } from '../guards/mcp-enabled.guard';

@Controller('auth')
@UseGuards(McpEnabledGuard, AuthenticationGuard)
export class ApiTokenController {
  constructor(private readonly tokenService: ApiTokenService) {}

  @Get('api-tokens')
  async list(@CurrentUser() user: ScopedUser) {
    return { data: await this.tokenService.list(user.userId) };
  }

  @Post('api-tokens')
  async create(@Body() body: unknown, @CurrentUser() user: ScopedUser) {
    return {
      data: await this.tokenService.create(user.userId, CreateApiTokenInputSchema.parse(body)),
    };
  }

  @Delete('api-tokens/:uuid')
  async revoke(@Param('uuid') uuid: string, @CurrentUser() user: ScopedUser) {
    await this.tokenService.revoke(user.userId, uuid);
    return { data: null };
  }
}
