type ContentDispositionType = 'attachment' | 'inline';

/**
 * Builds a Content-Disposition value that is safe for Node's HTTP headers.
 *
 * The ASCII filename is kept as a fallback for older clients. The UTF-8
 * filename is provided through RFC 5987's filename* parameter so document
 * names such as "TÜV-Bericht.pdf" remain readable in modern clients.
 */
export function createContentDisposition(type: ContentDispositionType, filename: string): string {
  const wellFormedFilename = filename
    .replace(/[\uD800-\uDFFF]/g, '�')
    .replace(/[\u0000-\u001F\u007F]/g, '_')
    .replace(/[\\/:*?"<>|]/g, '_')
    .trim();
  const safeFilename = wellFormedFilename || 'download';
  const asciiFallback = safeFilename.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_');
  const encodedFilename = encodeURIComponent(safeFilename).replace(
    /['()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );

  return `${type}; filename="${asciiFallback}"; filename*=UTF-8''${encodedFilename}`;
}
