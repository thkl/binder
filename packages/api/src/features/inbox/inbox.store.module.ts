import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { InboxItemStore } from './store/inbox-item.store';

@Module({
  imports: [DatabaseModule],
  providers: [InboxItemStore],
  exports: [InboxItemStore],
})
export class InboxStoreModule {}
