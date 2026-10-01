import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import type { Document, DocumentAnalysisMessage } from '@binder/common';
import { TranslatePipe } from '../../../../common/i18n/i18n.service';
import { DocumentAnalysisService } from '../../services/document-analysis.service';

@Component({
  selector: 'binder-document-analysis',
  standalone: true,
  imports: [DatePipe, TranslatePipe],
  templateUrl: './document-analysis.component.html',
  styleUrl: './document-analysis.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DocumentAnalysisComponent {
  readonly documentUuid = input.required<string>();
  readonly documentData = input.required<Document>();

  readonly analysis = inject(DocumentAnalysisService);
  readonly messages = signal<DocumentAnalysisMessage[]>([]);
  readonly prompt = signal('');
  readonly sessionUuid = signal<string | null>(null);
  readonly fileExpiresAt = signal<string | null>(null);
  readonly sending = signal(false);
  readonly error = signal<string | null>(null);

  updatePrompt(event: Event): void {
    this.prompt.set((event.target as HTMLTextAreaElement).value);
  }

  async send(): Promise<void> {
    const prompt = this.prompt().trim();
    if (!prompt || this.sending()) return;

    this.sending.set(true);
    this.error.set(null);
    const userMessage: DocumentAnalysisMessage = {
      role: 'user',
      text: prompt,
      createdAt: new Date().toISOString(),
    };
    this.messages.update((messages) => [...messages, userMessage]);
    this.prompt.set('');

    try {
      const response = this.sessionUuid()
        ? await this.analysis.continue(this.documentUuid(), this.sessionUuid()!, prompt)
        : await this.analysis.start(this.documentUuid(), prompt);
      this.sessionUuid.set(response.sessionUuid);
      this.fileExpiresAt.set(response.fileExpiresAt);
      this.messages.update((messages) => [...messages, response.assistantMessage]);
    } catch (error) {
      this.messages.update((messages) => messages.slice(0, -1));
      this.error.set(this.analysis.errorMessage(error));
    } finally {
      this.sending.set(false);
    }
  }

  startNewAnalysis(): void {
    if (this.sending()) return;
    this.messages.set([]);
    this.sessionUuid.set(null);
    this.fileExpiresAt.set(null);
    this.error.set(null);
  }
}
