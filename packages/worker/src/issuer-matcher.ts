import { randomUUID } from 'node:crypto';
import { Op } from 'sequelize';
import { Document, DocumentAuditEvent, DocumentFolder, Issuer } from './models.js';
import { logger } from './logger.js';

interface Candidate {
  issuer: Issuer;
  score: number;
  matchedFields: string[];
}

interface ValueMatch {
  matched: boolean;
  ocrSpaced: boolean;
  occurrences: MatchOccurrence[];
}

interface MatchOccurrence {
  relativePosition: number;
  context: string;
}

const HEADER_REGION_RATIO = 0.35;
const CONTEXT_WINDOW = 180;
const FINANCIAL_CONTEXT_MARKERS = [
  'iban',
  'bic',
  'swift',
  'sepa',
  'blz',
  'bankverbindung',
  'bankleitzahl',
  'kontonummer',
  'kontoinhaber',
  'kreditinstitut',
  'zahlungs',
  'zahlung',
  'uberweisung',
  'ueberweisung',
  'account number',
  'bank details',
  'payment details',
  'routing number',
  'sort code',
  'beneficiary',
];

/** Assigns an existing issuer only when the extracted text contains a unique, strong match. */
export async function matchDocumentIssuer(
  documentUuid: string,
  ownerUuid: string,
  text: string,
): Promise<void> {
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
      bestScore: best?.score ?? 0,
    });
    return;
  }

  const [updated] = await Document.update(
    { issuerUuid: best.issuer.uuid },
    { where: { uuid: documentUuid, ownerUuid, issuerUuid: { [Op.is]: null } } },
  );
  if (updated > 0) {
    await DocumentAuditEvent.create({
      uuid: randomUUID(),
      documentUuid,
      ownerUuid,
      actorUuid: null,
      actorType: 'worker',
      eventType: 'metadata-changed',
      summary: 'Issuer matched from extracted text',
      details: { fields: ['issuer'] },
    });
    if (best.issuer.folderUuid) {
      try {
        await DocumentFolder.findOrCreate({
          where: {
            documentUuid,
            folderUuid: best.issuer.folderUuid,
          },
          defaults: {
            documentUuid,
            folderUuid: best.issuer.folderUuid,
          },
        });
      } catch (error) {
        logger.warn('Unable to apply issuer folder routing', {
          documentUuid,
          issuerUuid: best.issuer.uuid,
          folderUuid: best.issuer.folderUuid,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    logger.info('Assigned issuer from extracted text', {
      documentUuid,
      issuerUuid: best.issuer.uuid,
      issuerName: best.issuer.name,
      score: best.score,
      matchedFields: best.matchedFields,
    });
  }
}

export function scoreIssuer(issuer: Issuer, text: string): Candidate | null {
  const nameMatch = matchValue(text, issuer.name);
  if (!nameMatch.matched) return null;

  const hasHeaderNameMatch = nameMatch.occurrences.some(
    (occurrence) =>
      occurrence.relativePosition <= HEADER_REGION_RATIO &&
      !isFinancialContext(occurrence, issuer.name),
  );
  let hasNonFinancialSupportingMatch = false;
  let score = 0.75;
  const matchedFields = ['name'];
  if (nameMatch.ocrSpaced) matchedFields.push('name.ocr-spaced');
  const fields: Array<[keyof Issuer, number]> = [
    ['address', 0.1],
    ['zipCode', 0.08],
    ['city', 0.05],
    ['country', 0.02],
  ];
  for (const [field, weight] of fields) {
    const value = issuer[field];
    const match = matchValue(text, value);
    if (match.matched) {
      if (match.occurrences.some((occurrence) => !isFinancialContext(occurrence, value))) {
        hasNonFinancialSupportingMatch = true;
      }
      score += weight;
      matchedFields.push(field);
      if (match.ocrSpaced) matchedFields.push(`${field}.ocr-spaced`);
    }
  }
  for (const [key, value] of Object.entries(issuer.custom ?? {})) {
    const match = matchValue(text, value);
    if (match.matched) {
      if (match.occurrences.some((occurrence) => !isFinancialContext(occurrence, value))) {
        hasNonFinancialSupportingMatch = true;
      }
      score += 0.03;
      matchedFields.push(`custom.${key}`);
      if (match.ocrSpaced) matchedFields.push(`custom.${key}.ocr-spaced`);
    }
  }

  // A name found only in a payment footer is not enough evidence to assign
  // the issuer. A header match or an independently matched non-financial
  // field is required before the candidate can be considered.
  if (!hasHeaderNameMatch && !hasNonFinancialSupportingMatch) return null;

  return { issuer, score: Math.min(1, score), matchedFields };
}

export function normalize(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ß/g, 'ss')
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function matchValue(text: string, value: unknown): ValueMatch {
  if (typeof value !== 'string' && typeof value !== 'number') {
    return { matched: false, ocrSpaced: false, occurrences: [] };
  }

  const normalizedValue = normalize(String(value));
  if (!normalizedValue) return { matched: false, ocrSpaced: false, occurrences: [] };

  const exactOccurrences = findOccurrences(` ${text} `, ` ${normalizedValue} `).map((index) =>
    createOccurrence(text, index + 1, normalizedValue.length),
  );
  if (exactOccurrences.length > 0) {
    return { matched: true, ocrSpaced: false, occurrences: exactOccurrences };
  }

  // Some OCR/PDF text layers emit a name as separate characters (for example
  // `M ü l l e r`). Compare a compact representation as a safe fallback.
  const compactValue = compact(normalizedValue);
  if (compactValue.length < 5) {
    return { matched: false, ocrSpaced: false, occurrences: [] };
  }

  const compactText = compact(text);
  const compactOccurrences = findOccurrences(compactText, compactValue).map((index) =>
    createOccurrence(compactText, index, compactValue.length),
  );
  return {
    matched: compactOccurrences.length > 0,
    ocrSpaced: compact(text).includes(compactValue),
    occurrences: compactOccurrences,
  };
}

function createOccurrence(text: string, index: number, matchLength: number): MatchOccurrence {
  return {
    relativePosition: index / Math.max(text.length, 1),
    context: text.slice(
      Math.max(0, index - CONTEXT_WINDOW),
      Math.min(text.length, index + matchLength + CONTEXT_WINDOW),
    ),
  };
}

function isFinancialContext(occurrence: MatchOccurrence, value: unknown): boolean {
  const normalizedValue =
    typeof value === 'string' || typeof value === 'number' ? normalize(String(value)) : '';
  const context = occurrence.context
    .replaceAll(normalizedValue, ' ')
    .replaceAll(compact(normalizedValue), ' ');

  return (
    FINANCIAL_CONTEXT_MARKERS.some((marker) => context.includes(marker)) ||
    /\bbank\b/iu.test(context)
  );
}

function findOccurrences(text: string, value: string): number[] {
  const occurrences: number[] = [];
  let offset = 0;

  while (offset <= text.length - value.length) {
    const index = text.indexOf(value, offset);
    if (index < 0) break;
    occurrences.push(index);
    offset = index + Math.max(value.length, 1);
  }

  return occurrences;
}

function compact(value: string): string {
  return value.replace(/\s+/g, '');
}
