import { Injectable } from '@nestjs/common';
import { literal } from 'sequelize';
import { Op } from 'sequelize';
import { ApplicationSettingsService } from '../../settings/service/application-settings.service';
import { DocumentEmbedding } from '../models/document-embedding.entity';
import { Document } from '../models/document.entity';
import { BinderLogger } from '../../../shared/service/logger.helper';
import type { DocumentSearchQuery } from '@binder/common';

export interface SemanticHit {
  document: Document;
  pageNumber: number;
  text: string;
  score: number;
}

@Injectable()
export class SemanticSearchService {
  private readonly logger = new BinderLogger(SemanticSearchService.name);

  constructor(private readonly settings: ApplicationSettingsService) {}

  async search(
    ownerUuid: string,
    query: string,
    limit: number,
    filters: Partial<Pick<DocumentSearchQuery, 'issuerUuid' | 'status' | 'semanticThreshold'>> = {},
  ): Promise<SemanticHit[]> {
    const semanticThreshold = filters.semanticThreshold ?? 0.35;
    const enabled =
      (await this.settings.get('embeddings.enabled', 'false'))?.toLowerCase() === 'true';
    const apiKey = await this.settings.get('embeddings.apiKey', '');
    const provider = await this.settings.get('ai.provider', 'openai-compatible');
    this.logger.debug('Semantic search configuration checked', {
      enabled,
      provider,
      hasApiKey: Boolean(apiKey),
      queryLength: query.length,
      limit,
      semanticThreshold,
    });
    if (!enabled || !apiKey || provider !== 'openai-compatible') {
      this.logger.debug('Semantic search skipped', {
        reason: !enabled ? 'disabled' : !apiKey ? 'missing-api-key' : 'unsupported-provider',
      });
      return [];
    }

    const blockedStatuses = ['uploaded', 'scanning', 'quarantined'] as const;
    if (
      filters.status &&
      blockedStatuses.includes(filters.status as (typeof blockedStatuses)[number])
    ) {
      return [];
    }

    const endpoint = await this.settings.get(
      'embeddings.endpoint',
      'https://api.openai.com/v1/embeddings',
    );
    const model = await this.settings.get('embeddings.model', 'text-embedding-3-small');
    this.logger.info('Requesting semantic query embedding', {
      provider,
      model,
      endpoint,
      queryLength: query.length,
    });
    const response = await fetch(endpoint!, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, input: [query] }),
    });
    if (!response.ok) throw new Error(`Embedding provider returned HTTP ${response.status}`);
    const body = (await response.json()) as { data?: Array<{ embedding?: number[] }> };
    const vector = body.data?.[0]?.embedding;
    if (!vector?.length) throw new Error('Embedding provider returned an invalid query vector');

    if (vector.some((value) => !Number.isFinite(value)))
      throw new Error('Embedding provider returned an invalid query vector');
    this.logger.info('Semantic query embedding received', { model, dimensions: vector.length });
    const vectorLiteral = `[${vector.join(',')}]`;
    const similarityExpression = `"embedding_vector"::vector(${vector.length}) <=> '${vectorLiteral}'::vector`;
    const embeddings = await DocumentEmbedding.findAll({
      include: [
        {
          model: Document,
          required: true,
          where: {
            ownerUuid,
            status: filters.status ?? { [Op.notIn]: blockedStatuses },
            ...(filters.issuerUuid ? { issuerUuid: filters.issuerUuid } : {}),
          },
        },
      ],
      where: { dimensions: vector.length },
      attributes: {
        include: [[literal(similarityExpression), 'cosineDistance']],
      },
      order: [[literal(similarityExpression), 'ASC']],
      limit: Math.min(250, Math.max(limit * 8, 25)),
    });
    const hits = embeddings
      .map((embedding) => ({
        document: (embedding as DocumentEmbedding & { document?: Document }).document!,
        pageNumber: embedding.pageNumber,
        text: embedding.content,
        score: normalizeSimilarity(
          Number(
            (embedding as DocumentEmbedding & { cosineDistance?: number }).get('cosineDistance'),
          ),
        ),
      }))
      .filter((hit) => hit.document && Number.isFinite(hit.score) && hit.score >= semanticThreshold)
      .sort((left, right) => right.score - left.score)
      .filter(
        (hit, index, hits) =>
          index === hits.findIndex((candidate) => candidate.document.uuid === hit.document.uuid),
      )
      .slice(0, limit);
    this.logger.info('Semantic search candidates ranked', {
      vectorDimensions: vector.length,
      embeddingChunks: embeddings.length,
      documentHits: hits.length,
      topScores: hits.slice(0, 5).map((hit) => Number(hit.score.toFixed(4))),
    });
    return hits;
  }
}

function normalizeSimilarity(cosineDistance: number): number {
  if (!Number.isFinite(cosineDistance)) return Number.NaN;
  return Math.min(1, Math.max(0, 1 - cosineDistance));
}
