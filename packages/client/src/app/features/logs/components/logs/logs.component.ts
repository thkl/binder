import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import type { LogFile, LogFileSource } from '@binder/common';
import { I18nService, TranslatePipe } from '../../../../common/i18n/i18n.service';
import { LogsService } from '../../services/logs.service';

type LogSourceFilter = LogFileSource | 'all';
type LogKindFilter = 'all' | 'error' | 'standard';
type LogLevelFilter = 'all' | 'error' | 'warn' | 'info' | 'debug';

@Component({
  selector: 'binder-logs',
  standalone: true,
  imports: [CommonModule, TranslatePipe],
  templateUrl: './logs.component.html',
  styleUrl: './logs.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LogsComponent implements OnInit {
  readonly logs = inject(LogsService);
  readonly i18n = inject(I18nService);
  readonly sourceFilter = signal<LogSourceFilter>('all');
  readonly kindFilter = signal<LogKindFilter>('all');
  readonly fileSearch = signal('');
  readonly fromDate = signal('');
  readonly toDate = signal('');
  readonly previewLevel = signal<LogLevelFilter>('all');
  readonly previewSearch = signal('');
  readonly copied = signal(false);
  readonly sourceOptions: LogSourceFilter[] = ['all', 'application', 'worker'];
  readonly kindOptions: LogKindFilter[] = ['all', 'error', 'standard'];
  readonly levelOptions: LogLevelFilter[] = ['all', 'error', 'warn', 'info', 'debug'];
  readonly expandedSources = signal<Record<LogFileSource, boolean>>({
    application: true,
    worker: true,
  });

  readonly filteredFiles = computed(() => {
    const search = this.fileSearch().trim().toLowerCase();
    const source = this.sourceFilter();
    const kind = this.kindFilter();
    const from = this.fromDate();
    const to = this.toDate();

    return this.logs.files().filter((file) => {
      const modifiedDate = file.modifiedAt.slice(0, 10);
      const matchesSearch =
        search.length === 0 ||
        file.name.toLowerCase().includes(search) ||
        file.source.toLowerCase().includes(search);
      const matchesSource = source === 'all' || file.source === source;
      const matchesKind =
        kind === 'all' || (kind === 'error' ? file.isError : !file.isError);
      const matchesFrom = from.length === 0 || modifiedDate >= from;
      const matchesTo = to.length === 0 || modifiedDate <= to;

      return matchesSearch && matchesSource && matchesKind && matchesFrom && matchesTo;
    });
  });

  readonly selectedFile = computed(() => {
    const filename = this.logs.previewFilename();
    return this.logs.files().find((file) => file.name === filename) ?? null;
  });

  readonly treeSources = computed(() =>
    (['application', 'worker'] as const).filter((source) => this.filesForSource(source).length > 0),
  );

  readonly filteredPreviewText = computed(() => {
    const text = this.logs.previewText();
    if (text === null) return null;

    const level = this.previewLevel();
    const search = this.previewSearch().trim().toLowerCase();
    const lines = text.split(/\r?\n/).filter((line) => {
      const matchesLevel = level === 'all' || this.lineLevel(line) === level;
      const matchesSearch = search.length === 0 || line.toLowerCase().includes(search);
      return matchesLevel && matchesSearch;
    });

    return lines.join('\n');
  });

  ngOnInit(): void {
    void this.logs.load();
  }

  sourceLabel(file: LogFile): string {
    return this.i18n.t(file.source === 'worker' ? 'logs.worker' : 'logs.application');
  }

  kindLabel(file: LogFile): string {
    return this.i18n.t(file.isError ? 'logs.errorLog' : 'logs.standardLog');
  }

  sourceCount(source: LogSourceFilter): number {
    if (source === 'all') return this.logs.files().length;
    return this.logs.files().filter((file) => file.source === source).length;
  }

  sourceFilterLabel(source: LogSourceFilter): string {
    if (source === 'all') return this.i18n.t('logs.allSources');
    return this.i18n.t(source === 'worker' ? 'logs.worker' : 'logs.application');
  }

  kindFilterLabel(kind: LogKindFilter): string {
    if (kind === 'all') return this.i18n.t('logs.allKinds');
    return this.i18n.t(kind === 'error' ? 'logs.errorLog' : 'logs.standardLog');
  }

  levelLabel(level: LogLevelFilter): string {
    return this.i18n.t(level === 'all' ? 'logs.allLevels' : `logs.level.${level}`);
  }

  selectFile(filename: string): void {
    void this.logs.preview(filename);
  }

  filesForSource(source: LogFileSource): LogFile[] {
    return this.filteredFiles().filter((file) => file.source === source);
  }

  isSourceExpanded(source: LogFileSource): boolean {
    return this.expandedSources()[source];
  }

  toggleSource(source: LogFileSource): void {
    this.expandedSources.update((expanded) => ({
      ...expanded,
      [source]: !expanded[source],
    }));
  }

  clearFilters(): void {
    this.sourceFilter.set('all');
    this.kindFilter.set('all');
    this.fileSearch.set('');
    this.fromDate.set('');
    this.toDate.set('');
  }

  async copyPreview(): Promise<void> {
    const text = this.filteredPreviewText();
    if (!text || !navigator.clipboard) return;

    try {
      await navigator.clipboard.writeText(text);
      this.copied.set(true);
      window.setTimeout(() => this.copied.set(false), 1_500);
    } catch {
      this.copied.set(false);
    }
  }

  private lineLevel(line: string): Exclude<LogLevelFilter, 'all'> {
    const jsonMatch = line.match(/"level"\s*:\s*"(error|warn|info|debug)"/i);
    if (jsonMatch?.[1]) return jsonMatch[1].toLowerCase() as Exclude<LogLevelFilter, 'all'>;

    const textMatch = line.match(/\|\s*(error|warn|info|debug)\s*\|/i);
    if (textMatch?.[1]) return textMatch[1].toLowerCase() as Exclude<LogLevelFilter, 'all'>;

    return 'info';
  }

  fileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
}
