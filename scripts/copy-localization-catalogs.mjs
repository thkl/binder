import { cp, mkdir } from 'node:fs/promises';

const source = new URL('../packages/api/src/features/localization/catalogs/', import.meta.url);
const target = new URL('../packages/api/dist/features/localization/catalogs/', import.meta.url);

await mkdir(target, { recursive: true });
await cp(source, target, { recursive: true });
