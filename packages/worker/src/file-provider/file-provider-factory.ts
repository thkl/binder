import { Op } from 'sequelize';
import { readFileSync } from 'node:fs';
import { ApplicationSetting } from '../models.js';
import { decryptSettingSecret } from '../config.js';
import { DropboxFileProvider } from './dropbox-file-provider.js';
import { FileProvider } from './file-provider.js';

export class FileProviderFactory {
  async create(): Promise<FileProvider | null> {
    const settings = await ApplicationSetting.findAll({
      where: { key: { [Op.in]: ['backup.provider', 'backup.dropbox.refreshToken'] } },
    });
    const values = new Map(
      settings.map((setting) => [
        setting.key,
        setting.isEncrypted && setting.valueIv
          ? decryptSettingSecret(setting.value, setting.valueIv)
          : setting.value,
      ]),
    );
    if (values.get('backup.provider') !== 'dropbox') return null;

    const refreshToken = values.get('backup.dropbox.refreshToken');
    const appKey = this.credential('DROPBOX_APP_KEY');
    const appSecret = this.credential('DROPBOX_APP_SECRET');
    if (!refreshToken || !appKey || !appSecret) {
      throw new Error('Dropbox is connected but its OAuth configuration is incomplete');
    }
    return new DropboxFileProvider(refreshToken, appKey, appSecret);
  }

  private credential(name: 'DROPBOX_APP_KEY' | 'DROPBOX_APP_SECRET'): string | undefined {
    const value = process.env[name]?.trim();
    if (value) return value;
    const file = process.env[`${name}_FILE`]?.trim();
    if (!file) return undefined;
    try {
      const secret = readFileSync(file, 'utf8').trim();
      return secret || undefined;
    } catch (error) {
      throw new Error(
        `Unable to read ${name}_FILE: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
