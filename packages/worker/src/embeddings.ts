import { randomUUID } from 'node:crypto';
import { Op, Transaction } from 'sequelize';
import { config } from './config.js';
import { sequelize } from './database.js';
import { DocumentEmbedding } from './models.js';
import { DocumentPage } from './document-page.model.js';
import { logger } from './logger.js';

export interface EmbeddingResult { model: string; vectors: number[][]; }
export interface EmbeddingProvider { embed(input: string[]): Promise<EmbeddingResult>; }

class OpenAICompatibleProvider implements EmbeddingProvider {
  async embed(input: string[]): Promise<EmbeddingResult> {
    const response = await fetch(config.embeddings.endpoint, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${config.embeddings.apiKey}` }, body: JSON.stringify({ model: config.embeddings.model, input }) });
    if (!response.ok) throw new Error(`Embedding provider returned HTTP ${response.status}`);
    const body = await response.json() as { model?: string; data?: Array<{ embedding?: number[]; index?: number }> };
    const vectors = (body.data ?? []).sort((a, b) => (a.index ?? 0) - (b.index ?? 0)).map(item => item.embedding ?? []);
    if (vectors.length !== input.length || vectors.some(vector => vector.length === 0)) throw new Error('Embedding provider returned an invalid vector response');
    return { model: body.model || config.embeddings.model, vectors };
  }
}

export function createEmbeddingProvider(): EmbeddingProvider {
  if (config.embeddings.provider !== 'openai-compatible') throw new Error(`Unsupported embedding provider: ${config.embeddings.provider}`);
  if (!config.embeddings.apiKey) throw new Error('Embedding API key is not configured');
  return new OpenAICompatibleProvider();
}

export async function embedDocument(documentUuid: string): Promise<void> {
  const pages = await DocumentPage.findAll({ where: { documentUuid, text: { [Op.ne]: '' } }, order: [['pageNumber', 'ASC']] });
  const chunks = pages.flatMap(page => chunk(page.text, config.embeddings.chunkSize, config.embeddings.chunkOverlap).map((content, chunkIndex) => ({ pageNumber: page.pageNumber, chunkIndex, content })));
  if (!chunks.length) { logger.info('No text chunks available for embeddings', { documentUuid }); return; }
  const provider = createEmbeddingProvider(); const batchSize = 32; const rows: Array<Record<string, unknown>> = [];
  for (let offset = 0; offset < chunks.length; offset += batchSize) { const batch = chunks.slice(offset, offset + batchSize); const result = await provider.embed(batch.map(chunk => chunk.content)); const dimensions = result.vectors[0].length; rows.push(...batch.map((chunk, i) => ({ uuid: randomUUID(), documentUuid, pageNumber: chunk.pageNumber, chunkIndex: chunk.chunkIndex, content: chunk.content, embedding: result.vectors[i], provider: config.embeddings.provider, model: result.model, dimensions }))); }
  await sequelize.transaction(async (transaction: Transaction) => { await DocumentEmbedding.destroy({ where: { documentUuid }, transaction }); await DocumentEmbedding.bulkCreate(rows, { transaction }); });
  logger.info('Persisted document embeddings', { documentUuid, chunks: rows.length, dimensions: rows[0]?.dimensions, provider: config.embeddings.provider, model: config.embeddings.model });
}

function chunk(text: string, size: number, overlap: number): string[] { const normalized = text.replace(/\s+/g, ' ').trim(); if (!normalized) return []; const result: string[] = []; let start = 0; while (start < normalized.length) { const end = Math.min(normalized.length, start + size); result.push(normalized.slice(start, end)); if (end === normalized.length) break; start = Math.max(start + 1, end - overlap); } return result; }
