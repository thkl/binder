import { Body, Controller, Get, Post, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { SetupAdminInputSchema, SetupStatusSchema } from '@binder/common';
import { SessionRequest } from '../../authentication/models/request.model';
import { SetupService } from '../service/setup.service';
import { ensureCsrfToken } from '../../../shared/security/csrf-token';

@Controller('setup')
export class SetupController {
  constructor(private readonly setup: SetupService) {}

  @Get('status')
  async status() {
    return { data: SetupStatusSchema.parse(await this.setup.status()) };
  }

  @Post('admin')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async createAdmin(@Body() body: unknown, @Req() request: SessionRequest) {
    const result = await this.setup.createAdministrator(SetupAdminInputSchema.parse(body));

    await new Promise<void>((resolve, reject) => {
      request.session.regenerate((error) => error ? reject(error) : resolve());
    });
    request.session.userId = result.uuid;
    request.session.mustChangePassword = false;
    const csrfToken = ensureCsrfToken(request);
    await new Promise<void>((resolve, reject) => {
      request.session.save((error) => error ? reject(error) : resolve());
    });

    return { data: result, csrfToken };
  }
}
