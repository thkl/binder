import { Controller, Post, Req, UseGuards } from '@nestjs/common';
import { DocumentSearchQuerySchema } from '@binder/common';
import type { Request } from 'express';
import { ApiTokenGuard } from '../authentication/guards/api-token.guard';
import { ApiTokenService } from '../authentication/service/api-token.service';
import type { ScopedUser } from '../authentication/decorators/current-user.decorator';
import { DocumentService } from '../document/service/document.service';

type McpRequest = Request & { user?: ScopedUser };

const tools = [
  {
    name: 'search_documents',
    description: 'Search Binder documents belonging to the authenticated user.',
    inputSchema: {
      type: 'object',
      properties: {
        q: { type: 'string', description: 'Search query' },
        limit: { type: 'integer' },
      },
      required: ['q'],
    },
  },
  {
    name: 'get_document',
    description: 'Get metadata for one Binder document belonging to the authenticated user.',
    inputSchema: { type: 'object', properties: { uuid: { type: 'string' } }, required: ['uuid'] },
  },
  {
    name: 'get_extracted_text',
    description:
      'Read extracted text from one Binder document belonging to the authenticated user.',
    inputSchema: { type: 'object', properties: { uuid: { type: 'string' } }, required: ['uuid'] },
  },
];

@Controller('mcp')
@UseGuards(ApiTokenGuard)
export class McpController {
  constructor(
    private readonly documents: DocumentService,
    private readonly apiTokens: ApiTokenService,
  ) {}

  @Post()
  async handle(@Req() request: McpRequest) {
    const body = request.body as {
      jsonrpc?: string;
      id?: string | number | null;
      method?: string;
      params?: any;
    };
    const id = body?.id ?? null;
    if (body?.jsonrpc !== '2.0' || !body.method) {
      return this.error(id, -32600, 'Invalid MCP JSON-RPC request');
    }

    if (body.method === 'initialize') {
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: '2025-11-25',
          capabilities: { tools: {} },
          serverInfo: { name: 'binder', version: '0.1.0' },
        },
      };
    }
    if (body.method === 'notifications/initialized') return { jsonrpc: '2.0', id };
    if (body.method === 'tools/list') return { jsonrpc: '2.0', id, result: { tools } };
    if (body.method !== 'tools/call')
      return this.error(id, -32601, `Unsupported method: ${body.method}`);

    const user = request.user;
    const name = body.params?.name;
    const args = body.params?.arguments ?? {};
    if (!user || !this.apiTokens.hasPermission(user, 'documents:read')) {
      return this.error(id, -32003, 'Token does not have documents:read permission');
    }
    if (!tools.some((tool) => tool.name === name)) return this.error(id, -32602, 'Unknown tool');

    try {
      let result: unknown;
      if (name === 'search_documents') {
        result = await this.documents.search(
          user.userId,
          DocumentSearchQuerySchema.parse({ q: args.q, limit: args.limit ?? 20 }),
        );
      } else if (name === 'get_document') {
        result = await this.documents.get(user.userId, String(args.uuid));
      } else {
        result = await this.documents.getExtractedText(user.userId, String(args.uuid));
      }
      return {
        jsonrpc: '2.0',
        id,
        result: { content: [{ type: 'text', text: JSON.stringify(result) }] },
      };
    } catch (error) {
      return {
        jsonrpc: '2.0',
        id,
        result: {
          isError: true,
          content: [
            {
              type: 'text',
              text: error instanceof Error ? error.message : 'Tool execution failed',
            },
          ],
        },
      };
    }
  }

  private error(id: string | number | null, code: number, message: string) {
    return { jsonrpc: '2.0', id, error: { code, message } };
  }
}
