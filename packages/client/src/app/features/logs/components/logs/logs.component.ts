import { ChangeDetectionStrategy, Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import type { LogFile } from '@binder/common';
import { I18nService, TranslatePipe } from '../../../../common/i18n/i18n.service';
import { LogsService } from '../../services/logs.service';

@Component({
  selector: 'binder-logs',
  standalone: true,
  imports: [CommonModule, TranslatePipe],
  templateUrl: './logs.component.html',
  styleUrl: './logs.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class LogsComponent implements OnInit {
  readonly logs = inject(LogsService);
  readonly i18n = inject(I18nService);

  ngOnInit(): void {
    void this.logs.load();
  }

  sourceLabel(file: LogFile): string {
    return this.i18n.t(file.source === 'worker' ? 'logs.worker' : 'logs.application');
  }

  kindLabel(file: LogFile): string {
    return this.i18n.t(file.isError ? 'logs.errorLog' : 'logs.standardLog');
  }

  fileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
}
