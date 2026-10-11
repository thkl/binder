import { Injectable } from '@nestjs/common';
import { EmailImportApprovedServer } from '../models/email-import-approved-server.entity';

@Injectable()
export class EmailImportApprovedServerStore {
  findAll(): Promise<EmailImportApprovedServer[]> {
    return EmailImportApprovedServer.findAll({ order: [['host', 'ASC'], ['port', 'ASC']] });
  }

  findByHostAndPort(host: string, port: number): Promise<EmailImportApprovedServer | null> {
    return EmailImportApprovedServer.findOne({ where: { host, port } });
  }

  async create(host: string, port: number, approvedBy: string): Promise<EmailImportApprovedServer> {
    const [server] = await EmailImportApprovedServer.findOrCreate({
      where: { host, port },
      defaults: { host, port, approvedBy },
    });
    return server;
  }

  delete(uuid: string): Promise<number> {
    return EmailImportApprovedServer.destroy({ where: { uuid } });
  }
}
