import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { createPrivateKey } from 'node:crypto';
import { AuthenticationGuard } from '../authentication/guards/authentication.guard';
import { CurrentUser, ScopedUser } from '../authentication/decorators/current-user.decorator';
import { RolesGuard } from '../../shared/guards/roles.guard';
import { Roles } from '../../shared/decorators/roles.decorator';
import { NotificationsService } from './notifications.service';

type UploadFile = { originalname: string; buffer: Buffer; size: number };

/** Provides authenticated device registration and push configuration endpoints. */
@Controller('notifications')
@UseGuards(AuthenticationGuard)
export class NotificationsController {
  /**
   * Delegates validated notification requests to the notification service.
   *
   * @param {NotificationsService} notifications - Notification service used to register devices and send pushes.
   */
  constructor(private readonly notifications: NotificationsService) {}

  /**
   * Registers the caller's APNs token and device environment.
   *
   * @param {{ token?: unknown; environment?: unknown; deviceName?: unknown }} body - Untrusted request payload to validate before use.
   * @param {ScopedUser} user - Authenticated user making the request.
   * @returns Registers the caller's APNs token and device environment.
   */
  @Post('devices')
  async registerDevice(@Body() body: { token?: unknown; environment?: unknown; deviceName?: unknown }, @CurrentUser() user: ScopedUser) {
    if (typeof body.token !== 'string' || !/^[a-fA-F0-9]{64,200}$/.test(body.token)) {
      throw new BadRequestException('A valid APNs device token is required');
    }
    if (body.environment !== 'sandbox' && body.environment !== 'production') {
      throw new BadRequestException('APNs environment must be sandbox or production');
    }
    const deviceName = typeof body.deviceName === 'string' ? body.deviceName.trim().slice(0, 120) : 'iOS device';
    await this.notifications.registerDevice(user.userId, body.token.toLowerCase(), body.environment, deviceName || 'iOS device');
    return { data: null };
  }

  /**
   * Reports registration state for the caller's device token.
   *
   * @param {{ token?: unknown }} body - Untrusted request payload to validate before use.
   * @param {ScopedUser} user - Authenticated user making the request.
   * @returns Reports registration state for the caller's device token.
   */
  @Post('devices/status')
  async getDeviceRegistration(@Body() body: { token?: unknown }, @CurrentUser() user: ScopedUser) {
    if (typeof body.token !== 'string' || !/^[a-fA-F0-9]{64,200}$/.test(body.token)) {
      throw new BadRequestException('A valid APNs device token is required');
    }
    return { data: await this.notifications.getDeviceRegistration(user.userId, body.token.toLowerCase()) };
  }

  /**
   * Reports whether this server has an active APNs provider usable by the iOS app.
   *
   * @returns Reports whether this server has an active APNs provider usable by the iOS app.
   */
  @Get('status')
  async getNotificationStatus() {
    const settings = await this.notifications.getPushSettings();
    return {
      data: {
        enabled: settings.provider === 'apns' && settings.enabled && settings.hasAPNsKey && Boolean(settings.keyId && settings.teamId && settings.topic),
      },
    };
  }

  /**
   * Unregisters the caller's APNs device token.
   *
   * @param {{ token?: unknown }} body - Untrusted request payload to validate before use.
   * @param {ScopedUser} user - Authenticated user making the request.
   * @returns Unregisters the caller's APNs device token.
   */
  @Delete('devices')
  async unregisterDevice(@Body() body: { token?: unknown }, @CurrentUser() user: ScopedUser) {
    if (typeof body.token === 'string') await this.notifications.unregisterDevice(user.userId, body.token.toLowerCase());
    return { data: null };
  }

  /**
   * Returns provider settings for the administrator's notification page.
   *
   * @returns Provider settings for the administrator's notification page.
   */
  @Get('push-settings')
  @UseGuards(RolesGuard)
  @Roles('admin')
  async getPushSettings() {
    return { data: await this.notifications.getPushSettings() };
  }

  /**
   * Lists registered devices with their owner and APNs environment.
   *
   * @returns Lists registered devices with their owner and APNs environment.
   */
  @Get('push-settings/devices')
  @UseGuards(RolesGuard)
  @Roles('admin')
  async getRegisteredDevices() {
    return { data: await this.notifications.getRegisteredDevices() };
  }

  /**
   * Removes one registered device from the push target list.
   *
   * @param {string} uuid - UUID of the target document or record.
   * @returns Removes one registered device from the push target list.
   */
  @Delete('push-settings/devices/:uuid')
  @UseGuards(RolesGuard)
  @Roles('admin')
  async removeRegisteredDevice(@Param('uuid') uuid: string) {
    await this.notifications.removeRegisteredDevice(uuid);
    return { data: null };
  }

  /**
   * Sends a test notification to one registered device.
   *
   * @param {string} uuid - UUID of the target document or record.
   * @returns Sends a test notification to one registered device.
   */
  @Post('push-settings/devices/:uuid/test')
  @UseGuards(RolesGuard)
  @Roles('admin')
  async sendTestPush(@Param('uuid') uuid: string) {
    await this.notifications.sendTestPush(uuid);
    return { data: null };
  }

  /**
   * Sends a test notification through the configured Pushover provider.
   *
   * @returns Sends a test notification through the configured Pushover provider.
   */
  @Post('push-settings/test')
  @UseGuards(RolesGuard)
  @Roles('admin')
  async sendPushoverTest() {
    await this.notifications.sendPushoverTest();
    return { data: null };
  }

  /**
   * Saves provider selection and per-event notification preferences.
   *
   * @param {Record<string, unknown>} body - Untrusted request payload to validate before use.
   * @returns Saves provider selection and per-event notification preferences.
   */
  @Put('push-settings')
  @UseGuards(RolesGuard)
  @Roles('admin')
  async savePushSettings(@Body() body: Record<string, unknown>) {
    return { data: await this.notifications.savePushSettings(body) };
  }

  /**
   * Validates and stores an uploaded APNs key file.
   *
   * @param {UploadFile} file - PDF or other file supplied for this operation.
   * @returns Validates and stores an uploaded APNs key file.
   */
  @Post('push-settings/apns-key')
  @UseGuards(RolesGuard)
  @Roles('admin')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 64 * 1024, files: 1 } }))
  async uploadAPNsKey(@UploadedFile() file?: UploadFile) {
    if (!file || !file.originalname.toLowerCase().endsWith('.p8')) {
      throw new BadRequestException('Upload an Apple APNs authentication key with the .p8 extension');
    }
    const pem = file.buffer.toString('utf8');
    try {
      const key = createPrivateKey(pem);
      if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1') {
        throw new Error('Expected an EC P-256 key');
      }
    } catch {
      throw new BadRequestException('The uploaded file is not a valid APNs P-256 private key');
    }
    await this.notifications.saveAPNsKey(pem);
    return { data: await this.notifications.getPushSettings() };
  }

  /**
   * Deletes the stored APNs key.
   *
   * @returns Deletes the stored APNs key.
   */
  @Delete('push-settings/apns-key')
  @UseGuards(RolesGuard)
  @Roles('admin')
  async deleteAPNsKey() {
    await this.notifications.deleteAPNsKey();
    return { data: await this.notifications.getPushSettings() };
  }

  /**
   * Deletes the stored Pushover application and user credentials.
   *
   * @returns Deletes the stored Pushover application and user credentials.
   */
  @Delete('push-settings/pushover-credentials')
  @UseGuards(RolesGuard)
  @Roles('admin')
  async deletePushoverCredentials() {
    await this.notifications.deletePushoverCredentials();
    return { data: await this.notifications.getPushSettings() };
  }
}
