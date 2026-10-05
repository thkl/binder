import { SetMetadata } from '@nestjs/common';
import type { ApiTokenPermission } from '@binder/common';

export const Permissions = (...permissions: ApiTokenPermission[]) =>
  SetMetadata('permissions', permissions);
