import { Injectable } from '@nestjs/common';
import { Op } from 'sequelize';
import { PipelineWorkerHeartbeat } from '../models/pipeline-worker-heartbeat.entity';

@Injectable()
export class PipelineWorkerHeartbeatStore {
  async findRecent(maxAgeMs: number): Promise<PipelineWorkerHeartbeat[]> {
    return PipelineWorkerHeartbeat.findAll({
      where: { lastSeenAt: { [Op.gte]: new Date(Date.now() - maxAgeMs) } },
      order: [['lastSeenAt', 'DESC']],
    });
  }
}
