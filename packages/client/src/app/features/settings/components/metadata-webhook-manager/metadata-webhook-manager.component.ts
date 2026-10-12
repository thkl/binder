import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import {
  ApiResponse,
  MetadataWebhookDelivery,
  MetadataWebhookDeliveryListSchema,
  MetadataWebhookTestResponseSchema,
  MetadataWebhookWorkflow,
  MetadataWebhookWorkflowInput,
  MetadataWebhookWorkflowListSchema,
  MetadataWebhookWorkflowSchema,
} from '@binder/common';
import { firstValueFrom } from 'rxjs';
import { I18nService, TranslatePipe } from '../../../../common/i18n/i18n.service';
import { MetadataService } from '../../../metadata/services/metadata.service';
import { AuthService } from '../../../authentication/services/auth.service';

const DEFAULT_TEMPLATE =
  '{\n  "event": "document.metadata-condition-matched",\n  "workflow": {"uuid": "{{workflow.uuid}}", "name": "{{workflow.name}}"},\n  "document": {"uuid": "{{document.uuid}}", "title": "{{document.title}}"},\n  "condition": {"field": "{{condition.field}}", "operator": "{{condition.operator}}", "expected": "{{condition.expected}}", "actual": "{{condition.actual}}"},\n  "metadata": "{{metadata}}"\n}';

