import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { SetupController } from './controller/setup.controller';
import { SetupService } from './service/setup.service';
import { SetupStateStore } from './store/setup-state.store';
import { SharedModule } from '../../shared/shared.service.module';
import { AuthenticationServiceModule } from '../authentication/authentication.service.module';
import { PipelineStoreModule } from '../pipeline/pipeline.store.module';
import { MaintenanceModule } from '../maintenance/maintenance.module';

@Module({
  imports: [
    DatabaseModule,
    SharedModule,
    AuthenticationServiceModule,
    PipelineStoreModule,
    MaintenanceModule,
  ],
  controllers: [SetupController],
  providers: [SetupService, SetupStateStore],
})
export class SetupModule {}
