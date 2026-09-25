import { Injectable } from '@nestjs/common';
import { ApplicationSetting } from '../models/settings.model';
import { NamedQueryAddingOptions } from '../../../shared/datastore/query-options.type';
import { BaseCrudStore } from '../../../shared/datastore/base-crud.store';

/**
 * Find all encrypted settings
 * Useful for re-encryption operations if encryption key changes
 */
const findEncrypted: NamedQueryAddingOptions<ApplicationSetting> = {
  name: 'findEncrypted',
  findOptions: {
    where: { isEncrypted: true },
    order: [['key', 'ASC']],
  },
};

/**
 * Find all plain text settings
 * Useful for exports or backups
 */
const findPlainText: NamedQueryAddingOptions<ApplicationSetting> = {
  name: 'findPlainText',
  findOptions: {
    where: { isEncrypted: false },
    order: [['key', 'ASC']],
  },
};

/**
 * Application Setting Store
 * Data access layer for ApplicationSetting model
 * Provides CRUD operations for global application configuration
 *
 * Settings are global (not per-user or per-project).
 * Primary key is the setting key (string).
 *
 * Named Queries:
 * - findEncrypted: Find all encrypted settings
 * - findPlainText: Find all plain text settings
 */
@Injectable()
export class ApplicationSettingStore extends BaseCrudStore<ApplicationSetting> {
  constructor() {
    super(ApplicationSetting);
    this.registerIdField('key'); // Primary key is 'key', not 'id'
  }

  protected registerNamedQueries(): void {
    this.addNamedQueryWithOptions(findEncrypted);
    this.addNamedQueryWithOptions(findPlainText);
  }

  /**
   * Get all encrypted settings
   * @returns All encrypted settings
   */
  async findEncrypted(): Promise<ApplicationSetting[]> {
    return this.findAllNamed('findEncrypted');
  }

  /**
   * Get all plain text settings
   * @returns All plain text settings
   */
  async findPlainText(): Promise<ApplicationSetting[]> {
    return this.findAllNamed('findPlainText');
  }

  /**
   * Create or update a setting
   * Uses upsert to avoid duplicate key errors
   * @param key - Setting key
   * @param value - Setting value
   * @param isEncrypted - Whether the value is encrypted
   * @param valueIv - IV for encrypted values
   * @param description - Human-readable description
   * @returns Created or updated setting
   */
  async createOrUpdate(
    key: string,
    value: string,
    isEncrypted: boolean = false,
    valueIv?: string,
    description?: string,
  ): Promise<ApplicationSetting> {
    const [setting] = await ApplicationSetting.upsert({
      key,
      value,
      isEncrypted,
      valueIv,
      description,
    });
    return setting;
  }

  /**
   * Delete a setting by key
   * @param key - Setting key
   * @returns Number of deleted rows (0 or 1)
   */
  async deleteByKey(key: string): Promise<number> {
    return ApplicationSetting.destroy({ where: { key } });
  }

  /**
   * Check if a setting exists
   * @param key - Setting key
   * @returns True if setting exists
   */
  async exists(key: string): Promise<boolean> {
    const count = await ApplicationSetting.count({ where: { key } });
    return count > 0;
  }
}
