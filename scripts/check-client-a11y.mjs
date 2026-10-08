import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

const root = new URL('../packages/client/src/app/', import.meta.url);
const errors = [];

async function collectHtml(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await collectHtml(path)));
    else if (entry.isFile() && entry.name.endsWith('.html')) files.push(path);
  }
  return files;
}

function report(file, message) {
  errors.push(`${relative(new URL('../', import.meta.url).pathname, file)}: ${message}`);
}

for (const file of await collectHtml(root.pathname)) {
  const source = await readFile(file, 'utf8');

  for (const attribute of ['aria-label', 'placeholder', 'title']) {
    const pattern = new RegExp(`${attribute}\\s*=\\s*"([^"]*)"`, 'g');
    for (const match of source.matchAll(pattern)) {
      if (!match[1].includes('{{') && !match[1].includes('[')) {
        report(file, `hard-coded ${attribute} must use a translation binding: ${match[0]}`);
      }
    }
  }

  for (const match of source.matchAll(/<img\b[^>]*>/gi)) {
    if (!/(?:\balt|\[alt\]|\[attr\.alt\])\s*=\s*/i.test(match[0])) {
      report(
        file,
        'every image must provide an alt attribute or be replaced with decorative markup',
      );
    }
  }

  for (const match of source.matchAll(/<(div|span|section|article)\b[^>]*\(click\)\s*=/gi)) {
    const tag = match[0];
    if (!/\brole\s*=|\btabindex\s*=/.test(tag)) {
      report(file, 'clickable non-semantic elements need a keyboard-accessible role or tabindex');
    }
  }

  for (const match of source.matchAll(/role="(dialog|alertdialog)"/g)) {
    const start = Math.max(0, match.index - 240);
    const context = source.slice(start, match.index + 260);
    if (!/aria-modal="true"/.test(context)) {
      report(file, `${match[1]} must declare aria-modal="true"`);
    }
  }
}

if (errors.length > 0) {
  console.error(`Client accessibility check failed with ${errors.length} issue(s):`);
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log('Client accessibility checks passed.');
}
