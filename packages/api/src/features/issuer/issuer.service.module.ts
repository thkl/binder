import { Module } from '@nestjs/common';
import { IssuerStoreModule } from './issuer.store.module';
import { IssuerService } from './service/issuer.service';
import { FolderStoreModule } from '../folder/folder.store.module';

@Module({
  imports: [IssuerStoreModule, FolderStoreModule],
  providers: [IssuerService],
  exports: [IssuerService, IssuerStoreModule],
})
export class IssuerServiceModule {}
