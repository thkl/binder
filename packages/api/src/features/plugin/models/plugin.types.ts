import type { PluginDocumentEvent, PluginManifest } from '@binder/common';

export interface BinderPlugin {
  manifest: PluginManifest;
  onDocumentEvent?: (event: PluginDocumentEvent) => void | Promise<void>;
}
