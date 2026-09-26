import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import {
  ApplicationSettingsResponse,
  SettingsMapItem,
  SetApplicationSettingInput
} from '@binder/common';
import { SettingsService } from '../../services/settings.service';

@Component({
  selector: 'binder-settings',
  standalone: true,
  templateUrl: './settings.component.html',
  styleUrl: './settings.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class SettingsComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  readonly settingsService = inject(SettingsService);

  readonly activeSection = signal('');
  readonly saved = signal(false);
  readonly values = signal<Record<string, string | boolean>>({});

  readonly sections = computed(() => this.settingsService.settings()?.template.sections ?? []);
  readonly activeSectionLabel = computed(() =>
    this.sections().find((section) => section.key === this.activeSection())?.label ?? 'Settings'
  );
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
    const response = await this.settingsService.load();
    if (!response) {
      return;
    }

    this.values.set(this.createInitialValues(response));
    const requestedSection = this.activeSection();
    const firstSection = response.template.sections[0]?.key;
    const sectionExists = response.template.sections.some((section) => section.key === requestedSection);

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
    return this.settingsService.settings()?.data.find((setting) => setting.key === item.key)?.description
      ?? item.key;
  }

  updateText(item: SettingsMapItem, event: Event): void {
    const value = (event.target as HTMLInputElement).value;
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

    const input = response.template.items.map((item): SetApplicationSettingInput => ({
      key: item.key,
      value: this.serializeValue(item),
      isEncrypted: item.encrypted,
      description: response.data.find((data) => data.key === item.key)?.description ?? undefined
    }));

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

  private createInitialValues(response: ApplicationSettingsResponse): Record<string, string | boolean> {
    const stored = new Map(response.data.map((setting) => [setting.key, setting.value]));
    return Object.fromEntries(response.template.items.map((item) => {
      const value = stored.get(item.key);
      if (item.type === 'checkbox') {
        return [item.key, value === undefined ? item.default === true : value === 'true'];
      }
      return [item.key, value ?? String(item.default ?? '')];
    }));
  }
}
