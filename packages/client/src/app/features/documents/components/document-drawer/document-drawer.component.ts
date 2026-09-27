import { ChangeDetectionStrategy, Component, HostListener, computed, effect, inject, input, output, signal } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import type { Document, DocumentTitleSuggestion } from '@binder/common';
import { TranslatePipe } from '../../../../common/i18n/i18n.service';
import { DocumentMetadataEditorComponent } from '../../../metadata/components/document-metadata-editor/document-metadata-editor.component';
import { ApplicationService } from '../../../../common/application.service';

export type DocumentDrawerTab = 'preview' | 'metadata';

@Component({
  selector: 'binder-document-drawer',
  standalone: true,
  imports: [DocumentMetadataEditorComponent, TranslatePipe],
  templateUrl: './document-drawer.component.html',
  styleUrl: './document-drawer.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class DocumentDrawerComponent {
  readonly documentUuid = input.required<string>();
  readonly documentData = input.required<Document>();
  readonly initialTab = input<DocumentDrawerTab>('preview');
  readonly suggestion = input<DocumentTitleSuggestion | null>(null);
  readonly externalClosePrompt = input(false);

  readonly closeRequest = output<void>();
  readonly dirtyChange = output<boolean>();
  readonly manuallySaved = output<void>();
  readonly suggestionTitleAccepted = output<string>();
  readonly suggestionDismissed = output<void>();
  readonly suggestionAccepted = output<string>();
  readonly keepEditingRequest = output<void>();
  readonly discardRequest = output<void>();

  readonly activeTab = signal<DocumentDrawerTab>('preview');
  readonly drawerWidth = signal(this.readDrawerWidth());
  readonly resizing = signal(false);
  readonly dirty = signal(false);
  readonly closePrompt = signal(false);
  readonly showClosePrompt = computed(() => this.closePrompt() || this.externalClosePrompt());
  readonly fileUrl = computed<SafeResourceUrl>(() => {
    const url = this.application.getApiUrl('v1', `documents/${this.documentUuid()}/file`);
    return this.sanitizer.bypassSecurityTrustResourceUrl(url);
  });

  private readonly sanitizer = inject(DomSanitizer);
  private readonly application = inject(ApplicationService);
  private readonly initialTabEffect = effect(() => {
    this.activeTab.set(this.initialTab());
  });

  constructor() {
    this.activeTab.set(this.initialTab());
  }

  selectTab(tab: DocumentDrawerTab): void {
    this.activeTab.set(tab);
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

  startResize(event: PointerEvent): void {
    event.preventDefault();
    this.resizing.set(true);
  }

  stopResize(): void {
    if (!this.resizing()) return;
    this.resizing.set(false);
    localStorage.setItem('binder.document-drawer.width', String(this.drawerWidth()));
  }

  resizeWithKeyboard(event: KeyboardEvent): void {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight' && event.key !== 'Home' && event.key !== 'End') return;
    event.preventDefault();
    if (event.key === 'Home') {
      this.setDrawerWidth(this.maxDrawerWidth());
    } else if (event.key === 'End') {
      this.setDrawerWidth(this.minDrawerWidth());
    } else {
      const change = event.key === 'ArrowLeft' ? 32 : -32;
      this.setDrawerWidth(this.drawerWidth() + change);
    }
    localStorage.setItem('binder.document-drawer.width', String(this.drawerWidth()));
  }

  @HostListener('document:pointermove', ['$event'])
  onPointerMove(event: PointerEvent): void {
    if (!this.resizing()) return;
    this.setDrawerWidth(window.innerWidth - event.clientX);
  }

  @HostListener('document:pointerup')
  onPointerUp(): void {
    this.stopResize();
  }

  @HostListener('document:pointercancel')
  onPointerCancel(): void {
    this.stopResize();
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.requestClose();
  }

  @HostListener('window:resize')
  onWindowResize(): void {
    this.setDrawerWidth(this.drawerWidth());
  }

  private setDrawerWidth(width: number): void {
    this.drawerWidth.set(Math.round(Math.min(this.maxDrawerWidth(), Math.max(this.minDrawerWidth(), width))));
  }

  private minDrawerWidth(): number {
    return Math.min(360, Math.max(280, window.innerWidth - 24));
  }

  private maxDrawerWidth(): number {
    return Math.min(960, Math.max(this.minDrawerWidth(), window.innerWidth - 24));
  }

  private readDrawerWidth(): number {
    const stored = Number(localStorage.getItem('binder.document-drawer.width'));
    return Number.isFinite(stored) && stored > 0 ? stored : 560;
  }
}
