import { Module } from '@nestjs/common';
import { MetadataStoreModule } from './metadata.store.module';
import { MetadataService } from './service/metadata.service';

@Module({
  imports: [MetadataStoreModule],
  providers: [MetadataService],
  exports: [MetadataService]
})
export class MetadataServiceModule {}
