import { BadRequestException, ConflictException, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import type { ClientRequest, RequestOptions } from 'node:http';
import type { MetadataWebhookConfig, MetadataWebhookOperator, PluginDocumentEvent } from '@binder/common';
import { ApplicationSettingsService } from '../../settings/service/application-settings.service';
import { BinderLogger } from '../../../shared/service/logger.helper';
import { DocumentStore } from '../../document/store/document.store';
import { MetadataService } from '../../metadata/service/metadata.service';
import { PluginRegistryService } from '../../plugin/service/plugin-registry.service';
import { MetadataWebhookDeliveryStore } from '../store/metadata-webhook-delivery.store';

type WebhookConfig = {
  enabled: boolean;
  url: string;
  bearerToken: string;
  field: string;
  operator: MetadataWebhookOperator;
  value: string;
  payloadTemplate: string;
};

type RequestResult = { success: boolean; statusCode: number; message: string };

const WORKFLOW_EVENTS = new Set(['document.metadata-changed', 'document.ai-suggestion-applied']);
const DEFAULT_TEMPLATE = '{\n  "event": "document.metadata-condition-matched",\n  "document": {\n    "uuid": "{{document.uuid}}",\n    "title": "{{document.title}}"\n  },\n  "condition": {\n    "field": "{{condition.field}}",\n    "operator": "{{condition.operator}}",\n    "expected": "{{condition.expected}}",\n    "actual": "{{condition.actual}}"\n  },\n  "metadata": "{{metadata}}"\n}';

/** Queues and delivers webhooks when document metadata matches the configured condition. */
@Injectable()
export class MetadataWebhookService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new BinderLogger(MetadataWebhookService.name);
  private timer?: NodeJS.Timeout;
  private dispatchRunning = false;

  constructor(
    private readonly settings: ApplicationSettingsService,
    private readonly deliveries: MetadataWebhookDeliveryStore,
    private readonly documents: DocumentStore,
    private readonly metadata: MetadataService,
    private readonly plugins: PluginRegistryService,
  ) {}

  onModuleInit(): void {
    this.plugins.register({
      manifest: {
        id: 'metadata-webhook',
        name: 'Metadata condition webhook',
        version: '1.0.0',
        description: 'Sends document metadata to a configured webhook when a metadata condition matches.',
        capabilities: ['document-events'],
        enabled: true,
      },
      onDocumentEvent: (event) => this.enqueueIfConditionMatches(event),
    });
    this.timer = setInterval(() => void this.dispatchPending(), 5_000);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Returns the latest delivery attempts for the administrator workflow view. */
  async listDeliveries() {
    const items = await this.deliveries.findRecent();
    return {
      items: items.map((item) => ({
        uuid: item.uuid,
        documentUuid: item.documentUuid,
        field: item.field,
        operator: item.operator,
        triggerValue: item.triggerValue,
        status: item.status,
        attempts: item.attempts,
        availableAt: item.availableAt.toISOString(),
        deliveredAt: item.deliveredAt?.toISOString() ?? null,
        lastError: item.lastError,
        createdAt: item.createdAt.toISOString(),
      })),
    };
  }

  /** Sends a sample payload through the currently saved webhook configuration. */
  async test(): Promise<RequestResult> {
    const config = await this.getConfig();
    this.assertReady(config);
    const body = this.renderTemplate(config.payloadTemplate, {
      event: 'document.metadata-webhook.test',
      document: {
        uuid: '00000000-0000-4000-8000-000000000000',
        title: 'Binder webhook test',
        originalFilename: 'webhook-test.pdf',
      },
      metadata: {
        triggerValue: config.value || 'Example value',
        issuer: 'Example issuer',
        documentType: 'Example document type',
        category: 'Example category',
        tags: ['example'],
        custom: {},
      },
      condition: {
        field: config.field,
        operator: config.operator,
        expected: config.value,
        actual: config.value || 'Example value',
      },
    });
    const result = await this.postJson(config.url, config.bearerToken, body);
    return {
      statusCode: result.statusCode,
      success: result.statusCode >= 200 && result.statusCode < 300,
      message: result.message,
    };
  }

  /** Resets an exhausted delivery so the background dispatcher can retry it. */
  async retry(uuid: string): Promise<void> {
    const delivery = await this.deliveries.retry(uuid);
    if (!delivery) throw new ConflictException('Only failed webhook deliveries can be retried');
  }

  /** Queues a webhook when the changed metadata field satisfies the configured rule. */
  private async enqueueIfConditionMatches(event: PluginDocumentEvent): Promise<void> {
    if (!WORKFLOW_EVENTS.has(event.name)) return;
    const config = await this.getConfig();
    if (!config.enabled || !config.url || !config.field) return;

    const details = event.payload['details'];
    const fields = details && typeof details === 'object'
      ? (details as Record<string, unknown>)['fields']
      : undefined;
    if (Array.isArray(fields) && !fields.includes(config.field) && !(config.field.startsWith('custom.') && fields.includes('custom'))) {
      return;
    }

    const document = await this.documents.findOwnedByUuid(event.ownerUuid, event.documentUuid);
    if (!document) return;
    const metadata = await this.metadata.getDocumentMetadata(event.ownerUuid, event.documentUuid);
    const actual = this.readMetadataField(metadata, config.field);
    if (!this.matchesCondition(actual, config.operator, config.value)) return;
    const triggerValue = this.valueForDisplay(actual);

    const sourceEventUuid = event.eventUuid ?? randomUUID();
    const renderedPayload = this.renderTemplate(config.payloadTemplate, {
      event: 'document.metadata-condition-matched',
      document: {
        uuid: document.uuid,
        title: document.title?.trim() || document.originalFilename,
        originalFilename: document.originalFilename,
        mimeType: document.mimeType,
        createdAt: document.createdAt.toISOString(),
        updatedAt: document.updatedAt.toISOString(),
      },
      metadata: {
        triggerValue,
        issuer: metadata.issuer?.name ?? '',
        issuerName: metadata.issuer?.name ?? '',
        documentType: metadata.documentType?.name ?? '',
        category: metadata.category?.name ?? '',
        tags: metadata.tags.map((tag) => tag.name),
        custom: metadata.custom,
      },
      condition: {
        field: config.field,
        operator: config.operator,
        expected: config.value,
        actual,
      },
    });
    if (!renderedPayload || typeof renderedPayload !== 'object' || Array.isArray(renderedPayload)) {
      throw new BadRequestException('Webhook body template must have a JSON object at its root');
    }

    await this.deliveries.enqueue({
      ownerUuid: event.ownerUuid,
      documentUuid: event.documentUuid,
      sourceEventUuid,
      field: config.field,
      operator: config.operator,
      triggerValue,
      payload: renderedPayload as Record<string, unknown>,
    });
  }

  /** Claims and sends one queued request while allowing other API replicas to work in parallel. */
  private async dispatchPending(): Promise<void> {
    if (this.dispatchRunning) return;
    this.dispatchRunning = true;
    try {
      const config = await this.getConfig();
      if (!config.enabled || !config.url) return;
      const delivery = await this.deliveries.claimNext();
      if (!delivery) return;
      try {
        this.assertReady(config);
        const result = await this.postJson(config.url, config.bearerToken, delivery.payload);
        if (result.statusCode < 200 || result.statusCode >= 300) {
          throw new Error(`Webhook returned HTTP ${result.statusCode}`);
        }
        await this.deliveries.markDelivered(delivery.uuid);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Webhook delivery failed';
        await this.deliveries.markFailed(delivery.uuid, delivery.attempts, message);
        this.logger.warn('Metadata-condition webhook delivery failed', {
          deliveryUuid: delivery.uuid,
          documentUuid: delivery.documentUuid,
          attempts: delivery.attempts,
          error: message,
        });
      }
    } catch (error) {
      this.logger.error('Unable to dispatch a metadata webhook', error);
    } finally {
      this.dispatchRunning = false;
    }
  }

  private async getConfig(): Promise<WebhookConfig> {
    const get = async (key: string, fallback = '') => (await this.settings.get(key, fallback)) ?? fallback;
    return {
      enabled: (await get('workflow.metadataWebhook.enabled', 'false')) === 'true',
      url: (await get('workflow.metadataWebhook.url')).trim(),
      bearerToken: await get('workflow.metadataWebhook.bearerToken'),
      field: (await get('workflow.metadataWebhook.field', 'issuer')).trim(),
      operator: (await get('workflow.metadataWebhook.operator', 'equals')) as MetadataWebhookOperator,
      value: await get('workflow.metadataWebhook.value'),
      payloadTemplate: await get('workflow.metadataWebhook.payloadTemplate', DEFAULT_TEMPLATE),
    };
  }

  /** Returns settings with the saved authorization token represented only as a presence flag. */
  async getConfigForAdmin() {
    const config = await this.getConfig();
    return {
      enabled: config.enabled,
      field: config.field,
      operator: config.operator,
      value: config.value,
      url: config.url,
      hasBearerToken: Boolean(config.bearerToken),
      payloadTemplate: config.payloadTemplate,
    };
  }

  /** Validates and persists the editable rule while keeping an unchanged secret encrypted. */
  async saveConfig(input: MetadataWebhookConfig): Promise<void> {
    const field = input.field.trim();
    if (!/^(issuer|documentType|category|tags|custom\.[A-Za-z0-9_.-]+)$/u.test(field)) {
      throw new BadRequestException('Choose issuer, document type, category, tags, or a custom metadata field');
    }
    const config: WebhookConfig = {
      enabled: input.enabled,
      url: input.url.trim(),
      bearerToken: '',
      field,
      operator: input.operator,
      value: input.value.trim(),
      payloadTemplate: input.payloadTemplate,
    };
    if (!['is-set', 'is-not-set'].includes(config.operator) && !config.value) {
      throw new BadRequestException('Enter a comparison value for this condition');
    }
    if (config.enabled) this.assertReady({ ...config, bearerToken: input.bearerToken ?? (await this.getConfig()).bearerToken });
    const existing = await this.getConfig();
    await Promise.all([
      this.settings.set('workflow.metadataWebhook.enabled', String(config.enabled)),
      this.settings.set('workflow.metadataWebhook.url', config.url),
      this.settings.set('workflow.metadataWebhook.field', config.field),
      this.settings.set('workflow.metadataWebhook.operator', config.operator),
      this.settings.set('workflow.metadataWebhook.value', config.value),
      this.settings.set('workflow.metadataWebhook.payloadTemplate', config.payloadTemplate),
    ]);
    if (input.clearBearerToken) await this.settings.delete('workflow.metadataWebhook.bearerToken');
    else if (input.bearerToken?.trim()) {
      await this.settings.set('workflow.metadataWebhook.bearerToken', input.bearerToken.trim(), true);
    } else if (!existing.bearerToken) {
      await this.settings.delete('workflow.metadataWebhook.bearerToken');
    }
  }

  private assertReady(config: WebhookConfig): void {
    if (!config.url) throw new BadRequestException('Set a webhook URL first');
    if (config.bearerToken.length > 4_096 || /[\r\n]/.test(config.bearerToken)) {
      throw new BadRequestException('Webhook bearer token is invalid or too long');
    }
    this.assertPublicWebhookURL(config.url);
    this.parseTemplate(config.payloadTemplate);
  }

  private readMetadataField(metadata: Awaited<ReturnType<MetadataService['getDocumentMetadata']>>, field: string): unknown {
    if (field === 'issuer') return metadata.issuer?.name ?? null;
    if (field === 'documentType') return metadata.documentType?.name ?? null;
    if (field === 'category') return metadata.category?.name ?? null;
    if (field === 'tags') return metadata.tags.map((tag) => tag.name);
    if (field.startsWith('custom.')) return metadata.custom[field.slice('custom.'.length)] ?? null;
    return null;
  }

  private matchesCondition(actual: unknown, operator: MetadataWebhookOperator, expected: string): boolean {
    const hasValue = Array.isArray(actual) ? actual.length > 0 : actual !== null && actual !== undefined && String(actual).trim() !== '';
    if (operator === 'is-set') return hasValue;
    if (operator === 'is-not-set') return !hasValue;
    if (!hasValue) return operator === 'not-equals';
    if (operator === 'contains') {
      return Array.isArray(actual)
        ? actual.some((item) => String(item).toLocaleLowerCase() === expected.toLocaleLowerCase())
        : String(actual).toLocaleLowerCase().includes(expected.toLocaleLowerCase());
    }
    const equal = (Array.isArray(actual) ? actual : [actual])
      .some((item) => String(item).trim().toLocaleLowerCase() === expected.toLocaleLowerCase());
    return operator === 'equals' ? equal : !equal;
  }

  private valueForDisplay(value: unknown): string {
    if (value === null || value === undefined) return '';
    return typeof value === 'string' ? value : JSON.stringify(value);
  }

  private parseTemplate(template: string): unknown {
    if (template.length > 20_000) throw new BadRequestException('Webhook JSON template is too large');
    let parsed: unknown;
    try {
      parsed = JSON.parse(template) as unknown;
    } catch {
      throw new BadRequestException('Webhook body template must contain valid JSON');
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new BadRequestException('Webhook body template must have a JSON object at its root');
    }
    return parsed;
  }

  /** Renders placeholders in parsed JSON values, preserving values for exact placeholders. */
  private renderTemplate(template: string, context: Record<string, unknown>): unknown {
    const parsed = this.parseTemplate(template);
    const render = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(render);
      if (value && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, render(item)]));
      }
      if (typeof value !== 'string') return value;
      const exact = value.match(/^\s*{{\s*([a-zA-Z0-9_.-]+)\s*}}\s*$/);
      if (exact) return this.resolveVariable(context, exact[1]);
      return value.replace(/{{\s*([a-zA-Z0-9_.-]+)\s*}}/g, (_match, path: string) => {
        const resolved = this.resolveVariable(context, path);
        return resolved === null || resolved === undefined
          ? ''
          : typeof resolved === 'string' ? resolved : JSON.stringify(resolved);
      });
    };
    return render(parsed);
  }

  private resolveVariable(context: Record<string, unknown>, path: string): unknown {
    return path.split('.').reduce<unknown>((value, key) => {
      if (!value || typeof value !== 'object') return undefined;
      return (value as Record<string, unknown>)[key];
    }, context);
  }

  private assertPublicWebhookURL(value: string): URL {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new BadRequestException('Webhook URL must be a valid HTTP or HTTPS URL');
    }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
      throw new BadRequestException('Webhook URL must use HTTP or HTTPS and cannot contain credentials');
    }
    const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')) {
      throw new BadRequestException('Webhook URL must point to a public host');
    }
    return url;
  }

  /** Posts JSON to a validated public address without following redirects. */
  private async postJson(urlValue: string, bearerToken: string, payload: unknown): Promise<RequestResult> {
    const url = this.assertPublicWebhookURL(urlValue);
    const hostname = url.hostname.replace(/^\[|\]$/g, '');
    const addresses = await lookup(hostname, { all: true, verbatim: true }).catch(() => []);
    if (addresses.length === 0 || addresses.some(({ address }) => !this.isPublicAddress(address))) {
      throw new BadRequestException('Webhook host must resolve only to public IP addresses');
    }
    const target = addresses[0];
    const requestClient = url.protocol === 'https:' ? httpsRequest : httpRequest;
    const body = JSON.stringify(payload);
    if (Buffer.byteLength(body) > 1_000_000) {
      throw new BadRequestException('Rendered webhook body is too large');
    }
    const requestOptions: RequestOptions = {
      hostname,
      port: url.port || undefined,
      path: `${url.pathname}${url.search}`,
      method: 'POST',
      lookup: (_host, _options, callback) => callback(null, target.address, target.family),
      headers: {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(body),
        'user-agent': 'Binder-Webhook/1.0',
        ...(url.host ? { host: url.host } : {}),
        ...(bearerToken ? { authorization: `Bearer ${bearerToken}` } : {}),
      },
    };

    return new Promise<RequestResult>((resolve, reject) => {
      const request: ClientRequest = requestClient(requestOptions, (response) => {
        response.resume();
        response.once('end', () => {
          const statusCode = response.statusCode ?? 0;
          resolve({
            success: statusCode >= 200 && statusCode < 300,
            statusCode,
            message: statusCode >= 200 && statusCode < 300
              ? `Webhook accepted the request (HTTP ${statusCode}).`
              : `Webhook returned HTTP ${statusCode}.`,
          });
        });
      });
      request.setTimeout(10_000, () => request.destroy(new Error('Webhook request timed out')));
      request.once('error', reject);
      request.end(body);
    });
  }

  /** Rejects loopback, private, link-local, multicast, and reserved network addresses. */
  private isPublicAddress(address: string): boolean {
    const normalized = address.toLowerCase();
    if (isIP(normalized) === 4) {
      const octets = normalized.split('.').map(Number);
      const [a, b, c] = octets;
      if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
      if (a === 100 && b >= 64 && b <= 127) return false;
      if (a === 169 && b === 254) return false;
      if (a === 172 && b >= 16 && b <= 31) return false;
      if (a === 192 && (b === 168 || (b === 0 && c === 0) || (b === 0 && c === 2))) return false;
      if (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) return false;
      if (a === 203 && b === 0 && c === 113) return false;
      if (a === 192 && b === 88 && c === 99) return false;
      return true;
    }
    if (isIP(normalized) === 6) {
      if (normalized.startsWith('::ffff:')) return this.isPublicAddress(normalized.slice(7));
      const firstHextet = Number.parseInt(normalized.split(':')[0] || '0', 16);
      if (firstHextet < 0x2000 || firstHextet > 0x3fff) return false;
      if (normalized.startsWith('2001:0:') || normalized.startsWith('2001:2:') || normalized.startsWith('2001:db8:') || normalized.startsWith('2002:')) return false;
      return true;
    }
    return false;
  }
}
