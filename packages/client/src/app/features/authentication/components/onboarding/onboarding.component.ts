import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { AuthService } from '../../services/auth.service';
import { SetupService, SetupValidationStep } from '../../services/setup.service';
import { I18nService, TranslatePipe } from '../../../../common/i18n/i18n.service';
import { AiProviderManagerComponent } from '../../../settings/components/ai-provider-manager/ai-provider-manager.component';
import { SettingsService } from '../../../settings/services/settings.service';
import type {
  ApplicationSettingsResponse,
  SetApplicationSettingInput,
  SetupCheck,
} from '@binder/common';

type OnboardingStep =
  'admin' | 'storage' | 'processing' | 'ai' | 'oidc' | 'recovery' | 'restore' | 'backup' | 'review';

const STEP_ORDER: OnboardingStep[] = [
  'admin',
  'storage',
  'processing',
  'ai',
  'oidc',
  'recovery',
  'restore',
  'backup',
  'review',
];

const STORAGE_SETTINGS = [
  'documents.storageRoot',
  'inbox.enabled',
  'inbox.path',
  'inbox.importOwnerUuid',
];

const PROCESSING_SETTINGS = [
  'pipeline.ocrLanguages',
  'pipeline.pollIntervalMs',
  'pipeline.lockTimeoutMs',
  'pipeline.reconcileIntervalMs',
  'security.malwareScan.required',
  'security.malwareScan.command',
  'security.malwareScan.timeoutMs',
];

const OIDC_SETTINGS = [
  'oidc.ISSUER_URL',
  'oidc.CLIENT_ID',
  'oidc.CLIENT_SECRET',
  'oidc.email_verified',
  'oidc.ACR_VALUES',
];

const BACKUP_SETTINGS = [
  'backup.root',
  'backup.enabled',
  'backup.schedule',
  'backup.retentionDays',
  'maintenance.timezone',
];

