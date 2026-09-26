// database-connection.service.ts
import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { Sequelize } from 'sequelize-typescript';
import { BinderLogger } from '../../shared/service/logger.helper';
import { toError } from '../../shared/util/toError';
import { ConfigService } from '@nestjs/config';
import { BinderConfig, ConfigKeys } from '../../shared/config/config.keys';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { User } from '../../features/authentication/models/user.entity';
import { ApplicationSetting } from '../../features/settings/models/settings.model';
import { Document } from '../../features/document/models/document.entity';
import { PipelineJob } from '../../features/pipeline/models/pipeline-job.entity';
import { PipelineJobEvent } from '../../features/pipeline/models/pipeline-job-event.entity';
import { DocumentCategory, DocumentTag, DocumentTagAssignment, DocumentType } from '../../features/metadata/models/vocabulary.entity';

@Injectable()
export class DatabaseConnectionService {
    private readonly logger = new BinderLogger(DatabaseConnectionService.name);
    private isConnected = false;
    private modelsLoaded = false;
    private isInitializing = false;
    private isRuntimeLost = false;
    private connectionCheckInterval?: NodeJS.Timeout;
    private models: any[] = [];
    private initializationPromise: Promise<void> | null = null;

    constructor(
        @InjectConnection() private sequelize: Sequelize,
        private readonly configService: ConfigService<BinderConfig>,
        private readonly eventEmitter: EventEmitter2,
    ) {
    }

    async start(): Promise<void> {
        this.logger.debug('DatabaseConnectionService bootstrapping')
        const isTest = this.configService.get<string>(ConfigKeys.NODE_ENV);

        if (isTest === 'test') {
            return;
        }

        this.registerModels([
            User, ApplicationSetting, Document, PipelineJob, PipelineJobEvent,
            DocumentType, DocumentCategory, DocumentTag, DocumentTagAssignment
        ]);
        await this.initialize();
    }

    // Register models (can be called anytime)
    registerModels(models: any[]) {
        const newModels: any[] = [];

        for (const model of models) {
            // Check if model is already registered by comparing constructor names or the model itself
            const isAlreadyRegistered = this.models.some(
                (existingModel) =>
                    existingModel === model ||
                    existingModel.name === model.name ||
                    (existingModel.tableName && model.tableName && existingModel.tableName === model.tableName)
            );

            if (!isAlreadyRegistered) {
                newModels.push(model);
                this.models.push(model);
            } else {
                this.logger.debug(`Model ${model.name || model.constructor.name} is already registered, skipping...`);
            }
        }

        if (newModels.length > 0) {
            this.logger.log(`Registered ${newModels.length} new models (total: ${this.models.length})`);
            this.logger.debug(`New models: ${newModels.map((m) => m.name || m.constructor.name).join(', ')}`);

            // If we're already connected and haven't loaded models yet, load them now
            if (this.isConnected && !this.modelsLoaded && !this.isInitializing) {
                this.loadModels().catch((error) => {
                    this.logger.error('Failed to load models after registration:', error);
                });
            }
        } else {
            this.logger.debug(`All ${models.length} models were already registered`);
        }
    }

    // Public method to trigger initialization
    async initialize(): Promise<void> {
        if (this.initializationPromise) {
            return this.initializationPromise;
        }

        this.initializationPromise = this.doInitialize();
        return this.initializationPromise;
    }

    private async doInitialize(): Promise<void> {
        this.logger.log('Initializing database connection...');

        try {
            await this.attemptConnection();
            this.startConnectionMonitoring();
        } catch (error) {
            this.logger.error('Initialization failed:', error);
            // Don't throw - let the app continue running
        }
    }

    private async attemptConnection(): Promise<void> {
        if (this.isInitializing) return;
        this.logger.log('Database attemptConnection');
        this.isInitializing = true;

        try {
            await this.sequelize.authenticate();
            this.isConnected = true;
            this.logger.log('Database connected successfully!');

            // Load models if we have any registered
            if (this.models.length > 0) {
                await this.loadModels();
            }
            this.eventEmitter.emit('database.connected');
        } catch (e) {
            const error = toError(e);
            this.isConnected = false;

            this.logger.error('Database connection failed:', error.message);
            this.logger.error(error);
            if (error.message.indexOf('Login failed') > -1) {
                this.logger.error('Database reported an credential error. No need to try again. Please fix this');
            } else {
                this.logger.log('App is running without database. Will retry in background...');
                this.startBackgroundReconnection();
            }
        } finally {
            this.isInitializing = false;
        }
    }

    private async loadModels(): Promise<void> {
        if (this.modelsLoaded || this.models.length === 0) return;

        try {
            this.logger.log(`Loading ${this.models.length} models...`);

            // Add models to Sequelize
            this.sequelize.addModels(this.models);

            this.modelsLoaded = true;
            this.logger.log('Models loaded successfully!');
            this.checkPermissions();
        } catch (e) {
            const error = toError(e);
            this.logger.error('Failed to load models:', error.message);
            throw error;
        }
    }

