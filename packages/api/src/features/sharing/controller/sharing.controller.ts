import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { CreateShareInputSchema } from '@binder/common';
import { AuthenticationGuard } from '../../authentication/guards/authentication.guard';
import { CurrentUser, ScopedUser } from '../../authentication/decorators/current-user.decorator';
import { SharingService } from '../service/sharing.service';

@Controller('shares')
@UseGuards(AuthenticationGuard)
export class SharingController {
  constructor(private readonly sharing: SharingService) {}

  @Get('recipients')
  async recipients(@CurrentUser() user: ScopedUser) {
    return { data: await this.sharing.listRecipients(user.userId) };
  }

  @Get('summary')
  async summary(@CurrentUser() user: ScopedUser) {
    return { data: await this.sharing.listOwnedShareSummary(user.userId) };
  }

  @Get('documents/:documentUuid')
  async listDocumentShares(
    @Param('documentUuid') documentUuid: string,
    @CurrentUser() user: ScopedUser,
  ) {
    return { data: await this.sharing.listDocumentShares(user.userId, documentUuid) };
  }

  @Post('documents/:documentUuid')
  async shareDocument(
    @Param('documentUuid') documentUuid: string,
    @Body() body: unknown,
    @CurrentUser() user: ScopedUser,
  ) {
    const input = CreateShareInputSchema.parse(body);
    return {
      data: await this.sharing.shareDocument(user.userId, documentUuid, input.recipientUuid),
    };
  }

  @Delete('documents/:documentUuid/:recipientUuid')
  async revokeDocumentShare(
    @Param('documentUuid') documentUuid: string,
    @Param('recipientUuid') recipientUuid: string,
    @CurrentUser() user: ScopedUser,
  ) {
    return {
      data: await this.sharing.revokeDocumentShare(user.userId, documentUuid, recipientUuid),
    };
  }

  @Get('folders/:folderUuid')
  async listFolderShares(
    @Param('folderUuid') folderUuid: string,
    @CurrentUser() user: ScopedUser,
  ) {
    return { data: await this.sharing.listFolderShares(user.userId, folderUuid) };
  }

  @Post('folders/:folderUuid')
  async shareFolder(
    @Param('folderUuid') folderUuid: string,
    @Body() body: unknown,
    @CurrentUser() user: ScopedUser,
  ) {
    const input = CreateShareInputSchema.parse(body);
    return {
      data: await this.sharing.shareFolder(user.userId, folderUuid, input.recipientUuid),
    };
  }

  @Delete('folders/:folderUuid/:recipientUuid')
  async revokeFolderShare(
    @Param('folderUuid') folderUuid: string,
    @Param('recipientUuid') recipientUuid: string,
    @CurrentUser() user: ScopedUser,
  ) {
    return {
      data: await this.sharing.revokeFolderShare(user.userId, folderUuid, recipientUuid),
    };
  }
}
