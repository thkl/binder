import {
  ChangeDetectionStrategy,
  Component,
  HostListener,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import type { Document, DocumentTitleSuggestion } from '@binder/common';
import { I18nService, TranslatePipe } from '../../../../common/i18n/i18n.service';
import { DocumentMetadataEditorComponent } from '../../../metadata/components/document-metadata-editor/document-metadata-editor.component';
import { ApplicationService } from '../../../../common/application.service';
import { DocumentAnalysisComponent } from '../document-analysis/document-analysis.component';
import { DocumentAuditHistoryComponent } from '../document-audit-history/document-audit-history.component';
import { CalendarService } from '../../services/calendar.service';
import { DocumentsService } from '../../services/documents.service';
import { ResizableSplitComponent } from '../../../../common/components/resizable-split/resizable-split.component';
import { ShareAccessComponent } from '../share-access/share-access.component';
import { AuthService } from '../../../authentication/services/auth.service';
import { SharingService } from '../../services/sharing.service';

export type DocumentDrawerTab = 'preview' | 'metadata' | 'history';
export type DocumentDrawerMode = 'analysis' | 'metadata';

@Component({
  selector: 'binder-document-drawer',
  standalone: true,
  imports: [
    DocumentAnalysisComponent,
    DocumentAuditHistoryComponent,
    DocumentMetadataEditorComponent,
    ResizableSplitComponent,
    TranslatePipe,
    ShareAccessComponent,
  ],
  templateUrl: './document-drawer.component.html',
  styleUrl: './document-drawer.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DocumentDrawerComponent {
  readonly documentUuid = input.required<string>();
  readonly documentData = input.required<Document>();
  readonly initialTab = input<DocumentDrawerTab>('preview');
  readonly mode = input<DocumentDrawerMode>('analysis');
  readonly suggestion = input<DocumentTitleSuggestion | null>(null);
  readonly suggestionLoading = input(false);
  readonly requeueLoading = input(false);
  readonly externalClosePrompt = input(false);
  readonly sharePanelOpen = signal(false);

  readonly closeRequest = output<void>();
  readonly tabChange = output<DocumentDrawerTab>();
  readonly dirtyChange = output<boolean>();
  readonly manuallySaved = output<void>();
  readonly suggestionTitleAccepted = output<string>();
  readonly suggestionDismissed = output<void>();
  readonly suggestionAccepted = output<string>();
  readonly keepEditingRequest = output<void>();
  readonly discardRequest = output<void>();
  readonly archiveRequested = output<void>();
  readonly deleteRequested = output<void>();
  readonly splitRequested = output<void>();
  readonly rotateRequested = output<void>();
  readonly suggestionRequested = output<void>();
  readonly requeueRequested = output<void>();
  readonly versionSelected = output<string>();
  readonly versions = signal<Document[]>([]);

  readonly activeTab = signal<DocumentDrawerTab>('preview');
  readonly dirty = signal(false);
  readonly closePrompt = signal(false);
  readonly calendarSyncing = signal(false);
  readonly calendarError = signal<string | null>(null);
  readonly showClosePrompt = computed(() => this.closePrompt() || this.externalClosePrompt());
  readonly showAnalysis = computed(() => this.mode() === 'analysis' && !this.readOnly());
  readonly readOnly = computed(() => this.documentData().ownerUuid !== this.auth.user()?.uuid);
  readonly shareRecipientCount = computed(
    () => this.sharing.documentShareCounts()[this.documentUuid()] ?? 0,
  );
  readonly fileUrl = computed<SafeResourceUrl>(() => {
    const url = this.application.getApiUrl('v1', `documents/${this.documentUuid()}/file`);
    return this.sanitizer.bypassSecurityTrustResourceUrl(url);
  });
  readonly archiveUrl = computed(() => this.documentData().archiveUrl);
  readonly canDownload = computed(() =>
    this.documents.supportsMimeCapability(this.documentData().mimeType, 'download'),
  );
  readonly canCreateArchive = computed(() =>
    this.documents.supportsMimeCapability(this.documentData().mimeType, 'pdfa'),
  );
  readonly canPreviewPdf = computed(() => this.documents.hasPdfPreview(this.documentData().mimeType));
  readonly canRotate = computed(() =>
    this.documents.supportsMimeCapability(this.documentData().mimeType, 'page-rotation'),
  );
  readonly canSplit = computed(() =>
    this.documents.supportsMimeCapability(this.documentData().mimeType, 'split'),
  );
  readonly archiveReady = computed(
    () => this.canCreateArchive() && this.documentData().archiveStatus === 'ready',
  );
  readonly archiveBusy = computed(() =>
    ['queued', 'processing'].includes(this.documentData().archiveStatus),
  );
  readonly contentAvailable = computed(
    () => !['uploaded', 'scanning', 'quarantined'].includes(this.documentData().status),
  );
  readonly canRequeue = computed(() =>
    ['failed', 'ready', 'quarantined'].includes(this.documentData().status),
  );

  private readonly sanitizer = inject(DomSanitizer);
  private readonly application = inject(ApplicationService);
  private readonly calendar = inject(CalendarService);
  private readonly documents = inject(DocumentsService);
  private readonly i18n = inject(I18nService);
  private readonly auth = inject(AuthService);
  private readonly sharing = inject(SharingService);
  private readonly initialTabEffect = effect(() => {
    this.activeTab.set(this.initialTab());
  });
  private readonly versionsEffect = effect(() => {
    const uuid = this.documentUuid();
    void this.loadVersions(uuid);
  });

  constructor() {
    this.activeTab.set(this.initialTab());
  }

  private async loadVersions(uuid: string): Promise<void> {
    try {
      this.versions.set(await this.documents.loadVersions(uuid));
    } catch {
      this.versions.set([]);
    }
  }

  selectTab(tab: DocumentDrawerTab): void {
    this.activeTab.set(tab);
    this.tabChange.emit(tab);
  }

  handleDirtyChange(dirty: boolean): void {
    this.dirty.set(dirty);
    if (!dirty) this.closePrompt.set(false);
    this.dirtyChange.emit(dirty);
  }

  requestClose(): void {
    if (this.dirty()) {
      this.closePrompt.set(true);
      return;
    }
    this.closeRequest.emit();
  }

  keepEditing(): void {
    this.closePrompt.set(false);
    this.keepEditingRequest.emit();
  }

  discardChanges(): void {
    if (this.externalClosePrompt()) {
      this.discardRequest.emit();
      return;
    }
    this.closePrompt.set(false);
    this.dirty.set(false);
    this.dirtyChange.emit(false);
    this.closeRequest.emit();
  }

  async addCalendarEvent(): Promise<void> {
    this.calendarSyncing.set(true);
    this.calendarError.set(null);

    try {
      const event = await this.calendar.synchronize(this.documentUuid());

      if (!event) {
        this.calendarError.set(this.i18n.t('documents.calendarNoDueDate'));
        return;
      }

      this.downloadCalendarEvent(event.downloadUrl, event.title);
    } catch (error) {
      const errorMessage = this.calendar.errorMessage(error);
      this.calendarError.set(
        errorMessage.startsWith('documents.') ? this.i18n.t(errorMessage) : errorMessage,
      );
    } finally {
      this.calendarSyncing.set(false);
    }
  }

  private downloadCalendarEvent(url: string, title: string): void {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${title}.ics`;
    anchor.click();
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.requestClose();
  }
}
