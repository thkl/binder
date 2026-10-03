import assert from 'node:assert/strict';
import test from 'node:test';
import { createContentDisposition } from './content-disposition';

test('creates an ASCII fallback and UTF-8 filename parameter', () => {
  const header = createContentDisposition('inline', 'TÜV-Bericht 05/2025.pdf');

  assert.equal(
    header,
    'inline; filename="T_V-Bericht 05_2025.pdf"; filename*=UTF-8\'\'T%C3%9CV-Bericht%2005_2025.pdf',
  );
});

test('removes control characters before building the header', () => {
  const header = createContentDisposition('attachment', 'report\r\n.pdf');

  assert.equal(header, 'attachment; filename="report__.pdf"; filename*=UTF-8\'\'report__.pdf');
});

test('uses a fallback name for an empty filename', () => {
  assert.equal(
    createContentDisposition('attachment', '   '),
    'attachment; filename="download"; filename*=UTF-8\'\'download',
  );
});
