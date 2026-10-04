/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { BinderLogger } from '../service/logger.helper';
import { BinderConfig, ConfigKeys } from '../config/config.keys';
import { SecretsService } from '../config/secrets.service';

/**
 * Encryption Service
 *
 * Provides AES-256-GCM encryption/decryption for sensitive data storage.
 * Uses a master encryption key from environment variables (ENCRYPTION_KEY).
 *
 * Security Features:
 * - AES-256-GCM authenticated encryption
 * - Random 96-bit nonce per encryption operation
 * - 128-bit authentication tag stored with the ciphertext
 * - Master key validation at module initialization
 * - Constant-time operations to prevent timing attacks
 * - No logging of sensitive data (keys, decrypted values)
 *
 * Usage:
 * ```typescript
 * const { encrypted, iv } = this.encryptionService.encrypt('sensitive-data');
 * const plaintext = this.encryptionService.decrypt(encrypted, iv);
 * ```
 */
@Injectable()
export class EncryptionService implements OnModuleInit {
  private readonly logger = new BinderLogger(EncryptionService.name);
  private readonly ALGORITHM = 'aes-256-gcm';
  private readonly IV_LENGTH = 12; // 96 bits is the recommended GCM nonce size
  private readonly AUTH_TAG_LENGTH = 16; // 128-bit authentication tag
  private readonly KEY_LENGTH = 32; // 256 bits for AES-256
  private readonly ENCRYPTED_PREFIX = 'gcm:';
  private masterKey: Buffer = Buffer.from([]);

  constructor(
    private configService: ConfigService<BinderConfig>,
    private readonly secrets: SecretsService,
  ) {}

  /**
   * Initialize and validate master encryption key on module startup
   * Throws error if ENCRYPTION_KEY is missing or invalid
   */
  onModuleInit() {
    try {
      this.validateMasterKey();
      this.logger.log('Encryption service initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize encryption service: ' + (error as Error).message);
      throw error;
    }
  }

  /**
   * Validate and load master encryption key from environment
   *
   * @throws {Error} If ENCRYPTION_KEY is missing or invalid length
   */
  private validateMasterKey(): void {
    const encryptionKey = this.secrets.get(ConfigKeys.ENCRYPTION_KEY);

    if (!encryptionKey) {
      throw new Error(
        'ENCRYPTION_KEY environment variable is required but not set. ' +
          'Generate one with: openssl rand -base64 32',
      );
    }

    try {
      // Decode base64 key
      this.masterKey = Buffer.from(encryptionKey, 'base64');

      // Validate key length (must be 32 bytes for AES-256)
      if (this.masterKey.length !== this.KEY_LENGTH) {
        throw new Error(
          `ENCRYPTION_KEY must be exactly ${this.KEY_LENGTH} bytes when base64-decoded. ` +
            `Current length: ${this.masterKey.length} bytes. ` +
            'Generate a new key with: openssl rand -base64 32',
        );
      }
    } catch (error) {
      if ((error as Error).message.includes('ENCRYPTION_KEY must be')) {
        throw error;
      }
      throw new Error(
        'ENCRYPTION_KEY is not valid base64. ' + 'Generate a new key with: openssl rand -base64 32',
      );
    }
  }

  /**
   * Encrypt plaintext using AES-256-GCM
   *
   * Generates a random Initialization Vector (IV) for each encryption operation
   * to ensure different ciphertext even for identical plaintext.
   *
   * @param plaintext - The text to encrypt
   * @returns Object containing the versioned ciphertext envelope and nonce (hex)
   *
   * @example
   * const { encrypted, iv } = service.encrypt('my-secret-token');
   * // Store both 'encrypted' and 'iv' in database
   */
  encrypt(plaintext: string): { encrypted: string; iv: string } {
    try {
      // Generate random IV for this encryption
      const iv = randomBytes(this.IV_LENGTH);

      // Create cipher
      const cipher = createCipheriv(this.ALGORITHM, this.masterKey, iv);

      let encrypted = cipher.update(plaintext, 'utf8', 'base64');
      encrypted += cipher.final('base64');
      const authenticationTag = cipher.getAuthTag().toString('base64');

      return {
        encrypted: `${this.ENCRYPTED_PREFIX}${authenticationTag}:${encrypted}`,
        iv: iv.toString('hex'),
      };
    } catch (error) {
      this.logger.error('Encryption failed', (error as Error).stack);
      throw new Error('Failed to encrypt data');
    }
  }

  /**
   * Decrypt ciphertext using AES-256-GCM
   *
   * @param encrypted - Versioned GCM envelope containing tag and ciphertext
   * @param iv - Hex-encoded nonce used during encryption
   * @returns Decrypted plaintext
   * @throws {Error} If decryption fails (wrong key, corrupted data, invalid IV)
   *
   * @example
   * const plaintext = service.decrypt(stored.encrypted, stored.iv);
   */
  decrypt(encrypted: string, iv: string): string {
    try {
      // Validate IV format and length
      this.validateIV(iv);

      const ivBuffer = Buffer.from(iv, 'hex');
      const [prefix, authenticationTagBase64, ciphertext] = encrypted.split(':');
      if (prefix !== this.ENCRYPTED_PREFIX.slice(0, -1) || !authenticationTagBase64) {
        throw new Error('Encrypted value is not an AES-256-GCM envelope');
      }

      const authenticationTag = Buffer.from(authenticationTagBase64, 'base64');
      if (authenticationTag.length !== this.AUTH_TAG_LENGTH) {
        throw new Error('Invalid AES-GCM authentication tag');
      }

      const decipher = createDecipheriv(this.ALGORITHM, this.masterKey, ivBuffer);
      decipher.setAuthTag(authenticationTag);

      let decrypted = decipher.update(ciphertext ?? '', 'base64', 'utf8');
      decrypted += decipher.final('utf8');

      return decrypted;
    } catch (error) {
      this.logger.error('Decryption failed (corrupted data or wrong key)');
      throw new Error('Failed to decrypt data - data may be corrupted or encryption key changed');
    }
  }

  /**
   * Validate GCM nonce format and length
   *
   * @param iv - Hex-encoded IV string
   * @throws {Error} If IV is invalid
   */
  private validateIV(iv: string): void {
    // Check IV is provided
    if (!iv) {
      throw new Error('Initialization Vector (IV) is required for decryption');
    }

    // Check IV is valid hex string
    if (!/^[0-9a-fA-F]+$/.test(iv)) {
      throw new Error('IV must be a valid hexadecimal string');
    }

    // Check nonce length (24 hex chars = 12 bytes)
    const expectedHexLength = this.IV_LENGTH * 2;
    if (iv.length !== expectedHexLength) {
      throw new Error(
        `IV must be exactly ${expectedHexLength} hexadecimal characters (${this.IV_LENGTH} bytes). ` +
          `Current length: ${iv.length} characters`,
      );
    }
  }

  /**
   * Test encryption/decryption round-trip
   * Useful for health checks and validation
   *
   * @returns true if encryption service is working correctly
   */
  healthCheck(): boolean {
    try {
      const testData = 'health-check-test-' + Date.now();
      const { encrypted, iv } = this.encrypt(testData);
      const decrypted = this.decrypt(encrypted, iv);
      return decrypted === testData;
    } catch (error) {
      this.logger.error('Encryption health check failed', (error as Error).stack);
      return false;
    }
  }
}
