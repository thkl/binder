import { Controller, Get, Param } from '@nestjs/common';
import {
  AvailableLanguagesResponseSchema,
  LocalizationCatalogSchema,
  type AvailableLanguagesResponse,
  type LocalizationCatalog,
} from '@binder/common';
import { LocalizationService } from './localization.service';

@Controller('localization')
export class LocalizationController {
  constructor(private readonly localization: LocalizationService) {}

  @Get('languages')
  async getLanguages(): Promise<{ data: AvailableLanguagesResponse }> {
    return {
      data: AvailableLanguagesResponseSchema.parse(await this.localization.listLanguages()),
    };
  }

  @Get('catalog/:language')
  async getCatalog(@Param('language') language: string): Promise<{ data: LocalizationCatalog }> {
    return {
      data: LocalizationCatalogSchema.parse(await this.localization.getCatalog(language)),
    };
  }
}
