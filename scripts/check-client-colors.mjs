import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

const root = new URL('../packages/client/src/app/', import.meta.url);
const repositoryRoot = new URL('../', import.meta.url).pathname;
const errors = [];
const colorPattern = /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)/g;

async function collectStyles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await collectStyles(path)));
    else if (entry.isFile() && /\.(?:css|scss)$/.test(entry.name)) files.push(path);
  }
  return files;
}

for (const file of await collectStyles(root.pathname)) {
  const source = await readFile(file, 'utf8');
  for (const match of source.matchAll(colorPattern)) {
    const line = source.slice(0, match.index).split('\n').length;
    errors.push(`${relative(repositoryRoot, file)}:${line}: ${match[0]}`);
  }
}

if (errors.length > 0) {
  console.error(`Client color-token check failed with ${errors.length} hard-coded color(s):`);
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log('Client color-token check passed.');
}
