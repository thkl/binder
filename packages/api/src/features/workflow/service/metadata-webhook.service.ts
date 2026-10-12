import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import type { ClientRequest, RequestOptions } from 'node:http';
import type {
  MetadataWebhookOperator,
  MetadataWebhookWorkflowInput,
  PluginDocumentEvent,
} from '@binder/common';
import { BinderLogger } from '../../../shared/service/logger.helper';
import { EncryptionService } from '../../../shared/util/encryption.service';
import { DocumentStore } from '../../document/store/document.store';
import { MetadataService } from '../../metadata/service/metadata.service';
import { PluginRegistryService } from '../../plugin/service/plugin-registry.service';
import { MetadataWebhookDeliveryStore } from '../store/metadata-webhook-delivery.store';
import { MetadataWebhookWorkflowStore } from '../store/metadata-webhook-workflow.store';
import { MetadataWebhookWorkflow } from '../models/metadata-webhook-workflow.entity';

type WebhookConfig = {
  name: string;
  enabled: boolean;
  ownerUuid: string;
  approvalStatus: 'pending' | 'approved' | 'rejected';
  uuid: string;
  url: string;
  bearerToken: string;
  field: string;
  operator: MetadataWebhookOperator;
  value: string;
  payloadTemplate: string;
};

type RequestResult = { success: boolean; statusCode: number; message: string };

const WORKFLOW_EVENTS = new Set(['document.metadata-changed', 'document.ai-suggestion-applied']);
const DEFAULT_TEMPLATE =
  '{\n  "event": "document.metadata-condition-matched",\n  "workflow": {"uuid": "{{workflow.uuid}}", "name": "{{workflow.name}}"},\n  "document": {\n    "uuid": "{{document.uuid}}",\n    "title": "{{document.title}}"\n  },\n  "condition": {\n    "field": "{{condition.field}}",\n    "operator": "{{condition.operator}}",\n    "expected": "{{condition.expected}}",\n    "actual": "{{condition.actual}}"\n  },\n  "metadata": "{{metadata}}"\n}';

