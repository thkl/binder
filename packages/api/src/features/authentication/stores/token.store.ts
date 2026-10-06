import { Injectable } from '@nestjs/common';
import { BaseCrudStore } from '../../../shared/datastore/base-crud.store';
import { IStoreUser } from '../../../shared/datastore/query-options.type';
import { PasswordResetToken } from '../models/password-reset-token.entity';
import { createHash } from 'crypto';
import { User } from '../models/user.entity';
import * as argon2 from 'argon2';
import { QueryTypes } from 'sequelize';

export const RESET_RESPONSE = { accepted: true as const };

@Injectable()
export class PasswordResetTokenStore extends BaseCrudStore<PasswordResetToken, IStoreUser> {
  constructor() {
    super(PasswordResetToken);
    this.registerIdField('uuid');
  }

  hash(token: string): string {
    return createHash('sha256').update(token, 'utf8').digest('hex');
  }

  async confirm(token: string, newPassword: string): Promise<{ accepted: true }> {
    const userModel = User;
    const reset = await this.findOne({
      where: { tokenHash: this.hash(token), usedAt: null },
    });

    if (!reset || reset.expiresAt.getTime() <= Date.now()) {
      return RESET_RESPONSE;
    }

    const user = await userModel.findByPk(reset.userUuid);
    if (!user || !user.isActive || !user.passwordHash) return RESET_RESPONSE;

    await this.model.sequelize?.transaction(async (transaction) => {
      await user.update(
        { passwordHash: await argon2.hash(newPassword), mustChangePassword: false },
        { transaction },
      );
      await reset.update({ usedAt: new Date() }, { transaction });
      await this.model.sequelize?.query(
        "DELETE FROM user_sessions WHERE sess::jsonb->>'userId' = :userId",
        { replacements: { userId: user.uuid }, type: QueryTypes.DELETE, transaction },
      );
    });

    return RESET_RESPONSE;
  }
}
