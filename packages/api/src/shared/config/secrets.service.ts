import { Injectable } from '@nestjs/common';
import { secrets } from '@binder/common/secrets';

@Injectable()
export class SecretsService {
  get(name: string): string | undefined {
    return secrets.get(name);
  }

  require(name: string): string {
    return secrets.require(name);
  }
}
