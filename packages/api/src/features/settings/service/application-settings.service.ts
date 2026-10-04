import { Injectable } from '@nestjs/common';
import { BinderLogger } from '../../../shared/service/logger.helper';
import { ApplicationSettingStore } from '../store/application-setting.store';
import { EncryptionService } from '../../../shared/util/encryption.service';
import { ApplicationSettingExported, ApplicationSettingsData } from '../models/settings';
import { settingsMap, settingsSections } from '../models/constants';

const SECRET_STRIPPED_VALUE = '****';

@Injectable()
export class ApplicationSettingsService {
  private readonly logger = new BinderLogger(ApplicationSettingsService.name);

  constructor(
    private readonly appSettingsStore: ApplicationSettingStore,
    private readonly encryptionService: EncryptionService,
  ) {
    this.logger.debug('ApplicationSettingsService initialized');
  }

  /**
   * Get a setting value
   * Returns the database value, or the supplied default when not configured.
   *
   * @param key - Setting key (e.g., 'mail.host')
   * @param defaultValue - Default value if not found in DB or env
   * @returns Setting value (decrypted if encrypted)
   */
  async get(key: string, defaultValue?: string): Promise<string | undefined> {
    try {
      const setting = await this.appSettingsStore.findById(key);

      if (setting) {
        // Decrypt if encrypted
        if (setting.isEncrypted && setting.valueIv) {
          return this.encryptionService.decrypt(setting.value, setting.valueIv);
        }
        return setting.value;
      }

      return defaultValue;
    } catch (error) {
      this.logger.error(`Failed to get setting '${key}': ${(error as Error).message}`);
      throw error;
    }
  }

  /**
   * Set a setting value
   * Automatically encrypts if isEncrypted is true
   *
   * @param key - Setting key
   * @param value - Setting value (will be encrypted if isEncrypted is true)
   * @param isEncrypted - Whether to encrypt the value
   * @param description - Human-readable description
   */
  async set(
    key: string,
    value: string,
    isEncrypted: boolean = false,
    description?: string,
  ): Promise<void> {
    try {
      // A connected external provider is authoritative. The generic settings
      // form submits all fields and may otherwise send a stale `none` value
      // after OAuth has connected Dropbox. Disconnecting removes the refresh
      // token first, so selecting `none` still works through the disconnect UI.
      if (key === 'backup.provider' && value === 'none') {
        const dropboxConnection = await this.appSettingsStore.findById(
          'backup.dropbox.refreshToken',
        );
        if (dropboxConnection) value = 'dropbox';
      }
      if (isEncrypted) {
        if (value !== SECRET_STRIPPED_VALUE) {
          // Do not change Values that are ****
          // Encrypt the value
          const { encrypted, iv } = this.encryptionService.encrypt(value);
          await this.appSettingsStore.createOrUpdate(key, encrypted, true, iv, description);
        }
      } else {
        // Store as plain text
        await this.appSettingsStore.createOrUpdate(key, value, false, undefined, description);
      }

      this.logger.log(`Setting '${key}' updated successfully`);
    } catch (error) {
      this.logger.error(`Failed to set setting '${key}': ${(error as Error).message}`);
      throw error;
    }
  }

  /**
   * Delete a setting
   *
   * @param key - Setting key
   * @returns Number of deleted settings (0 or 1)
   */
  async delete(key: string): Promise<number> {
    try {
      const deleted = await this.appSettingsStore.deleteByKey(key);
      this.logger.log(`Setting '${key}' deleted`);
      return deleted;
    } catch (error) {
      this.logger.error(`Failed to delete setting '${key}': ${(error as Error).message}`);
      throw error;
    }
  }

  /**
   * Get all settings (decrypted)
   * Only includes values, not encryption metadata
   *
   * @returns Array of ApplicationSettingExported
   */
  async getAll(): Promise<ApplicationSettingExported> {
    try {
      const settingData = await this.appSettingsStore.findAll();
      const result: ApplicationSettingsData[] = [];

      for (const setting of settingData) {
        const st: ApplicationSettingsData = {
          key: setting.key,
          isEncrypted: setting.isEncrypted,
          description: setting.description,
          // Encrypted values are intentionally never decrypted for the settings
          // overview. The client only needs the masked value and this also
          // keeps stale legacy ciphertext from breaking settings reads.
          value: setting.isEncrypted ? SECRET_STRIPPED_VALUE : setting.value,
        };
        result.push(st);
      }

      const settings: ApplicationSettingExported = {
        template: {
          sections: settingsSections,
          items: settingsMap,
        },
        data: result,
      };

      return settings;
    } catch (error) {
      this.logger.error(`Failed to get all settings: ${(error as Error).message}`);
      throw error;
    }
  }
}
