import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import {
  MetadataDefinition,
  ApplicationSettingsResponse,
  SettingsMapItem,
  SetApplicationSettingInput,
} from '@binder/common';
import { SettingsService } from '../../services/settings.service';
import { MetadataService } from '../../../metadata/services/metadata.service';
import { I18nService, TranslatePipe } from '../../../../common/i18n/i18n.service';
import { AiProviderManagerComponent } from '../ai-provider-manager/ai-provider-manager.component';
import { UserManagementComponent } from '../user-management/user-management.component';
import { AuthService } from '../../../authentication/services/auth.service';
import { DropboxConnectionService } from '../../services/dropbox-connection.service';

@Component({
  selector: 'binder-settings',
  standalone: true,
  imports: [TranslatePipe, AiProviderManagerComponent, UserManagementComponent],
  templateUrl: './settings.component.html',
  styleUrl: './settings.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettingsComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  readonly settingsService = inject(SettingsService);
  readonly metadataService = inject(MetadataService);
  readonly i18n = inject(I18nService);
  readonly auth = inject(AuthService);
  readonly dropbox = inject(DropboxConnectionService);

  readonly activeSection = signal('');
  readonly saved = signal(false);
  readonly values = signal<Record<string, string | boolean>>({});

  readonly sections = computed(() => this.settingsService.settings()?.template.sections ?? []);
  readonly activeSectionLabel = computed(() => this.sectionLabel(this.activeSection()));
  readonly activeItems = computed(() => {
    const response = this.settingsService.settings();
    return response?.template.items.filter((item) => item.section === this.activeSection()) ?? [];
  });

  ngOnInit(): void {
    this.route.paramMap.subscribe((params) => {
      const section = params.get('section');
      if (section) {
        this.activeSection.set(section);
      }
    });

    void this.loadSettings();
  }

  async loadSettings(): Promise<void> {
    const [response] = await Promise.all([
      this.settingsService.load(),
      this.settingsService.loadUsers(),
      this.metadataService.loadDefinitions(),
      this.dropbox.load(),
    ]);
    if (!response) {
      return;
    }

    this.values.set(this.createInitialValues(response));
    const requestedSection = this.activeSection();
    const firstSection = response.template.sections[0]?.key;
    const sectionExists =
      requestedSection === 'users' ||
      response.template.sections.some((section) => section.key === requestedSection);

    if (!sectionExists && firstSection) {
      this.activeSection.set(firstSection);
      await this.router.navigate(['/settings', firstSection], { replaceUrl: true });
    }
  }

  async selectSection(section: string): Promise<void> {
    this.saved.set(false);
    await this.router.navigate(['/settings', section]);
  }

  stringValue(item: SettingsMapItem): string {
    const value = this.values()[item.key];
    return typeof value === 'string' ? value : String(value ?? '');
  }

  booleanValue(item: SettingsMapItem): boolean {
    const value = this.values()[item.key];
    return value === true || value === 'true';
  }

  description(item: SettingsMapItem): string {
    return (
      this.settingsService.settings()?.data.find((setting) => setting.key === item.key)
        ?.description ?? item.key
    );
  }

  patternHint(item: SettingsMapItem): string {
    const key = `setting.${item.key}.hint`;
    const translated = this.i18n.t(key);
    return translated === key ? (item.patternMessage ?? '') : translated;
  }

  sectionLabel(key: string): string {
    if (key === 'users') return this.i18n.t('users.title');
    const section = this.sections().find((candidate) => candidate.key === key);
    return section ? this.i18n.t(`settings.${section.key}`) : this.i18n.t('settings.title');
  }

  itemLabel(item: SettingsMapItem): string {
    const key = `setting.${item.key}`;
    const translated = this.i18n.t(key);
    return translated === key ? item.label : translated;
  }

  settingOptionLabel(key: string, option: string): string {
    const translated = this.i18n.t(`setting.${key}.${option}`);
    return translated === `setting.${key}.${option}` ? option : translated;
  }

  metadataOptions(item: SettingsMapItem): MetadataDefinition[] {
    if (item.key === 'calendar.dueDateField') {
      return this.metadataService
        .definitions()
        .filter((definition) => definition.type === 'date' || definition.type === 'datetime');
    }

    return this.metadataService.definitions();
  }

  metadataDefinition(item: SettingsMapItem): MetadataDefinition | null {
    const value = this.stringValue(item);
    return (
      this.metadataOptions(item).find((definition) => definition.key === value) ??
      this.metadataService.definitions().find((definition) => definition.key === value) ??
      null
    );
  }

  metadataValueIsMissing(item: SettingsMapItem): boolean {
    const value = this.stringValue(item);
    return value.length > 0 && this.metadataDefinition(item) === null;
  }

  metadataTypeLabel(type: MetadataDefinition['type']): string {
    const key =
      type === 'date'
        ? 'metadata.date'
        : type === 'datetime'
          ? 'metadata.dateTime'
          : type === 'boolean'
            ? 'metadata.yesNo'
            : type === 'select'
              ? 'metadata.select'
              : type === 'multi-select'
                ? 'metadata.multiSelect'
                : 'metadata.text';
    return this.i18n.t(key);
  }

  updateText(item: SettingsMapItem, event: Event): void {
    const value = (event.target as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement)
      .value;
    this.values.update((current) => ({ ...current, [item.key]: value }));
    this.saved.set(false);
  }

  updateCheckbox(item: SettingsMapItem, event: Event): void {
    const value = (event.target as HTMLInputElement).checked;
    this.values.update((current) => ({ ...current, [item.key]: value }));
    this.saved.set(false);
  }

  async save(): Promise<void> {
    const response = this.settingsService.settings();
    if (!response) {
      return;
    }

    const input = response.template.items.map(
      (item): SetApplicationSettingInput => ({
        key: item.key,
        value: this.serializeValue(item),
        isEncrypted: item.encrypted,
        description: response.data.find((data) => data.key === item.key)?.description ?? undefined,
      }),
    );

    if (await this.settingsService.saveAll(input)) {
      this.saved.set(true);
      this.values.set(this.createInitialValues(this.settingsService.settings() ?? response));
    }
  }

  private serializeValue(item: SettingsMapItem): string {
    const value = this.values()[item.key];
    if (item.type === 'checkbox') {
      return this.booleanValue(item) ? 'true' : 'false';
    }
    return typeof value === 'string' ? value : String(value ?? '');
  }

  private createInitialValues(
    response: ApplicationSettingsResponse,
  ): Record<string, string | boolean> {
    const stored = new Map(response.data.map((setting) => [setting.key, setting.value]));
    return Object.fromEntries(
      response.template.items.map((item) => {
        const value = stored.get(item.key);
        if (item.type === 'checkbox') {
          return [item.key, value === undefined ? item.default === true : value === 'true'];
        }
        return [item.key, value ?? String(item.default ?? '')];
      }),
    );
  }
}
