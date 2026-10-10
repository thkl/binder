import { Injectable } from '@nestjs/common';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { Op } from 'sequelize';
import { NativeSSOAuthCode } from '../models/native-sso-auth-code.entity';

@Injectable()
export class NativeSSOAuthCodeStore {
  async issue(userUuid: string, codeChallenge: string, appState: string): Promise<string> {
    await NativeSSOAuthCode.destroy({ where: { expiresAt: { [Op.lte]: new Date() } } });
    const code = randomBytes(32).toString('base64url');
    await NativeSSOAuthCode.create({
      userUuid,
      codeHash: this.hash(code),
      codeChallenge,
      appState,
      expiresAt: new Date(Date.now() + 2 * 60_000),
      usedAt: null,
    });
    return code;
  }

  async consume(code: string, verifier: string): Promise<{ userUuid: string; appState: string } | null> {
    const challenge = createHash('sha256').update(verifier, 'ascii').digest('base64url');
    const codeHash = this.hash(code);
    const sequelize = NativeSSOAuthCode.sequelize;
    if (!sequelize) throw new Error('Native SSO authorization code model is not initialized');

    return sequelize.transaction(async (transaction) => {
      const grant = await NativeSSOAuthCode.findOne({
        where: { codeHash, usedAt: null, expiresAt: { [Op.gt]: new Date() } },
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      if (!grant || !this.matches(grant.codeChallenge, challenge)) return null;
      const result = { userUuid: grant.userUuid, appState: grant.appState };
      await grant.update({ usedAt: new Date() }, { transaction });
      return result;
    });
  }

  private hash(code: string): string {
    return createHash('sha256').update(code, 'utf8').digest('hex');
  }

  private matches(left: string, right: string): boolean {
    const leftBytes = Buffer.from(left, 'ascii');
    const rightBytes = Buffer.from(right, 'ascii');
    return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
  }
}
