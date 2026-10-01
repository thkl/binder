import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AiProviderConfiguration,
  AiProviderConfigurationSchema,
  AiProviderProfileSchema,
  AiProviderTask,
  AiProviderTestResponse,
  AiProviderTestResponseSchema,
  CreateAiProviderProfileInput,
  UpdateAiProviderProfileInput,
} from '@binder/common';
import { ApplicationSettingsService } from '../../settings/service/application-settings.service';
import { EncryptionService } from '../../../shared/util/encryption.service';
import { AiProviderProfile } from '../models/ai-provider.entity';
import { AiProviderStore } from '../store/ai-provider.store';

const ASSISTANT_PROVIDER_SETTING = 'ai.assistantProviderUuid';
const EMBEDDING_PROVIDER_SETTING = 'ai.embeddingProviderUuid';
const MASKED_SECRET = '****';

export interface ResolvedAiProvider {
  uuid: string | null;
  name: string;
  providerType: 'openai-compatible';
  apiKey: string;
  assistantEndpoint: string;
  assistantModel: string;
  fileUploadEndpoint: string;
  fileAnalysisEndpoint: string;
  fileAnalysisModel: string;
  embeddingEndpoint: string;
  embeddingModel: string;
}

@Injectable()
export class AiProviderService {
  constructor(
    private readonly providers: AiProviderStore,
    private readonly settings: ApplicationSettingsService,
    private readonly encryption: EncryptionService,
  ) {}

  async getConfiguration(): Promise<AiProviderConfiguration> {
    const [items, selection] = await Promise.all([this.providers.listAll(), this.readSelection()]);

    return AiProviderConfigurationSchema.parse({
      items: items.map((item) => this.toResponse(item)),
      selection,
    });
  }

  async create(input: CreateAiProviderProfileInput) {
    const encryptedSecret = this.encryptSecret(input.apiKey);
    const provider = await this.providers.create({
      name: input.name,
      providerType: input.providerType,
      assistantEndpoint: this.toNullable(input.assistantEndpoint),
      assistantModel: this.toNullable(input.assistantModel),
      fileUploadEndpoint: this.toNullable(input.fileUploadEndpoint),
      fileAnalysisEndpoint: this.toNullable(input.fileAnalysisEndpoint),
      fileAnalysisModel: this.toNullable(input.fileAnalysisModel),
      embeddingEndpoint: this.toNullable(input.embeddingEndpoint),
      embeddingModel: this.toNullable(input.embeddingModel),
      apiKey: encryptedSecret.value,
      apiKeyIv: encryptedSecret.iv,
      enabled: input.enabled,
    });

    return this.toResponse(provider);
  }

  async update(uuid: string, input: UpdateAiProviderProfileInput) {
    const existing = await this.providers.findByUuid(uuid);
    if (!existing) throw new NotFoundException('AI provider not found');

    const changes: Record<string, unknown> = {};
    if (input.name !== undefined) changes.name = input.name;
    if (input.providerType !== undefined) changes.providerType = input.providerType;
    if (input.assistantEndpoint !== undefined)
      changes.assistantEndpoint = this.toNullable(input.assistantEndpoint);
    if (input.assistantModel !== undefined)
      changes.assistantModel = this.toNullable(input.assistantModel);
    if (input.fileUploadEndpoint !== undefined)
      changes.fileUploadEndpoint = this.toNullable(input.fileUploadEndpoint);
    if (input.fileAnalysisEndpoint !== undefined)
      changes.fileAnalysisEndpoint = this.toNullable(input.fileAnalysisEndpoint);
    if (input.fileAnalysisModel !== undefined)
      changes.fileAnalysisModel = this.toNullable(input.fileAnalysisModel);
    if (input.embeddingEndpoint !== undefined)
      changes.embeddingEndpoint = this.toNullable(input.embeddingEndpoint);
    if (input.embeddingModel !== undefined)
      changes.embeddingModel = this.toNullable(input.embeddingModel);
    if (input.enabled !== undefined) changes.enabled = input.enabled;
    if (input.apiKey !== undefined && input.apiKey !== MASKED_SECRET) {
      const encryptedSecret = this.encryptSecret(input.apiKey);
      changes.apiKey = encryptedSecret.value;
      changes.apiKeyIv = encryptedSecret.iv;
    }

    const updated = await this.providers.update(uuid, changes);
    const provider = updated ?? existing;

    await this.clearInvalidSelections(provider);

    return this.toResponse(provider);
  }

  async remove(uuid: string): Promise<void> {
    const existing = await this.providers.findByUuid(uuid);
    if (!existing) throw new NotFoundException('AI provider not found');

    const selection = await this.readSelection();
    if (selection.assistantProviderUuid === uuid) {
      await this.settings.set(ASSISTANT_PROVIDER_SETTING, '', false);
    }
    if (selection.embeddingProviderUuid === uuid) {
      await this.settings.set(EMBEDDING_PROVIDER_SETTING, '', false);
    }

    if (!(await this.providers.delete(uuid))) {
      throw new ConflictException('AI provider could not be deleted');
    }
  }

