import { Module } from '@nestjs/common';
import { PipelineServiceModule } from './pipeline.service.module';

@Module({
  imports: [PipelineServiceModule],
})
export class PipelineModule {}
