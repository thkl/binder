import { HttpClient } from '@angular/common/http';
import { Injectable, Pipe, PipeTransform, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import {
  AvailableLanguagesResponseSchema,
  LocalizationCatalogSchema,
  type AppLanguage,
  type AvailableLanguage,
  type LocalizedText,
  type VocabularyItem,
} from '@binder/common';
import { ApplicationService } from '../application.service';

type TranslationMap = Record<string, string>;

@Injectable({ providedIn: 'root' })
export class I18nService {
  readonly language = signal<AppLanguage>(this.initialLanguage());
  readonly availableLanguages = signal<AvailableLanguage[]>([
    { code: 'en', name: 'English', nativeName: 'English' },
    { code: 'de', name: 'German', nativeName: 'Deutsch' },
  ]);
  private readonly catalogs = signal<Record<string, TranslationMap>>({});
  private readonly http = inject(HttpClient);
  private readonly application = inject(ApplicationService);

  constructor() {
    void this.loadAvailableLanguages();
  }

  setLanguage(language: AppLanguage): void {
    this.language.set(language);
    localStorage.setItem('binder.language', language);
    void this.loadCatalog(language);
  }

  t(key: string): string {
    return this.catalogs()[this.language()]?.[key] ?? key;
  }

  name(item: Pick<VocabularyItem, 'name' | 'translations'>): string {
    const translations = item.translations as LocalizedText;
    const language = this.language();
    return (
      translations[language] ||
      translations[language.split('-')[0]] ||
      translations['en'] ||
      translations['de'] ||
      item.name
    );
  }

  private async loadAvailableLanguages(): Promise<void> {
    try {
      const response = await firstValueFrom(
        this.http.get<{ data: unknown }>(
          this.application.getApiUrl('v1', 'localization/languages'),
        ),
      );
      const languages = AvailableLanguagesResponseSchema.parse(response.data).items;
      this.availableLanguages.set(languages);
      if (!languages.some((available) => available.code === this.language())) {
        this.setLanguage(languages[0].code);
      } else {
        await this.loadCatalog(this.language());
      }
    } catch {
      // The server is required to provide the application and its translations.
    }
  }

  private async loadCatalog(language: AppLanguage): Promise<void> {
    if (this.catalogs()[language]) return;

    try {
      const response = await firstValueFrom(
        this.http.get<{ data: unknown }>(
          this.application.getApiUrl('v1', `localization/catalog/${encodeURIComponent(language)}`),
        ),
      );
      const catalog = LocalizationCatalogSchema.parse(response.data);
      this.catalogs.update((current) => ({
        ...current,
        [catalog.code]: catalog.translations,
      }));
    } catch {
      // Keep the key visible if the catalog cannot be loaded.
    }
  }

  private initialLanguage(): AppLanguage {
    const stored = localStorage.getItem('binder.language');
    if (stored && /^[a-z]{2}(?:-[A-Z]{2})?$/.test(stored)) return stored;
    const browserLanguage = navigator.language;
    return /^[a-z]{2}(?:-[A-Z]{2})?$/.test(browserLanguage) ? browserLanguage : 'en';
  }
}

@Pipe({ name: 't', standalone: true })
export class TranslatePipe implements PipeTransform {
  constructor(private readonly i18n: I18nService) {}

  transform(key: string): string {
    return this.i18n.t(key);
  }
}
