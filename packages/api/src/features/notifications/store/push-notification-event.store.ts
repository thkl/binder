import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { Op } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { BaseCrudStore } from '../../../shared/datastore/base-crud.store';
import { PushNotificationEvent } from '../models/push-notification-event.entity';

@Injectable()
export class PushNotificationEventStore extends BaseCrudStore<PushNotificationEvent> {
  constructor(@InjectConnection() private readonly sequelize: Sequelize) {
    super(PushNotificationEvent);
    this.registerIdField('uuid');
  }

  async claimNext(): Promise<PushNotificationEvent | null> {
    return this.sequelize.transaction(async (transaction) => {
      const event = await this.model.findOne({
        where: { deliveredAt: null, availableAt: { [Op.lte]: new Date() } },
        order: [
          ['createdAt', 'ASC'],
          ['uuid', 'ASC'],
        ],
        transaction,
        lock: transaction.LOCK.UPDATE,
        skipLocked: true,
      });
      if (!event) return null;
      await event.update(
        {
          attempts: event.attempts + 1,
          availableAt: new Date(Date.now() + 120_000),
        },
        { transaction },
      );
      return event;
    });
  }

  async markDelivered(uuid: string): Promise<void> {
    await this.model.update({ deliveredAt: new Date(), lastError: null }, { where: { uuid } });
  }

  async markFailed(uuid: string, attempts: number, error: string): Promise<void> {
    const delaySeconds = Math.min(3600, 10 * 2 ** Math.min(attempts, 8));
    const exhausted = attempts >= 8;
    await this.model.update(
      {
        lastError: error.slice(0, 500),
        availableAt: new Date(Date.now() + delaySeconds * 1000),
        deliveredAt: exhausted ? new Date() : null,
      },
      { where: { uuid } },
    );
  }
}
