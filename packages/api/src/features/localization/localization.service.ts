import { Injectable, NotFoundException } from '@nestjs/common';
import { AvailableLanguage, LocalizationCatalog, LocalizationCatalogSchema } from '@binder/common';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

@Injectable()
export class LocalizationService {
  private readonly catalogDirectory = resolve(__dirname, 'catalogs');

  async listLanguages(): Promise<{ items: AvailableLanguage[] }> {
    const catalogs = await this.readCatalogs();
    return {
      items: catalogs.map(({ code, name, nativeName }) => ({ code, name, nativeName })),
    };
  }

  async getCatalog(code: string): Promise<LocalizationCatalog> {
    const catalog = (await this.readCatalogs()).find((entry) => entry.code === code);
    if (!catalog) {
      throw new NotFoundException('Language catalog not found');
    }
    return catalog;
  }

  private async readCatalogs(): Promise<LocalizationCatalog[]> {
    const entries = await readdir(this.catalogDirectory, { withFileTypes: true });
    const catalogs = await Promise.all(
      entries
        .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
        .map(async (entry) => {
          const raw = await readFile(resolve(this.catalogDirectory, entry.name), 'utf8');
          return LocalizationCatalogSchema.parse(JSON.parse(raw));
        }),
    );
    return catalogs.sort((left, right) => left.code.localeCompare(right.code));
  }
}
