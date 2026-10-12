import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import {
  ApiResponse,
  MetadataWebhookConfigResponse,
  MetadataWebhookConfigResponseSchema,
  MetadataWebhookDelivery,
  MetadataWebhookDeliveryListSchema,
  MetadataWebhookTestResponseSchema,
} from '@binder/common';
import { firstValueFrom } from 'rxjs';
import { I18nService, TranslatePipe } from '../../../../common/i18n/i18n.service';
import { MetadataService } from '../../../metadata/services/metadata.service';

@Component({
  selector: 'binder-metadata-webhook-manager',
  standalone: true,
  imports: [TranslatePipe, DatePipe],
  templateUrl: './metadata-webhook-manager.component.html',
  styleUrl: './metadata-webhook-manager.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MetadataWebhookManagerComponent {
  private readonly http = inject(HttpClient);
  readonly i18n = inject(I18nService);
  readonly metadata = inject(MetadataService);
  readonly config = signal<MetadataWebhookConfigResponse | null>(null);
  readonly bearerToken = signal('');
  readonly clearBearerToken = signal(false);
  readonly deliveries = signal<MetadataWebhookDelivery[]>([]);
  readonly loading = signal(false);
  readonly working = signal(false);
  readonly message = signal<string | null>(null);
  readonly error = signal<string | null>(null);

  constructor() {
    void this.loadConfig();
    void this.metadata.loadVocabulary();
    void this.load();
  }

  /** Loads the rule and available custom metadata fields for the editor. */
  async loadConfig(): Promise<void> {
    try {
      const response = await firstValueFrom(
        this.http.get<ApiResponse<unknown>>('/api/v1/workflows/metadata-webhook/config', { withCredentials: true }),
      );
      this.config.set(MetadataWebhookConfigResponseSchema.parse(response.data));
    } catch (error) {
      this.error.set(this.errorMessage(error));
    }
  }

  /** Saves the selected field condition and webhook settings. */
  async saveConfig(): Promise<void> {
    const config = this.config();
    if (!config) return;
    this.working.set(true);
    this.error.set(null);
    this.message.set(null);
    try {
      const response = await firstValueFrom(this.http.put<ApiResponse<unknown>>(
        '/api/v1/workflows/metadata-webhook/config',
        {
          ...config,
          bearerToken: this.bearerToken(),
          clearBearerToken: this.clearBearerToken(),
        },
        { withCredentials: true },
      ));
      this.config.set(MetadataWebhookConfigResponseSchema.parse(response.data));
      this.bearerToken.set('');
      this.clearBearerToken.set(false);
      this.message.set(this.i18n.t('workflow.saved'));
    } catch (error) {
      this.error.set(this.errorMessage(error));
    } finally {
      this.working.set(false);
    }
  }

  /** Updates one rule field while keeping the rest of the form state. */
  updateConfig<K extends keyof MetadataWebhookConfigResponse>(key: K, value: MetadataWebhookConfigResponse[K]): void {
    this.config.update((config) => config ? { ...config, [key]: value } : config);
  }

  /** Reads a text input event and updates one string setting. */
  updateText(key: 'field' | 'operator' | 'value' | 'url' | 'payloadTemplate', event: Event): void {
    this.updateConfig(key, (event.target as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement).value as never);
  }

  /** Reads a checkbox event and updates the enabled state. */
  updateEnabled(event: Event): void {
    this.updateConfig('enabled', (event.target as HTMLInputElement).checked);
  }

  /** Lists built-in metadata keys and each active custom field. */
  fieldOptions(): Array<{ value: string; label: string }> {
    return [
      { value: 'issuer', label: this.i18n.t('workflow.field.issuer') },
      { value: 'documentType', label: this.i18n.t('workflow.field.documentType') },
      { value: 'category', label: this.i18n.t('workflow.field.category') },
      { value: 'tags', label: this.i18n.t('workflow.field.tags') },
      ...this.metadata.definitions().filter((item) => item.active).map((item) => ({
        value: `custom.${item.key}`,
        label: `${this.i18n.t('workflow.field.custom')}: ${item.label}`,
      })),
    ];
  }

  /** Offers known vocabulary values when the selected field has a finite list. */
  valueOptions(): string[] {
    const field = this.config()?.field;
    const values = this.metadata.vocabulary();
    if (field === 'issuer') return this.metadata.issuers().map((item) => item.name);
    if (field === 'documentType') return values?.documentTypes.map((item) => item.name) ?? [];
    if (field === 'category') return values?.categories.map((item) => item.name) ?? [];
    if (field === 'tags') return values?.tags.map((item) => item.name) ?? [];
    const key = field?.startsWith('custom.') ? field.slice('custom.'.length) : '';
    return this.metadata.definitions().find((item) => item.key === key)?.options ?? [];
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const response = await firstValueFrom(
        this.http.get<ApiResponse<unknown>>('/api/v1/workflows/metadata-webhook/deliveries', {
          withCredentials: true,
        }),
      );
      this.deliveries.set(MetadataWebhookDeliveryListSchema.parse(response.data).items);
    } catch (error) {
      this.error.set(this.errorMessage(error));
    } finally {
      this.loading.set(false);
    }
  }

  async sendTest(): Promise<void> {
    this.working.set(true);
    this.message.set(null);
    this.error.set(null);
    try {
      const response = await firstValueFrom(
        this.http.post<ApiResponse<unknown>>('/api/v1/workflows/metadata-webhook/test', {}, {
          withCredentials: true,
        }),
      );
      const result = MetadataWebhookTestResponseSchema.parse(response.data);
      if (result.success) this.message.set(this.i18n.t('workflow.testSucceeded'));
      else this.error.set(`${this.i18n.t('workflow.testFailed')} ${result.message}`);
    } catch (error) {
      this.error.set(this.errorMessage(error));
    } finally {
      this.working.set(false);
    }
  }

  async retry(delivery: MetadataWebhookDelivery): Promise<void> {
    this.working.set(true);
    this.error.set(null);
    this.message.set(null);
    try {
      await firstValueFrom(
        this.http.post(`/api/v1/workflows/metadata-webhook/deliveries/${delivery.uuid}/retry`, {}, {
          withCredentials: true,
        }),
      );
      this.message.set(this.i18n.t('workflow.retryQueued'));
      await this.load();
    } catch (error) {
      this.error.set(this.errorMessage(error));
    } finally {
      this.working.set(false);
    }
  }

  statusLabel(delivery: MetadataWebhookDelivery): string {
    return this.i18n.t(`workflow.status.${delivery.status}`);
  }

  operatorLabel(operator: string): string {
    return this.i18n.t(`workflow.operator.${operator}`);
  }

  private errorMessage(error: unknown): string {
    if (error instanceof HttpErrorResponse && typeof error.error?.message === 'string') {
      return error.error.message;
    }
    return this.i18n.t('workflow.requestFailed');
  }
}
