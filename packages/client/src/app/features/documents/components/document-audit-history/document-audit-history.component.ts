import { ChangeDetectionStrategy, Component, effect, inject, input, signal } from '@angular/core';

import type { Document, DocumentAuditEvent, DocumentAuditResponse } from '@binder/common';
import { TranslatePipe, I18nService } from '../../../../common/i18n/i18n.service';
import { DocumentAuditService } from '../../services/document-audit.service';
import { DocumentsService } from '../../services/documents.service';
import { DatePipe } from '@angular/common';

@Component({
  selector: 'binder-document-audit-history',
  standalone: true,
  imports: [DatePipe, TranslatePipe],
  templateUrl: './document-audit-history.component.html',
  styleUrl: './document-audit-history.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DocumentAuditHistoryComponent {
  readonly documentUuid = input.required<string>();
  readonly refreshKey = input('');

  readonly page = signal<DocumentAuditResponse | null>(null);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly rollingBack = signal<string | null>(null);
  readonly deletingVersion = signal<string | null>(null);
  readonly versions = signal<Document[]>([]);

  private readonly audit = inject(DocumentAuditService);
  readonly documents = inject(DocumentsService);
  private readonly i18n = inject(I18nService);

  private readonly loadEffect = effect(() => {
    const documentUuid = this.documentUuid();
    this.refreshKey();
    if (documentUuid) void this.load(documentUuid, 1);
  });

  async load(documentUuid = this.documentUuid(), page = this.page()?.page ?? 1): Promise<void> {
    this.loading.set(true);
    this.error.set(null);

    try {
      const [history, versions] = await Promise.all([
        this.audit.load(documentUuid, page),
        this.documents.loadVersions(documentUuid),
      ]);
      this.page.set(history);
      this.versions.set(versions);
    } catch (error) {
      this.error.set(this.audit.errorMessage(error));
    } finally {
      this.loading.set(false);
    }
  }

  eventLabel(event: DocumentAuditEvent): string {
    return this.i18n.t(`audit.event.${event.eventType}`);
  }

  actorLabel(event: DocumentAuditEvent): string {
    return this.i18n.t(`audit.actor.${event.actorType}`);
  }

  fieldLabels(event: DocumentAuditEvent): string {
    const fields = event.details['fields'];
    if (!Array.isArray(fields)) return '';

    return fields
      .filter((field): field is string => typeof field === 'string')
      .map((field) =>
        field.startsWith('custom.')
          ? `${this.i18n.t('audit.field.custom')}: ${field.slice('custom.'.length)}`
          : this.i18n.t(`audit.field.${field}`),
      )
      .join(', ');
  }

  async rollback(event: DocumentAuditEvent): Promise<void> {
    if (!event.changeSetUuid || this.rollingBack()) return;
    if (!window.confirm(this.i18n.t('audit.rollbackConfirm'))) return;

    this.rollingBack.set(event.changeSetUuid);
    this.error.set(null);
    try {
      await this.audit.rollback(event.changeSetUuid);
      await this.load(this.documentUuid(), 1);
    } catch (error) {
      this.error.set(this.audit.errorMessage(error));
    } finally {
      this.rollingBack.set(null);
    }
  }

  async deleteVersion(version: Document): Promise<void> {
    if (version.versionParentUuid === null || this.deletingVersion()) return;
    const title = version.title?.trim() || version.originalFilename;
    if (
      !window.confirm(
        this.i18n.t('audit.deleteVersionConfirm').replace('{title}', title),
      )
    ) {
      return;
    }

    this.deletingVersion.set(version.uuid);
    this.error.set(null);
    try {
      await this.documents.deleteVersion(version.uuid);
      await this.load(this.documentUuid(), 1);
    } catch (error) {
      this.error.set(this.audit.errorMessage(error));
    } finally {
      this.deletingVersion.set(null);
    }
  }
}
