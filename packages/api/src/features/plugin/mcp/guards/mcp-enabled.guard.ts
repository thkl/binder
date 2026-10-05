import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { McpRuntimeService } from '../service/mcp-runtime.service';

@Injectable()
export class McpEnabledGuard implements CanActivate {
  constructor(private readonly runtime: McpRuntimeService) {}

  async canActivate(_context: ExecutionContext): Promise<boolean> {
    if (!(await this.runtime.isEnabled())) {
      throw new ForbiddenException('MCP is disabled');
    }
    return true;
  }
}
