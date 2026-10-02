import { Module } from '@nestjs/common';
import { AuthenticationServiceModule } from '../authentication/authentication.service.module';
import { PipelineController } from './controller/pipeline.controller';
import { PipelineServiceModule } from './pipeline.service.module';

@Module({
  imports: [PipelineServiceModule, AuthenticationServiceModule],
  controllers: [PipelineController],
})
export class PipelineModule {}
