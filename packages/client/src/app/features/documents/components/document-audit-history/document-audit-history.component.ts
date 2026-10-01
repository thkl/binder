import { ChangeDetectionStrategy, Component, effect, inject, input, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import type { DocumentAuditEvent, DocumentAuditResponse } from '@binder/common';
import { TranslatePipe, I18nService } from '../../../../common/i18n/i18n.service';
import { DocumentAuditService } from '../../services/document-audit.service';

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

  private readonly audit = inject(DocumentAuditService);
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
      this.page.set(await this.audit.load(documentUuid, page));
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
}