  async setSelection(selection: {
    assistantProviderUuid: string | null;
    embeddingProviderUuid: string | null;
  }): Promise<AiProviderConfiguration> {
    await this.validateSelection(selection.assistantProviderUuid, 'assistant');
    await this.validateSelection(selection.embeddingProviderUuid, 'embedding');

    await Promise.all([
      this.settings.set(
        ASSISTANT_PROVIDER_SETTING,
        selection.assistantProviderUuid ?? '',
        false,
        'Selected provider profile for document assistance',
      ),
      this.settings.set(
        EMBEDDING_PROVIDER_SETTING,
        selection.embeddingProviderUuid ?? '',
        false,
        'Selected provider profile for semantic embeddings',
      ),
    ]);

    return this.getConfiguration();
  }

  async test(uuid: string, task: AiProviderTask): Promise<AiProviderTestResponse> {
    const provider = await this.providers.findByUuid(uuid);
    if (!provider) throw new NotFoundException('AI provider not found');
    if (!provider.enabled) throw new BadRequestException('AI provider is disabled');

    const runtime = this.toRuntime(provider);
    const endpoint = task === 'assistant' ? runtime.assistantEndpoint : runtime.embeddingEndpoint;
    const model = task === 'assistant' ? runtime.assistantModel : runtime.embeddingModel;
    if (!endpoint || !model) {
      throw new BadRequestException(`The provider has no ${task} endpoint and model configured`);
    }

    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (runtime.apiKey) headers.authorization = `Bearer ${runtime.apiKey}`;

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers,
        signal: AbortSignal.timeout(15_000),
        body: JSON.stringify(
          task === 'assistant'
            ? {
                model,
                messages: [{ role: 'user', content: 'Reply with the word OK.' }],
                max_tokens: 8,
              }
            : { model, input: ['Binder provider connectivity test'] },
        ),
      });

      return AiProviderTestResponseSchema.parse({
        success: response.ok,
        status: response.status,
        message: response.ok
          ? 'Provider responded successfully'
          : `Provider returned HTTP ${response.status}`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Provider request failed';

      return AiProviderTestResponseSchema.parse({
        success: false,
        status: 0,
        message: `Provider request failed: ${message}`,
      });
    }
  }

  async resolve(task: AiProviderTask): Promise<ResolvedAiProvider | null> {
    const selectedUuid = await this.settings.get(
      task === 'assistant' ? ASSISTANT_PROVIDER_SETTING : EMBEDDING_PROVIDER_SETTING,
      '',
    );

    if (selectedUuid) {
      const provider = await this.providers.findByUuid(selectedUuid);
      if (!provider || !provider.enabled) return null;
      const runtime = this.toRuntime(provider);
      const endpoint = task === 'assistant' ? runtime.assistantEndpoint : runtime.embeddingEndpoint;
      const model = task === 'assistant' ? runtime.assistantModel : runtime.embeddingModel;
      return endpoint && model ? runtime : null;
    }

    return this.resolveLegacy(task);
  }

  async resolveFileAnalysis(providerUuid?: string | null): Promise<ResolvedAiProvider | null> {
    let runtime: ResolvedAiProvider | null;

    if (providerUuid !== undefined) {
      if (!providerUuid) return null;
      const provider = await this.providers.findByUuid(providerUuid);
      runtime = provider?.enabled ? this.toRuntime(provider) : null;
    } else {
      runtime = await this.resolve('assistant');
    }

    if (
      !runtime?.fileUploadEndpoint ||
      !runtime.fileAnalysisEndpoint ||
      !runtime.fileAnalysisModel
    ) {
      return null;
    }

    return runtime;
  }

  private async resolveLegacy(task: AiProviderTask): Promise<ResolvedAiProvider | null> {
    const providerType = await this.settings.get('ai.provider', 'openai-compatible');
    const apiKey = await this.settings.get('ai.apiKey', '');
    const assistantEndpoint = await this.settings.get('ai.endpoint', '');
    const assistantModel = await this.settings.get('ai.model', '');
    const embeddingEndpoint = await this.settings.get('embeddings.endpoint', '');
    const embeddingModel = await this.settings.get('embeddings.model', '');
    const fileUploadEndpoint = await this.settings.get('ai.fileUploadEndpoint', '');
    const fileAnalysisEndpoint = await this.settings.get('ai.fileAnalysisEndpoint', '');

    if (providerType !== 'openai-compatible') return null;
    const runtime: ResolvedAiProvider = {
      uuid: null,
      name: 'Legacy AI configuration',
      providerType,
      apiKey: apiKey ?? '',
      assistantEndpoint: assistantEndpoint ?? '',
      assistantModel: assistantModel ?? '',
      fileUploadEndpoint: fileUploadEndpoint ?? '',
      fileAnalysisEndpoint: fileAnalysisEndpoint ?? '',
      fileAnalysisModel: assistantModel ?? '',
      embeddingEndpoint: embeddingEndpoint ?? '',
      embeddingModel: embeddingModel ?? '',
    };
    const endpoint = task === 'assistant' ? runtime.assistantEndpoint : runtime.embeddingEndpoint;
    const model = task === 'assistant' ? runtime.assistantModel : runtime.embeddingModel;
    return endpoint && model ? runtime : null;
  }

  private async validateSelection(uuid: string | null, task: AiProviderTask): Promise<void> {
    if (!uuid) return;
    const provider = await this.providers.findByUuid(uuid);
    if (!provider) throw new NotFoundException('Selected AI provider not found');
    if (!provider.enabled) throw new BadRequestException('Selected AI provider is disabled');

    const endpoint = task === 'assistant' ? provider.assistantEndpoint : provider.embeddingEndpoint;
    const model = task === 'assistant' ? provider.assistantModel : provider.embeddingModel;
    if (!endpoint || !model) {
      throw new BadRequestException(`The selected provider has no ${task} endpoint and model`);
    }
  }

  private async clearInvalidSelections(provider: AiProviderProfile): Promise<void> {
    const selection = await this.readSelection();
    const updates: Promise<unknown>[] = [];

    if (
      selection.assistantProviderUuid === provider.uuid &&
      (!provider.enabled || !provider.assistantEndpoint || !provider.assistantModel)
    ) {
      updates.push(this.settings.set(ASSISTANT_PROVIDER_SETTING, '', false));
    }

    if (
      selection.embeddingProviderUuid === provider.uuid &&
      (!provider.enabled || !provider.embeddingEndpoint || !provider.embeddingModel)
    ) {
      updates.push(this.settings.set(EMBEDDING_PROVIDER_SETTING, '', false));
    }

    await Promise.all(updates);
  }

  private async readSelection(): Promise<{
    assistantProviderUuid: string | null;
    embeddingProviderUuid: string | null;
  }> {
    const [assistantProviderUuid, embeddingProviderUuid] = await Promise.all([
      this.settings.get(ASSISTANT_PROVIDER_SETTING, ''),
      this.settings.get(EMBEDDING_PROVIDER_SETTING, ''),
    ]);
    return {
      assistantProviderUuid: assistantProviderUuid || null,
      embeddingProviderUuid: embeddingProviderUuid || null,
    };
  }

  private encryptSecret(value: string | undefined): { value: string; iv: string | null } {
    if (!value?.trim()) return { value: '', iv: null };
    const encrypted = this.encryption.encrypt(value);
    return { value: encrypted.encrypted, iv: encrypted.iv };
  }

  private toRuntime(provider: AiProviderProfile): ResolvedAiProvider {
    return {
      uuid: provider.uuid,
      name: provider.name,
      providerType: provider.providerType,
      apiKey:
        provider.apiKey && provider.apiKeyIv
          ? this.encryption.decrypt(provider.apiKey, provider.apiKeyIv)
          : '',
      assistantEndpoint: provider.assistantEndpoint ?? '',
      assistantModel: provider.assistantModel ?? '',
      fileUploadEndpoint: provider.fileUploadEndpoint ?? '',
      fileAnalysisEndpoint: provider.fileAnalysisEndpoint ?? '',
      fileAnalysisModel: provider.fileAnalysisModel ?? '',
      embeddingEndpoint: provider.embeddingEndpoint ?? '',
      embeddingModel: provider.embeddingModel ?? '',
    };
  }

  private toNullable(value: string | undefined): string | null {
    const trimmed = value?.trim() ?? '';
    return trimmed ? trimmed : null;
  }

  private toResponse(provider: AiProviderProfile) {
    return AiProviderProfileSchema.parse({
      uuid: provider.uuid,
      name: provider.name,
      providerType: provider.providerType,
      assistantEndpoint: provider.assistantEndpoint,
      assistantModel: provider.assistantModel,
      fileUploadEndpoint: provider.fileUploadEndpoint,
      fileAnalysisEndpoint: provider.fileAnalysisEndpoint,
      fileAnalysisModel: provider.fileAnalysisModel,
      embeddingEndpoint: provider.embeddingEndpoint,
      embeddingModel: provider.embeddingModel,
      apiKeyConfigured: Boolean(provider.apiKey && provider.apiKeyIv),
      enabled: provider.enabled,
      createdAt: provider.createdAt.toISOString(),
      updatedAt: provider.updatedAt.toISOString(),
    });
  }
}
