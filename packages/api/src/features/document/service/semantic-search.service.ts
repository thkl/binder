import { Injectable } from '@nestjs/common';
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

    const embeddings = await DocumentEmbedding.findAll({
      include: [{ model: Document, required: true, where: { ownerUuid } }],
      where: { dimensions: vector.length }
    });
    return embeddings
      .map((embedding) => ({
        document: (embedding as DocumentEmbedding & { document?: Document }).document!,
        pageNumber: embedding.pageNumber,
        text: embedding.content,
        score: cosineSimilarity(vector, embedding.embedding)
      }))
      .filter((hit) => hit.document && Number.isFinite(hit.score))
      .sort((left, right) => right.score - left.score)
      .filter((hit, index, hits) => index === hits.findIndex((candidate) => candidate.document.uuid === hit.document.uuid))
      .slice(0, limit);
  }
}

function cosineSimilarity(left: number[], right: number[]): number {
  if (left.length !== right.length) return 0;
  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftMagnitude += left[index] ** 2;
    rightMagnitude += right[index] ** 2;
  }
  return leftMagnitude && rightMagnitude ? dot / Math.sqrt(leftMagnitude * rightMagnitude) : 0;
}
