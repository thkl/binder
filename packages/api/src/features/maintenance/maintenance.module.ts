import { Module } from '@nestjs/common';
import { AuthenticationServiceModule } from '../authentication/authentication.service.module';
import { MaintenanceController } from './controller/maintenance.controller';
import { MaintenanceService } from './service/maintenance.service';
import { MaintenanceRunStore } from './store/maintenance-run.store';
import { MaintenanceRequestStore } from './store/maintenance-request.store';
import { SharedModule } from '../../shared/shared.service.module';

@Module({
  imports: [AuthenticationServiceModule, SharedModule],
  controllers: [MaintenanceController],
  providers: [MaintenanceService, MaintenanceRunStore, MaintenanceRequestStore],
})
export class MaintenanceModule {}
