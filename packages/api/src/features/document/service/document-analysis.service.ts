import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  DocumentAnalysisResponse,
  DocumentAnalysisResponseSchema,
  DocumentAnalysisSessionState,
  DocumentAnalysisSessionStateSchema,
} from '@binder/common';
import type { DocumentAnalysisMessage } from '@binder/common';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { ApplicationSettingsService } from '../../settings/service/application-settings.service';
import {
  AiProviderService,
  ResolvedAiProvider,
} from '../../ai-provider/service/ai-provider.service';
import { BinderLogger } from '../../../shared/service/logger.helper';
import { DocumentStore } from '../store/document.store';
import { DocumentAnalysisSessionStore } from '../store/document-analysis-session.store';
import { DocumentStorageService } from './document-storage.service';
import type { DocumentAnalysisSession } from '../models/document-analysis-session.entity';

interface UploadedFileResponse {
  id: string;
  expiresAt: Date | null;
}

interface AnalysisResponsePayload {
  id: string;
  text: string;
}

@Injectable()
export class DocumentAnalysisService {
  private static readonly MAX_PERSISTED_MESSAGES = 100;
  private readonly logger = new BinderLogger(DocumentAnalysisService.name);

  constructor(
    private readonly documents: DocumentStore,
    private readonly sessions: DocumentAnalysisSessionStore,
    private readonly storage: DocumentStorageService,
    private readonly settings: ApplicationSettingsService,
    private readonly aiProviders: AiProviderService,
  ) {}

  async start(
    ownerUuid: string,
    documentUuid: string,
    prompt: string,
    forceNew = false,
  ): Promise<DocumentAnalysisResponse> {
    const document = await this.loadPdf(ownerUuid, documentUuid);
    const timeoutMs = await this.readTimeoutMs();

    const activeSession = await this.sessions.findActiveOwned(ownerUuid, documentUuid);
    if (activeSession) {
      const existingProvider = await this.aiProviders.resolveFileAnalysis(
        activeSession.providerUuid,
      );
      if (existingProvider) {
        return this.sendWithSession(
          activeSession,
          existingProvider,
          documentUuid,
          prompt,
          forceNew ? null : activeSession.remoteResponseId,
          timeoutMs,
          forceNew,
        );
      }
    }

    const provider = await this.requireProvider();
    const expirationSeconds = await this.readExpirationSeconds();
    const pdfBuffer = await fs.readFile(await this.storage.resolveStoragePath(document.storageKey));
    const uploaded = await this.uploadPdf(
      provider,
      pdfBuffer,
      document.originalFilename,
      expirationSeconds,
      timeoutMs,
    );
    const session = await this.sessions.create({
      uuid: randomUUID(),
      ownerUuid,
      documentUuid,
      providerUuid: provider.uuid,
      remoteFileId: uploaded.id,
      remoteResponseId: null,
      fileExpiresAt: uploaded.expiresAt,
      messages: [],
    });

    try {
      const response = await this.requestAnalysis(provider, uploaded.id, prompt, null, timeoutMs);
      await this.sessions.update(session.uuid, {
        remoteResponseId: response.id,
        messages: this.exchangeMessages(prompt, response.text),
      });
      return this.createResponse(
        session.uuid,
        documentUuid,
        provider,
        prompt,
        response.text,
        uploaded.expiresAt,
      );
    } catch (error) {
      await this.sessions.delete(session.uuid);
      await this.deleteRemoteFile(provider, uploaded.id, timeoutMs);
      throw error;
    }
  }

  async getActiveSession(
    ownerUuid: string,
    documentUuid: string,
  ): Promise<DocumentAnalysisSessionState | null> {
    const document = await this.documents.findOwnedByUuid(ownerUuid, documentUuid);
    if (!document) throw new NotFoundException('Document not found');

    const session = await this.sessions.findActiveOwned(ownerUuid, documentUuid);
    return session ? this.createSessionState(session) : null;
  }

  async continue(
    ownerUuid: string,
    documentUuid: string,
    sessionUuid: string,
    prompt: string,
  ): Promise<DocumentAnalysisResponse> {
    const document = await this.documents.findOwnedByUuid(ownerUuid, documentUuid);
    if (!document) throw new NotFoundException('Document not found');

    const session = await this.sessions.findOwned(ownerUuid, documentUuid, sessionUuid);
    if (!session) throw new NotFoundException('Analysis session not found');
    if (this.isExpired(session.fileExpiresAt)) {
      return this.start(ownerUuid, documentUuid, prompt);
    }

    const provider = await this.requireProvider(session.providerUuid);
    return this.sendWithSession(
      session,
      provider,
      documentUuid,
      prompt,
      session.remoteResponseId,
      await this.readTimeoutMs(),
      false,
    );
  }

