import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import type { SharedDocument, SharedFolder } from '@binder/common';
import { TranslatePipe } from '../../common/i18n/i18n.service';
import { SharingService } from '../documents/services/sharing.service';

@Component({
  selector: 'binder-shared-with-me',
  standalone: true,
  imports: [CommonModule, TranslatePipe],
  templateUrl: './shared-with-me.component.html',
  styleUrl: './shared-with-me.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SharedWithMeComponent implements OnInit {
  readonly folders = signal<SharedFolder[]>([]);
  readonly documents = signal<SharedDocument[]>([]);
  readonly folderDocuments = signal<SharedDocument[]>([]);
  readonly selectedFolder = signal<SharedFolder | null>(null);
  readonly loading = signal(false);
  readonly error = signal(false);
  private readonly sharing = inject(SharingService);
  private readonly router = inject(Router);

  async ngOnInit(): Promise<void> {
    this.loading.set(true);
    try {
      const [folders, documents] = await Promise.all([
        this.sharing.receivedFolders(),
        this.sharing.receivedDocuments(),
      ]);
      this.folders.set(folders);
      this.documents.set(documents);
    } catch {
      this.error.set(true);
    } finally {
      this.loading.set(false);
    }
  }

  async selectFolder(folder: SharedFolder): Promise<void> {
    this.selectedFolder.set(folder);
    this.folderDocuments.set([]);
    this.loading.set(true);
    this.error.set(false);
    try {
      this.folderDocuments.set(await this.sharing.folderDocuments(folder.uuid));
    } catch {
      this.error.set(true);
    } finally {
      this.loading.set(false);
    }
  }

  openDocument(document: SharedDocument['document']): void {
    void this.router.navigate(['/documents'], { queryParams: { open: document.uuid } });
  }

  title(item: SharedDocument): string {
    return item.document.title || item.document.originalFilename;
  }
}
