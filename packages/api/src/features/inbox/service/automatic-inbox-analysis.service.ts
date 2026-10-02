import { Injectable, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { BinderLogger } from '../../../shared/service/logger.helper';
import { ApplicationSettingsService } from '../../settings/service/application-settings.service';
import { InboxService } from './inbox.service';

@Injectable()
export class AutomaticInboxAnalysisService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new BinderLogger(AutomaticInboxAnalysisService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly settings: ApplicationSettingsService,
    private readonly inbox: InboxService,
  ) {}

  onApplicationBootstrap(): void {
    this.startMonitor();
  }

  @OnEvent('database.connected')
  onDatabaseConnected(): void {
    this.startMonitor();
  }

  private startMonitor(): void {
    if (this.timer) return;

    this.logger.info('Automatic inbox AI analysis monitor started');
    this.timer = setInterval(() => void this.runIfEnabled(), 5_000);
    void this.runIfEnabled();
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async runIfEnabled(): Promise<void> {
    if (this.running) return;

    this.running = true;
    try {
      const enabled =
        (await this.settings.get('ai.automaticAnalysis.enabled', 'false'))?.toLowerCase() ===
        'true';
      if (!enabled) return;

      const result = await this.inbox.processAllWithAi();
      if (result.processed > 0 || result.failed > 0) {
        this.logger.info('Automatic inbox AI analysis completed', {
          processed: result.processed,
          failed: result.failed,
          skipped: result.skipped,
        });
      }
    } catch (error) {
      this.logger.warn(
        `Automatic inbox AI analysis failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      this.running = false;
    }
  }
}
