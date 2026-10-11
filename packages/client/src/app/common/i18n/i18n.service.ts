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

/** Loads server translation catalogs and formats localized UI strings. */
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

  /**
   * Starts loading the available server languages during service initialization.
   */
  constructor() {
    void this.loadAvailableLanguages();
  }

  /**
   * Persists the selected language and loads its server catalog.
   *
   * @param {AppLanguage} language - Language code to select or load.
   * @returns {void} - No value.
   */
  setLanguage(language: AppLanguage): void {
    this.language.set(language);
    localStorage.setItem('binder.language', language);
    void this.loadCatalog(language);
  }

  /**
   * Returns a localized string and substitutes any named parameters.
   *
   * @param {string} key - Setting, header, or metadata key to read or update.
   * @param {Record<string, string | number>} parameters - Named values to substitute into the localized string.
   * @returns {string} - A localized string and substitutes any named parameters.
   */
  t(key: string, parameters?: Record<string, string | number>): string {
    const text = this.catalogs()[this.language()]?.[key] ?? key;
    if (!parameters) return text;
    return text.replace(/\{([a-zA-Z0-9_.-]+)\}/g, (match, name: string) =>
      Object.prototype.hasOwnProperty.call(parameters, name) ? String(parameters[name]) : match,
    );
  }

  /**
   * Chooses the best available translation for a vocabulary item.
   *
   * @param {Pick<VocabularyItem, 'name' | 'translations'>} item - Vocabulary, list, or feedback item being processed.
   * @returns {string} - Chooses the best available translation for a vocabulary item.
   */
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

  /**
   * Loads server language support and falls back when the saved language is unavailable.
   *
   * @returns {Promise<void>} - Resolves when the operation completes.
   */
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

  /**
   * Loads and caches the translation catalog for one language.
   *
   * @param {AppLanguage} language - Language code to select or load.
   * @returns {Promise<void>} - Resolves when the operation completes.
   */
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

  /**
   * Selects the saved language or falls back to the browser preference.
   *
   * @returns {AppLanguage} - Selects the saved language or falls back to the browser preference.
   */
  private initialLanguage(): AppLanguage {
    const stored = localStorage.getItem('binder.language');
    if (stored && /^[a-z]{2}(?:-[A-Z]{2})?$/.test(stored)) return stored;
    const browserLanguage = navigator.language;
    return /^[a-z]{2}(?:-[A-Z]{2})?$/.test(browserLanguage) ? browserLanguage : 'en';
  }
}

// The catalog is loaded asynchronously. The pipe must be impure so Angular
// evaluates it again when the service's signal receives the server response.
/** Re-evaluates translations when the language catalog or selected language changes. */
@Pipe({ name: 't', standalone: true, pure: false })
export class TranslatePipe implements PipeTransform {
  /**
   * Uses the shared localization service to resolve template translation keys.
   *
   * @param {I18nService} i18n - Localization service used to resolve display text.
   */
  constructor(private readonly i18n: I18nService) {}

  /**
   * Translates a template key and optional interpolation parameters.
   *
   * @param {string} key - Setting, header, or metadata key to read or update.
   * @param {Record<string, string | number>} parameters - Named values to substitute into the localized string.
   * @returns {string} - Translates a template key and optional interpolation parameters.
   */
  transform(key: string, parameters?: Record<string, string | number>): string {
    return this.i18n.t(key, parameters);
  }
}
