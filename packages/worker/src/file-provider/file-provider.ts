/** A remote file's path and modification time returned by a backup provider. */
export interface FileProviderEntry {
  path: string;
  modifiedAt: Date;
}

/** Defines the remote file operations required by backup and restore workflows. */
export abstract class FileProvider {
  /**
   * Uploads a local file to the provider's remote path.
   *
   * @param {string} localPath - Local filesystem path used for the file operation.
   * @param {string} remotePath - Path of the file in remote storage.
   * @returns {Promise<void>} - Resolves when the operation completes.
   */
  abstract storeFile(localPath: string, remotePath: string): Promise<void>;
  /**
   * Downloads a remote file into a local path.
   *
   * @param {string} remotePath - Path of the file in remote storage.
   * @param {string} localPath - Local filesystem path used for the file operation.
   * @returns {Promise<void>} - Resolves when the operation completes.
   */
  abstract readFile(remotePath: string, localPath: string): Promise<void>;
  /**
   * Deletes a remote file when it exists.
   *
   * @param {string} remotePath - Path of the file in remote storage.
   * @returns {Promise<void>} - Resolves when the operation completes.
   */
  abstract deleteFile(remotePath: string): Promise<void>;
  /**
   * Lists files directly contained in a remote folder.
   *
   * @param {string} remoteFolder - Remote folder path to list or use as the backup destination.
   * @returns {Promise<FileProviderEntry[]>} - Lists files directly contained in a remote folder.
   */
  abstract listFiles(remoteFolder: string): Promise<FileProviderEntry[]>;
}
