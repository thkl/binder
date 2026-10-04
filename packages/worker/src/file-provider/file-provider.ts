export abstract class FileProvider {
  abstract storeFile(localPath: string, remotePath: string): Promise<void>;
  abstract readFile(remotePath: string, localPath: string): Promise<void>;
  abstract deleteFile(remotePath: string): Promise<void>;
}
