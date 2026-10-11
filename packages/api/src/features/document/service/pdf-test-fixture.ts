/** Builds a minimal PDF with one searchable text line on each supplied page. */
export function createPdfFixture(pageTexts: string[]): Buffer {
  const pageObjects = pageTexts.flatMap((_text, index) => [3 + index * 2, 4 + index * 2]);
  const fontObject = 3 + pageTexts.length * 2;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${pageObjects
      .filter((_value, index) => index % 2 === 0)
      .map((value) => `${value} 0 R`)
      .join(' ')}] /Count ${pageTexts.length} >>`,
  ];

  for (let index = 0; index < pageTexts.length; index += 1) {
    const pageObject = 3 + index * 2;
    const contentObject = pageObject + 1;
    const text = pageTexts[index]
      .replaceAll('\\', '\\\\')
      .replaceAll('(', '\\(')
      .replaceAll(')', '\\)');
    const stream = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontObject} 0 R >> >> /Contents ${contentObject} 0 R >>`,
      `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`,
    );
  }
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');

  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf, 'latin1'));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}
