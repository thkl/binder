import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { Op } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { BaseCrudStore } from '../../../shared/datastore/base-crud.store';
import { MetadataWebhookDelivery } from '../models/metadata-webhook-delivery.entity';

@Injectable()
export class MetadataWebhookDeliveryStore extends BaseCrudStore<MetadataWebhookDelivery> {
  constructor(@InjectConnection() private readonly sequelize: Sequelize) {
    super(MetadataWebhookDelivery);
    this.registerIdField('uuid');
  }

  /** Inserts one delivery for each source audit event and ignores duplicate event handling. */
  enqueue(input: {
    ownerUuid: string;
    documentUuid: string;
    sourceEventUuid: string;
    field: string;
    operator: string;
    triggerValue: string;
    payload: Record<string, unknown>;
  }): Promise<[MetadataWebhookDelivery, boolean]> {
    return this.model.findOrCreate({
      where: { sourceEventUuid: input.sourceEventUuid },
      defaults: input,
    });
  }

  /** Locks and marks one due record in flight so other replicas skip the same row. */
  async claimNext(): Promise<MetadataWebhookDelivery | null> {
    return this.sequelize.transaction(async (transaction) => {
      const delivery = await this.model.findOne({
        where: { status: 'pending', availableAt: { [Op.lte]: new Date() } },
        order: [
          ['createdAt', 'ASC'],
          ['uuid', 'ASC'],
        ],
        transaction,
        lock: transaction.LOCK.UPDATE,
        skipLocked: true,
      });
      if (!delivery) return null;

      await delivery.update(
        {
          attempts: delivery.attempts + 1,
          availableAt: new Date(Date.now() + 120_000),
        },
        { transaction },
      );
      return delivery;
    });
  }

  /** Marks a delivery successful and clears any earlier error. */
  async markDelivered(uuid: string): Promise<void> {
    await this.model.update(
      { status: 'delivered', deliveredAt: new Date(), lastError: null },
      { where: { uuid } },
    );
  }

  /** Schedules exponential retry or marks the delivery exhausted after eight attempts. */
  async markFailed(uuid: string, attempts: number, error: string): Promise<void> {
    const exhausted = attempts >= 8;
    const delaySeconds = Math.min(3600, 10 * 2 ** Math.min(attempts, 8));
    await this.model.update(
      {
        status: exhausted ? 'failed' : 'pending',
        availableAt: new Date(Date.now() + delaySeconds * 1000),
        lastError: error.slice(0, 500),
      },
      { where: { uuid } },
    );
  }

  /** Returns the newest delivery rows for the workflow management screen. */
  findRecent(limit = 25): Promise<MetadataWebhookDelivery[]> {
    return this.model.findAll({
      order: [
        ['createdAt', 'DESC'],
        ['uuid', 'DESC'],
      ],
      limit,
    });
  }

  /** Resets only failed deliveries and returns null for any other state. */
  async retry(uuid: string): Promise<MetadataWebhookDelivery | null> {
    const delivery = await this.model.findOne({ where: { uuid, status: 'failed' } });
    if (!delivery) return null;
    await delivery.update({
      status: 'pending',
      attempts: 0,
      availableAt: new Date(),
      deliveredAt: null,
      lastError: null,
    });
    return delivery;
  }
}
