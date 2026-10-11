import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { CreateShareInputSchema } from '@binder/common';
import { AuthenticationGuard } from '../../authentication/guards/authentication.guard';
import { CurrentUser, ScopedUser } from '../../authentication/decorators/current-user.decorator';
import { SharingService } from '../service/sharing.service';

/** Exposes endpoints for granting and viewing document and folder shares. */
@Controller('shares')
@UseGuards(AuthenticationGuard)
export class SharingController {
  /**
   * Delegates share operations to the access-control service.
   *
   * @param {SharingService} sharing - Sharing service used to check grants and readable resources.
   */
  constructor(private readonly sharing: SharingService) {}

  /**
   * Lists users the current user is allowed to share resources with.
   *
   * @param {ScopedUser} user - Authenticated user making the request.
   * @returns Lists users the current user is allowed to share resources with.
   */
  @Get('recipients')
  async recipients(@CurrentUser() user: ScopedUser) {
    return { data: await this.sharing.listRecipients(user.userId) };
  }

  /**
   * Returns share recipient counts for the current user's owned resources.
   *
   * @param {ScopedUser} user - Authenticated user making the request.
   * @returns Share recipient counts for the current user's owned resources.
   */
  @Get('summary')
  async summary(@CurrentUser() user: ScopedUser) {
    return { data: await this.sharing.listOwnedShareSummary(user.userId) };
  }

  /**
   * Lists grants on a document owned by the current user.
   *
   * @param {string} documentUuid - UUID of the document.
   * @param {ScopedUser} user - Authenticated user making the request.
   * @returns Lists grants on a document owned by the current user.
   */
  @Get('documents/:documentUuid')
  async listDocumentShares(
    @Param('documentUuid') documentUuid: string,
    @CurrentUser() user: ScopedUser,
  ) {
    return { data: await this.sharing.listDocumentShares(user.userId, documentUuid) };
  }

  /**
   * Grants the specified recipient access to an owned document.
   *
   * @param {string} documentUuid - UUID of the document.
   * @param {unknown} body - Untrusted request payload to validate before use.
   * @param {ScopedUser} user - Authenticated user making the request.
   * @returns Grants the specified recipient access to an owned document.
   */
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

  /**
   * Revokes a recipient's grant on an owned document.
   *
   * @param {string} documentUuid - UUID of the document.
   * @param {string} recipientUuid - UUID of the share recipient.
   * @param {ScopedUser} user - Authenticated user making the request.
   * @returns Revokes a recipient's grant on an owned document.
   */
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

  /**
   * Lists grants on a folder owned by the current user.
   *
   * @param {string} folderUuid - UUID of the folder.
   * @param {ScopedUser} user - Authenticated user making the request.
   * @returns Lists grants on a folder owned by the current user.
   */
  @Get('folders/:folderUuid')
  async listFolderShares(
    @Param('folderUuid') folderUuid: string,
    @CurrentUser() user: ScopedUser,
  ) {
    return { data: await this.sharing.listFolderShares(user.userId, folderUuid) };
  }

  /**
   * Grants the specified recipient access to an owned folder and its contents.
   *
   * @param {string} folderUuid - UUID of the folder.
   * @param {unknown} body - Untrusted request payload to validate before use.
   * @param {ScopedUser} user - Authenticated user making the request.
   * @returns Grants the specified recipient access to an owned folder and its contents.
   */
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

  /**
   * Revokes a recipient's grant on an owned folder.
   *
   * @param {string} folderUuid - UUID of the folder.
   * @param {string} recipientUuid - UUID of the share recipient.
   * @param {ScopedUser} user - Authenticated user making the request.
   * @returns Revokes a recipient's grant on an owned folder.
   */
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