  private async sendWithSession(
    session: DocumentAnalysisSession,
    provider: ResolvedAiProvider,
    documentUuid: string,
    prompt: string,
    previousResponseId: string | null,
    timeoutMs: number,
    resetMessages: boolean,
  ): Promise<DocumentAnalysisResponse> {
    const response = await this.requestAnalysis(
      provider,
      session.remoteFileId,
      prompt,
      previousResponseId,
      timeoutMs,
    );
    const messages = resetMessages
      ? this.exchangeMessages(prompt, response.text)
      : [...(session.messages ?? []), ...this.exchangeMessages(prompt, response.text)].slice(
          -DocumentAnalysisService.MAX_PERSISTED_MESSAGES,
        );

    await this.sessions.update(session.uuid, {
      remoteResponseId: response.id,
      messages,
    });

    return this.createResponse(
      session.uuid,
      documentUuid,
      provider,
      prompt,
      response.text,
      session.fileExpiresAt,
    );
  }

  private async loadPdf(ownerUuid: string, documentUuid: string) {
    const document = await this.documents.findOwnedByUuid(ownerUuid, documentUuid);
    if (!document) throw new NotFoundException('Document not found');
    if (document.mimeType !== 'application/pdf') {
      throw new BadRequestException('PDF analysis is currently available for PDF documents only');
    }
    if (document.status === 'uploaded' || document.status === 'scanning') {
      throw new BadRequestException('The document is waiting for malware scanning');
    }
    if (document.status === 'quarantined') {
      throw new BadRequestException('The document is quarantined and cannot be analyzed');
    }
    const absolutePath = await this.storage.resolveStoragePath(document.storageKey);
    let fileSize: number;
    try {
      fileSize = (await fs.stat(absolutePath)).size;
    } catch {
      throw new NotFoundException('The document file is not available in storage');
    }

    const maxUploadBytes = Number(
      await this.settings.get('documents.maxUploadBytes', String(50 * 1024 * 1024)),
    );
    if (!Number.isSafeInteger(maxUploadBytes) || maxUploadBytes <= 0) {
      throw new BadRequestException('documents.maxUploadBytes must be a positive integer');
    }
    if (fileSize > maxUploadBytes) {
      throw new BadRequestException(
        `The document exceeds the configured analysis size limit of ${maxUploadBytes} bytes`,
      );
    }
    return document;
  }

  private async requireProvider(providerUuid?: string | null): Promise<ResolvedAiProvider> {
    const provider = await this.aiProviders.resolveFileAnalysis(providerUuid);
    if (!provider || !provider.uuid) {
      throw new BadRequestException(
        'Configure an enabled assistant provider with file upload and PDF analysis endpoints first',
      );
    }
    return provider;
  }

  private async uploadPdf(
    provider: ResolvedAiProvider,
    pdfBuffer: Buffer,
    filename: string,
    expirationSeconds: number,
    timeoutMs: number,
  ): Promise<UploadedFileResponse> {
    const form = new FormData();
    form.append(
      'file',
      new Blob([pdfBuffer as unknown as BlobPart], { type: 'application/pdf' }),
      filename,
    );
    form.append('purpose', 'user_data');
    form.append('expires_after[anchor]', 'created_at');
    form.append('expires_after[seconds]', String(expirationSeconds));

    const response = await fetch(provider.fileUploadEndpoint, {
      method: 'POST',
      headers: this.authorizationHeaders(provider),
      body: form,
      signal: AbortSignal.timeout(timeoutMs),
    });
    const payload = await this.readJson(response);
    if (!response.ok || !isRecord(payload) || typeof payload.id !== 'string') {
      this.logger.error('PDF upload for manual analysis failed', {
        provider: provider.name,
        status: response.status,
      });
      throw new BadRequestException('The AI provider could not accept the document PDF');
    }

    const expiresAt =
      typeof payload.expires_at === 'number'
        ? new Date(payload.expires_at * 1000)
        : typeof payload.expires_at === 'string'
          ? new Date(payload.expires_at)
          : null;
    return {
      id: payload.id,
      expiresAt:
        expiresAt && !Number.isNaN(expiresAt.valueOf())
          ? expiresAt
          : new Date(Date.now() + expirationSeconds * 1000),
    };
  }

