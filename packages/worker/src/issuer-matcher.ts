import { Op } from 'sequelize';
import { Document, Issuer } from './models.js';
import { logger } from './logger.js';

interface Candidate {
  issuer: Issuer;
  score: number;
  matchedFields: string[];
}

interface ValueMatch {
  matched: boolean;
  ocrSpaced: boolean;
}

/** Assigns an existing issuer only when the extracted text contains a unique, strong match. */
export async function matchDocumentIssuer(documentUuid: string, ownerUuid: string, text: string): Promise<void> {
  const document = await Document.findOne({ where: { uuid: documentUuid, ownerUuid } });
  if (!document || document.issuerUuid || !text.trim()) return;

  const issuers = await Issuer.findAll({ where: { ownerUuid } });
  const normalizedText = normalize(text);
  const candidates = issuers
    .map((issuer) => scoreIssuer(issuer, normalizedText))
    .filter((candidate): candidate is Candidate => candidate !== null)
    .sort((left, right) => right.score - left.score);

  const best = candidates[0];
  const runnerUp = candidates[1];
  if (!best || best.score < 0.75 || (runnerUp && best.score - runnerUp.score < 0.08)) {
    logger.debug('No unique issuer match found', {
      documentUuid,
      ownerUuid,
      candidateCount: candidates.length,
      bestScore: best?.score ?? 0
    });
    return;
  }

  const [updated] = await Document.update(
    { issuerUuid: best.issuer.uuid },
    { where: { uuid: documentUuid, ownerUuid, issuerUuid: { [Op.is]: null } } }
  );
  if (updated > 0) {
    logger.info('Assigned issuer from extracted text', {
      documentUuid,
      issuerUuid: best.issuer.uuid,
      issuerName: best.issuer.name,
      score: best.score,
      matchedFields: best.matchedFields
    });
  }
}

function scoreIssuer(issuer: Issuer, text: string): Candidate | null {
  const nameMatch = matchValue(text, issuer.name);
  if (!nameMatch.matched) return null;

  let score = 0.75;
  const matchedFields = ['name'];
  if (nameMatch.ocrSpaced) matchedFields.push('name.ocr-spaced');
  const fields: Array<[keyof Issuer, number]> = [
    ['address', 0.1],
    ['zipCode', 0.08],
    ['city', 0.05],
    ['country', 0.02]
  ];
  for (const [field, weight] of fields) {
    const value = issuer[field];
    const match = matchValue(text, value);
    if (match.matched) {
      score += weight;
      matchedFields.push(field);
      if (match.ocrSpaced) matchedFields.push(`${field}.ocr-spaced`);
    }
  }
  for (const [key, value] of Object.entries(issuer.custom ?? {})) {
    const match = matchValue(text, value);
    if (match.matched) {
      score += 0.03;
      matchedFields.push(`custom.${key}`);
      if (match.ocrSpaced) matchedFields.push(`custom.${key}.ocr-spaced`);
    }
  }
  return { issuer, score: Math.min(1, score), matchedFields };
}

function normalize(value: string): string {
  return value.normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ß/g, 'ss')
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function matchValue(text: string, value: unknown): ValueMatch {
  if (typeof value !== 'string' && typeof value !== 'number') {
    return { matched: false, ocrSpaced: false };
  }

  const normalizedValue = normalize(String(value));
  if (!normalizedValue) return { matched: false, ocrSpaced: false };
  if ((` ${text} `).includes(` ${normalizedValue} `)) {
    return { matched: true, ocrSpaced: false };
  }

  // Some OCR/PDF text layers emit a name as separate characters (for example
  // `M ü l l e r`). Compare a compact representation as a safe fallback.
  const compactValue = compact(normalizedValue);
  if (compactValue.length < 5) return { matched: false, ocrSpaced: false };
  return { matched: compact(text).includes(compactValue), ocrSpaced: compact(text).includes(compactValue) };
}

function compact(value: string): string {
  return value.replace(/\s+/g, '');
}
