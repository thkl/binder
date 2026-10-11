import { Controller, Get, UseGuards } from '@nestjs/common';
import { AuthenticationGuard } from '../../authentication/guards/authentication.guard';
import { DocumentFormatRegistry } from '../service/document-format.registry';

/** Exposes the file formats and actions supported by this API release. */
@Controller('document-formats')
@UseGuards(AuthenticationGuard)
export class DocumentFormatsController {
  /**
   * Creates the controller with the active API format registry.
   *
   * @param {DocumentFormatRegistry} formats - Registry that supplies supported descriptors.
   */
  constructor(private readonly formats: DocumentFormatRegistry) {}

  /**
   * Returns upload hints and supported capabilities for authenticated clients.
   *
   * @returns The API's supported document format descriptors.
   */
  @Get()
  getFormats() {
    return this.formats.getSupportedFormats();
  }
}
