import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { CreateIssuerInputSchema, UpdateIssuerInputSchema } from '@binder/common';
import { AuthenticationGuard } from '../../authentication/guards/authentication.guard';
import { CurrentUser, ScopedUser } from '../../authentication/decorators/current-user.decorator';
import { IssuerService } from '../service/issuer.service';

@Controller('issuers')
@UseGuards(AuthenticationGuard)
export class IssuerController {
  constructor(private readonly issuers: IssuerService) {}

  @Get()
  async list(@CurrentUser() user: ScopedUser, @Query('q') query?: string) {
    return { data: await this.issuers.list(user.userId, query) };
  }

  @Post()
  async create(@CurrentUser() user: ScopedUser, @Body() body: unknown) {
    return { data: await this.issuers.create(user.userId, CreateIssuerInputSchema.parse(body)) };
  }

  @Patch(':uuid')
  async update(@CurrentUser() user: ScopedUser, @Param('uuid') uuid: string, @Body() body: unknown) {
    return { data: await this.issuers.update(user.userId, uuid, UpdateIssuerInputSchema.parse(body)) };
  }
}
