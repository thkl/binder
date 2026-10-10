import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { QueryTypes } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';

@Injectable()
export class AuthenticationSessionStore {
  constructor(@InjectConnection() private readonly sequelize: Sequelize) {}

  async invalidateOtherSessions(userUuid: string, currentSessionId: string): Promise<void> {
    await this.sequelize.query(
      `DELETE FROM user_sessions
       WHERE sess::jsonb->>'userId' = :userUuid
         AND sid <> :currentSessionId`,
      {
        replacements: { userUuid, currentSessionId },
        type: QueryTypes.DELETE,
      },
    );
  }
}
