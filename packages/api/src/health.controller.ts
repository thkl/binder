import { Controller, Get } from '@nestjs/common';
import { HealthResponse, HealthResponseSchema } from '@binder/common';

@Controller('health')
export class HealthController {
  @Get()
  getHealth(): HealthResponse {
    return HealthResponseSchema.parse({
      status: 'ok',
      service: 'api',
      version: '0.1.0',
    });
  }
}
