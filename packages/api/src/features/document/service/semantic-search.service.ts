import { Injectable } from '@nestjs/common';
import { literal } from 'sequelize';
import { ApplicationSettingsService } from '../../settings/service/application-settings.service';
import { DocumentEmbedding } from '../models/document-embedding.entity';
import { Document } from '../models/document.entity';

export interface SemanticHit {
  document: Document;
  pageNumber: number;
  text: string;
  score: number;
}

@Injectable()
export class SemanticSearchService {
  constructor(private readonly settings: ApplicationSettingsService) {}

  async search(ownerUuid: string, query: string, limit: number): Promise<SemanticHit[]> {
    const enabled = (await this.settings.get('embeddings.enabled', 'false'))?.toLowerCase() === 'true';
    const apiKey = await this.settings.get('embeddings.apiKey', '');
    const provider = await this.settings.get('embeddings.provider', 'openai-compatible');
    if (!enabled || !apiKey || provider !== 'openai-compatible') return [];

    const endpoint = await this.settings.get('embeddings.endpoint', 'https://api.openai.com/v1/embeddings');
    const model = await this.settings.get('embeddings.model', 'text-embedding-3-small');
    const response = await fetch(endpoint!, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, input: [query] })
    });
    if (!response.ok) throw new Error(`Embedding provider returned HTTP ${response.status}`);
    const body = await response.json() as { data?: Array<{ embedding?: number[] }> };
    const vector = body.data?.[0]?.embedding;
    if (!vector?.length) throw new Error('Embedding provider returned an invalid query vector');

    if (vector.some((value) => !Number.isFinite(value))) throw new Error('Embedding provider returned an invalid query vector');
    const vectorLiteral = `[${vector.join(',')}]`;
    const similarityExpression = `"embedding_vector"::vector(${vector.length}) <=> '${vectorLiteral}'::vector`;
    const embeddings = await DocumentEmbedding.findAll({
      include: [{ model: Document, required: true, where: { ownerUuid } }],
      where: { dimensions: vector.length },
      attributes: {
        include: [[literal(similarityExpression), 'cosineDistance']]
      },
      order: [[literal(similarityExpression), 'ASC']],
      limit: Math.min(250, Math.max(limit * 8, 25))
    });
    return embeddings
      .map((embedding) => ({
        document: (embedding as DocumentEmbedding & { document?: Document }).document!,
        pageNumber: embedding.pageNumber,
        text: embedding.content,
        score: 1 - Number((embedding as DocumentEmbedding & { cosineDistance?: number }).get('cosineDistance'))
      }))
      .filter((hit) => hit.document && Number.isFinite(hit.score) && hit.score >= 0.35)
      .sort((left, right) => right.score - left.score)
      .filter((hit, index, hits) => index === hits.findIndex((candidate) => candidate.document.uuid === hit.document.uuid))
      .slice(0, limit);
  }
}
