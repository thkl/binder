import { BadGatewayException, BadRequestException, Injectable, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { createSign } from 'node:crypto';
import { connect, ClientHttp2Session } from 'node:http2';
import { ApplicationSettingsService } from '../settings/service/application-settings.service';
import { BinderLogger } from '../../shared/service/logger.helper';
import { PushDeviceStore } from './store/push-device.store';
import { PushNotificationEventStore } from './store/push-notification-event.store';
import { PushNotificationEvent } from './models/push-notification-event.entity';
import { DocumentStore } from '../document/store/document.store';

type Environment = 'sandbox' | 'production';
type PushSettings = {
  enabled: boolean;
  keyId: string;
  teamId: string;
  topic: string;
  documentAdded: boolean;
  processingComplete: boolean;
  processingFailed: boolean;
  hasAPNsKey: boolean;
};
type APNsAlert = { title: string; body: string; data?: Record<string, string> };
type APNsResult = { status: number; reason?: string; requestId?: string };

@Injectable()
export class NotificationsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new BinderLogger(NotificationsService.name);
  private timer?: NodeJS.Timeout;
  private pollRunning = false;
  private jwtCache?: { token: string; issuedAt: number };

  constructor(
    private readonly settings: ApplicationSettingsService,
    private readonly devices: PushDeviceStore,
    private readonly events: PushNotificationEventStore,
    private readonly documents: DocumentStore,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => void this.dispatchPending(), 5_000);
    this.timer.unref();
  }

  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  async registerDevice(ownerId: string, token: string, environment: Environment, deviceName: string): Promise<void> {
    await this.devices.register(ownerId, token, environment, deviceName);
  }

  async unregisterDevice(ownerId: string, token: string): Promise<void> {
    await this.devices.unregister(ownerId, token);
  }

  async getDeviceRegistration(ownerId: string, token: string): Promise<{ enabled: boolean; environment: Environment | null }> {
    const device = await this.devices.findRegistration(ownerId, token);
    return { enabled: Boolean(device), environment: device?.environment ?? null };
  }

  async getRegisteredDevices() {
    return this.devices.findAllForAdmin();
  }

  async removeRegisteredDevice(uuid: string): Promise<void> {
    await this.devices.removeByUuid(uuid);
  }

  async sendTestPush(uuid: string): Promise<void> {
    const config = await this.getPushSettings();
    if (!config.enabled || !config.hasAPNsKey || !config.keyId || !config.teamId || !config.topic) {
      throw new BadRequestException('Configure and enable APNs before sending a test notification');
    }
    const device = await this.devices.findByUuid(uuid);
    if (!device) throw new NotFoundException('Registered device not found');
    const host = device.environment === 'sandbox' ? 'https://api.sandbox.push.apple.com' : 'https://api.push.apple.com';
    const result = await this.postAPNs(host, device.token, config, {
      title: 'Binder test notification',
      body: 'Push notifications are working for this device.',
      data: { eventType: 'test' },
    });
    if (result.status === 410) {
      await this.devices.deleteToken(device.token);
      throw new BadRequestException('APNs reports this device token is no longer active. It has been removed.');
    }
    if (result.status < 200 || result.status >= 300) {
      const details = [result.reason, result.requestId && `request ${result.requestId}`].filter(Boolean).join(', ');
      throw new BadGatewayException(`APNs returned HTTP ${result.status}${details ? ` (${details})` : ''}`);
    }
  }

  async getPushSettings(): Promise<PushSettings> {
    const get = async (key: string, fallback = '') => (await this.settings.get(`push.${key}`, fallback)) ?? fallback;
    return {
      enabled: (await get('enabled', 'false')) === 'true',
      keyId: await get('keyId'), teamId: await get('teamId'), topic: await get('topic', 'network.thkl.binder.ios'),
      documentAdded: (await get('events.documentAdded', 'true')) === 'true',
      processingComplete: (await get('events.processingComplete', 'false')) === 'true',
      processingFailed: (await get('events.processingFailed', 'true')) === 'true',
      hasAPNsKey: Boolean(await get('privateKey')),
    };
  }

  async savePushSettings(input: Record<string, unknown>): Promise<PushSettings> {
    const fields: [string, unknown][] = [
      ['enabled', input.enabled], ['keyId', input.keyId], ['teamId', input.teamId], ['topic', input.topic],
      ['events.documentAdded', input.documentAdded], ['events.processingComplete', input.processingComplete], ['events.processingFailed', input.processingFailed],
    ];
    for (const [key, value] of fields) {
      if (typeof value !== 'string' && typeof value !== 'boolean') continue;
      const normalized = typeof value === 'boolean' ? String(value) : value.trim();
      if (key === 'keyId' || key === 'teamId' || key === 'topic') {
        if (normalized.length > 255) throw new BadRequestException(`${key} is too long`);
      }
      await this.settings.set(`push.${key}`, normalized, false, 'APNs push notification configuration');
    }
    if (input.enabled === true || input.enabled === 'true') {
      const config = await this.getPushSettings();
      if (!config.hasAPNsKey || !config.keyId || !config.teamId || !config.topic) {
        throw new BadRequestException('Upload the APNs .p8 key and enter its Key ID, Team ID, and app topic before enabling notifications');
      }
    }
    this.jwtCache = undefined;
    return this.getPushSettings();
  }

  async saveAPNsKey(pem: string): Promise<void> {
    await this.settings.set('push.privateKey', pem, true, 'Encrypted APNs private key');
    this.jwtCache = undefined;
  }

  async deleteAPNsKey(): Promise<void> {
    await this.settings.delete('push.privateKey');
    await this.settings.set('push.enabled', 'false', false, 'APNs push notifications enabled');
    this.jwtCache = undefined;
  }

  private async dispatchPending(): Promise<void> {
    if (this.pollRunning) return;
    this.pollRunning = true;
    try {
      for (let sent = 0; sent < 20; sent++) {
        const event = await this.events.claimNext();
        if (!event) break;
        try {
          await this.sendEvent(event);
          await this.events.markDelivered(event.uuid);
        } catch (error) {
          await this.events.markFailed(event.uuid, event.attempts, (error as Error).message);
          this.logger.warn(`Push delivery attempt failed for event ${event.uuid}`);
        }
      }
    } catch (error) {
      this.logger.debug(`Push queue unavailable: ${(error as Error).message}`);
    } finally { this.pollRunning = false; }
  }

  private async sendEvent(event: PushNotificationEvent): Promise<void> {
    const config = await this.getPushSettings();
    const enabled = event.eventType === 'document-added' ? config.documentAdded
      : event.eventType === 'processing-complete' ? config.processingComplete
        : config.processingFailed;
    if (!config.enabled || !enabled) return;
    if (!config.hasAPNsKey || !config.keyId || !config.teamId || !config.topic) throw new Error('APNs is enabled but its key, Key ID, Team ID, or topic is missing');
    const devices = await this.devices.findForOwner(event.ownerUuid);
    const document = await this.documents.findOwnedByUuid(event.ownerUuid, event.documentUuid);
    const documentTitle = document?.title?.trim() || document?.originalFilename || '';
    for (const device of devices) {
      const host = device.environment === 'sandbox' ? 'https://api.sandbox.push.apple.com' : 'https://api.push.apple.com';
      const result = await this.postAPNs(host, device.token, config, {
        title: 'Binder',
        body: this.notificationText(event.eventType, documentTitle),
        data: { documentUuid: event.documentUuid, documentTitle, eventType: event.eventType },
      });
      if (result.status === 410) {
        await this.devices.deleteToken(device.token);
      } else if (result.status < 200 || result.status >= 300) {
        const details = [result.reason, result.requestId && `request ${result.requestId}`].filter(Boolean).join(', ');
        throw new Error(`APNs returned HTTP ${result.status}${details ? ` (${details})` : ''}`);
      }
    }
  }

  private postAPNs(host: string, token: string, config: PushSettings, alert: APNsAlert): Promise<APNsResult> {
    return this.getJWT(config).then((jwt) => new Promise<APNsResult>((resolve, reject) => {
      const session: ClientHttp2Session = connect(host);
      const timeout = setTimeout(() => { session.destroy(); reject(new Error('APNs request timed out')); }, 12_000);
      session.once('error', (error) => { clearTimeout(timeout); reject(error); });
      session.once('connect', () => {
        const request = session.request({
          ':method': 'POST', ':path': `/3/device/${token}`,
          authorization: `bearer ${jwt}`,
          'apns-topic': config.topic, 'apns-push-type': 'alert', 'apns-priority': '10',
        });
        let status = 0;
        let requestId: string | undefined;
        const responseChunks: Buffer[] = [];
        request.on('response', (headers) => {
          status = Number(headers[':status'] ?? 0);
          requestId = typeof headers['apns-id'] === 'string' ? headers['apns-id'] : undefined;
        });
        request.on('data', (chunk: Buffer | string) => responseChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        request.on('error', (error) => { clearTimeout(timeout); session.destroy(); reject(error); });
        request.on('end', () => {
          clearTimeout(timeout);
          session.close();
          let reason: string | undefined;
          if (responseChunks.length) {
            try {
              const body = JSON.parse(Buffer.concat(responseChunks).toString('utf8')) as { reason?: unknown };
              if (typeof body.reason === 'string') reason = body.reason;
            } catch { /* APNs may return an empty or non-JSON body. */ }
          }
          resolve({ status, reason, requestId });
        });
        request.end(JSON.stringify({
          aps: { alert: { title: alert.title, body: alert.body }, sound: 'default' },
          ...alert.data,
        }));
      });
    }));
  }

  private notificationText(type: string, documentTitle: string): string {
    if (type === 'document-added') return 'A document was added.';
    if (type === 'processing-complete') {
      return documentTitle ? `“${documentTitle}” has finished processing.` : 'Document processing is complete.';
    }
    return 'Document processing needs attention.';
  }

  private async getJWT(config: PushSettings): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    if (this.jwtCache && now - this.jwtCache.issuedAt < 50 * 60) return this.jwtCache.token;
    const privateKey = await this.settings.get('push.privateKey');
    if (!privateKey) throw new Error('APNs private key is missing');
    const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const unsigned = `${encode({ alg: 'ES256', kid: config.keyId })}.${encode({ iss: config.teamId, iat: now })}`;
    const signature = createSign('SHA256').update(unsigned).sign({ key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url');
    const token = `${unsigned}.${signature}`;
    this.jwtCache = { token, issuedAt: now };
    return token;
  }
}
