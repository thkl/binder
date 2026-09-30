import { Module } from '@nestjs/common';
import { LoggingService } from './service/logging.service';
import { ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core/constants.js';
import { CustomThrottlerGuard } from './guards/custom-throttler.guard';
import { CsrfGuard } from './guards/csrf.guard';
import { EncryptionService } from './util/encryption.service';
import { ApplicationSettingsService } from '../features/settings/service/application-settings.service';
import { ApplicationSettingStore } from '../features/settings/store/application-setting.store';

@Module({
    imports: [
        ThrottlerModule.forRoot({
            throttlers: [
                {
                    ttl: 60000,
                    limit: 60,
                },
            ],
        }),
    ],
    controllers: [],
    providers: [
        LoggingService,
        {
            provide: APP_GUARD,
            useClass: CustomThrottlerGuard,
        },
        {
            provide: APP_GUARD,
            useClass: CsrfGuard,
        },
        EncryptionService,
        ApplicationSettingStore,
        ApplicationSettingsService
    ],
    exports: [LoggingService, EncryptionService, ApplicationSettingsService]
})
export class SharedModule { }
