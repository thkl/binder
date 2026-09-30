import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { SetupController } from './controller/setup.controller';
import { SetupService } from './service/setup.service';
import { SetupStateStore } from './store/setup-state.store';

@Module({
  imports: [DatabaseModule],
  controllers: [SetupController],
  providers: [SetupService, SetupStateStore]
})
export class SetupModule {}
