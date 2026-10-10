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

@Controller('notifications')
@UseGuards(AuthenticationGuard)
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

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

  @Post('devices/status')
  async getDeviceRegistration(@Body() body: { token?: unknown }, @CurrentUser() user: ScopedUser) {
    if (typeof body.token !== 'string' || !/^[a-fA-F0-9]{64,200}$/.test(body.token)) {
      throw new BadRequestException('A valid APNs device token is required');
    }
    return { data: await this.notifications.getDeviceRegistration(user.userId, body.token.toLowerCase()) };
  }

  @Get('status')
  async getNotificationStatus() {
    const settings = await this.notifications.getPushSettings();
    return {
      data: {
        enabled: settings.provider === 'apns' && settings.enabled && settings.hasAPNsKey && Boolean(settings.keyId && settings.teamId && settings.topic),
      },
    };
  }

  @Delete('devices')
  async unregisterDevice(@Body() body: { token?: unknown }, @CurrentUser() user: ScopedUser) {
    if (typeof body.token === 'string') await this.notifications.unregisterDevice(user.userId, body.token.toLowerCase());
    return { data: null };
  }

  @Get('push-settings')
  @UseGuards(RolesGuard)
  @Roles('admin')
  async getPushSettings() {
    return { data: await this.notifications.getPushSettings() };
  }

  @Get('push-settings/devices')
  @UseGuards(RolesGuard)
  @Roles('admin')
  async getRegisteredDevices() {
    return { data: await this.notifications.getRegisteredDevices() };
  }

  @Delete('push-settings/devices/:uuid')
  @UseGuards(RolesGuard)
  @Roles('admin')
  async removeRegisteredDevice(@Param('uuid') uuid: string) {
    await this.notifications.removeRegisteredDevice(uuid);
    return { data: null };
  }

  @Post('push-settings/devices/:uuid/test')
  @UseGuards(RolesGuard)
  @Roles('admin')
  async sendTestPush(@Param('uuid') uuid: string) {
    await this.notifications.sendTestPush(uuid);
    return { data: null };
  }

  @Post('push-settings/test')
  @UseGuards(RolesGuard)
  @Roles('admin')
  async sendPushoverTest() {
    await this.notifications.sendPushoverTest();
    return { data: null };
  }

  @Put('push-settings')
  @UseGuards(RolesGuard)
  @Roles('admin')
  async savePushSettings(@Body() body: Record<string, unknown>) {
    return { data: await this.notifications.savePushSettings(body) };
  }

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

  @Delete('push-settings/apns-key')
  @UseGuards(RolesGuard)
  @Roles('admin')
  async deleteAPNsKey() {
    await this.notifications.deleteAPNsKey();
    return { data: await this.notifications.getPushSettings() };
  }

  @Delete('push-settings/pushover-credentials')
  @UseGuards(RolesGuard)
  @Roles('admin')
  async deletePushoverCredentials() {
    await this.notifications.deletePushoverCredentials();
    return { data: await this.notifications.getPushSettings() };
  }
}
