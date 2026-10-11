import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import type { Document, SharedDocument, SharedFolder } from '@binder/common';
import { I18nService, TranslatePipe } from '../../common/i18n/i18n.service';
import { SharingService } from '../documents/services/sharing.service';
import { DocumentsService } from '../documents/services/documents.service';
import { DocumentDrawerComponent } from '../documents/components/document-drawer/document-drawer.component';

const ALL_SHARED = '__all_shared__';
const UNFILED_SHARED = '__unfiled_shared__';

/** Displays shared folders and documents using the regular document drawer. */
@Component({
  selector: 'binder-shared-with-me',
  standalone: true,
  imports: [CommonModule, TranslatePipe, DocumentDrawerComponent],
  templateUrl: './shared-with-me.component.html',
  styleUrl: './shared-with-me.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SharedWithMeComponent implements OnInit {
  readonly folders = signal<SharedFolder[]>([]);
  readonly documents = signal<SharedDocument[]>([]);
  readonly unfiledDocuments = signal<SharedDocument[]>([]);
  readonly folderDocuments = signal<SharedDocument[]>([]);
  readonly selectedFolderUuid = signal(ALL_SHARED);
  readonly drawerDocument = signal<Document | null>(null);
  readonly openingUuid = signal<string | null>(null);
  readonly loading = signal(false);
  readonly error = signal(false);
  readonly thumbnailFailed = signal<Record<string, boolean>>({});
  private readonly sharing = inject(SharingService);
  private readonly documentsService = inject(DocumentsService);
  private readonly i18n = inject(I18nService);
  private folderLoadRun = 0;

  /**
   * Loads shared folders, all shared documents, and directly shared unfiled items.
   *
   * @returns {Promise<void>} - Resolves when the operation completes.
   */
  async ngOnInit(): Promise<void> {
    this.loading.set(true);
    try {
      const [folders, documents, unfiled] = await Promise.all([
        this.sharing.receivedFolders(),
        this.sharing.receivedDocuments(),
        this.sharing.receivedUnfiledDocuments(),
      ]);
      this.folders.set(folders);
      this.documents.set(documents);
      this.unfiledDocuments.set(unfiled);
    } catch {
      this.error.set(true);
    } finally {
      this.loading.set(false);
    }
  }

  /**
   * Selects a shared folder and loads its documents, ignoring stale responses.
   *
   * @param {string} folderUuid - UUID of the folder.
   * @returns {Promise<void>} - Resolves when the operation completes.
   */
  async selectFolder(folderUuid: string): Promise<void> {
    const run = ++this.folderLoadRun;
    this.selectedFolderUuid.set(folderUuid);
    if (folderUuid === ALL_SHARED || folderUuid === UNFILED_SHARED) {
      this.loading.set(false);
      return;
    }
    const folder = this.folders().find((item) => item.uuid === folderUuid);
    if (!folder) return;
    this.folderDocuments.set([]);
    this.loading.set(true);
    this.error.set(false);
    try {
      const documents = await this.sharing.folderDocuments(folder.uuid);
      if (run === this.folderLoadRun) this.folderDocuments.set(documents);
    } catch {
      if (run === this.folderLoadRun) this.error.set(true);
    } finally {
      if (run === this.folderLoadRun) this.loading.set(false);
    }
  }

  /**
   * Loads a shared document and opens it in the standard document drawer.
   *
   * @param {SharedDocument['document']} document - Document being read or updated.
   * @returns {Promise<void>} - Resolves when the operation completes.
   */
  async openDocument(document: SharedDocument['document']): Promise<void> {
    this.openingUuid.set(document.uuid);
    this.error.set(false);
    try {
      const loaded = await this.documentsService.loadDocument(document.uuid);
      if (loaded) this.drawerDocument.set(loaded);
      else this.error.set(true);
    } finally {
      this.openingUuid.set(null);
    }
  }

  closeDocument(): void { this.drawerDocument.set(null); }

  /**
   * Returns rows for the currently selected shared folder or aggregate view.
   *
   * @returns {SharedDocument[]} - Rows for the currently selected shared folder or aggregate view.
   */
  selectedDocuments(): SharedDocument[] {
    const selection = this.selectedFolderUuid();
    if (selection === ALL_SHARED) return this.documents();
    if (selection === UNFILED_SHARED) return this.unfiledDocuments();
    return this.folderDocuments();
  }

  selectedFolderName(): string {
    const selection = this.selectedFolderUuid();
    if (selection === ALL_SHARED) return this.i18n.t('sharing.allShared');
    if (selection === UNFILED_SHARED) return this.i18n.t('sharing.unfiled');
    return this.folders().find((folder) => folder.uuid === selection)?.name ?? '';
  }

  title(item: SharedDocument): string {
    return item.document.title || item.document.originalFilename;
  }

  markThumbnailFailed(uuid: string): void {
    this.thumbnailFailed.update((current) => ({ ...current, [uuid]: true }));
  }

  hasThumbnailFailed(uuid: string): boolean {
    return this.thumbnailFailed()[uuid] === true;
  }
}
