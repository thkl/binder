import { Injectable, inject, signal } from '@angular/core';
import { ApplicationService, type PendingSharedFile } from '../../../common/application.service';
import { I18nService } from '../../../common/i18n/i18n.service';
import { DocumentsService } from './documents.service';

type ImportNotice = { kind: 'busy' | 'success' | 'error'; message: string };

@Injectable({ providedIn: 'root' })
export class MobileShareImportService {
  readonly notice = signal<ImportNotice | null>(null);
  private readonly application = inject(ApplicationService);
  private readonly documents = inject(DocumentsService);
  private readonly i18n = inject(I18nService);
  private processing = false;

  async processPending(): Promise<void> {
    if (!this.application.isNativeMobile() || this.processing) return;
    this.processing = true;

    let uploaded = 0;
    let duplicates = 0;
    try {
      const files = await this.application.getPendingSharedFiles();
      for (const pending of files) {
        this.notice.set({
          kind: 'busy',
          message: this.i18n.t('mobileShare.uploading', { name: pending.name }),
        });

        const file = await this.readFile(pending);
        this.documents.clearUploadNotice();
        const success = await this.documents.upload(file);
        if (success) {
          await this.application.completePendingSharedFile(pending.id);
          uploaded += 1;
          continue;
        }

        if (this.documents.duplicateUpload()) {
          await this.application.completePendingSharedFile(pending.id);
          duplicates += 1;
          continue;
        }

        this.notice.set({
          kind: 'error',
          message: this.i18n.t('mobileShare.uploadFailed', { name: pending.name }),
        });
        return;
      }

      if (uploaded > 0 && duplicates > 0) {
        this.notice.set({
          kind: 'success',
          message: this.i18n.t('mobileShare.completedWithDuplicates', { uploaded, duplicates }),
        });
      } else if (uploaded > 0) {
        this.notice.set({
          kind: 'success',
          message: this.i18n.t('mobileShare.completed', { count: uploaded }),
        });
      } else if (duplicates > 0) {
        this.notice.set({
          kind: 'success',
          message: this.i18n.t('mobileShare.duplicatesOnly', { count: duplicates }),
        });
      } else {
        this.notice.set(null);
      }
    } catch {
      this.notice.set({ kind: 'error', message: this.i18n.t('mobileShare.unavailable') });
    } finally {
      this.processing = false;
    }
  }

  dismissNotice(): void {
    this.notice.set(null);
  }

  private async readFile(pending: PendingSharedFile): Promise<File> {
    const chunkSize = 256 * 1024;
    const parts: BlobPart[] = [];

    for (let offset = 0; offset < pending.size; offset += chunkSize) {
      const base64 = await this.application.readPendingSharedFileChunk(
        pending.id,
        offset,
        Math.min(chunkSize, pending.size - offset),
      );
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
      }
      parts.push(bytes.buffer as ArrayBuffer);
    }

    return new File(parts, pending.name, { type: 'application/pdf' });
  }
}
