import { ChangeDetectionStrategy, Component, EventEmitter, HostListener, Input, Output, inject } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';

@Component({
  selector: 'binder-document-viewer',
  standalone: true,
  templateUrl: './document-viewer.component.html',
  styleUrl: './document-viewer.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class DocumentViewerComponent {
  @Input({ required: true }) documentUuid = '';
  @Input() title = 'Document';
  @Output() closed = new EventEmitter<void>();

  private readonly sanitizer = inject(DomSanitizer);

  get fileUrl(): SafeResourceUrl {
    return this.sanitizer.bypassSecurityTrustResourceUrl(`/api/v1/documents/${this.documentUuid}/file`);
  }

  @HostListener('document:keydown.escape')
  closeWithEscape(): void { this.closed.emit(); }
}
