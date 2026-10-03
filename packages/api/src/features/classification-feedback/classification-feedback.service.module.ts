import { Module } from '@nestjs/common';
import { DocumentAuditServiceModule } from '../document/document-audit.service.module';
import { DocumentStoreModule } from '../document/document.store.module';
import { ClassificationFeedbackStoreModule } from './classification-feedback.store.module';
import { ClassificationFeedbackService } from './service/classification-feedback.service';

@Module({
  imports: [ClassificationFeedbackStoreModule, DocumentStoreModule, DocumentAuditServiceModule],
  providers: [ClassificationFeedbackService],
  exports: [ClassificationFeedbackService],
})
export class ClassificationFeedbackServiceModule {}
