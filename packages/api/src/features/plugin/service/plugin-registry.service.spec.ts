import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PluginRegistryService } from './plugin-registry.service';

const documentUuid = '11111111-1111-4111-8111-111111111111';
const ownerUuid = '22222222-2222-4222-8222-222222222222';

function event() {
  return {
    name: 'document.metadata-changed',
    documentUuid,
    ownerUuid,
    actorUuid: ownerUuid,
    actorType: 'user' as const,
    payload: { fields: ['category'] },
    occurredAt: '2026-10-02T10:00:00.000Z',
  };
}

describe('plugin registry', () => {
  it('validates and lists registered plugins', () => {
    const registry = new PluginRegistryService();

    registry.register({
      manifest: {
        id: 'calendar',
        name: 'Calendar integration',
        version: '0.1.0',
        description: 'Creates calendar entries from approved metadata.',
        capabilities: ['document-events', 'calendar'],
        enabled: true,
      },
    });

    assert.deepEqual(registry.list(), [
      {
        id: 'calendar',
        name: 'Calendar integration',
        version: '0.1.0',
        description: 'Creates calendar entries from approved metadata.',
        capabilities: ['document-events', 'calendar'],
        enabled: true,
      },
    ]);
  });

  it('dispatches events only to enabled document-event plugins', async () => {
    const registry = new PluginRegistryService();
    const received: string[] = [];

    registry.register({
      manifest: {
        id: 'enabled-plugin',
        name: 'Enabled plugin',
        version: '1.0.0',
        description: 'Receives document events.',
        capabilities: ['document-events'],
        enabled: true,
      },
      onDocumentEvent: (receivedEvent) => {
        received.push(receivedEvent.documentUuid);
      },
    });
    registry.register({
      manifest: {
        id: 'disabled-plugin',
        name: 'Disabled plugin',
        version: '1.0.0',
        description: 'Does not receive events while disabled.',
        capabilities: ['document-events'],
        enabled: false,
      },
      onDocumentEvent: () => {
        received.push('disabled');
      },
    });

    registry.publishDocumentEvent(event());
    await new Promise<void>((resolve) => setImmediate(resolve));

    assert.deepEqual(received, [documentUuid]);
  });

  it('isolates a failing plugin from other plugins', async () => {
    const registry = new PluginRegistryService();
    let received = false;

    registry.register({
      manifest: {
        id: 'failing-plugin',
        name: 'Failing plugin',
        version: '1.0.0',
        description: 'Throws while processing an event.',
        capabilities: ['document-events'],
        enabled: true,
      },
      onDocumentEvent: () => {
        throw new Error('plugin failure');
      },
    });
    registry.register({
      manifest: {
        id: 'healthy-plugin',
        name: 'Healthy plugin',
        version: '1.0.0',
        description: 'Continues processing after another plugin fails.',
        capabilities: ['document-events'],
        enabled: true,
      },
      onDocumentEvent: () => {
        received = true;
      },
    });

    registry.publishDocumentEvent(event());
    await new Promise<void>((resolve) => setImmediate(resolve));

    assert.equal(received, true);
  });
});
