import { Module } from '@nestjs/common';
import { AuthenticationServiceModule } from '../authentication/authentication.service.module';
import { MaintenanceController } from './controller/maintenance.controller';
import { MaintenanceService } from './service/maintenance.service';
import { MaintenanceRunStore } from './store/maintenance-run.store';

@Module({
  imports: [AuthenticationServiceModule],
  controllers: [MaintenanceController],
  providers: [MaintenanceService, MaintenanceRunStore]
})
export class MaintenanceModule {}
