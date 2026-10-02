import { Injectable, Logger } from '@nestjs/common';
import {
  PluginDocumentEvent,
  PluginDocumentEventSchema,
  PluginManifest,
  PluginManifestSchema,
} from '@binder/common';
import type { BinderPlugin } from '../models/plugin.types';

@Injectable()
export class PluginRegistryService {
  private readonly logger = new Logger(PluginRegistryService.name);
  private readonly plugins = new Map<string, BinderPlugin>();

  register(plugin: BinderPlugin): void {
    const manifest = PluginManifestSchema.parse(plugin.manifest);

    if (this.plugins.has(manifest.id)) {
      throw new Error(`A plugin with the id '${manifest.id}' is already registered`);
    }

    this.plugins.set(manifest.id, {
      ...plugin,
      manifest,
    });
    this.logger.log(`Registered plugin '${manifest.id}' (${manifest.version})`);
  }

  list(): PluginManifest[] {
    return [...this.plugins.values()]
      .map(({ manifest }) => ({
        ...manifest,
        capabilities: [...manifest.capabilities],
      }))
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  publishDocumentEvent(event: PluginDocumentEvent): void {
    const parsed = PluginDocumentEventSchema.safeParse(event);
    if (!parsed.success) {
      this.logger.error(`Rejected invalid document plugin event: ${parsed.error.message}`);
      return;
    }

    for (const plugin of this.plugins.values()) {
      if (!plugin.manifest.enabled || !plugin.manifest.capabilities.includes('document-events')) {
        continue;
      }
      if (!plugin.onDocumentEvent) continue;

      void this.invokeDocumentHandler(plugin, parsed.data);
    }
  }

  private async invokeDocumentHandler(
    plugin: BinderPlugin,
    event: PluginDocumentEvent,
  ): Promise<void> {
    try {
      await plugin.onDocumentEvent?.(event);
    } catch (error) {
      this.logger.error(
        `Plugin '${plugin.manifest.id}' failed while handling '${event.name}'`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