/** Lets users manage their webhook workflows and lets admins approve submissions. */
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
  readonly auth = inject(AuthService);
  readonly workflows = signal<MetadataWebhookWorkflow[]>([]);
  readonly pendingReview = signal<MetadataWebhookWorkflow[]>([]);
  readonly deliveries = signal<MetadataWebhookDelivery[]>([]);
  readonly draft = signal<MetadataWebhookWorkflowInput>(this.emptyDraft());
  readonly editingUuid = signal<string | null>(null);
  readonly editorOpen = signal(false);
  readonly rejectNote = signal('');
  readonly loading = signal(false);
  readonly working = signal(false);
  readonly message = signal<string | null>(null);
  readonly error = signal<string | null>(null);

  constructor() {
    void this.load();
    void this.metadata.loadVocabulary();
  }

  /** Loads workflows visible to this user and their recent delivery history. */
  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const [workflowResponse, deliveryResponse] = await Promise.all([
        firstValueFrom(
          this.http.get<ApiResponse<unknown>>('/api/v1/workflows/metadata-webhook', {
            withCredentials: true,
          }),
        ),
        firstValueFrom(
          this.http.get<ApiResponse<unknown>>('/api/v1/workflows/metadata-webhook/deliveries', {
            withCredentials: true,
          }),
        ),
      ]);
      const workflowData = MetadataWebhookWorkflowListSchema.parse(workflowResponse.data);
      this.workflows.set(workflowData.items);
      this.pendingReview.set(workflowData.pending);
      this.deliveries.set(MetadataWebhookDeliveryListSchema.parse(deliveryResponse.data).items);
    } catch (error) {
      this.error.set(this.errorMessage(error));
    } finally {
      this.loading.set(false);
    }
  }

  /** Starts a new workflow form with a useful JSON template. */
  create(): void {
    this.editingUuid.set(null);
    this.editorOpen.set(true);
    this.draft.set(this.emptyDraft());
    this.message.set(null);
    this.error.set(null);
  }

  /** Copies a workflow into the form without exposing its saved token. */
  edit(workflow: MetadataWebhookWorkflow): void {
    this.editingUuid.set(workflow.uuid);
    this.editorOpen.set(true);
    this.draft.set({
      name: workflow.name,
      enabled: workflow.enabled,
      field: workflow.field,
      operator: workflow.operator,
      value: workflow.value,
      url: workflow.url,
      payloadTemplate: workflow.payloadTemplate,
      bearerToken: '',
      clearBearerToken: false,
    });
    this.message.set(null);
    this.error.set(null);
  }

  /** Saves a new or edited workflow; user submissions wait for admin approval. */
  async save(): Promise<void> {
    this.working.set(true);
    this.error.set(null);
    this.message.set(null);
    try {
      const uuid = this.editingUuid();
      const response = await firstValueFrom(
        uuid
          ? this.http.put<ApiResponse<unknown>>(
              `/api/v1/workflows/metadata-webhook/${uuid}`,
              this.draft(),
              { withCredentials: true },
            )
          : this.http.post<ApiResponse<unknown>>(
              '/api/v1/workflows/metadata-webhook',
              this.draft(),
              { withCredentials: true },
            ),
      );
      const saved = MetadataWebhookWorkflowSchema.parse(response.data);
      this.editingUuid.set(null);
      this.editorOpen.set(false);
      this.draft.set(this.emptyDraft());
      this.message.set(
        this.i18n.t(saved.approvalStatus === 'approved' ? 'workflow.saved' : 'workflow.submitted'),
      );
      await this.load();
    } catch (error) {
      this.error.set(this.errorMessage(error));
    } finally {
      this.working.set(false);
    }
  }

  /** Removes a workflow and its queued delivery history. */
  async remove(workflow: MetadataWebhookWorkflow): Promise<void> {
    this.working.set(true);
    this.error.set(null);
    try {
      await firstValueFrom(
        this.http.delete(`/api/v1/workflows/metadata-webhook/${workflow.uuid}`, {
          withCredentials: true,
        }),
      );
      this.message.set(this.i18n.t('workflow.deleted'));
      await this.load();
    } catch (error) {
      this.error.set(this.errorMessage(error));
    } finally {
      this.working.set(false);
    }
  }

  /** Approves a pending workflow so future matching document changes can run it. */
  async approve(workflow: MetadataWebhookWorkflow): Promise<void> {
    await this.review(workflow, true);
  }

  /** Rejects a pending workflow with the current review note. */
  async reject(workflow: MetadataWebhookWorkflow): Promise<void> {
    await this.review(workflow, false);
  }

  /** Sends one live sample request for an already approved workflow. */
  async test(workflow: MetadataWebhookWorkflow): Promise<void> {
    this.working.set(true);
    this.error.set(null);
    this.message.set(null);
    try {
      const response = await firstValueFrom(
        this.http.post<ApiResponse<unknown>>(
          `/api/v1/workflows/metadata-webhook/${workflow.uuid}/test`,
          {},
          { withCredentials: true },
        ),
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

  /** Retries one failed delivery if the API authorizes the current user. */
  async retry(delivery: MetadataWebhookDelivery): Promise<void> {
    this.working.set(true);
    this.error.set(null);
    try {
      await firstValueFrom(
        this.http.post(
          `/api/v1/workflows/metadata-webhook/deliveries/${delivery.uuid}/retry`,
          {},
          { withCredentials: true },
        ),
      );
      this.message.set(this.i18n.t('workflow.retryQueued'));
      await this.load();
    } catch (error) {
      this.error.set(this.errorMessage(error));
    } finally {
      this.working.set(false);
    }
  }

  /** Updates the form model without adding Angular Forms as a dependency. */
  updateDraft<K extends keyof MetadataWebhookWorkflowInput>(
    key: K,
    value: MetadataWebhookWorkflowInput[K],
  ): void {
    this.draft.update((current) => ({ ...current, [key]: value }));
  }

  /** Reads a text or selection control and updates its form property. */
  updateText(
    key: 'name' | 'field' | 'operator' | 'value' | 'url' | 'payloadTemplate',
    event: Event,
  ): void {
    this.updateDraft(
      key,
      (event.target as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement).value as never,
    );
  }

  /** Returns built-in metadata fields and active custom fields for the selector. */
  fieldOptions(): Array<{ value: string; label: string }> {
    return [
      { value: 'issuer', label: this.i18n.t('workflow.field.issuer') },
      { value: 'documentType', label: this.i18n.t('workflow.field.documentType') },
      { value: 'category', label: this.i18n.t('workflow.field.category') },
      { value: 'tags', label: this.i18n.t('workflow.field.tags') },
      ...this.metadata
        .definitions()
        .filter((item) => item.active)
        .map((item) => ({
          value: `custom.${item.key}`,
          label: `${this.i18n.t('workflow.field.custom')}: ${item.label}`,
        })),
    ];
  }

  /** Supplies existing vocabulary values as suggestions for the rule value. */
  valueOptions(): string[] {
    const field = this.draft().field;
    const vocabulary = this.metadata.vocabulary();
    if (field === 'issuer') return this.metadata.issuers().map((item) => item.name);
    if (field === 'documentType') return vocabulary?.documentTypes.map((item) => item.name) ?? [];
    if (field === 'category') return vocabulary?.categories.map((item) => item.name) ?? [];
    if (field === 'tags') return vocabulary?.tags.map((item) => item.name) ?? [];
    const key = field.startsWith('custom.') ? field.slice(7) : '';
    return this.metadata.definitions().find((item) => item.key === key)?.options ?? [];
  }

  statusLabel(status: MetadataWebhookWorkflow['approvalStatus']): string {
    return this.i18n.t(`workflow.approval.${status}`);
  }

  deliveryStatusLabel(delivery: MetadataWebhookDelivery): string {
    return this.i18n.t(`workflow.status.${delivery.status}`);
  }

  visibleWorkflows(): MetadataWebhookWorkflow[] {
    return this.auth.user()?.isAdmin
      ? this.workflows().filter((workflow) => workflow.approvalStatus !== 'pending')
      : this.workflows();
  }

  operatorLabel(operator: string): string {
    return this.i18n.t(`workflow.operator.${operator}`);
  }

  private async review(workflow: MetadataWebhookWorkflow, approved: boolean): Promise<void> {
    this.working.set(true);
    this.error.set(null);
    try {
      await firstValueFrom(
        approved
          ? this.http.post(
              `/api/v1/workflows/metadata-webhook/${workflow.uuid}/approve`,
              {},
              { withCredentials: true },
            )
          : this.http.post(
              `/api/v1/workflows/metadata-webhook/${workflow.uuid}/reject`,
              { note: this.rejectNote() },
              { withCredentials: true },
            ),
      );
      this.message.set(this.i18n.t(approved ? 'workflow.approved' : 'workflow.rejected'));
      this.rejectNote.set('');
      await this.load();
    } catch (error) {
      this.error.set(this.errorMessage(error));
    } finally {
      this.working.set(false);
    }
  }

  private emptyDraft(): MetadataWebhookWorkflowInput {
    return {
      name: '',
      enabled: true,
      field: 'issuer',
      operator: 'equals',
      value: '',
      url: '',
      payloadTemplate: DEFAULT_TEMPLATE,
      bearerToken: '',
      clearBearerToken: false,
    };
  }

  private errorMessage(error: unknown): string {
    if (error instanceof HttpErrorResponse && typeof error.error?.message === 'string')
      return error.error.message;
    return this.i18n.t('workflow.requestFailed');
  }
}
