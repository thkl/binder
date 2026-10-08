import { Controller, Get, Param } from '@nestjs/common';
import { AvailableLanguagesResponseSchema, LocalizationCatalogSchema } from '@binder/common';
import { LocalizationService } from './localization.service';

@Controller('localization')
export class LocalizationController {
  constructor(private readonly localization: LocalizationService) {}

  @Get('languages')
  async getLanguages() {
    return AvailableLanguagesResponseSchema.parse(await this.localization.listLanguages());
  }

  @Get('catalog/:language')
  async getCatalog(@Param('language') language: string) {
    return LocalizationCatalogSchema.parse(await this.localization.getCatalog(language));
  }
}
