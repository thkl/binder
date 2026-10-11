import { Op } from 'sequelize';
import { secrets } from '@binder/common/secrets';
import { ApplicationSetting } from '../models.js';
import { decryptSettingSecret } from '../config.js';
import { DropboxFileProvider } from './dropbox-file-provider.js';
import { FileProvider } from './file-provider.js';

export class FileProviderFactory {
  /**
   * Creates the configured backup provider, or returns `null` when remote backup is disabled.
   *
   * @returns {Promise<FileProvider | null>} - Creates the configured backup provider, or returns `null` when remote backup is disabled.
   */
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
    const refreshToken = values.get('backup.dropbox.refreshToken');
    const provider = values.get('backup.provider');
    if (provider !== 'dropbox' && !refreshToken) return null;
    const appKey = secrets.get('DROPBOX_APP_KEY');
    const appSecret = secrets.get('DROPBOX_APP_SECRET');
    if (!refreshToken || !appKey || !appSecret) {
      throw new Error('Dropbox is connected but its OAuth configuration is incomplete');
    }
    return new DropboxFileProvider(refreshToken, appKey, appSecret);
  }

  /**
   * Creates a temporary provider for a supplied token without loading persisted backup settings.
   *
   * @param {string} accessToken - OAuth access token for the remote provider.
   * @returns {FileProvider} - Creates a temporary provider for a supplied token without loading persisted backup settings.
   */
  createWithAccessToken(accessToken: string): FileProvider {
    if (!accessToken.trim()) throw new Error('Dropbox access token is empty');
    return new DropboxFileProvider(null, null, null, accessToken.trim());
  }
}
