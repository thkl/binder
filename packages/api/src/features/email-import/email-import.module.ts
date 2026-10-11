import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { SharedModule } from '../../shared/shared.service.module';
import { AuthenticationServiceModule } from '../authentication/authentication.service.module';
import { EmailImportConfig } from './models/email-import-config.entity';
import { EmailImportApprovedServer } from './models/email-import-approved-server.entity';
import { EmailImportController } from './controller/email-import.controller';
import { EmailImportConfigService } from './service/email-import-config.service';
import { EmailImportApprovedServerStore } from './store/email-import-approved-server.store';

@Module({
  imports: [
    SharedModule,
    AuthenticationServiceModule,
    SequelizeModule.forFeature([EmailImportConfig, EmailImportApprovedServer]),
  ],
  controllers: [EmailImportController],
  providers: [EmailImportConfigService, EmailImportApprovedServerStore],
  exports: [EmailImportConfigService],
})
export class EmailImportModule {}
