import { Module } from '@nestjs/common';
import { AuthenticationServiceModule } from '../authentication/authentication.service.module';
import { ClassificationFeedbackController } from './controller/classification-feedback.controller';
import { ClassificationFeedbackServiceModule } from './classification-feedback.service.module';

@Module({
  imports: [ClassificationFeedbackServiceModule, AuthenticationServiceModule],
  controllers: [ClassificationFeedbackController],
})
export class ClassificationFeedbackModule {}