    private startBackgroundReconnection(): void {
        let attempts = 0;
        const maxAttempts = 20;

        const reconnectInterval = setInterval(
            async () => {
                if (this.isConnected) {
                    clearInterval(reconnectInterval);
                    return;
                }

                attempts++;
                this.logger.log(`Background reconnection attempt ${attempts}/${maxAttempts}`);

                try {
                    await this.sequelize.authenticate();
                    this.isConnected = true;
                    this.logger.log('Database reconnected!');

                    // Load models after reconnection
                    if (this.models.length > 0 && !this.modelsLoaded) {
                        await this.loadModels();
                    }

                    clearInterval(reconnectInterval);
                    this.eventEmitter.emit('database.restored');
                } catch (error) {
                    if (attempts >= maxAttempts) {
                        this.logger.error(`Failed to reconnect after ${maxAttempts} attempts`);
                        clearInterval(reconnectInterval);
                    }
                }
            },
            5000 + attempts * 1000
        );
    }

    private startConnectionMonitoring(): void {
        if (this.connectionCheckInterval) return; // Already monitoring

        this.connectionCheckInterval = setInterval(async () => {
            try {
                await this.sequelize.authenticate();

                if (!this.isConnected) {
                    this.isConnected = true;
                    this.logger.log('Database connection restored');

                    // Reload models if they weren't loaded
                    if (this.models.length > 0 && !this.modelsLoaded) {
                        await this.loadModels();
                    }
                    this.isRuntimeLost = false;
                    this.eventEmitter.emit('database.restored');
                }
            } catch (error) {
                if (this.isConnected) {
                    this.isConnected = false;
                    this.modelsLoaded = false;
                    this.isRuntimeLost = true;
                    this.logger.warn('Database connection lost');
                }
            }
        }, 30000);
    }

    // Method to safely execute database operations
    async executeWithConnection<T>(operation: () => Promise<T>): Promise<T> {
        // First ensure we're initialized
        await this.initialize();

        if (!this.isConnected) {
            throw new Error('Database not connected');
        }

        if (!this.modelsLoaded && this.models.length > 0) {
            throw new Error('Database models not loaded');
        }

        try {
            return await operation();
        } catch (e) {
            const error = toError(e);
            if (this.isConnectionError(error)) {
                this.isConnected = false;
                this.modelsLoaded = false;
                this.logger.error('Connection error during operation:', error.message);
            }
            throw error;
        }
    }

    // Force reconnection
    async forceReconnect(): Promise<void> {
        this.logger.warn('Forcing database reconnection...');

        try {
            await this.sequelize.close();
            await this.delay(2000);

            this.isConnected = false;
            this.modelsLoaded = false;

            await this.attemptConnection();

            this.logger.log('Force reconnection successful');
        } catch (e) {
            const error = toError(e);
            this.logger.error('Force reconnection failed:', error.message);
            throw error;
        }
    }

    isConnectionError(error: any): boolean {
        const connectionErrors = [
            'ETIMEDOUT',
            'ECONNRESET',
            'ECONNREFUSED',
            'EHOSTUNREACH',
            'ENOTFOUND',
            'SequelizeConnectionError',
            'ConnectionError',
            'socket hang up',
            'connection terminated',
            'Connection lost'
        ];

        const errorMessage = error.message?.toLowerCase() || '';
        const errorName = error.name?.toLowerCase() || '';

        return connectionErrors.some(
            (errorType) => errorMessage.includes(errorType.toLowerCase()) || errorName.includes(errorType.toLowerCase())
        );
    }

    private async checkPermissions() {
        try {
            this.logger.debug('Running DB Check');
            const [results] = await this.sequelize.query(`
                SELECT
                    current_database() AS database_name,
                    current_user AS database_user,
                    current_schema() AS schema_name,
                    has_database_privilege(
                        current_user,
                        current_database(),
                        'CONNECT'
                    ) AS can_connect,
                    COALESCE(
                        has_schema_privilege(
                            current_user,
                            current_schema(),
                            'USAGE'
                        ),
                        false
                    ) AS can_use_schema,
                    COALESCE(
                        has_schema_privilege(
                            current_user,
                            current_schema(),
                            'CREATE'
                        ),
                        false
                    ) AS can_create_objects
            `);

            const perms = results[0] as {
                database_name: string;
                database_user: string;
                schema_name: string;
                can_connect: boolean;
                can_use_schema: boolean;
                can_create_objects: boolean;
            } | undefined;

            if (!perms) {
                this.logger.warn('PostgreSQL permission check returned no result');
                return;
            }

            const canMigrate =
                perms.can_connect &&
                perms.can_use_schema &&
                perms.can_create_objects;

            this.logger.debug(
                `PostgreSQL permission check: ${canMigrate ? 'passed' : 'failed'} ` +
                `${JSON.stringify({
                    database: perms.database_name,
                    user: perms.database_user,
                    schema: perms.schema_name,
                    canConnect: perms.can_connect,
                    canUseSchema: perms.can_use_schema,
                    canCreateObjects: perms.can_create_objects
                })}`
            );
        } catch (e) {
            this.logger.error(e);
        }
    }

    getStatus() {
        return {
            connected: this.isConnected,
            modelsLoaded: this.modelsLoaded,
            initializing: this.isInitializing,
            registeredModels: this.models.length,
            runtimeLost: this.isRuntimeLost,

            timestamp: new Date().toISOString()
        };
    }

    private delay(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
}