/** Queues and delivers webhooks when document metadata matches the configured condition. */
@Injectable()
export class MetadataWebhookService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new BinderLogger(MetadataWebhookService.name);
  private timer?: NodeJS.Timeout;
  private dispatchRunning = false;

  constructor(
    private readonly encryption: EncryptionService,
    private readonly deliveries: MetadataWebhookDeliveryStore,
    private readonly workflowStore: MetadataWebhookWorkflowStore,
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
        description:
          'Sends document metadata to approved user webhooks when a metadata condition matches.',
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

  /** Lists workflows visible to the caller; admins can review the entire workspace. */
  async listWorkflows(ownerUuid: string, isAdmin: boolean) {
    const [items, pending] = await Promise.all([
      this.workflowStore.list(isAdmin ? undefined : ownerUuid),
      isAdmin ? this.workflowStore.findPendingReview() : Promise.resolve([]),
    ]);
    return {
      items: items.map((item) => this.toWorkflowResponse(item)),
      pending: pending.map((item) => this.toWorkflowResponse(item)),
    };
  }

  /** Creates a rule owned by the current user; only admin-created rules start approved. */
  async createWorkflow(ownerUuid: string, input: MetadataWebhookWorkflowInput, isAdmin: boolean) {
    this.validateWorkflowInput(input);
    const secret = this.encryptToken(input.bearerToken);
    const workflow = await this.workflowStore.createWorkflow({
      ownerUuid,
      name: input.name.trim(),
      enabled: input.enabled,
      field: input.field.trim(),
      operator: input.operator,
      value: input.value.trim(),
      url: input.url.trim(),
      ...secret,
      payloadTemplate: input.payloadTemplate,
      approvalStatus: isAdmin ? 'approved' : 'pending',
      ...(isAdmin ? { reviewedBy: ownerUuid, reviewedAt: new Date(), reviewNote: null } : {}),
    });
    return this.toWorkflowResponse(workflow);
  }

  /** Updates an owned rule; user edits revoke approval and stop its queued work. */
  async updateWorkflow(
    uuid: string,
    ownerUuid: string,
    input: MetadataWebhookWorkflowInput,
    isAdmin: boolean,
  ) {
    this.validateWorkflowInput(input);
    const workflow = await this.workflowStore.findOwned(uuid, ownerUuid);
    if (!workflow) throw new NotFoundException('Workflow not found');
    const secret = this.resolveUpdatedToken(workflow, input);
    const approvalStatus = isAdmin ? 'approved' : 'pending';
    await workflow.update({
      name: input.name.trim(),
      enabled: input.enabled,
      field: input.field.trim(),
      operator: input.operator,
      value: input.value.trim(),
      url: input.url.trim(),
      ...secret,
      payloadTemplate: input.payloadTemplate,
      approvalStatus,
      reviewedBy: isAdmin ? ownerUuid : null,
      reviewedAt: isAdmin ? new Date() : null,
      reviewNote: null,
    });
    await this.deliveries.stopPendingForWorkflow(workflow.uuid);
    return this.toWorkflowResponse(workflow);
  }

  /** Deletes an owned workflow and cascades its delivery history. */
  async deleteWorkflow(uuid: string, ownerUuid: string): Promise<void> {
    if (!(await this.workflowStore.deleteOwned(uuid, ownerUuid)))
      throw new NotFoundException('Workflow not found');
  }

  /** Records an admin decision for a pending user workflow. */
  async reviewWorkflow(uuid: string, reviewerUuid: string, approved: boolean, note?: string) {
    const workflow = await this.workflowStore.review(
      uuid,
      approved ? 'approved' : 'rejected',
      reviewerUuid,
      approved ? null : note?.trim() || null,
    );
    if (!workflow) throw new NotFoundException('Workflow not found');
    if (!approved) await this.deliveries.stopPendingForWorkflow(uuid);
    return this.toWorkflowResponse(workflow);
  }

  /** Sends a sample only after the workflow has passed administrator review. */
  async testWorkflow(uuid: string, ownerUuid: string, isAdmin: boolean): Promise<RequestResult> {
    const workflow = isAdmin
      ? await this.workflowStore.findByUuid(uuid)
      : await this.workflowStore.findOwned(uuid, ownerUuid);
    if (!workflow) throw new NotFoundException('Workflow not found');
    if (workflow.approvalStatus !== 'approved')
      throw new ForbiddenException(
        'An administrator must approve this workflow before it can be tested',
      );
    const config = await this.toWebhookConfig(workflow);
    this.assertReady(config);
    const sampleValue = config.value || 'Example value';
    const body = this.renderTemplate(config.payloadTemplate, {
      event: 'document.metadata-webhook.test',
      workflow: { uuid: workflow.uuid, name: workflow.name },
      document: {
        uuid: '00000000-0000-4000-8000-000000000000',
        title: 'Binder webhook test',
        originalFilename: 'webhook-test.pdf',
      },
      metadata: {
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
        actual: sampleValue,
      },
    });
    return this.postJson(config.url, config.bearerToken, body);
  }

  /** Returns recent deliveries owned by the caller, or all deliveries to an admin. */
  async listDeliveries(ownerUuid: string, isAdmin: boolean) {
    const [items, workflows] = await Promise.all([
      this.deliveries.findRecent(isAdmin ? undefined : ownerUuid),
      this.workflowStore.list(isAdmin ? undefined : ownerUuid),
    ]);
    const names = new Map(workflows.map((item) => [item.uuid, item.name]));
    return {
      items: items.map((item) => ({
        uuid: item.uuid,
        documentUuid: item.documentUuid,
        workflowUuid: item.workflowUuid,
        workflowName: item.workflowUuid ? (names.get(item.workflowUuid) ?? null) : null,
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

  /** Requeues a failed delivery only for its owner or an administrator. */
  async retry(uuid: string, ownerUuid: string, isAdmin: boolean): Promise<void> {
    const existing = await this.deliveries.findByUuid(uuid);
    if (!existing || (!isAdmin && existing.ownerUuid !== ownerUuid)) {
      throw new NotFoundException('Delivery not found');
    }
    if (!existing.workflowUuid)
      throw new ConflictException('This delivery is not associated with a current workflow');
    const workflow = await this.workflowStore.findByUuid(existing.workflowUuid);
    if (!workflow || !workflow.enabled || workflow.approvalStatus !== 'approved') {
      throw new ForbiddenException(
        'The workflow must be enabled and approved before delivery can be retried',
      );
    }
    const delivery = await this.deliveries.retry(uuid, isAdmin ? undefined : ownerUuid);
    if (!delivery)
      throw new ConflictException('Only failed deliveries owned by you can be retried');
  }

  /** Queues each approved owner rule whose condition matches the changed metadata. */
  private async enqueueIfConditionMatches(event: PluginDocumentEvent): Promise<void> {
    if (!WORKFLOW_EVENTS.has(event.name)) return;
    const workflows = await this.workflowStore.findRunnable(event.ownerUuid);
    if (workflows.length === 0) return;
    const details = event.payload['details'];
    const fields =
      details && typeof details === 'object'
        ? (details as Record<string, unknown>)['fields']
        : undefined;
    const document = await this.documents.findOwnedByUuid(event.ownerUuid, event.documentUuid);
    if (!document) return;
    const metadata = await this.metadata.getDocumentMetadata(event.ownerUuid, event.documentUuid);
    for (const workflow of workflows) {
      if (
        Array.isArray(fields) &&
        !fields.includes(workflow.field) &&
        !(workflow.field.startsWith('custom.') && fields.includes('custom'))
      )
        continue;
      const actual = this.readMetadataField(metadata, workflow.field);
      if (
        !this.matchesCondition(actual, workflow.operator as MetadataWebhookOperator, workflow.value)
      )
        continue;
      const config = await this.toWebhookConfig(workflow);
      const triggerValue = this.valueForDisplay(actual);
      const renderedPayload = this.renderTemplate(config.payloadTemplate, {
        event: 'document.metadata-condition-matched',
        workflow: { uuid: workflow.uuid, name: workflow.name },
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
      if (
        !renderedPayload ||
        typeof renderedPayload !== 'object' ||
        Array.isArray(renderedPayload)
      ) {
        throw new BadRequestException('Webhook body template must have a JSON object at its root');
      }
      await this.deliveries.enqueue({
        ownerUuid: event.ownerUuid,
        documentUuid: event.documentUuid,
        sourceEventUuid: event.eventUuid ?? randomUUID(),
        workflowUuid: workflow.uuid,
        field: config.field,
        operator: config.operator,
        triggerValue,
        payload: renderedPayload as Record<string, unknown>,
      });
    }
  }

  /** Claims and sends one queued request while allowing other API replicas to work in parallel. */
  private async dispatchPending(): Promise<void> {
    if (this.dispatchRunning) return;
    this.dispatchRunning = true;
    try {
      const delivery = await this.deliveries.claimNext();
      if (!delivery) return;
      try {
        if (!delivery.workflowUuid) throw new Error('Delivery has no associated workflow');
        const workflow = await this.workflowStore.findByUuid(delivery.workflowUuid);
        if (!workflow || !workflow.enabled || workflow.approvalStatus !== 'approved') {
          await this.deliveries.cancel(
            delivery.uuid,
            'Workflow is disabled or awaiting administrator approval.',
          );
          return;
        }
        const config = await this.toWebhookConfig(workflow);
        this.assertReady(config);
        const result = await this.postJson(config.url, config.bearerToken, delivery.payload);
        if (!result.success) throw new Error(`Webhook returned HTTP ${result.statusCode}`);
        await this.deliveries.markDelivered(delivery.uuid);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Webhook delivery failed';
        await this.deliveries.markFailed(delivery.uuid, delivery.attempts, message);
        this.logger.warn('Metadata workflow webhook delivery failed', {
          deliveryUuid: delivery.uuid,
          workflowUuid: delivery.workflowUuid,
          documentUuid: delivery.documentUuid,
          attempts: delivery.attempts,
          error: message,
        });
      }
    } catch (error) {
      this.logger.error('Unable to dispatch a metadata workflow webhook', error);
    } finally {
      this.dispatchRunning = false;
    }
  }

  private validateWorkflowInput(input: MetadataWebhookWorkflowInput): void {
    if (
      !/^(issuer|documentType|category|tags|custom\.[A-Za-z0-9_.-]+)$/u.test(input.field.trim())
    ) {
      throw new BadRequestException(
        'Choose issuer, document type, category, tags, or a custom metadata field',
      );
    }
    if (!['is-set', 'is-not-set'].includes(input.operator) && !input.value.trim()) {
      throw new BadRequestException('Enter a comparison value for this condition');
    }
    const config = {
      url: input.url.trim(),
      bearerToken: input.bearerToken?.trim() ?? '',
      payloadTemplate: input.payloadTemplate,
    };
    this.assertReady(config);
  }

  private encryptToken(token?: string, existing?: MetadataWebhookWorkflow) {
    if (token?.trim()) {
      const encrypted = this.encryption.encrypt(token.trim());
      return { bearerToken: encrypted.encrypted, bearerTokenIv: encrypted.iv };
    }
    return {
      bearerToken: existing?.bearerToken ?? null,
      bearerTokenIv: existing?.bearerTokenIv ?? null,
    };
  }

  private resolveUpdatedToken(
    workflow: MetadataWebhookWorkflow,
    input: MetadataWebhookWorkflowInput,
  ) {
    if (input.clearBearerToken) return { bearerToken: null, bearerTokenIv: null };
    return this.encryptToken(input.bearerToken, workflow);
  }

  private async toWebhookConfig(workflow: MetadataWebhookWorkflow): Promise<WebhookConfig> {
    const bearerToken =
      workflow.bearerToken && workflow.bearerTokenIv
        ? this.encryption.decrypt(workflow.bearerToken, workflow.bearerTokenIv)
        : '';
    return {
      uuid: workflow.uuid,
      ownerUuid: workflow.ownerUuid,
      name: workflow.name,
      enabled: workflow.enabled,
      approvalStatus: workflow.approvalStatus,
      url: workflow.url,
      bearerToken,
      field: workflow.field,
      operator: workflow.operator as MetadataWebhookOperator,
      value: workflow.value,
      payloadTemplate: workflow.payloadTemplate,
    };
  }

  private toWorkflowResponse(workflow: MetadataWebhookWorkflow) {
    return {
      uuid: workflow.uuid,
      ownerUuid: workflow.ownerUuid,
      ownerLabel: (workflow.owner?.email
        ? `${workflow.owner.username} (${workflow.owner.email})`
        : (workflow.owner?.username ?? workflow.ownerUuid)
      ).slice(0, 400),
      name: workflow.name,
      enabled: workflow.enabled,
      field: workflow.field,
      operator: workflow.operator,
      value: workflow.value,
      url: workflow.url,
      hasBearerToken: Boolean(workflow.bearerToken && workflow.bearerTokenIv),
      payloadTemplate: workflow.payloadTemplate,
      approvalStatus: workflow.approvalStatus,
      reviewNote: workflow.reviewNote,
      createdAt: workflow.createdAt.toISOString(),
      updatedAt: workflow.updatedAt.toISOString(),
    };
  }

  private assertReady(
    config: Pick<WebhookConfig, 'url' | 'bearerToken' | 'payloadTemplate'>,
  ): void {
    if (!config.url) throw new BadRequestException('Set a webhook URL first');
    if (config.bearerToken.length > 4_096 || /[\r\n]/.test(config.bearerToken)) {
      throw new BadRequestException('Webhook bearer token is invalid or too long');
    }
    this.assertPublicWebhookURL(config.url);
    this.parseTemplate(config.payloadTemplate);
  }

  private readMetadataField(
    metadata: Awaited<ReturnType<MetadataService['getDocumentMetadata']>>,
    field: string,
  ): unknown {
    if (field === 'issuer') return metadata.issuer?.name ?? null;
    if (field === 'documentType') return metadata.documentType?.name ?? null;
    if (field === 'category') return metadata.category?.name ?? null;
    if (field === 'tags') return metadata.tags.map((tag) => tag.name);
    if (field.startsWith('custom.')) return metadata.custom[field.slice('custom.'.length)] ?? null;
    return null;
  }

  private matchesCondition(
    actual: unknown,
    operator: MetadataWebhookOperator,
    expected: string,
  ): boolean {
    const hasValue = Array.isArray(actual)
      ? actual.length > 0
      : actual !== null && actual !== undefined && String(actual).trim() !== '';
    if (operator === 'is-set') return hasValue;
    if (operator === 'is-not-set') return !hasValue;
    if (!hasValue) return operator === 'not-equals';
    if (operator === 'contains') {
      return Array.isArray(actual)
        ? actual.some((item) => String(item).toLocaleLowerCase() === expected.toLocaleLowerCase())
        : String(actual).toLocaleLowerCase().includes(expected.toLocaleLowerCase());
    }
    const equal = (Array.isArray(actual) ? actual : [actual]).some(
      (item) => String(item).trim().toLocaleLowerCase() === expected.toLocaleLowerCase(),
    );
    return operator === 'equals' ? equal : !equal;
  }

  private valueForDisplay(value: unknown): string {
    if (value === null || value === undefined) return '';
    return typeof value === 'string' ? value : JSON.stringify(value);
  }

  private parseTemplate(template: string): unknown {
    if (template.length > 20_000)
      throw new BadRequestException('Webhook JSON template is too large');
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
          : typeof resolved === 'string'
            ? resolved
            : JSON.stringify(resolved);
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
      throw new BadRequestException(
        'Webhook URL must use HTTP or HTTPS and cannot contain credentials',
      );
    }
    const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    if (
      hostname === 'localhost' ||
      hostname.endsWith('.localhost') ||
      hostname.endsWith('.local')
    ) {
      throw new BadRequestException('Webhook URL must point to a public host');
    }
    return url;
  }

  /** Posts JSON to a validated public address without following redirects. */
  private async postJson(
    urlValue: string,
    bearerToken: string,
    payload: unknown,
  ): Promise<RequestResult> {
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
            message:
              statusCode >= 200 && statusCode < 300
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
      if (
        normalized.startsWith('2001:0:') ||
        normalized.startsWith('2001:2:') ||
        normalized.startsWith('2001:db8:') ||
        normalized.startsWith('2002:')
      )
        return false;
      return true;
    }
    return false;
  }
}