  private async requestAnalysis(
    provider: ResolvedAiProvider,
    fileId: string,
    prompt: string,
    previousResponseId: string | null,
    timeoutMs: number,
  ): Promise<AnalysisResponsePayload> {
    const body: Record<string, unknown> = {
      model: provider.fileAnalysisModel,
      store: true,
      max_output_tokens: 4000,
      input: [
        {
          role: 'user',
          content: [
            { type: 'input_file', file_id: fileId },
            { type: 'input_text', text: prompt },
          ],
        },
      ],
    };
    if (previousResponseId) body.previous_response_id = previousResponseId;

    const response = await fetch(provider.fileAnalysisEndpoint, {
      method: 'POST',
      headers: { ...this.authorizationHeaders(provider), 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const payload = await this.readJson(response);
    const text = extractResponseText(payload);
    if (!response.ok || !isRecord(payload) || typeof payload.id !== 'string' || !text) {
      this.logger.error('PDF analysis request failed', {
        provider: provider.name,
        status: response.status,
        hasPreviousResponse: Boolean(previousResponseId),
      });
      throw new BadRequestException('The AI provider could not analyze the document');
    }
    return { id: payload.id, text };
  }

  private async deleteRemoteFile(
    provider: ResolvedAiProvider,
    fileId: string,
    timeoutMs: number,
  ): Promise<void> {
    try {
      const endpoint = `${provider.fileUploadEndpoint.replace(/\/$/, '')}/${encodeURIComponent(fileId)}`;
      await fetch(endpoint, {
        method: 'DELETE',
        headers: this.authorizationHeaders(provider),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      this.logger.warn('Could not remove failed manual-analysis upload', {
        provider: provider.name,
      });
    }
  }

  private authorizationHeaders(provider: ResolvedAiProvider): Record<string, string> {
    return provider.apiKey ? { authorization: `Bearer ${provider.apiKey}` } : {};
  }

  private async readJson(response: Response): Promise<unknown> {
    try {
      return await response.json();
    } catch {
      return null;
    }
  }

  private async readExpirationSeconds(): Promise<number> {
    const value = Number(await this.settings.get('ai.fileAnalysis.expirationSeconds', '3600'));
    if (!Number.isSafeInteger(value) || value < 3600 || value > 2_592_000) {
      throw new BadRequestException(
        'ai.fileAnalysis.expirationSeconds must be between 3600 and 2592000',
      );
    }
    return value;
  }

  private async readTimeoutMs(): Promise<number> {
    const value = Number(await this.settings.get('ai.fileAnalysis.timeoutMs', '120000'));
    if (!Number.isSafeInteger(value) || value < 1_000 || value > 600_000) {
      throw new BadRequestException('ai.fileAnalysis.timeoutMs must be between 1000 and 600000');
    }
    return value;
  }

  private createResponse(
    sessionUuid: string,
    documentUuid: string,
    provider: ResolvedAiProvider,
    prompt: string,
    text: string,
    fileExpiresAt: Date | null,
  ): DocumentAnalysisResponse {
    return DocumentAnalysisResponseSchema.parse({
      sessionUuid,
      documentUuid,
      providerName: provider.name,
      userMessage: { role: 'user', text: prompt, createdAt: new Date().toISOString() },
      assistantMessage: { role: 'assistant', text, createdAt: new Date().toISOString() },
      fileExpiresAt: fileExpiresAt?.toISOString() ?? null,
    });
  }

  private createSessionState(session: DocumentAnalysisSession): DocumentAnalysisSessionState {
    return DocumentAnalysisSessionStateSchema.parse({
      sessionUuid: session.uuid,
      documentUuid: session.documentUuid,
      messages: (session.messages ?? []).slice(-DocumentAnalysisService.MAX_PERSISTED_MESSAGES),
      fileExpiresAt: session.fileExpiresAt?.toISOString() ?? null,
    });
  }

  private exchangeMessages(prompt: string, response: string): DocumentAnalysisMessage[] {
    return [
      { role: 'user', text: prompt, createdAt: new Date().toISOString() },
      { role: 'assistant', text: response, createdAt: new Date().toISOString() },
    ];
  }

  private isExpired(expiresAt: Date | null): boolean {
    return !expiresAt || expiresAt.getTime() <= Date.now();
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function extractResponseText(value: unknown): string {
  if (!isRecord(value)) return '';
  if (typeof value.output_text === 'string') return value.output_text.trim().slice(0, 50_000);
  if (!Array.isArray(value.output)) return '';

  return value.output
    .flatMap((item) => {
      if (!isRecord(item) || !Array.isArray(item.content)) return [];
      return item.content
        .filter((content): content is Record<string, unknown> => isRecord(content))
        .filter((content) => content.type === 'output_text' && typeof content.text === 'string')
        .map((content) => content.text as string);
    })
    .join('\n')
    .trim()
    .slice(0, 50_000);
}
