import { ChangeDetectionStrategy, Component, output, signal } from '@angular/core';
import { FoldersService, FolderTreeRow } from '../../services/folders.service';
import { TranslatePipe } from '../../../../common/i18n/i18n.service';

@Component({
  selector: 'binder-folder-tree',
  standalone: true,
  imports: [TranslatePipe],
  templateUrl: './folder-tree.component.html',
  styleUrl: './folder-tree.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class FolderTreeComponent {
  readonly folderSelected = output<string | null>();
  readonly creatingParentUuid = signal<string | null | undefined>(undefined);
  readonly createName = signal('');
  readonly editingUuid = signal<string | null>(null);
  readonly movingUuid = signal<string | null>(null);
  readonly moveTargetUuid = signal<string>('');

  constructor(readonly folders: FoldersService) {}

  async toggle(row: FolderTreeRow): Promise<void> {
    await this.folders.toggle(row.folder);
  }

  select(folderUuid: string | null): void {
    this.folders.select(folderUuid);
    this.folderSelected.emit(folderUuid);
  }

  beginCreate(parentUuid: string | null): void {
    this.createName.set('');
    this.creatingParentUuid.set(parentUuid);
  }

  cancelCreate(): void {
    this.creatingParentUuid.set(undefined);
    this.createName.set('');
  }

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
    this.editingUuid.set(uuid);
    this.createName.set(currentName);
    queueMicrotask(() => {
      document.querySelector<HTMLInputElement>(`[data-folder-editor="${uuid}"]`)?.select();
    });
  }

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
    this.movingUuid.set(uuid);
    this.moveTargetUuid.set('');
  }

  cancelMove(): void {
    this.movingUuid.set(null);
    this.moveTargetUuid.set('');
  }

  async move(): Promise<void> {
    const uuid = this.movingUuid();
    if (!uuid) return;
    if (await this.folders.move(uuid, this.moveTargetUuid() || null)) this.cancelMove();
  }

  async remove(uuid: string, name: string): Promise<void> {
    if (!window.confirm(`${name}: ${this.folders.selectedFolderUuid() === uuid ? 'This folder is selected. ' : ''}Delete the folder and keep its documents?`)) return;
    await this.folders.remove(uuid);
  }

  trackRow(_index: number, row: FolderTreeRow): string {
    return row.folder.uuid;
  }
}
