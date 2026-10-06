import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { SharedModule } from '../../shared/shared.service.module';
import { AuthenticationServiceModule } from '../authentication/authentication.service.module';
import { EmailImportConfig } from './models/email-import-config.entity';
import { EmailImportController } from './controller/email-import.controller';
import { EmailImportConfigService } from './service/email-import-config.service';

@Module({
  imports: [
    SharedModule,
    AuthenticationServiceModule,
    SequelizeModule.forFeature([EmailImportConfig]),
  ],
  controllers: [EmailImportController],
  providers: [EmailImportConfigService],
  exports: [EmailImportConfigService],
})
export class EmailImportModule {}
