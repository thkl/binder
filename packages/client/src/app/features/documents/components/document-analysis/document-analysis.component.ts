import { ChangeDetectionStrategy, Component, effect, inject, input, signal } from '@angular/core';
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
  readonly restoring = signal(false);
  readonly error = signal<string | null>(null);
  private readonly forceNew = signal(false);

  private readonly restoreEffect = effect(() => {
    const uuid = this.documentUuid();
    if (uuid) void this.restoreSession(uuid);
  });

  private async restoreSession(uuid: string): Promise<void> {
    this.restoring.set(true);
    this.error.set(null);

    try {
      const session = await this.analysis.load(uuid);
      if (uuid !== this.documentUuid()) return;

      this.sessionUuid.set(session?.sessionUuid ?? null);
      this.fileExpiresAt.set(session?.fileExpiresAt ?? null);
      this.messages.set(session?.messages ?? []);
    } catch (error) {
      if (uuid === this.documentUuid()) {
        this.error.set(this.analysis.errorMessage(error));
      }
    } finally {
      if (uuid === this.documentUuid()) {
        this.restoring.set(false);
      }
    }
  }

  updatePrompt(event: Event): void {
    this.prompt.set((event.target as HTMLTextAreaElement).value);
  }

  async send(): Promise<void> {
    const prompt = this.prompt().trim();
    if (!prompt || this.sending() || this.restoring()) return;

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
        : await this.analysis.start(this.documentUuid(), prompt, this.forceNew());
      this.forceNew.set(false);
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
    if (this.sending() || this.restoring()) return;
    this.messages.set([]);
    this.sessionUuid.set(null);
    this.fileExpiresAt.set(null);
    this.error.set(null);
    this.forceNew.set(true);
  }
}
