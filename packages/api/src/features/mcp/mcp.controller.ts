import { Controller, ForbiddenException, Post, Req, Res, UseGuards } from '@nestjs/common';
import { createMcpHandler, McpServer } from '@modelcontextprotocol/server';
import { DocumentSearchQuerySchema } from '@binder/common';
import { z } from 'zod';
import type { Request, Response } from 'express';
import { ApiTokenGuard } from '../authentication/guards/api-token.guard';
import { ApiTokenService } from '../authentication/service/api-token.service';
import type { ScopedUser } from '../authentication/decorators/current-user.decorator';
import { DocumentService } from '../document/service/document.service';

type McpRequest = Request & { user?: ScopedUser };

@Controller('mcp')
@UseGuards(ApiTokenGuard)
export class McpController {
  constructor(
    private readonly documents: DocumentService,
    private readonly apiTokens: ApiTokenService,
  ) {}

  @Post()
  async handle(@Req() request: McpRequest, @Res() response: Response): Promise<void> {
    const user = request.user;
    if (!user || !this.apiTokens.hasPermission(user, 'documents:read')) {
      throw new ForbiddenException('Token does not have documents:read permission');
    }

    const server = new McpServer({ name: 'binder', version: '0.1.0' });
    server.registerTool(
      'search_documents',
      {
        description: 'Search Binder documents belonging to the authenticated user.',
        inputSchema: z.object({
          q: z.string().min(1).describe('Search query'),
          limit: z.number().int().min(1).max(100).optional(),
        }),
      },
      async ({ q, limit }) => ({
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              await this.documents.search(
                user.userId,
                DocumentSearchQuerySchema.parse({ q, limit: limit ?? 20 }),
              ),
            ),
          },
        ],
      }),
    );
    server.registerTool(
      'get_document',
      {
        description: 'Get metadata for one Binder document belonging to the authenticated user.',
        inputSchema: z.object({ uuid: z.uuid() }),
      },
      async ({ uuid }) => ({
        content: [
          { type: 'text', text: JSON.stringify(await this.documents.get(user.userId, uuid)) },
        ],
      }),
    );
    server.registerTool(
      'get_extracted_text',
      {
        description:
          'Read extracted text from one Binder document belonging to the authenticated user.',
        inputSchema: z.object({ uuid: z.uuid() }),
      },
      async ({ uuid }) => ({
        content: [
          {
            type: 'text',
            text: JSON.stringify(await this.documents.getExtractedText(user.userId, uuid)),
          },
        ],
      }),
    );

    const handler = createMcpHandler(() => server, {
      legacy: 'stateless',
      responseMode: 'auto',
    });
    const headers = new Headers();
    for (const [name, value] of Object.entries(request.headers)) {
      if (typeof value === 'string') headers.set(name, value);
      else if (Array.isArray(value)) headers.set(name, value.join(', '));
    }
    if (!headers.has('accept')) headers.set('accept', 'application/json, text/event-stream');
    const webRequest = new Request(`http://${request.get('host')}${request.originalUrl}`, {
      method: request.method,
      headers,
      body: request.body === undefined ? undefined : JSON.stringify(request.body),
    });
    const webResponse = await handler.fetch(webRequest, { parsedBody: request.body });
    response.status(webResponse.status);
    webResponse.headers.forEach((value, name) => response.setHeader(name, value));
    response.send(Buffer.from(await webResponse.arrayBuffer()));
  }
}
