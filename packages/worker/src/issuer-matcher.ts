import { Op } from 'sequelize';
import { Document, Issuer } from './models.js';
import { logger } from './logger.js';

interface Candidate {
  issuer: Issuer;
  score: number;
  matchedFields: string[];
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
  const name = normalize(issuer.name);
  if (!name || !contains(text, name)) return null;

  let score = 0.75;
  const matchedFields = ['name'];
  const fields: Array<[keyof Issuer, number]> = [
    ['address', 0.1],
    ['zipCode', 0.08],
    ['city', 0.05],
    ['country', 0.02]
  ];
  for (const [field, weight] of fields) {
    const value = issuer[field];
    if (typeof value === 'string' && value.trim() && contains(text, normalize(value))) {
      score += weight;
      matchedFields.push(field);
    }
  }
  for (const [key, value] of Object.entries(issuer.custom ?? {})) {
    if (typeof value === 'string' && value.trim() && contains(text, normalize(value))) {
      score += 0.03;
      matchedFields.push(`custom.${key}`);
    }
  }
  return { issuer, score: Math.min(1, score), matchedFields };
}

function normalize(value: string): string {
  return value.normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function contains(text: string, value: string): boolean {
  return value.length > 0 && (` ${text} `).includes(` ${value} `);
}
