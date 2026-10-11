import { Injectable } from '@nestjs/common';
import { Op } from 'sequelize';
import { BaseCrudStore } from '../../../shared/datastore/base-crud.store';
import { User } from '../../authentication/models/user.entity';
import { PushDevice } from '../models/push-device.entity';

@Injectable()
export class PushDeviceStore extends BaseCrudStore<PushDevice> {
  constructor() {
    super(PushDevice);
    this.registerIdField('uuid');
  }

  async register(
    ownerUuid: string,
    token: string,
    environment: 'sandbox' | 'production',
    deviceName: string,
  ): Promise<void> {
    // A token represents one active APNs registration. Use it as the conflict
    // target so repeated opt-in calls update the existing row instead of
    // creating another delivery target.
    await this.model.upsert(
      { ownerUuid, token, environment, deviceName },
      { conflictFields: ['token'] },
    );
  }

  async findRegistration(
    ownerUuid: string,
    token: string,
  ): Promise<Pick<PushDevice, 'environment'> | null> {
    const device = await this.model.findOne({
      where: { ownerUuid, token },
      attributes: ['environment'],
    });
    return device ? { environment: device.environment } : null;
  }

  async findForOwner(ownerUuid: string): Promise<PushDevice[]> {
    const devices = await this.model.findAll({
      where: { ownerUuid },
      order: [['createdAt', 'ASC']],
    });
    // Older databases may already contain duplicate token rows. Never send
    // the same APNs token more than once for one notification event.
    return [...new Map(devices.map((device) => [device.token, device])).values()];
  }

  async findByUuid(uuid: string): Promise<PushDevice | null> {
    return this.model.findOne({ where: { uuid } });
  }

  async removeByUuid(uuid: string): Promise<void> {
    await this.model.destroy({ where: { uuid } });
  }

  async findAllForAdmin(): Promise<
    Array<{
      uuid: string;
      ownerUsername: string;
      deviceName: string;
      environment: 'sandbox' | 'production';
      createdAt: Date;
      tokenHint: string;
    }>
  > {
    const devices = await this.model.findAll({
      order: [
        ['createdAt', 'DESC'],
        ['uuid', 'ASC'],
      ],
    });
    if (devices.length === 0) return [];
    const owners = await User.findAll({
      where: { uuid: { [Op.in]: [...new Set(devices.map((device) => device.ownerUuid))] } },
      attributes: ['uuid', 'username'],
    });
    const usernames = new Map(owners.map((owner) => [owner.uuid, owner.username]));
    return devices.map((device) => ({
      uuid: device.uuid,
      ownerUsername: usernames.get(device.ownerUuid) ?? 'Unknown user',
      deviceName: device.deviceName,
      environment: device.environment,
      createdAt: device.createdAt,
      tokenHint: `…${device.token.slice(-6)}`,
    }));
  }

  async unregister(ownerUuid: string, token: string): Promise<void> {
    await this.model.destroy({ where: { ownerUuid, token } });
  }

  async deleteToken(token: string): Promise<void> {
    await this.model.destroy({ where: { token: { [Op.eq]: token } } });
  }
}
