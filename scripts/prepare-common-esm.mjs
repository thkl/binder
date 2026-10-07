import { readdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const outputDirectory = new URL('../packages/common/dist/esm/', import.meta.url);
const files = await readdir(outputDirectory);

for (const file of files) {
  if (!file.endsWith('.js')) continue;

  const sourcePath = join(outputDirectory.pathname, file);
  const moduleFile = file.replace(/\.js$/, '.mjs');
  const source = await readFile(sourcePath, 'utf8');
  const updatedSource = source.replace(
    `//# sourceMappingURL=${file}.map`,
    `//# sourceMappingURL=${moduleFile}.map`,
  );
  await writeFile(sourcePath, updatedSource);
  await rename(sourcePath, join(outputDirectory.pathname, moduleFile));

  const sourceMapPath = join(outputDirectory.pathname, `${file}.map`);
  try {
    await rename(sourceMapPath, join(outputDirectory.pathname, `${moduleFile}.map`));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

await writeFile(
  join(outputDirectory.pathname, 'package.json'),
  JSON.stringify({ type: 'module' }, null, 2) + '\n',
);
