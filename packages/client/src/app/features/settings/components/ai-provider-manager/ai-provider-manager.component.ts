import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import type {
  AiProviderProfile,
  AiProviderTask,
  CreateAiProviderProfileInput,
} from '@binder/common';
import { AiProviderService } from '../../services/ai-provider.service';
import { I18nService, TranslatePipe } from '../../../../common/i18n/i18n.service';

interface AiProviderDraft {
  name: string;
  assistantEndpoint: string;
  assistantModel: string;
  fileUploadEndpoint: string;
  fileAnalysisEndpoint: string;
  fileAnalysisModel: string;
  embeddingEndpoint: string;
  embeddingModel: string;
  apiKey: string;
  enabled: boolean;
}

const EMPTY_DRAFT: AiProviderDraft = {
  name: '',
  assistantEndpoint: 'https://api.openai.com/v1/chat/completions',
  assistantModel: 'gpt-4o-mini',
  fileUploadEndpoint: 'https://api.openai.com/v1/files',
  fileAnalysisEndpoint: 'https://api.openai.com/v1/responses',
  fileAnalysisModel: 'gpt-4o-mini',
  embeddingEndpoint: 'https://api.openai.com/v1/embeddings',
  embeddingModel: 'text-embedding-3-small',
  apiKey: '',
  enabled: true,
};

@Component({
  selector: 'binder-ai-provider-manager',
  standalone: true,
  imports: [TranslatePipe],
  templateUrl: './ai-provider-manager.component.html',
  styleUrl: './ai-provider-manager.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AiProviderManagerComponent implements OnInit {
  readonly aiProviders = inject(AiProviderService);
  readonly i18n = inject(I18nService);

  readonly draft = signal<AiProviderDraft>({ ...EMPTY_DRAFT });
  readonly editingUuid = signal<string | null>(null);
  readonly formError = signal<string | null>(null);

  ngOnInit(): void {
    void this.aiProviders.load();
  }

  providers(): AiProviderProfile[] {
    return this.aiProviders.providers();
  }

  selection(task: AiProviderTask): string {
    const selection = this.aiProviders.configuration()?.selection;
    return task === 'assistant'
      ? (selection?.assistantProviderUuid ?? '')
      : (selection?.embeddingProviderUuid ?? '');
  }

  updateText(field: Exclude<keyof AiProviderDraft, 'enabled'>, event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.draft.update((current) => ({ ...current, [field]: value }));
    this.formError.set(null);
  }

  updateEnabled(event: Event): void {
    this.draft.update((current) => ({
      ...current,
      enabled: (event.target as HTMLInputElement).checked,
    }));
  }

  async save(): Promise<void> {
    const value = this.draft();
    if (!value.name.trim()) {
      this.formError.set(this.i18n.t('aiProviders.nameRequired'));
      return;
    }
    if (!this.hasTaskConfiguration(value)) {
      this.formError.set(this.i18n.t('aiProviders.taskRequired'));
      return;
    }

    this.formError.set(null);
    const editingUuid = this.editingUuid();
    if (editingUuid) {
      const input: Record<string, unknown> = { ...value };
      if (!value.apiKey.trim()) delete input['apiKey'];
      if (await this.aiProviders.update(editingUuid, input)) this.resetForm();
      return;
    }

    const input: CreateAiProviderProfileInput = {
      ...value,
      providerType: 'openai-compatible',
    };
    if (await this.aiProviders.create(input)) this.resetForm();
  }

  edit(provider: AiProviderProfile): void {
    this.editingUuid.set(provider.uuid);
    this.draft.set({
      name: provider.name,
      assistantEndpoint: provider.assistantEndpoint ?? '',
      assistantModel: provider.assistantModel ?? '',
      fileUploadEndpoint: provider.fileUploadEndpoint ?? '',
      fileAnalysisEndpoint: provider.fileAnalysisEndpoint ?? '',
      fileAnalysisModel: provider.fileAnalysisModel ?? '',
      embeddingEndpoint: provider.embeddingEndpoint ?? '',
      embeddingModel: provider.embeddingModel ?? '',
      apiKey: '',
      enabled: provider.enabled,
    });
    this.formError.set(null);
  }

  resetForm(): void {
    this.editingUuid.set(null);
    this.draft.set({ ...EMPTY_DRAFT });
    this.formError.set(null);
  }

  async remove(provider: AiProviderProfile): Promise<void> {
    if (!window.confirm(this.i18n.t('aiProviders.deleteConfirm'))) return;
    await this.aiProviders.remove(provider.uuid);
    if (this.editingUuid() === provider.uuid) this.resetForm();
  }

  async select(task: AiProviderTask, event: Event): Promise<void> {
    const uuid = (event.target as HTMLSelectElement).value || null;
    const current = this.aiProviders.configuration()?.selection;
    await this.aiProviders.setSelection({
      assistantProviderUuid: current?.assistantProviderUuid ?? null,
      embeddingProviderUuid: current?.embeddingProviderUuid ?? null,
      ...(task === 'assistant' ? { assistantProviderUuid: uuid } : { embeddingProviderUuid: uuid }),
    });
  }

  async test(provider: AiProviderProfile, task: AiProviderTask): Promise<void> {
    await this.aiProviders.test(provider.uuid, task);
  }

  testKey(provider: AiProviderProfile, task: AiProviderTask): string {
    return `${provider.uuid}:${task}`;
  }

  private hasTaskConfiguration(value: AiProviderDraft): boolean {
    const hasAssistant = Boolean(value.assistantEndpoint.trim() && value.assistantModel.trim());
    const hasEmbedding = Boolean(value.embeddingEndpoint.trim() && value.embeddingModel.trim());
    return hasAssistant || hasEmbedding;
  }
}
