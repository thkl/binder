import { Op } from 'sequelize';
import { secrets } from '@binder/common/secrets';
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
    const appKey = secrets.get('DROPBOX_APP_KEY');
    const appSecret = secrets.get('DROPBOX_APP_SECRET');
    if (!refreshToken || !appKey || !appSecret) {
      throw new Error('Dropbox is connected but its OAuth configuration is incomplete');
    }
    return new DropboxFileProvider(refreshToken, appKey, appSecret);
  }

}