@Component({
  selector: 'binder-onboarding',
  standalone: true,
  imports: [DatePipe, TranslatePipe, AiProviderManagerComponent],
  templateUrl: './onboarding.component.html',
  styleUrl: './onboarding.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OnboardingComponent {
  readonly setupSecret = signal('');
  readonly username = signal('admin');
  readonly password = signal('');
  readonly confirmation = signal('');
  readonly validationError = signal<string | null>(null);
  readonly step = signal<OnboardingStep>('admin');
  readonly values = signal<Record<string, string | boolean>>({});
  readonly settingsLoaded = signal(false);
  readonly oidcSecretPreserved = signal(false);
  readonly oidcSkipped = signal(false);
  readonly stepError = signal<string | null>(null);
  readonly recoveryAccessToken = signal('');
  readonly recoveryFolder = signal('/');
  readonly recoveryMode = signal(false);
  readonly selectedRecoveryBackup = signal<string | null>(null);
  readonly recoveryPassword = signal('');
  readonly recoveryConfirmation = signal('');
  readonly recoveryQueued = signal(false);

  readonly stepNumber = computed(() => STEP_ORDER.indexOf(this.step()) + 1);
  readonly canGoBack = computed(() => this.stepNumber() > 2);

  readonly auth = inject(AuthService);
  readonly setup = inject(SetupService);
  readonly settings = inject(SettingsService);
  private readonly i18n = inject(I18nService);

  constructor() {
    if (this.auth.user()) {
      void this.prepareWorkspaceSteps();
    } else if (window.location.search.includes('dropbox=connected')) {
      this.recoveryMode.set(true);
      this.settingsLoaded.set(true);
      window.history.replaceState({}, '', window.location.pathname);
      void this.prepareRecoveryStep(true);
    }
  }

  async submit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    this.validationError.set(null);

    if (this.password() !== this.confirmation()) {
      this.validationError.set(this.i18n.t('setup.mismatch'));
      return;
    }

    if (await this.auth.createAdministrator(this.setupSecret(), this.username(), this.password())) {
      this.setupSecret.set('');
      this.password.set('');
      this.confirmation.set('');
      await this.prepareWorkspaceSteps();
    }
  }

  async continueStorage(): Promise<void> {
    if (!(await this.saveSettings(STORAGE_SETTINGS))) return;
    const validation = await this.validate('storage');
    if (validation?.valid) {
      this.goTo('processing');
    }
  }

  async continueProcessing(): Promise<void> {
    if (!(await this.saveSettings(PROCESSING_SETTINGS))) return;
    const validation = await this.validate('processing');
    if (validation?.valid) {
      this.goTo('ai');
    }
  }

  continueAi(): void {
    this.goTo('oidc');
  }

  async continueOidc(): Promise<void> {
    if (!(await this.saveSettings(OIDC_SETTINGS))) return;
    this.oidcSkipped.set(false);
    const validation = await this.validate('oidc');
    if (validation?.valid || validation?.checks.every((check) => check.status === 'warning')) {
      await this.prepareRecoveryStep(false);
    }
  }

  skipOidc(): void {
    this.oidcSkipped.set(true);
    void this.prepareRecoveryStep(false);
  }

  async continueRecovery(): Promise<void> {
    await this.setup.loadRecoveryBackups(
      this.recoveryAccessToken(),
      this.recoveryMode(),
      this.recoveryFolder(),
    );
    if (!this.selectedRecoveryBackup()) {
      this.stepError.set(this.i18n.t('setup.recoverySelectRequired'));
      return;
    }
    this.goTo('restore');
  }

  selectRecoveryBackup(filename: string): void {
    this.selectedRecoveryBackup.set(filename);
    this.stepError.set(null);
  }

  async submitRecoveryRestore(): Promise<void> {
    this.stepError.set(null);
    if (this.recoveryPassword() !== this.recoveryConfirmation()) {
      this.stepError.set(this.i18n.t('setup.recoveryPasswordMismatch'));
      return;
    }
    const filename = this.selectedRecoveryBackup();
    if (!filename) return;
    const requestUuid = await this.setup.requestRecoveryRestore(
      {
        filename,
        accessToken: this.recoveryAccessToken() || undefined,
        remoteFolder: this.recoveryFolder(),
        backupPassword: this.recoveryPassword(),
        backupPasswordConfirmation: this.recoveryConfirmation(),
      },
      this.recoveryMode(),
    );
    if (requestUuid) {
      this.recoveryPassword.set('');
      this.recoveryConfirmation.set('');
      this.recoveryQueued.set(true);
    }
  }

  async refreshRecoveryBackups(): Promise<void> {
    await this.setup.loadRecoveryBackups(
      this.recoveryAccessToken(),
      this.recoveryMode(),
      this.recoveryFolder(),
    );
  }

  connectDropbox(): void {
    const endpoint = this.recoveryMode()
      ? '/api/v1/setup/recovery/public/dropbox/connect'
      : '/api/v1/maintenance/dropbox/connect?returnTo=/';
    window.location.assign(endpoint);
  }

  startRecovery(): void {
    this.recoveryMode.set(true);
    this.settingsLoaded.set(true);
    void this.prepareRecoveryStep(true);
  }

  async continueBackup(): Promise<void> {
    if (!(await this.saveSettings(BACKUP_SETTINGS))) return;
    const validation = await this.validate('backup');
    if (validation?.valid) {
      this.goTo('review');
    }
  }

  async completeOnboarding(): Promise<void> {
    const result = await this.setup.complete();
    if (result) {
      this.auth.finishOnboarding();
    }
  }

  goBack(): void {
    const index = Math.max(1, STEP_ORDER.indexOf(this.step()) - 1);
    this.step.set(STEP_ORDER[index]);
    this.stepError.set(null);
  }

  async rerun(step: SetupValidationStep): Promise<void> {
    await this.validate(step);
  }

  validation(step: SetupValidationStep) {
    return this.setup.validation(step);
  }

  hasErrors(step: SetupValidationStep): boolean {
    return this.validation(step)?.checks.some((check) => check.status === 'error') ?? false;
  }

  checkMessage(check: SetupCheck): string {
    const key = `setup.check.${check.key}`;
    const statusKey = `${key}.${check.status}`;
    const statusTranslation = this.i18n.t(statusKey);
    if (statusTranslation !== statusKey) return statusTranslation;

    const translated = this.i18n.t(key);
    return check.status === 'ok' && translated !== key ? translated : check.message;
  }

  value(key: string): string {
    const value = this.values()[key];
    return typeof value === 'string' ? value : String(value ?? '');
  }

  booleanValue(key: string): boolean {
    const value = this.values()[key];
    return value === true || value === 'true';
  }

  secretValue(): string {
    return this.oidcSecretPreserved() ? '' : this.value('oidc.CLIENT_SECRET');
  }

  setText(key: string, event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.values.update((current) => ({ ...current, [key]: value }));
    if (key === 'oidc.CLIENT_SECRET') this.oidcSecretPreserved.set(false);
  }

  setCheckbox(key: string, event: Event): void {
    const value = (event.target as HTMLInputElement).checked;
    this.values.update((current) => ({ ...current, [key]: value }));
  }

  inputValue(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  private async prepareWorkspaceSteps(): Promise<void> {
    this.stepError.set(null);
    const response = await this.settings.load();
    if (!response) {
      this.stepError.set(this.settings.error() ?? this.i18n.t('setup.settingsError'));
      return;
    }

    const values = this.createInitialValues(response);
    const ownerUuid = this.auth.user()?.uuid;
    if (ownerUuid && !values['inbox.importOwnerUuid']) {
      values['inbox.importOwnerUuid'] = ownerUuid;
    }
    this.values.set(values);
    this.oidcSecretPreserved.set(values['oidc.CLIENT_SECRET'] === '****');
    this.settingsLoaded.set(true);
    this.goTo('storage');
    await this.validate('storage');
  }

  private async prepareRecoveryStep(publicRecovery = false): Promise<void> {
    this.goTo('recovery');
    await this.setup.loadRecoveryBackups(undefined, publicRecovery, this.recoveryFolder());
  }

  private async validate(step: SetupValidationStep) {
    this.stepError.set(null);
    const validation = await this.setup.validate(step);
    if (!validation) {
      this.stepError.set(this.setup.error() ?? this.i18n.t('setup.validationError'));
    }
    return validation;
  }

  private async saveSettings(keys: string[]): Promise<boolean> {
    const response = this.settings.settings();
    if (!response) {
      this.stepError.set(this.i18n.t('setup.settingsError'));
      return false;
    }

    const input = keys
      .map((key): SetApplicationSettingInput | null => {
        const item = response.template.items.find((candidate) => candidate.key === key);
        if (!item) return null;

        let value = this.value(key);
        if (key === 'oidc.CLIENT_SECRET' && this.oidcSecretPreserved()) {
          value = '****';
        }
        if (item.type === 'checkbox') value = this.booleanValue(key) ? 'true' : 'false';

        return {
          key,
          value,
          isEncrypted: item.encrypted,
          description:
            response.data.find((setting) => setting.key === key)?.description ?? undefined,
        };
      })
      .filter((setting): setting is SetApplicationSettingInput => setting !== null);

    if (!(await this.settings.saveAll(input))) {
      this.stepError.set(this.settings.error() ?? this.i18n.t('setup.settingsError'));
      return false;
    }

    this.values.set(this.createInitialValues(this.settings.settings() ?? response));
    this.oidcSecretPreserved.set(this.value('oidc.CLIENT_SECRET') === '****');
    return true;
  }

  private createInitialValues(
    response: ApplicationSettingsResponse,
  ): Record<string, string | boolean> {
    const stored = new Map(response.data.map((setting) => [setting.key, setting.value]));
    return Object.fromEntries(
      response.template.items.map((item) => {
        const storedValue = stored.get(item.key);
        if (item.type === 'checkbox') {
          return [
            item.key,
            storedValue === undefined ? item.default === true : storedValue === 'true',
          ];
        }
        return [item.key, storedValue ?? String(item.default ?? '')];
      }),
    );
  }

  private goTo(step: OnboardingStep): void {
    this.stepError.set(null);
    this.step.set(step);
  }
}
