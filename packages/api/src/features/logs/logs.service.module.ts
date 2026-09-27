import { Module } from '@nestjs/common';
import { SharedModule } from '../../shared/shared.service.module';
import { LogsService } from './service/logs.service';

@Module({
  imports: [SharedModule],
  providers: [LogsService],
  exports: [LogsService]
})
export class LogsServiceModule {}
