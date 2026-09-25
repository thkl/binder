import { Module } from '@nestjs/common';
import { LoggingService } from './service/logging.service';
import { ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core/constants.js';
import { CustomThrottlerGuard } from './guards/custom-throttler.guard';

@Module({
    imports: [
        ThrottlerModule.forRoot({
            throttlers: [
                {
                    ttl: 60000,
                    limit: 10,
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
    ],
    exports: [LoggingService]
})
export class SharedModule { }
