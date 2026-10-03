import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { DocumentClassificationFeedbackStore } from './store/document-classification-feedback.store';

@Module({
  imports: [DatabaseModule],
  providers: [DocumentClassificationFeedbackStore],
  exports: [DocumentClassificationFeedbackStore],
})
export class ClassificationFeedbackStoreModule {}
