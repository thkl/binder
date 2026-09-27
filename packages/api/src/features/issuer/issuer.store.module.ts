import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { IssuerStore } from './store/issuer.store';

@Module({
  imports: [DatabaseModule],
  providers: [IssuerStore],
  exports: [IssuerStore]
})
export class IssuerStoreModule {}
