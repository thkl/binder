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
import { TranslatePipe } from '../../../../common/i18n/i18n.service';
import { DocumentMetadataEditorComponent } from '../../../metadata/components/document-metadata-editor/document-metadata-editor.component';
import { ApplicationService } from '../../../../common/application.service';
import { DocumentAnalysisComponent } from '../document-analysis/document-analysis.component';

export type DocumentDrawerTab = 'preview' | 'metadata';

@Component({
  selector: 'binder-document-drawer',
  standalone: true,
  imports: [DocumentAnalysisComponent, DocumentMetadataEditorComponent, TranslatePipe],
  templateUrl: './document-drawer.component.html',
  styleUrl: './document-drawer.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DocumentDrawerComponent {
  readonly documentUuid = input.required<string>();
  readonly documentData = input.required<Document>();
  readonly initialTab = input<DocumentDrawerTab>('preview');
  readonly suggestion = input<DocumentTitleSuggestion | null>(null);
  readonly externalClosePrompt = input(false);

  readonly closeRequest = output<void>();
  readonly tabChange = output<DocumentDrawerTab>();
  readonly dirtyChange = output<boolean>();
  readonly manuallySaved = output<void>();
  readonly suggestionTitleAccepted = output<string>();
  readonly suggestionDismissed = output<void>();
  readonly suggestionAccepted = output<string>();
  readonly keepEditingRequest = output<void>();
  readonly discardRequest = output<void>();

  readonly activeTab = signal<DocumentDrawerTab>('preview');
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

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.requestClose();
  }
}
