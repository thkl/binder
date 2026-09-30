import {
  ChangeDetectionStrategy,
  Component,
  HostListener,
  computed,
  inject,
  input,
  output,
} from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { TranslatePipe } from '../../i18n/i18n.service';

@Component({
  selector: 'binder-document-viewer',
  standalone: true,
  imports: [TranslatePipe],
  templateUrl: './document-viewer.component.html',
  styleUrl: './document-viewer.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DocumentViewerComponent {
  readonly documentUuid = input.required<string>();
  readonly title = input('Document');
  readonly closed = output<void>();

  private readonly sanitizer = inject(DomSanitizer);

  readonly fileUrl = computed<SafeResourceUrl>(() =>
    this.sanitizer.bypassSecurityTrustResourceUrl(`/api/v1/documents/${this.documentUuid()}/file`),
  );

  @HostListener('document:keydown.escape')
  closeWithEscape(): void {
    this.closed.emit();
  }
}
