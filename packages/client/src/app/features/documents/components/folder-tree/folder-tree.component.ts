import { ChangeDetectionStrategy, Component, HostListener, inject, input, output, signal } from '@angular/core';
import { FoldersService, FolderTreeRow } from '../../services/folders.service';
import { I18nService, TranslatePipe } from '../../../../common/i18n/i18n.service';
import { ShareAccessComponent } from '../share-access/share-access.component';
import { SharingService } from '../../services/sharing.service';

/** Renders the folder tree and handles folder selection and management actions. */
@Component({
  selector: 'binder-folder-tree',
  host: { '[class.share-dialog-open]': 'sharingFolder() !== null' },
  standalone: true,
  imports: [TranslatePipe, ShareAccessComponent],
  templateUrl: './folder-tree.component.html',
  styleUrl: './folder-tree.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FolderTreeComponent {
  readonly folderSelected = output<string | null>();
  readonly unassignedRequested = output<void>();
  readonly newDocumentsRequested = output<void>();
  readonly unassignedSelected = input(false);
  readonly newDocumentsSelected = input(false);
  readonly i18n = inject(I18nService);
  readonly creatingParentUuid = signal<string | null | undefined>(undefined);
  readonly createName = signal('');
  readonly editingUuid = signal<string | null>(null);
  readonly movingUuid = signal<string | null>(null);
  readonly moveTargetUuid = signal<string>('');
  readonly sharingFolder = signal<{ uuid: string; name: string } | null>(null);
  readonly actionMenuUuid = signal<string | null>(null);

  constructor(readonly folders: FoldersService, readonly sharing: SharingService) {}

  /**
   * Expands or collapses a row and loads its children on first expansion.
   *
   * @param {FolderTreeRow} row - Folder tree row being acted on.
   * @returns {Promise<void>} - Resolves when the operation completes.
   */
  async toggle(row: FolderTreeRow): Promise<void> {
    await this.folders.toggle(row.folder);
  }

  select(folderUuid: string | null): void {
    this.folderSelected.emit(folderUuid);
  }

  selectUnassigned(): void {
    this.unassignedRequested.emit();
  }

  selectNewDocuments(): void {
    this.newDocumentsRequested.emit();
  }

  beginCreate(parentUuid: string | null): void {
    this.actionMenuUuid.set(null);
    this.createName.set('');
    this.creatingParentUuid.set(parentUuid);
  }

  cancelCreate(): void {
    this.creatingParentUuid.set(undefined);
    this.createName.set('');
  }

  /**
   * Creates the pending folder beneath the selected parent.
   *
   * @returns {Promise<void>} - Resolves when the operation completes.
   */
  async create(): Promise<void> {
    const parentUuid = this.creatingParentUuid();
    if (parentUuid === undefined) return;
    const folder = await this.folders.create(this.createName(), parentUuid);
    if (!folder) return;
    this.cancelCreate();
    if (parentUuid) {
      this.folders.expanded.update((current) => new Set(current).add(parentUuid));
    }
  }

  beginRename(uuid: string, currentName: string): void {
    this.actionMenuUuid.set(null);
    this.editingUuid.set(uuid);
    this.createName.set(currentName);
    queueMicrotask(() => {
      document.querySelector<HTMLInputElement>(`[data-folder-editor="${uuid}"]`)?.select();
    });
  }

  /**
   * Persists the edited folder name when the inline editor loses focus.
   *
   * @param {string} uuid - UUID of the target document or record.
   * @param {Event} event - Queued notification or pipeline event to process.
   * @returns {Promise<void>} - Resolves when the operation completes.
   */
  async finishRename(uuid: string, event: Event): Promise<void> {
    if (this.editingUuid() !== uuid) return;
    const name = (event.target as HTMLInputElement).value;
    if (name.trim()) await this.folders.rename(uuid, name);
    this.editingUuid.set(null);
  }

  handleRenameKeydown(uuid: string, event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      this.editingUuid.set(null);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      (event.target as HTMLInputElement).blur();
    }
  }

  beginMove(uuid: string): void {
    this.actionMenuUuid.set(null);
    this.movingUuid.set(uuid);
    this.moveTargetUuid.set('');
  }

  cancelMove(): void {
    this.movingUuid.set(null);
    this.moveTargetUuid.set('');
  }

  /**
   * Moves the selected folder to the chosen parent and closes the move control on success.
   *
   * @returns {Promise<void>} - Resolves when the operation completes.
   */
  async move(): Promise<void> {
    const uuid = this.movingUuid();
    if (!uuid) return;
    if (await this.folders.move(uuid, this.moveTargetUuid() || null)) this.cancelMove();
  }

  /**
   * Confirms and removes a folder while retaining the documents it contains.
   *
   * @param {string} uuid - UUID of the target document or record.
   * @param {string} name - Secret, folder, or resource name to resolve or assign.
   * @returns {Promise<void>} - Resolves when the operation completes.
   */
  async remove(uuid: string, name: string): Promise<void> {
    this.actionMenuUuid.set(null);
    if (
      !window.confirm(
        `${name}: ${this.folders.selectedFolderUuid() === uuid ? 'This folder is selected. ' : ''}Delete the folder and keep its documents?`,
      )
    )
      return;
    await this.folders.remove(uuid);
  }

  trackRow(_index: number, row: FolderTreeRow): string {
    return row.folder.uuid;
  }

  toggleActionMenu(uuid: string): void {
    this.actionMenuUuid.update((current) => (current === uuid ? null : uuid));
  }

  openSharing(uuid: string, name: string): void {
    this.actionMenuUuid.set(null);
    this.sharingFolder.update((current) => (current?.uuid === uuid ? null : { uuid, name }));
  }

  closeFolderSharing(): void {
    this.sharingFolder.set(null);
  }

  @HostListener('document:click', ['$event'])
  closeMenuOnOutsideClick(event: MouseEvent): void {
    const target = event.target;
    if (target instanceof Element && !target.closest('.folder-actions')) {
      this.actionMenuUuid.set(null);
    }
  }

  @HostListener('document:keydown.escape')
  closeMenuOnEscape(): void {
    this.actionMenuUuid.set(null);
    this.closeFolderSharing();
  }
}
