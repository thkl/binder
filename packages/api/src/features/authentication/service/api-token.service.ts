import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { randomBytes, createHash } from 'node:crypto';
import { ApiTokenPermission, CreateApiTokenInput } from '@binder/common';
import { InjectModel } from '@nestjs/sequelize';
import { ApiToken } from '../models/api-token.entity';
import { User } from '../models/user.entity';
import { ScopedUser } from '../decorators/current-user.decorator';

const TOKEN_PREFIX = 'bnd_pat_';

@Injectable()
export class ApiTokenService {
  constructor(
    @InjectModel(ApiToken) private readonly tokens: typeof ApiToken,
    @InjectModel(User) private readonly users: typeof User,
  ) {}

  async create(userUuid: string, input: CreateApiTokenInput) {
    const secret = randomBytes(32).toString('base64url');
    const publicId = randomBytes(8).toString('hex');
    const token = `${TOKEN_PREFIX}${publicId}.${secret}`;
    const record = await this.tokens.create({
      userUuid,
      name: input.name,
      tokenPrefix: `${TOKEN_PREFIX}${publicId}`,
      tokenHash: this.hash(token),
      permissions: [...new Set(input.permissions)] as ApiTokenPermission[],
      lastUsedAt: null,
      expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
      revokedAt: null,
    });
    return { token, apiToken: this.toResponse(record) };
  }

  async list(userUuid: string) {
    const records = await this.tokens.findAll({
      where: { userUuid },
      order: [['createdAt', 'DESC']],
    });
    return { items: records.map((record) => this.toResponse(record)) };
  }

  async revoke(userUuid: string, tokenUuid: string): Promise<void> {
    const record = await this.tokens.findOne({ where: { uuid: tokenUuid, userUuid } });
    if (!record) throw new ForbiddenException('Token not found');
    if (!record.revokedAt) {
      await record.update({ revokedAt: new Date() });
    }
  }

  async authenticate(rawToken: string): Promise<ScopedUser> {
    const record = await this.tokens.findOne({ where: { tokenHash: this.hash(rawToken) } });
    if (
      !record ||
      record.revokedAt ||
      (record.expiresAt && record.expiresAt.getTime() <= Date.now())
    ) {
      throw new UnauthorizedException('Invalid or expired API token');
    }
    const user = await this.users.findOne({ where: { uuid: record.userUuid, isActive: true } });
    if (!user || user.mustChangePassword) throw new UnauthorizedException('User is not available');
    await record.update({ lastUsedAt: new Date() });
    return {
      userId: user.uuid,
      username: user.username,
      email: user.email,
      isAdmin: user.isAdmin,
      role: user.isAdmin ? 'admin' : 'user',
      scope: 'api',
      jti: record.uuid,
      permissions: record.permissions,
    } as ScopedUser;
  }

  hasPermission(user: ScopedUser, permission: ApiTokenPermission): boolean {
    return user.permissions?.includes(permission) ?? false;
  }

  private hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private toResponse(record: ApiToken) {
    return {
      uuid: record.uuid,
      name: record.name,
      tokenPrefix: record.tokenPrefix,
      permissions: record.permissions,
      createdAt: record.createdAt,
      lastUsedAt: record.lastUsedAt,
      expiresAt: record.expiresAt,
      revokedAt: record.revokedAt,
    };
  }
}
