import { Module } from '@nestjs/common';
import { IssuerStoreModule } from './issuer.store.module';
import { IssuerService } from './service/issuer.service';

@Module({
  imports: [IssuerStoreModule],
  providers: [IssuerService],
  exports: [IssuerService, IssuerStoreModule]
})
export class IssuerServiceModule {}
