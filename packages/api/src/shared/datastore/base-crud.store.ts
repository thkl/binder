// nosemgrep
import { Injectable } from '@nestjs/common';
import { Model, ModelStatic, WhereOptions, Order, FindOptions, Includeable, Op, Transaction } from 'sequelize';
import {
    CSVExportOptions,
    CSVImportOptions,
    CSVProcessResult,
    CsvUpdateDescriptor,
    CsvUpdateFieldDescriptor,
    CsvUpdateResult,
    FilterOptions,
    FindOptionParameters,
    FindOptionParameterTransform,
    IStoreUser,
    NamedQuery,
    NamedQueryAddingOptions,
    NamedQueryMap,
    NamedQueryOptions,
    PaginatedResult,
    QueryOptions,
    SortOptions,
    TimestampFieldConfig,
    UpsertOptions
} from './query-options.type';
import { CSVImportResult } from './result.type';
import { catchError, finalize, map, Observable, of } from 'rxjs';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { parseCSV } from './csv-parser';
import { inspect } from 'node:util';
import * as crypto from 'crypto';
import { QueryBuilder } from './query-builder';
import { Sequelize } from 'sequelize-typescript';
import { BinderLogger } from '../service/logger.helper';
import { SafePropertyAccess } from '../util/savepropertyaccess';
import { toError } from '../util/toError';
import { getMetadataStorage } from 'class-validator';
import { CsvValidator } from './csv-validator';

// Type definition
interface FieldDefinition {
    type: string;
    optional?: boolean;
    nullable?: boolean;
    validators?: string[];
}

type DtoConstructor<T = any> = new () => T;

/**
 * Minimal cache adapter contract used by BaseCrudStore.
 * Implementations can wrap Redis, Nest cache-manager, memory, or disk storage.
 */
export interface BaseCrudCacheAdapter {
    /** Reads a previously cached value by its fully-qualified cache key. */
    get<T = unknown>(key: string): Promise<T | undefined>;
    /** Stores a serializable value by its fully-qualified cache key. */
    set<T = unknown>(key: string, value: T): Promise<void>;
    /** Removes a cached value by its fully-qualified cache key. */
    delete(key: string): Promise<void>;
}

/**
 * Cache configuration for a BaseCrudStore instance.
 */
export interface BaseCrudCacheOptions {
    /** Adapter used to persist cache entries. */
    adapter: BaseCrudCacheAdapter;
    /** Optional namespace used to isolate this store's entries from other stores. */
    namespace?: string;
    /** Optional TTL in milliseconds. Omit for no time-based expiration. */
    ttlMs?: number;
}

/**
 * Lightweight cache envelope with optional expiration metadata.
 */
interface BaseCrudCacheEnvelope<T = unknown> {
    /** Unix timestamp in milliseconds after which the entry is stale. */
    expiresAt?: number;
    /** Cached plain JSON value. */
    value: T;
}

/**
 * Small Redis-like client shape supported by the Redis adapter factory.
 */
export interface BaseCrudRedisLikeClient {
    /** Reads a string value by key. */
    get(key: string): Promise<string | null>;
    /** Writes a string value by key. */
    set(key: string, value: string): Promise<void>;
    /** Deletes a key. */
    del(key: string): Promise<void>;
}

/**
 * Small Nest cache-manager-like shape supported by the Nest cache adapter factory.
 */
export interface BaseCrudNestCacheLikeClient {
    /** Reads a value by key. */
    get<T = unknown>(key: string): Promise<T | undefined> | T | undefined;
    /** Writes a value by key. */
    set<T = unknown>(key: string, value: T): Promise<void> | void;
    /** Deletes a key. */
    del?(key: string): Promise<void> | void;
    /** Deletes a key for cache-manager variants that use delete(). */
    delete?(key: string): Promise<void> | void;
}

/**
 * Factory for supported BaseCrudStore cache adapters.
 */
export class BaseCrudCacheFactory {
    /**
     * Creates an in-process memory cache adapter.
     *
     * @returns Cache adapter backed by a Map
     */
    static memory(): BaseCrudCacheAdapter {
        const storage = new Map<string, unknown>();
        return {
            // Keep values as-is for fast local cache reads.
            async get<T = unknown>(key: string): Promise<T | undefined> {
                return storage.get(key) as T | undefined;
            },
            async set<T = unknown>(key: string, value: T): Promise<void> {
                storage.set(key, value);
            },
            async delete(key: string): Promise<void> {
                storage.delete(key);
            }
        };
    }

    /**
     * Creates a Redis cache adapter without depending on a concrete Redis package.
     *
     * @param client - Redis-like client with get/set/del methods
     * @returns Cache adapter backed by Redis
     */
    static redis(client: BaseCrudRedisLikeClient): BaseCrudCacheAdapter {
        return {
            // Redis stores JSON strings so any client implementation can be used.
            async get<T = unknown>(key: string): Promise<T | undefined> {
                const value = await client.get(key);
                return value === null || value === undefined ? undefined : (JSON.parse(value) as T);
            },
            async set<T = unknown>(key: string, value: T): Promise<void> {
                await client.set(key, JSON.stringify(value));
            },
            async delete(key: string): Promise<void> {
                await client.del(key);
            }
        };
    }

    /**
     * Creates an adapter around Nest's cache-manager style cache service.
     *
     * @param cache - Nest cache-like object with get/set and del/delete methods
     * @returns Cache adapter backed by Nest cache
     */
    static nestCache(cache: BaseCrudNestCacheLikeClient): BaseCrudCacheAdapter {
        return {
            // Nest cache-manager can store objects directly in memory or serialize in its backend.
            async get<T = unknown>(key: string): Promise<T | undefined> {
                return (await cache.get<T>(key)) as T | undefined;
            },
            async set<T = unknown>(key: string, value: T): Promise<void> {
                await cache.set(key, value);
            },
            async delete(key: string): Promise<void> {
                if (cache.del) {
                    await cache.del(key);
                } else if (cache.delete) {
                    await cache.delete(key);
                }
            }
        };
    }

    /**
     * Creates a JSON file cache adapter for local disk caching.
     *
     * @param directory - Directory where cache files are stored
     * @returns Cache adapter backed by JSON files
     */
    static file(directory: string): BaseCrudCacheAdapter {
        return {
            // File names are hashed so arbitrary cache keys cannot escape the directory.
            async get<T = unknown>(key: string): Promise<T | undefined> {
                const filePath = BaseCrudCacheFactory.filePathForKey(directory, key);
                try {
                    return JSON.parse(await fsp.readFile(filePath, 'utf8')) as T;
                } catch {
                    return undefined;
                }
            },
            async set<T = unknown>(key: string, value: T): Promise<void> {
                const filePath = BaseCrudCacheFactory.filePathForKey(directory, key);
                await fsp.mkdir(directory, { recursive: true });
                await fsp.writeFile(filePath, JSON.stringify(value), { mode: 0o600 });
            },
            async delete(key: string): Promise<void> {
                const filePath = BaseCrudCacheFactory.filePathForKey(directory, key);
                try {
                    await fsp.unlink(filePath);
                } catch {
                    // Missing cache files are already invalidated.
                }
            }
        };
    }

    /**
     * Builds a safe deterministic file path for a cache key.
     *
     * @param directory - Cache directory
     * @param key - Cache key to hash
     * @returns Absolute cache file path
     */
    private static filePathForKey(directory: string, key: string): string {
        const hash = crypto.createHash('sha256').update(key).digest('hex');
        return path.join(directory, `${hash}.json`);
    }
}

/**
 * Abstract base class for CRUD operations on Sequelize models.
 * Provides common database operations with error handling, filtering, pagination, and named queries.
 *
 * @template T - The Sequelize model type extending Model
 * @template U - The user type for tracking who created/updated records (defaults to IStoreUser)
 *
 * @example
 * ```typescript
 * // Use with your own User model
 * export class ProductStore extends BaseCrudStore<Product, User> {
 *     constructor() {
 *         super(Product);
 *     }
 * }
 *
 * // Or use with the default IStoreUser interface
 * export class ProductStore extends BaseCrudStore<Product> {
 *     constructor() {
 *         super(Product);
 *     }
 * }
 * ```
 */
@Injectable()
export abstract class BaseCrudStore<
    T extends Model,
    U extends IStoreUser = IStoreUser,
    Q extends Record<string, Record<string, any>> = Record<string, Record<string, any>>
> {
    protected model: ModelStatic<T>;
    protected defaultInitialQuery?: FilterOptions;
    protected namedQueries: NamedQueryMap = {};
    protected idFieldName: string = 'uuid';
    protected readonly logger = new BinderLogger(BaseCrudStore.name);
    private returnRaw: boolean = false;
    private cacheOptions?: BaseCrudCacheOptions;
    logQueries = false;
    private schemaCache = new Map<DtoConstructor<any>, Record<string, FieldDefinition>>();

    /**
     * Configuration for timestamp field names.
     * Defaults match legacy field names for backward compatibility.
     */
    protected timestampFields: Required<TimestampFieldConfig> = {
        createdAt: 'created',
        createdBy: 'createdby',
        updatedAt: 'changedAt',
        updatedBy: 'changedby'
    };

    /**
     * Cache of which timestamp fields actually exist in the model.
     * Initialized lazily on first create/update call for compatibility with delayed model initialization.
     */
    protected timestampFieldsExist?: {
        createdAt: boolean;
        createdBy: boolean;
        updatedAt: boolean;
        updatedBy: boolean;
    };

    /**
     * Creates a new instance of the BaseCrudStore.
     *
     * @param model - The Sequelize model class to perform operations on
     * @param defaultInitialQuery - Optional default filters applied to all queries
     * @param timestampConfig - Optional configuration for timestamp field names (uses defaults if not provided)
     *
     * @example
     * // Using defaults (backward compatible)
     * constructor() {
     *   super(MyModel);
     * }
     *
     * @example
     * // Using custom field names
     * constructor() {
     *   super(MyModel, {}, {
     *     createdAt: 'created_at',
     *     createdBy: 'created_by',
     *     updatedAt: 'updated_at',
     *     updatedBy: 'updated_by'
     *   });
     * }
     */
    constructor(
        model: ModelStatic<T>,
        defaultInitialQuery?: FilterOptions,
        timestampConfig?: TimestampFieldConfig
    ) {
        this.model = model;
        this.defaultInitialQuery = defaultInitialQuery;

        // Merge custom config with defaults
        if (timestampConfig) {
            this.timestampFields = {
                ...this.timestampFields,
                ...timestampConfig
            };
        }

        // Note: timestampFieldsExist is initialized lazily on first use
        // This allows  for delayed model initialization (e.g., when database isn't ready at startup)

        this.registerNamedQueries();
    }

    setRawResult(returnRawResult: boolean) {
        this.returnRaw = returnRawResult;
    }

    /**
     * Returns whether this store is configured to return raw plain objects.
     *
     * @returns True when raw result mode is enabled
     */
    needsRawResult() {
        return this.returnRaw;
    }

    /**
     * Enables read-through caching for this store.
     *
     * @param options - Cache adapter, namespace, and optional TTL configuration
     * @returns The current store for fluent setup in child constructors
     */
    useCache(options: BaseCrudCacheOptions): this {
        // Keep cache opt-in so existing stores preserve current database behavior by default.
        this.cacheOptions = options;
        return this;
    }

    /**
     * Disables read-through caching for this store.
     *
     * @returns The current store for fluent setup in child constructors
     */
    disableCache(): this {
        // Dropping the options makes all cache helpers become no-ops.
        this.cacheOptions = undefined;
        return this;
    }

    /**
     * Invalidates all cached reads for this store.
     * Use this from other stores/services when associated data changes outside this store.
     *
     * @returns Promise that resolves after the cache namespace version has changed
     */
    async invalidateCache(): Promise<void> {
        if (!this.cacheOptions) {
            return;
        }

        // Versioned keys make invalidation lightweight across Redis, Nest cache, memory, and file adapters.
        await this.cacheOptions.adapter.set(this.getCacheVersionKey(), `${Date.now()}:${crypto.randomUUID()}`);
    }

    /**
     * Builds the namespace prefix used for all cache keys in this store.
     *
     * @returns Namespaced cache prefix
     */
    private getCacheNamespace(): string {
        return this.cacheOptions?.namespace ?? this.model.name;
    }

    /**
     * Builds the key that stores the current namespace version.
     *
     * @returns Cache version key
     */
    private getCacheVersionKey(): string {
        return `base-crud:${this.getCacheNamespace()}:version`;
    }

    /**
     * Reads the current cache namespace version, initializing it when missing.
     *
     * @returns Current namespace version
     */
    private async getCacheVersion(): Promise<string> {
        if (!this.cacheOptions) { return '' };
        const adapter = this.cacheOptions.adapter;
        const versionKey = this.getCacheVersionKey();
        const existingVersion = await adapter.get<string>(versionKey);

        if (existingVersion) {
            return existingVersion;
        }

        // Initialize the namespace lazily so stores do not need application bootstrap work.
        const initialVersion = `${Date.now()}:${crypto.randomUUID()}`;
        await adapter.set(versionKey, initialVersion);
        return initialVersion;
    }

    /**
     * Creates a stable hash for cacheable method arguments.
     *
     * @param value - Value to hash
     * @returns SHA-256 hash for the value
     */
    private hashCacheValue(value: unknown): string {
        // util.inspect preserves symbol keys such as Sequelize Op.or better than JSON.stringify.
        return crypto
            .createHash('sha256')
            .update(inspect(value, { depth: null, sorted: true, compact: true, breakLength: Infinity }))
            .digest('hex');
    }

    /**
     * Builds a versioned cache key for one read operation.
     *
     * @param methodName - Store read method name
     * @param keyParts - Arguments that uniquely identify the read result
     * @returns Fully qualified cache key
     */
    private async buildCacheKey(methodName: string, keyParts: unknown[]): Promise<string> {
        const version = await this.getCacheVersion();
        const hash = this.hashCacheValue(keyParts);
        return `base-crud:${this.getCacheNamespace()}:${version}:${methodName}:${hash}`;
    }

    /**
     * Reads a cached value when caching is enabled and the entry is still fresh.
     *
     * @param cacheKey - Fully qualified cache key
     * @returns Cached value or undefined when missing/expired
     */
    private async readCache<TValue>(cacheKey: string): Promise<TValue | undefined> {
        if (!this.cacheOptions) {
            return undefined;
        }

        const envelope = await this.cacheOptions.adapter.get<BaseCrudCacheEnvelope<TValue>>(cacheKey);
        if (!envelope) {
            return undefined;
        }

        if (envelope.expiresAt !== undefined && envelope.expiresAt <= Date.now()) {
            // Expired entries are cleaned up opportunistically during reads.
            await this.cacheOptions.adapter.delete(cacheKey);
            return undefined;
        }

        return envelope.value;
    }

    /**
     * Stores a value in cache when caching is enabled.
     *
     * @param cacheKey - Fully qualified cache key
     * @param value - Plain serializable value to cache
     */
    private async writeCache<TValue>(cacheKey: string, value: TValue): Promise<void> {
        if (!this.cacheOptions) {
            return;
        }

        const envelope: BaseCrudCacheEnvelope<TValue> = {
            // TTL is stored in the envelope so every adapter can share the same expiration behavior.
            expiresAt: this.cacheOptions.ttlMs ? Date.now() + this.cacheOptions.ttlMs : undefined,
            value
        };
        await this.cacheOptions.adapter.set(cacheKey, envelope);
    }

    /**
     * Converts a Sequelize model/plain object into plain JSON-safe data.
     *
     * @param value - Value returned from Sequelize
     * @returns Plain value suitable for JSON-oriented cache backends
     */
    private toCachePlainValue<V>(value: V): V {
        if (Array.isArray(value)) {
            return value.map((item) => this.toCachePlainValue(item)) as V;
        }

        if (value && typeof value === 'object' && typeof (value as any).get === 'function') {
            return (value as any).get({ plain: true });
        }

        return value;
    }

    /**
     * Converts cached plain data back into the method's expected return shape.
     *
     * @param value - Cached plain value
     * @param raw - Whether the caller expects plain raw data
     * @returns Plain data or rebuilt Sequelize model instances
     */
    private fromCacheValue<V>(value: V, raw: boolean): V {
        if (raw || value === null || value === undefined) {
            return value;
        }

        if (Array.isArray(value)) {
            return value.map((item) => this.fromCacheValue(item, raw)) as V;
        }

        if (typeof value === 'object') {
            // Rebuild as a non-new Sequelize model so non-raw callers keep model-like behavior.
            return (this.model as any).build(value, { isNewRecord: false, raw: true });
        }

        return value;
    }

    /**
     * Executes a read operation through cache when caching is enabled.
     *
     * @param methodName - Store read method name
     * @param keyParts - Arguments that uniquely identify the read result
     * @param raw - Whether the caller expects plain raw data
     * @param loader - Database loader used on cache misses
     * @returns Cached or freshly loaded value
     */
    private async cachedFind<V>(
        methodName: string,
        keyParts: unknown[],
        raw: boolean,
        loader: () => Promise<V>
    ): Promise<V> {
        if (!this.cacheOptions) {
            return loader();
        }

        const cacheKey = await this.buildCacheKey(methodName, keyParts);
        const cached = await this.readCache<V>(cacheKey);
        if (cached !== undefined) {
            //this.logger.debug(`Cache hit ${cacheKey}`);
            return this.fromCacheValue(cached, raw);
        }

        const loaded = await loader();
        await this.writeCache(cacheKey, this.toCachePlainValue(loaded));
        return loaded;
    }

    /**
     * Hook method for child classes to register named queries during initialization.
     * Override this method in child classes to define reusable query patterns.
     *
     * @protected
     */
    protected registerNamedQueries(): void {
        // Default implementation - child classes can override
    }

    /**
     * Initializes the timestamp field existence cache on first use.
     * Called lazily by create() and update() to support delayed model initialization.
     * After first call, subsequent calls are no-ops (cache is already initialized).
     *
     * @protected
     */
    protected ensureTimestampFieldsInitialized(): void {
        if (this.timestampFieldsExist) {
            return; // Already initialized
        }

        // Initialize cache by checking which fields exist in the model
        this.timestampFieldsExist = {
            createdAt: this.fieldExistsInModel(this.timestampFields.createdAt),
            createdBy: this.fieldExistsInModel(this.timestampFields.createdBy),
            updatedAt: this.fieldExistsInModel(this.timestampFields.updatedAt),
            updatedBy: this.fieldExistsInModel(this.timestampFields.updatedBy)
        };
    }

    /**
     * Registers a custom ID field name for the model.
     * By default, the store uses 'uuid' as the primary key field.
     * Use this method to specify a different field name if your model uses a different primary key.
     *
     * @param fieldName - The name of the field to use as the primary key
     *
     * @example
     * // In your store's constructor
     * constructor() {
     *   super(MyModel);
     *   this.registerIdField('id'); // Use 'id' instead of 'uuid'
     * }
     */
    registerIdField(fieldName: string): void {
        //the default id field for the model is uuid .. if its another register this here
        this.idFieldName = fieldName;
    }

    /**
     * Creates a new fluent query builder for method chaining.
     * Provides a chainable API for building complex queries.
     *
     * @returns A new QueryBuilder instance
     *
     * @example
     * // Simple query with chaining
     * const users = await store
     *   .query()
     *   .where({ active: true })
     *   .orderBy('name', 'ASC')
     *   .limit(10)
     *   .execute();
     *
     * @example
     * // Paginated query
     * const result = await store
     *   .query()
     *   .where({ category: 'electronics' })
     *   .orderBy('price', 'DESC')
     *   .paginate(1, 20);
     *
     * @example
     * // Complex query with multiple conditions
     * const products = await store
     *   .query()
     *   .where({ active: true, inStock: true })
     *   .include('category', 'supplier')
     *   .orderBy('createdAt', 'DESC')
     *   .limit(50)
     *   .execute();
     *
     * @example
     * // Get single result
     * const user = await store
     *   .query()
     *   .where({ email: 'test@example.com' })
     *   .first();
     *
     * @example
     * // Count results
     * const count = await store
     *   .query()
     *   .where({ active: true })
     *   .count();
     */
    query(): QueryBuilder<T, U> {
        return new QueryBuilder<T, U>(this);
    }

    /**
     * Registers a named query using a configuration object.
     * This is a convenience wrapper around addNamedQuery that accepts all parameters as a single object.
     *
     * @param namedQueryAddingOptions - Configuration object containing all named query parameters
     * @protected
     *
     * @example
     * this.addNamedQueryWithOptions({
     *   name: 'activeUsers',
     *   findOptions: { where: { active: true } },
     *   returnType: User,
     *   parameters: [{ name: 'status', type: 'string' }]
     * });
     */
    protected addNamedQueryWithOptions(namedQueryAddingOptions: NamedQueryAddingOptions<T>): void {
        const { name, findOptions, returnType, parameters, transform } = namedQueryAddingOptions;
        this.addNamedQuery(name as string, findOptions, returnType, parameters, transform);
    }

    /**
     * Registers a named query that can be reused throughout the application.
     * Named queries are predefined query patterns with specific options and optional parameters.
     * Parameters in the findOptions should use placeholder format like $paramName.
     *
     * **Parameter Placeholders:**
     * - `$paramName` - Simple parameter substitution
     * - `$paramName%` - Wildcard parameter (appends % for LIKE queries)
     *
     * @template R - The return type for the named query (defaults to T)
     * @param name - Unique identifier for the named query
     * @param findOptions - Sequelize FindOptions with optional parameter placeholders ($paramName)
     * @param returnType - Optional constructor for the return type
     * @param parameters - Optional parameter definitions for validation and type safety
     * @protected
     *
     * @example
     * // Named query with parameters
     * this.addNamedQuery('withProfile', {
     *   include: [{
     *     model: Profile,
     *     as: 'profile',
     *     where: {
     *       [Op.and]: [
     *         { uuid: '$uuid' },
     *         { active: '$active' }
     *       ]
     *     }
     *   }]
     * }, undefined, [
     *   { name: 'uuid', type: 'string' },
     *   { name: 'active', type: 'boolean' }
     * ]);
     *
     * @example
     * // Named query with wildcard for LIKE search
     * this.addNamedQuery('searchByName', {
     *   where: {
     *     name: { [Op.like]: '$name%' }
     *   }
     * }, undefined, [
     *   { name: 'name', type: 'string' }
     * ]);
     * // Usage: findAllNamed('searchByName', {}, { name: 'John' })
     * // Results in: WHERE name LIKE 'John%'
     */
    protected addNamedQuery<R = T>(
        name: string,
        findOptions: FindOptions,
        returnType?: new () => R,
        parameters?: Array<FindOptionParameters>,
        transform?: FindOptionParameterTransform
    ): void {
        SafePropertyAccess.set(this.namedQueries, name, {
            name,
            findOptions,
            returnType,
            parameters,
            transform
        });
    }

    /**
     * Registers a dynamic field search query that searches across multiple model fields.
     * Creates flexible search functionality with configurable field matching and logical operators.
     *
     * @template R - The return type for the field search query (defaults to T)
     * @param name - Unique identifier for the field search query
     * @param config - Configuration object defining the search behavior
     * @param returnType - Optional constructor for the return type
     * @protected
     *
     * @example
     * // Search users by name across multiple fields with OR logic
     * this.addFieldSearchQuery('searchUsers', {
     *   filterName: 'searchTerm',
     *   fields: ['firstName', 'lastName', 'email', 'username'],
     *   operator: 'or',
     *   matchType: 'contains'
     * });
     *
     * @example
     * // Search with exact match and AND logic
     * this.addFieldSearchQuery('exactUserSearch', {
     *   filterName: 'exactTerm',
     *   fields: ['firstName', 'lastName'],
     *   operator: 'and',
     *   matchType: 'exact'
     * });
     */
    protected addFieldSearchQuery<R = T>(name: string, config: NamedQueryOptions, returnType?: new () => R): void {
        //default to true
        if (config.caseSensitive === undefined) {
            config.caseSensitive = true;
        }
        SafePropertyAccess.set(this.namedQueries, name, {
            name,
            findOptions: {}, // Will be built dynamically
            returnType,
            fieldSearchConfig: config
        });
    }

    /**
     * Checks if a field exists in the model's attributes.
     * Useful for validating field names before performing operations.
     *
     * @param fieldName - The name of the field to check
     * @returns True if the field exists in the model, false otherwise
     * @protected
     */
    protected fieldExistsInModel(fieldName: string) {
        const attributes = this.model.getAttributes();
        return Object.prototype.hasOwnProperty.call(attributes, fieldName);
    }

    /**
     * Validates that a field name exists in the model schema.
     * Throws an error if the field is not found.
     *
     * @param fieldName - The name of the field to validate
     * @param context - Context description for the error message (e.g., "sorting", "filtering")
     * @throws Error if the field does not exist in the model
     * @protected
     */
    protected validateFieldName(fieldName: string, context: string): void {
        if (!this.fieldExistsInModel(fieldName)) {
            throw new Error(
                `Invalid field '${fieldName}' for ${context} in model ${this.model.name}. Field does not exist in model schema.`
            );
        }
    }

    // ==================== LIFECYCLE HOOKS ====================
    /**
     * Hook called before a record is created.
     * Override this method to add custom validation, modification, or side effects.
     *
     * @param data - The data that will be used to create the record
     * @param user - The user performing the operation (if available)
     * @returns The modified data (or original data if no changes)
     * @protected
     *
     * @example
     * protected async beforeCreate(data: Partial<Product>, user?: User) {
     *   // Add custom validation
     *   if (!data.sku) {
     *     throw new Error('SKU is required');
     *   }
     *   // Modify data before creation
     *   return { ...data, status: 'pending' };
     * }
     */

    protected async beforeCreate(data: Partial<T['_attributes']>, user?: U): Promise<Partial<T['_attributes']>> {
        return data;
    }

    /**
     * Hook called after a record is created.
     * Override this method to add custom side effects like logging, notifications, or cache invalidation.
     *
     * @param record - The newly created record
     * @param user - The user who performed the operation (if available)
     * @protected
     *
     * @example
     * protected async afterCreate(record: Product, user?: User) {
     *   // Send notification
     *   await this.notificationService.send(`New product created: ${record.name}`);
     *   // Invalidate cache
     *   await this.cache.invalidate('products');
     * }
     */

    protected async afterCreate(record: T, user?: U): Promise<void> {
        // Default: no-op
    }

    /**
     * Hook called before a record is updated.
     * Override this method to add custom validation, modification, or side effects.
     *
     * @param id - The ID of the record being updated
     * @param data - The data that will be used to update the record
     * @param user - The user who performed the operation (if available)
     * @returns The modified data (or original data if no changes)
     * @protected
     *
     * @example
     * protected async beforeUpdate(id: string, data: Partial<Product>, user?: User) {
     *   // Prevent certain fields from being updated
     *   const { sku, ...allowedData } = data;
     *   return allowedData;
     * }
     */

    protected async beforeUpdate(
        id: string | number,
        data: Partial<T['_attributes']>,
        user?: U
    ): Promise<Partial<T['_attributes']>> {
        return data;
    }

    /**
     * Hook called after a record is updated.
     * Override this method to add custom side effects.
     *
     * @param record - The updated record
     * @param user - The user who performed the operation (if available)
     * @protected
     *
     * @example
     * protected async afterUpdate(record: Product, user?: User) {
     *   // Log the change
     *   await this.auditLog.record('update', record.uuid, user?.gid);
     * }
     */

    protected async afterUpdate(record: T, user?: U): Promise<void> {
        // Default: no-op
    }

    /**
     * Hook called before a record is deleted.
     * Override this method to add custom validation or side effects.
     * Throw an error to prevent the deletion.
     *
     * @param id - The ID of the record being deleted
     * @param user - The user performing the operation (if available)
     * @protected
     *
     * @example
     * protected async beforeDelete(id: string, user?: User) {
     *   // Prevent deletion if record has dependencies
     *   const hasOrders = await this.orderService.hasOrdersForProduct(id);
     *   if (hasOrders) {
     *     throw new Error('Cannot delete product with existing orders');
     *   }
     * }
     */

    protected async beforeDelete(id: string | number, user?: U): Promise<void> {
        // Default: no-op
    }

    /**
     * Hook called after a record is deleted.
     * Override this method to add custom side effects.
     *
     * @param id - The ID of the record that was deleted
     * @param user - The user who performed the operation (if available)
     * @protected
     *
     * @example
     * protected async afterDelete(id: string, user?: User) {
     *   // Clean up related resources
     *   await this.storageService.deleteProductImages(id);
     * }
     */

    protected async afterDelete(id: string | number, user?: U): Promise<void> {
        // Default: no-op
    }

    // ==================== CRUD OPERATIONS ====================

    /**
     * Finds a single record by its primary key.
     *
     * @param uuid - The primary key value (string or number)
     * @returns Promise resolving to a Result containing the found record or null if not found
     */
    async findById(uuid: string | number, raw: boolean = false): Promise<T | null> {
        try {
            const item = await this.cachedFind(
                'findById',
                [uuid, raw || this.returnRaw],
                raw || this.returnRaw,
                async () => {
                    return this.model.findByPk(uuid);
                }
            );
            if (item && (raw === true || this.returnRaw === true)) {
                // Cached raw reads may already be plain objects, while Sequelize reads expose get().
                return item.get?.({ plain: true }) ?? item;
            }
            return item;
        } catch (error) {
            this.logger.error(`findById error ${error}`);
            throw error;
        }
    }

    /**
     * Get or generate schema for a DTO class, caching the result
     */
    protected getOrCreateSchema<DTO>(dtoClass: DtoConstructor<DTO>): Record<string, FieldDefinition> {
        if (this.schemaCache.has(dtoClass)) {
            return this.schemaCache.get(dtoClass)!;
        }

        const schema = this.getDtoSchema(dtoClass);
        this.schemaCache.set(dtoClass, schema);
        return schema;
    }

    /**
     * Generates schema combining DTO structure with Sequelize model constraints
     */

    private getDtoSchema<DTO>(dtoClass: DtoConstructor<DTO>): Record<string, FieldDefinition> {
        const schema: Record<string, FieldDefinition> = {};
        const prototype = dtoClass.prototype;
        const clazz = new dtoClass();
        let proNames = Object.getOwnPropertyNames(clazz);

        if (proNames.length === 0) {
            const metadataStorage = getMetadataStorage();
            const targetMetadatas = metadataStorage.getTargetValidationMetadatas(dtoClass, '', false, false);
            proNames = [...new Set(targetMetadatas.map((m) => m.propertyName))];
        }

        const modelAttributes = this.model.getAttributes();
        const metadataStorage = getMetadataStorage();
        const validationMetadatas = metadataStorage.getTargetValidationMetadatas(dtoClass, '', false, false);

        proNames.forEach((propertyKey) => {
            const designType = Reflect.getMetadata('design:type', prototype, propertyKey);
            const modelField = modelAttributes[propertyKey];

            const propertyValidators = validationMetadatas
                .filter((m) => m.propertyName === propertyKey)
                .map((m) => m.type);

            const isOptional =
                propertyValidators.includes('isOptional' as any) || propertyValidators.includes('IsOptional' as any);

            schema[propertyKey] = {
                type: designType ? designType.name.toLowerCase() : 'unknown',
                optional: isOptional,
                nullable: modelField?.allowNull ?? true,
                validators: propertyValidators.map((v) => String(v))
            };
        });

        return schema;
    }

    /**
     * Validates and merges changes from a new object into an old object based on a DTO schema.
     * Only fields defined in the DTO schema (objectKeys) are processed, providing type-safe updates
     * with automatic type normalization and change tracking for audit trails.
     *
     * This method is useful for:
     * - Enforcing DTO-based field restrictions during updates
     * - Generating audit logs of what changed
     * - Type normalization (converting strings to numbers/dates)
     * - Detecting actual changes vs. no-op updates
     *
     * @param objectKeys - DTO schema generated from `getDtoSchema()` defining allowed fields and their types
     * @param oldObject - The existing record/object to update
     * @param newObject - The incoming data containing potential updates
     * @returns Object containing:
     *   - `updated`: The merged object with applied changes
     *   - `message`: Array of human-readable change descriptions for audit logging
     *   - `count`: Number of fields that were actually changed
     *
     * @example
     * // Get DTO schema first
     * const schema = store.getDtoSchema(UpdateProductDto);
     *
     * // Apply updates with change tracking
     * const result = store.updateObject(schema, existingProduct, incomingData);
     *
     * console.log(result.count); // 2
     * console.log(result.message);
     * // ['price changed from 10 to 15', 'stock changed from 100 to 95']
     *
     * await store.update(productId, result.updated);
     *
     * @example
     * // With audit logging
     * const result = store.updateObject(schema, oldRecord, newData);
     * if (result.count > 0) {
     *   await auditLog.create({
     *     recordId: oldRecord.uuid,
     *     changes: result.message,
     *     changedBy: currentUser.gid
     *   });
     *   await store.update(oldRecord.uuid, result.updated);
     * }
     */
    updateObject(
        objectKeys: Record<string, FieldDefinition>,
        oldObject: T,
        newObject: Record<string, any>,
        excludeFields: string[] = []
    ) {
        const result: string[] = [];
        const tmpObject = { ...oldObject };
        const changes: Partial<T> = {};
        const excluded = new Set(excludeFields);
        const errors: string[] = [];

        for (const [fieldname, fieldDef] of Object.entries(objectKeys)) {
            if (excluded.has(fieldname)) continue;

            if (!(fieldname in newObject)) {
                continue;
            }

            const oldValue = SafePropertyAccess.get(tmpObject, fieldname);
            const newValue = SafePropertyAccess.get(newObject, fieldname);

            // Validate nullable constraint
            if (newValue === null || newValue === undefined) {
                if (fieldDef.nullable === false) {
                    errors.push(`Field '${fieldname}' cannot be null`);
                    continue;
                }

                if (oldValue !== newValue) {
                    result.push(`${fieldname} changed from ${oldValue} to null`);
                    SafePropertyAccess.set(tmpObject, fieldname, newValue);
                    SafePropertyAccess.set(changes, fieldname, newValue);
                }
                continue;
            }

            if (oldValue === undefined || !fieldDef) {
                continue;
            }

            let normalizedOld: any;
            let normalizedNew: any;
            let changed = false;

            switch (fieldDef.type) {
                case 'number':
                    normalizedOld = oldValue ? parseFloat(oldValue as string) : null;
                    normalizedNew = newValue ? parseFloat(newValue as string) : null;
                    changed = normalizedOld !== normalizedNew;
                    break;

                case 'date':
                    normalizedOld = new Date(oldValue as string).getTime();
                    normalizedNew = new Date(newValue as string).getTime();
                    changed = normalizedOld !== normalizedNew;
                    break;

                default:
                    normalizedOld = oldValue;
                    normalizedNew = newValue;
                    changed = oldValue !== newValue;
                    break;
            }

            if (changed) {
                result.push(`${fieldname} changed from ${normalizedOld} to ${normalizedNew}`);
                SafePropertyAccess.set(tmpObject, fieldname, newValue);
                SafePropertyAccess.set(changes, fieldname, newValue);
            }
        }

        if (errors.length > 0) {
            throw new Error(`Validation failed: ${errors.join(', ')}`);
        }

        return {
            updated: tmpObject,
            changes,
            message: result,
            count: result.length
        };
    }

    async performUpdateIfChange<DTO>(
        dtoClass: DtoConstructor<DTO>,
        oldObject: T,
        newObject: DTO,
        excludeFields: string[] = []
    ) {
        const schema = this.getOrCreateSchema(dtoClass);
        const state = this.updateObject(schema, oldObject, newObject as any, excludeFields);

        if (state.count > 0) {
            const id: string | undefined = SafePropertyAccess.get(oldObject, this.idFieldName);
            if (id) {
                await this.update(id, state.changes);
            }
        }

        return state;
    }

    /**
     * Finds a single record based on the provided query options.
     * Applies default initial query, filters, sorting, and includes.
     *
     * @param options - Optional query configuration including filters, sorting, and includes
     * @returns Promise resolving to a Result containing the found record or null if not found
     */
    async findOne(options?: QueryOptions | FindOptions): Promise<T | null> {
        try {
            let findOptions: any;
            if (options) {
                findOptions = options instanceof QueryOptions ? this.buildFindOptions(options) : options;
            }
            const rawResult = this.returnRaw || (findOptions?.raw ?? false);
            const item = await this.cachedFind('findOne', [findOptions, rawResult], rawResult, async () => {
                return this.model.findOne(findOptions);
            });
            return this.returnRaw && item ? (item.get?.({ plain: true }) ?? item) : item;
        } catch (error) {
            this.logger.error(`findOne error ${error}`);
            throw error;
        }
    }

    /**
     * Finds all records matching the provided query options.
     * Applies default initial query, filters, sorting, and includes.
     *
     * @param options - Optional query configuration including filters, sorting, and includes
     * @returns Promise resolving to a Result containing an array of matching records
     */
    async findAll(options?: QueryOptions | FindOptions): Promise<T[]> {
        try {
            let findOptions: any;
            let rawResult: boolean | undefined = false;

            if (options) {
                findOptions = options instanceof QueryOptions ? this.buildFindOptions(options) : options;
                rawResult = options instanceof QueryOptions ? options.rawResult : (options.raw ?? false);
            }

            const resultIsRaw = this.returnRaw || rawResult === true;
            const items = await this.cachedFind('findAll', [findOptions, resultIsRaw], resultIsRaw, async () => {
                return this.model.findAll(findOptions);
            });
            return (this.returnRaw || rawResult === true) && items
                ? items.map((item) => item.get?.({ plain: true }) ?? item)
                : items;
        } catch (error) {
            this.logger.error(`findAll error ${error}`);
            throw error;
        }
    }

    /**
     * Finds records with pagination support.
     * Returns paginated results with metadata including total count, page info, and navigation flags.
     * this will now also suport filter {field:{value: 'search', operator: 'like'}}
     * @param options - Optional query configuration including pagination settings
     * @returns Promise resolving to a Result containing paginated data and metadata
     */
    async findWithPagination(options?: QueryOptions): Promise<PaginatedResult<T>> {
        try {
            if (!options) {
                options = {
                    page: 0,
                    pageSize: 10
                }
            }
            const { pagination } = options || {};
            const page = pagination?.page || +options.page! || 1;
            const pageSize = pagination?.pageSize || +options.pageSize! || 10;
            const offset = (page - 1) * pageSize;

            const findOptions = this.buildFindOptions(options);
            const rawResult = this.returnRaw;
            const cachedResult = await this.cachedFind(
                'findWithPagination',
                [findOptions, page, pageSize, rawResult],
                rawResult,
                async () => {
                    const { count, rows } = await this.model.findAndCountAll({
                        ...findOptions,
                        limit: pageSize,
                        offset,
                        distinct: true // Important for associations
                    });

                    return { count, rows };
                }
            );

            const totalPages = Math.ceil(cachedResult.count / pageSize);
            const datarows =
                this.returnRaw && cachedResult.rows
                    ? cachedResult.rows.map((item) => item.get?.({ plain: true }) ?? item)
                    : cachedResult.rows;

            const result: PaginatedResult<T> = {
                items: datarows,
                total: cachedResult.count,
                page,
                size: cachedResult.count,
                pageSize,
                totalPages,
                hasNext: page < totalPages,
                hasPrev: page > 1
            };

            return result;
        } catch (error) {
            this.logger.error(`findWithPagination error ${error}`);
            throw error;
        }
    }

    /**
     * Executes a named query to find a single record.
     * Named queries are predefined query patterns registered via addNamedQuery.
     * Supports parameter substitution for flexible, reusable queries.
     *
     * @template R - The return type for the named query (defaults to T)
     * @param queryName - The name of the registered named query
     * @param options - Optional query configuration (excludes initialQuery as it's defined in the named query)
     * @param parameters - Optional parameters to substitute in the named query (e.g., { uuid: "123", active: true })
     * @returns Promise resolving to a Result containing the found record or null if not found
     */
    async findOneNamed<K extends keyof Q & string, R = T>(
        queryName: K,
        options?: Omit<QueryOptions, 'initialQuery'>,
        parameters?: Q[K]
    ): Promise<R | null> {
        try {
            const namedQuery = Object.prototype.hasOwnProperty.call(this.namedQueries, queryName)
                ? SafePropertyAccess.get<NamedQuery>(this.namedQueries, queryName)
                : null;

            if (!namedQuery) {
                const error = new Error(`Named query '${queryName}' not found`);
                this.logger.error(`findOneNamed error ${error}`);
                throw error;
            }

            // Validate parameters if defined
            const paramValidationResult = this.validateParameters(namedQuery, parameters);
            if (!paramValidationResult.isValid) {
                const error = new Error(paramValidationResult.error);
                this.logger.error(`findOneNamed error ${error}`);
                throw error;
            }

            const findOptions = this.buildNamedQueryOptions(namedQuery, options, parameters);
            const rawResult = this.returnRaw || findOptions.raw === true;
            const item = await this.cachedFind(
                'findOneNamed',
                [queryName, findOptions, parameters, rawResult],
                rawResult,
                async () => {
                    return this.model.findOne(findOptions);
                }
            );
            return (this.returnRaw && item ? (item.get?.({ plain: true }) ?? item) : item) as unknown as R | null;
        } catch (error) {
            this.logger.error(`findOneNamed error ${error}`);
            throw error;
        }
    }

    /**
     * Executes a named query to find all matching records.
     * Named queries are predefined query patterns registered via addNamedQuery.
     * Supports parameter substitution for flexible, reusable queries.
     *
     * @template R - The return type for the named query (defaults to T)
     * @param queryName - The name of the registered named query
     * @param options - Optional query configuration (excludes initialQuery as it's defined in the named query)
     * @param parameters - Optional parameters to substitute in the named query (e.g., { uuid: "123", active: true })
     * @returns Promise resolving to a Result containing an array of matching records
     */
    async findAllNamed<K extends keyof Q & string, R = T>(
        queryName: K,
        options?: Omit<QueryOptions, 'initialQuery'>,
        parameters?: Q[K]
    ): Promise<R[]> {
        try {
            const namedQuery = Object.prototype.hasOwnProperty.call(this.namedQueries, queryName)
                ? SafePropertyAccess.get<NamedQuery>(this.namedQueries, queryName)
                : null;

            if (!namedQuery) {
                const error = new Error(`Named query '${queryName}' not found`);
                this.logger.error(`findAllNamed error ${error}`);
                throw error;
            }

            // Validate parameters if defined
            const paramValidationResult = this.validateParameters(namedQuery, parameters);
            if (!paramValidationResult.isValid) {
                const error = new Error(paramValidationResult.error);
                this.logger.error(`findAllNamed error ${error}`);
                throw error;
            }
            const findOptions = this.buildNamedQueryOptions(namedQuery, options, parameters);
            this.debugLog(findOptions);

            const rawResult = this.returnRaw || findOptions.raw === true;
            const items = await this.cachedFind(
                'findAllNamed',
                [queryName, findOptions, parameters, rawResult],
                rawResult,
                async () => {
                    return this.model.findAll(findOptions);
                }
            );
            return (this.returnRaw && items && Array.isArray(items)
                ? items.map((item) => item.get?.({ plain: true }) ?? item)
                : items) as unknown as R[];
        } catch (error) {
            this.logger.error(`findAllNamed error ${error}`);
            throw error;
        }
    }

    /**
     * Executes a field search query designed for controller/API usage.
     * Searches across multiple fields using a single search term from QueryOptions.filters.
     * Perfect for REST API endpoints that need flexible search functionality.
     *
     * @template R - The return type for the field search query (defaults to T)
     * @param queryName - The name of the registered field search query
     * @param options - Query configuration with search term in filters and other options
     * @returns Promise resolving to a Result containing the found record or null if not found
     *
     * @example
     * // From a NestJS controller:
     * const queryOptions: QueryOptions = {
     *   filters: { q: 'john', status: 'active' },
     *   pagination: { page: 1, pageSize: 10 }
     * };
     * const result = await store.findOneByFieldSearch('searchUsers', queryOptions);
     */
    async findOneByFieldSearch<R = T>(queryName: string, options?: QueryOptions): Promise<R | null> {
        try {
            const namedQuery = Object.prototype.hasOwnProperty.call(this.namedQueries, queryName)
                ? SafePropertyAccess.get<NamedQuery>(this.namedQueries, queryName)
                : null;

            if (!namedQuery || !(namedQuery as any).fieldSearchConfig) {
                const error = new Error(`Field search query '${queryName}' not found`);
                this.logger.error(`findOneByFieldSearch error ${error}`);
                throw error;
            }

            const findOptions = this.buildFieldSearchQueryOptions(namedQuery, options);
            const rawResult = this.returnRaw || findOptions.raw === true;
            const item = await this.cachedFind(
                'findOneByFieldSearch',
                [queryName, findOptions, rawResult],
                rawResult,
                async () => {
                    return this.model.findOne(findOptions);
                }
            );
            return (this.returnRaw && item ? (item.get?.({ plain: true }) ?? item) : item) as unknown as R | null;
        } catch (error) {
            this.logger.error(`findOneByFieldSearch error ${error}`);
            throw error;
        }
    }

    /**
     * Executes a field search query to find all matching records.
     * Designed for controller/API usage with search terms in QueryOptions.filters.
     *
     * @template R - The return type for the field search query (defaults to T)
     * @param queryName - The name of the registered field search query
     * @param options - Query configuration with search term in filters and other options
     * @returns Promise resolving to a Result containing an array of matching records
     */
    async findAllByFieldSearch<R = T>(queryName: string, options?: QueryOptions): Promise<R[]> {
        try {
            const namedQuery = Object.prototype.hasOwnProperty.call(this.namedQueries, queryName)
                ? SafePropertyAccess.get<NamedQuery>(this.namedQueries, queryName)
                : null;

            if (!namedQuery || !(namedQuery as any).fieldSearchConfig) {
                const error = new Error(`Field search query '${queryName}' not found`);
                this.logger.error(`findAllByFieldSearch error ${error}`);
                throw error;
            }

            const findOptions = this.buildFieldSearchQueryOptions(namedQuery, options);
            const rawResult = this.returnRaw || findOptions.raw === true;
            const items = await this.cachedFind(
                'findAllByFieldSearch',
                [queryName, findOptions, rawResult],
                rawResult,
                async () => {
                    return this.model.findAll(findOptions);
                }
            );
            return (this.returnRaw && items
                ? items.map((item) => item.get?.({ plain: true }) ?? item)
                : items) as unknown as R[];
        } catch (error) {
            this.logger.error(`findAllByFieldSearch error ${error}`);
            throw error;
        }
    }

    /**
     * Executes a named query with pagination support.
     * Combines the benefits of named queries with paginated results.
     * Supports parameter substitution for flexible, reusable queries.
     *
     * @template R - The return type for the named query (defaults to T)
     * @param queryName - The name of the registered named query
     * @param options - Optional query configuration including pagination settings (excludes initialQuery)
     * @param parameters - Optional parameters to substitute in the named query (e.g., { uuid: "123", active: true })
     * @returns Promise resolving to a Result containing paginated data and metadata
     */
    async findNamedWithPagination<R = T>(
        queryName: string,
        options?: Omit<QueryOptions, 'initialQuery'>,
        parameters?: Record<string, any>
    ): Promise<PaginatedResult<R>> {
        try {
            const namedQuery = Object.prototype.hasOwnProperty.call(this.namedQueries, queryName)
                ? SafePropertyAccess.get<NamedQuery>(this.namedQueries, queryName)
                : null;

            if (!namedQuery) {
                const error = new Error(`Named query '${queryName}' not found`);
                this.logger.error(`findNamedWithPagination error ${error}`);
                throw error;
            }

            // Validate parameters if defined
            const paramValidationResult = this.validateParameters(namedQuery, parameters);
            if (!paramValidationResult.isValid) {
                const error = new Error(paramValidationResult.error);
                this.logger.error(`findNamedWithPagination error ${error}`);
                throw error;
            }

            if (!options) {
                options = {
                    page: 0,
                    pageSize: 10
                }
            }

            const { pagination } = options || {page:0,pageSize:10};
            const page = +pagination!.page || +options.page! || 1; // some calls do not pack the pagination inside the object
            const pageSize = +pagination!.pageSize || +options.pageSize! || 10;
            const offset = (page - 1) * pageSize;

            const findOptions = this.buildNamedQueryOptions(namedQuery, options, parameters);

            const rawResult = this.returnRaw || findOptions.raw === true;
            const cachedResult = await this.cachedFind(
                'findNamedWithPagination',
                [queryName, findOptions, parameters, page, pageSize, rawResult],
                rawResult,
                async () => {
                    const { count, rows } = await this.model.findAndCountAll({
                        ...findOptions,
                        limit: pageSize,
                        offset,
                        distinct: true
                    });

                    return { count, rows };
                }
            );

            const totalPages = Math.ceil(cachedResult.count / pageSize);
            const datarows = this.returnRaw
                ? cachedResult.rows.map((item) => item.get?.({ plain: true }) ?? item)
                : cachedResult.rows;

            const result: PaginatedResult<R> = {
                items: datarows as unknown as R[],
                total: cachedResult.count,
                page,
                size: cachedResult.count,
                pageSize,
                totalPages,
                hasNext: page < totalPages,
                hasPrev: page > 1
            };

            return result;
        } catch (error) {
            this.logger.error(`findNamedWithPagination error ${error}`);
            throw error;
        }
    }

    /**
     * Creates a new record in the database.
     * Calls beforeCreate and afterCreate lifecycle hooks.
     *
     * @param data - Partial record data containing the fields to be created
     * @param user - The user performing the operation (optional)
     * @returns Promise resolving to a Result containing the newly created record
     */
    async create(data: Partial<T['_attributes']>, user?: U): Promise<T> {
        try {
            // Call beforeCreate hook
            const processedData = await this.beforeCreate(data, user);

            // Lazy initialization: check which fields exist on first use
            this.ensureTimestampFieldsInitialized();

            const record: any = { ...processedData };
            const recordValue = SafePropertyAccess.get<any>(record, this.idFieldName);
            if (recordValue === undefined || recordValue === '' || recordValue === 'new') {
                SafePropertyAccess.set(record, this.idFieldName, crypto.randomUUID());
            }

            // Only auto-fill fields that exist in the model (cached check for performance)
            if (this.timestampFieldsExist && this.timestampFieldsExist.createdAt) {
                this.autoFillMandatoryField(this.timestampFields.createdAt, record, new Date());
            }
            if (this.timestampFieldsExist && this.timestampFieldsExist.createdBy) {
                this.autoFillMandatoryField(this.timestampFields.createdBy, record, user ? user.gid : 'system');
            }

            const item = await this.model.create(record);

            // Call afterCreate hook
            await this.afterCreate(item, user);
            // Any write can affect id and query cache entries for this store.
            await this.invalidateCache();

            return item;
        } catch (error) {
            this.logger.error(`create error ${error}`);
            throw error;
        }
    }

    /**
     * Updates an existing record by its ID.
     * Applies default initial query to ensure only accessible records are updated.
     * Calls beforeUpdate and afterUpdate lifecycle hooks.
     *
     * @param id - The primary key of the record to update
     * @param data - Partial record data containing the fields to be updated
     * @param idField - Optional field name to use for ID matching
     * @param user - The user performing the operation (optional)
     * @returns Promise resolving to a Result containing the updated record or null if not found/updated
     */
    async update(id: string | number, data: Partial<T['_attributes']>, idField?: string, user?: U): Promise<T | null> {
        try {
            if (data && data.dataValues && data.get) {
                // convert to raw value
                data = data.get({ plain: true });
            }

            // Call beforeUpdate hook
            const processedData = await this.beforeUpdate(id, data, user);

            // Lazy initialization: check which fields exist on first use
            this.ensureTimestampFieldsInitialized();

            const record = { ...processedData } as any;

            // Only auto-fill fields that exist in the model (cached check for performance)
            if (this.timestampFieldsExist && this.timestampFieldsExist.updatedAt) {
                this.autoFillMandatoryField(this.timestampFields.updatedAt, record, new Date());
            }
            if (this.timestampFieldsExist && this.timestampFieldsExist.updatedBy) {
                this.autoFillMandatoryField(this.timestampFields.updatedBy, record, user ? user.gid : 'system');
            }

            // Build where clause that includes initial query
            const whereClause: any = {
                ...this.defaultInitialQuery
            };
            const idFieldName = idField ?? this.idFieldName;
            whereClause[idFieldName] = id; // set the default id field

            const [affectedCount] = await this.model.update(record, {
                where: whereClause
            });

            if (affectedCount === 0) {
                return null;
            }

            const updatedItem = await this.model.findOne({
                where: whereClause
            });

            if (updatedItem) {
                // Call afterUpdate hook
                await this.afterUpdate(updatedItem, user);
                // Any write can affect id and query cache entries for this store.
                await this.invalidateCache();
            }

            return updatedItem;
        } catch (error) {
            this.logger.error(`update error ${error}`);
            throw error;
        }
    }

    /**
     * Updates multiple records in batches for better performance.
     * Processes records in chunks to avoid memory issues with large datasets.
     * Each record must contain the ID field for identification (configured via idFieldName).
     *
     * @param data - Array of partial record data containing fields to update (must include ID field)
     * @param batchSize - Number of records to process per batch (default: 100)
     * @param transaction - Optional transaction to ensure atomic operations
     * @returns Promise resolving to an array of update results, each containing affected count and rows
     *
     * @example
     * const updates = [
     *   { uuid: '123', name: 'Updated Name 1' },
     *   { uuid: '456', name: 'Updated Name 2' }
     * ];
     * const results = await store.bulkUpdate(updates, 50);
     *
     * @example
     * // With transaction for atomic updates
     * const transaction = await sequelize.transaction();
     * try {
     *   const results = await store.bulkUpdate(updates, 50, transaction);
     *   await transaction.commit();
     * } catch (error) {
     *   await transaction.rollback();
     *   throw error;
     * }
     */
    async bulkUpdate(
        data: Partial<T['_attributes']>[],
        batchSize: number = 100,
        transaction?: Transaction
    ): Promise<[affectedCount: number, affectedRows: T[]][]> {
        this.logger.debug(`bulkUpdate with ${data.length} items`);
        const chunks: Partial<T['_attributes']>[][] = [];

        if (data && data.length) {
            for (let i = 0; i < data.length; i += batchSize) {
                chunks.push(data.slice(i, i + batchSize));
            }
        }

        const promises: Promise<[affectedCount: number, affectedRows: T[]][]>[] = chunks.map(async (chunk, index) => {
            const updatePromises = chunk.map(async (record): Promise<[number, T[]]> => {
                try {
                    const plainRecord = record && typeof (record as any).get === 'function'
                        ? (record as any).get({ plain: true })
                        : record;
                    const idValue = SafePropertyAccess.get(plainRecord, this.idFieldName);
                    const updateData = { ...plainRecord };
                    SafePropertyAccess.delete(updateData, this.idFieldName);
                    const whereClause: any = {};
                    SafePropertyAccess.set(whereClause, this.idFieldName, idValue);

                    const result = await this.model.update(updateData, {
                        where: whereClause,
                        returning: true,
                        transaction
                    });

                    if (!result[0]) {
                        this.logger.warn(`No rows updated for ${this.idFieldName}=${idValue}`);
                    }
                    return result;
                } catch (error) {
                    this.logger.error(`Error updating record:`, error);
                    this.logger.error(JSON.stringify(chunk));
                    throw error;
                }
            });

            try {
                return await Promise.all(updatePromises);
            } catch (error) {
                this.logger.error(`Error in chunk ${index + 1}:`, error);
                throw error;
            }
        });

        const results = await Promise.all(promises);
        if (!results) {
            return [];
        }
        const flattened = results.flat();
        if (!flattened) {
            return [];
        }
        // Bulk updates can affect arbitrary cached query results.
        await this.invalidateCache();
        return flattened;
    }

    /**
     * Deletes a record by its ID.
     * Applies default initial query to ensure only accessible records are deleted.
     * Calls beforeDelete and afterDelete lifecycle hooks.
     *
     * @param uuid - The primary key of the record to delete
     * @param user - The user performing the operation (optional)
     * @returns Promise resolving to a Result containing true if deleted, false if not found
     */
    async delete(uuid: string | number, user?: U): Promise<boolean> {
        try {
            // Call beforeDelete hook
            await this.beforeDelete(uuid, user);

            // Build where clause that includes initial query
            const whereClause: any = {
                ...this.defaultInitialQuery
            };
            SafePropertyAccess.set(whereClause, this.idFieldName, uuid); // set the default id field
            //whereClause[this.idFieldName] = uuid;
            const deletedCount = await this.model.destroy({
                where: whereClause
            });

            if (deletedCount > 0) {
                // Call afterDelete hook
                await this.afterDelete(uuid, user);
                // Deletions make cached id and query reads stale.
                await this.invalidateCache();
                return true;
            }

            return false;
        } catch (error) {
            this.logger.error(`delete error ${error}`);
            throw error;
        }
    }

    /**
     * Deletes records matching the provided WHERE clause.
     * Applies default initial query to ensure only accessible records are deleted.
     * More flexible than delete() as it allows complex query conditions.
     *
     * @param where - Sequelize WHERE clause specifying which records to delete
     * @param transaction - Optional transaction to ensure atomic operations
     * @returns Promise resolving to true if any records were deleted, false otherwise
     *
     * @example
     * // Delete all inactive users
     * const deleted = await store.deleteWhere({ active: false });
     *
     * @example
     * // Delete with complex conditions
     * const deleted = await store.deleteWhere({
     *   [Op.and]: [
     *     { status: 'expired' },
     *     { createdAt: { [Op.lt]: new Date('2024-01-01') } }
     *   ]
     * });
     *
     * @example
     * // With transaction
     * const transaction = await sequelize.transaction();
     * try {
     *   await store.deleteWhere({ status: 'archived' }, transaction);
     *   await transaction.commit();
     * } catch (error) {
     *   await transaction.rollback();
     *   throw error;
     * }
     */
    async deleteWhere(where: WhereOptions, transaction?: Transaction): Promise<boolean> {
        const whereClause: any = {
            ...where,
            ...this.defaultInitialQuery
        };

        try {
            if (whereClause.where === undefined) {
                const deletedCount = await this.model.destroy({
                    where: whereClause,
                    transaction
                });
                // Deletions make cached id and query reads stale.
                if (deletedCount > 0) {
                    await this.invalidateCache();
                }
                return deletedCount > 0;
            } else {
                const deletedCount = await this.model.destroy({
                    ...whereClause,
                    transaction
                });
                // Deletions make cached id and query reads stale.
                if (deletedCount > 0) {
                    await this.invalidateCache();
                }
                return deletedCount > 0;
            }
        } catch (error) {
            this.logger.error(`delete error ${error}`);
            throw error;
        }
    }

    /**
     * Deletes multiple records matching the WHERE clause in a single operation.
     * Alias for deleteWhere() - both methods have identical functionality.
     * Applies default initial query to ensure only accessible records are deleted.
     *
     * @param where - Sequelize WHERE clause specifying which records to delete
     * @param transaction - Optional transaction to ensure atomic operations
     * @returns Promise resolving to true if any records were deleted, false otherwise
     *
     * @example
     * const deleted = await store.bulkDelete({ status: 'archived' });
     *
     * @example
     * // With transaction
     * const transaction = await sequelize.transaction();
     * try {
     *   await store.bulkDelete({ status: 'archived' }, transaction);
     *   await transaction.commit();
     * } catch (error) {
     *   await transaction.rollback();
     *   throw error;
     * }
     */
    async bulkDelete(where: WhereOptions, transaction?: Transaction): Promise<boolean> {
        return this.deleteWhere(where, transaction);
    }

    /**
     * Creates multiple records in a single database operation.
     * More efficient than multiple individual create calls.
     *
     * @param data - Array of partial record data for bulk creation
     * @param batchSize - Number of records to process per batch
     * @param transaction - Optional transaction to ensure atomic operations
     * @returns Promise resolving to a Result containing an array of created records
     *
     * @example
     * // Without transaction
     * const results = await store.bulkCreate(records, 100);
     *
     * @example
     * // With transaction for atomic creation
     * const transaction = await sequelize.transaction();
     * try {
     *   const results = await store.bulkCreate(records, 100, transaction);
     *   await transaction.commit();
     * } catch (error) {
     *   await transaction.rollback();
     *   throw error;
     * }
     */
    async bulkCreate(
        data: Partial<T['_attributes']>[],
        batchSize: number,
        transaction?: Transaction
    ): Promise<Partial<T['_attributes']>[]> {
        try {
            const chunks: Partial<T['_attributes']>[][] = [];
            for (let i = 0; i < data.length; i += batchSize) {
                chunks.push(data.slice(i, i + batchSize));
            }

            // Create array of promises
            const promises = chunks.map((chunk, index) => {
                return this.model
                    .bulkCreate(chunk as any, { transaction })
                    .then((result: Partial<T['_attributes']>[]) => {
                        this.logger.log(`Chunk ${index + 1}/${chunks.length} completed`);
                        return result;
                    })
                    .catch((error: Error) => {
                        this.logger.error(`Error in chunk ${index + 1}:`, error);
                        throw error;
                    });
            });

            // Wait for all promises to resolve
            const results = await Promise.all(promises);

            // Flatten the results array
            // Bulk creates can change list and paginated query results.
            await this.invalidateCache();
            return results.flat();
        } catch (error) {
            this.logger.error(`bulkCreate error ${error}`);
            throw error;
        }
    }

    /**
     * Updates an existing record or creates a new one if it doesn't exist.
     * If ID is provided and record exists, it will be updated. Otherwise, a new record is created.
     *
     * @param data - Record data containing fields to be created or updated (should include ID for update operations)
     * @param id - Optional explicit ID to check for existing record (uses data.id if not provided)
     * @returns Promise resolving to a Result containing the upserted record and a boolean indicating if it was created (true) or updated (false)
     */
    async upsert(data: Partial<T['_attributes']>, options: UpsertOptions): Promise<{ record: T; created: boolean }> {
        try {
            // Use provided ID or extract from data
            let idField = this.idFieldName;
            let recordId = options.uuid || SafePropertyAccess.get<any>(data as any, this.idFieldName);
            if (options.match) {
                idField = Object.keys(options.match)[0];
                recordId = options.match[idField];
            }

            // Try to find existing record
            let existing = null;
            if (recordId) {
                const where:any = {};
                where[idField] = recordId;
                existing = await this.findOne({ where });
            }

            if (existing !== null) {
                // Record exists - update it
                const updateResult = await this.update(recordId, data, idField);
                if (updateResult !== null) {
                    return { record: updateResult, created: false };
                }
                // If update returns null, fall through to create
                this.logger.warn(`upsert: update returned null for id ${recordId}, creating new record`);
            }

            // Record doesn't exist (or update failed) - create new one
            const createResult = await this.create(data);
            return { record: createResult, created: true };
        } catch (error) {
            this.logger.error(`upsert error ${error}`);
            throw error;
        }
    }

    /**
     * Counts the number of records matching the provided query options.
     * Useful for getting totals without retrieving all records.
     *
     * @param options - Optional query configuration for filtering and includes
     * @returns Promise resolving to a Result containing the count of matching records
     */
    async count(options?: QueryOptions): Promise<number> {
        try {
            const findOptions = this.buildFindOptions(options);
            const count = await this.model.count({
                where: findOptions.where,
                include: findOptions.include,
                distinct: true
            });
            return count;
        } catch (error) {
            this.logger.error(`count  error ${error}`);
            throw error;
        }
    }

    /**
     * Finds the maximum value of a specific field in the table.
     * Useful for finding the highest ID, latest date, or maximum numeric value.
     *
     * @param field - The name of the field to find the maximum value for
     * @param findOptions - Optional Sequelize FindOptions to filter records
     * @returns Promise resolving to the maximum value found
     *
     * @example
     * // Find the highest order number
     * const maxOrder = await store.max('orderNumber', { where: { status: 'completed' } });
     */
    async max(field: string, findOptions: FindOptions): Promise<number | null> {
        try {
            const count: number | null = await this.model.max(field, {
                where: findOptions.where
            });
            return count;
        } catch (error) {
            this.logger.error(`count  error ${error}`);
            throw error;
        }
    }

    /**
     * Updates a record only if it exists and the user has access to it.
     * Performs an access check before updating using the hasAccess() method.
     *
     * @param id - The primary key of the record to update
     * @param data - Partial record data containing the fields to be updated
     * @param user - The user performing the operation (used for access control)
     * @returns Promise resolving to an object with the updated record or an error
     *
     * @example
     * const result = await store.updateIfExists('123', { name: 'New Name' }, currentUser);
     * if (result.error) {
     *   console.error('Update failed:', result.error);
     * } else {
     *   console.log('Updated:', result.record);
     * }
     */
    async updateIfExists(
        id: string,
        data: Partial<T['_attributes']>,
        user: U
    ): Promise<{ record: T | null ; error: Error | null }> {
        try {
            const item = await this.findById(id);
            if (item !== null && this.hasAccess(item, user)) {
                const record : any = await this.update(id, data, undefined, user);
                return { record, error: null };
            } else {
                return { record: null, error: new Error('Nothing found') };
            }
        } catch (error) {
            this.logger.error(`updateIfExists error ${error}`);
            throw error;
        }
    }

    /**
     * Deletes a record only if it exists and the user has access to it.
     * Performs an access check before deleting using the hasAccess() method.
     *
     * @param id - The primary key of the record to delete
     * @param user - The user performing the operation (used for access control)
     * @returns Promise resolving to an object indicating if the record was removed or an error occurred
     *
     * @example
     * const result = await store.deleteIfExists('123', currentUser);
     * if (result.error) {
     *   console.error('Delete failed:', result.error);
     * } else {
     *   console.log('Deleted:', result.removed);
     * }
     */
    async deleteIfExists(id: string, user: U): Promise<{ removed: boolean; error: Error | null }> {
        try {
            const item = await this.findById(id);
            if (item !== null && this.hasAccess(item, user)) {
                const removed = await this.delete(id);
                return { removed, error: null };
            } else {
                return { removed: false, error: new Error('Nothing found') };
            }
        } catch (error) {
            this.logger.error(`deleteIfExists error ${error}`);
            throw error;
        }
    }

    /**
     * Automatically fills a mandatory field with default data if the field exists in the model and is not set.
     * Used internally to ensure required fields like 'created', 'createdby', etc. have values.
     *
     * @param fieldName - The name of the field to auto-fill
     * @param record - The record object to modify
     * @param defaultData - The default value to use if the field is empty
     * @returns The modified record object
     * @protected
     */
    protected autoFillMandatoryField<R extends Record<string, any>>(fieldName: string, record: R, defaultData: any): R {
        const rf = SafePropertyAccess.get(record, fieldName);
        if ((this.fieldExistsInModel(fieldName) && rf === null) || rf === undefined) {
            SafePropertyAccess.set(record, fieldName, defaultData);
        }
        return record;
    }

    /**
     * Builds Sequelize FindOptions from the provided QueryOptions.
     * Combines default initial query, per-request initial query, filters, sorting, and includes.
     *
     * @param options - Optional query configuration
     * @returns Sequelize FindOptions object ready for database queries
     * @protected
     */
    protected buildFindOptions(options?: QueryOptions): FindOptions {
        const findOptions: FindOptions = {};

        // Combine initial queries (default + per-request)
        const combinedInitialQuery = {
            ...this.defaultInitialQuery,
            ...options?.initialQuery
        };

        // Combine initial query with filters
        const allFilters = {
            ...combinedInitialQuery,
            ...options?.filter
        };

        // Check for both string keys and Symbol keys (Sequelize operators)
        const hasFilters = Object.keys(allFilters).length > 0 || Object.getOwnPropertySymbols(allFilters).length > 0;

        if (hasFilters) {
            findOptions.where = this.buildWhereClause(allFilters);
        }

        if (options?.sort) {
            findOptions.order = this.buildOrderClause(options.sort);
        }

        if (options?.include) {
            findOptions.include = this.buildIncludeClause(options.include);
        }

        return findOptions;
    }

    /**
     * Builds a Sequelize WHERE clause from filter options.
     * Supports both simple equality filtering and complex Sequelize operators.
     * Handles nested operator expressions like Op.and, Op.or, Op.between, etc.
     * Ignores null and undefined values in simple filters.
     *
     * @param filters - Key-value pairs for filtering records, can include Sequelize operators
     * @returns Sequelize WhereOptions object
     * @protected
     *
     * @example
     * // Simple equality filters
     * buildWhereClause({ name: "John", age: 25 })
     *
     * @example
     * // Complex operator filters
     * buildWhereClause({
     *   [Op.and]: [
     *     { deviceId: "device123" },
     *     { isCompleted: false },
     *     { dueDate: { [Op.between]: [startDate, endDate] } }
     *   ]
     * })
     */
    protected buildWhereClause(filters: FilterOptions): WhereOptions {
        const where: WhereOptions = {};

        // Handle string keys (regular properties)
        for (const [key, value] of Object.entries(filters)) {
            if (typeof value === 'string') {
                if (value !== undefined && value !== null) {
                    SafePropertyAccess.set(where, key, value);
                }
            } else {
                const operator = value.operator;
                if (operator) {
                    switch (operator) {
                        case 'like':
                            (where as any)[key] = { [Op.like]: `${value.value}%` };
                            break;
                        case 'contains':
                            (where as any)[key] = { [Op.like]: `%${value.value}%` };
                            break;
                        case 'gt':
                            (where as any)[key] = { [Op.gt]: value.value };
                            break;
                        case 'gte':
                            (where as any)[key] = { [Op.gte]: value.value };
                            break;
                        case 'lt':
                            (where as any)[key] = { [Op.lt]: value.value };
                            break;
                        case 'lte':
                            (where as any)[key] = { [Op.lte]: value.value };
                            break;
                        case 'in':
                            (where as any)[key] = { [Op.in]: value.value.split(',') };
                            break;
                        default:
                            (where as any)[key] = value.value;
                            break;
                    }
                } else {
                    SafePropertyAccess.set(where, key, value);
                }
            }
        }

        // Handle Symbol keys (Sequelize operators like Op.and, Op.or, etc.)
        for (const symbol of Object.getOwnPropertySymbols(filters)) {
            //nosemgrep: gitlab.eslint.detect-object-injection -> its a symbol
            const value = (filters as any)[symbol];
            if (value !== undefined && value !== null) {
                //nosemgrep: gitlab.eslint.detect-object-injection -> its a symbol
                (where as any)[symbol] = value;
            }
        }

        return where;
    }

    /**
     * Builds a Sequelize ORDER clause from sort options.
     * Validates that field names exist in the model schema before using them.
     *
     * @param sort - Object containing field name and sort direction
     * @returns Sequelize Order array format [[field, direction]]
     * @throws Error if any field name does not exist in the model
     * @protected
     */
    protected buildOrderClause(sort: SortOptions[] | string[]): Order {
        const result: Order = [];
        sort.forEach((item) => {
            const fields = typeof item === 'string' ? item.split(':') : item.field.split(':');
            const fieldName = fields[0];

            // Validate field name against model schema
            this.validateFieldName(fieldName, 'sorting');

            const direction =
                typeof item === 'string'
                    ? fields.length > 1
                        ? fields[1]
                        : 'ASC'
                    : (item.direction ?? (fields.length > 1 ? fields[1] : 'ASC'));
            result.push([fieldName, direction]);
        });
        return result;
    }

    /**
     * Builds a Sequelize INCLUDE clause from an array of association names.
     * Creates basic associations - can be extended for nested includes or specific options.
     * Validates that associations exist in the model before using them.
     *
     * @param includes - Array of association names to include in the query
     * @returns Array of Sequelize Includeable objects
     * @throws Error if any association name does not exist in the model
     * @protected
     */
    protected buildIncludeClause(includes: string[]): Includeable[] {
        // This is a basic implementation - you might want to extend this
        // to handle nested includes or specific association options
        return includes.map((include) => {
            // Validate association exists
            const associations = this.model.associations;
            if (associations && !Object.prototype.hasOwnProperty.call(associations, include)) {
                throw new Error(
                    `Invalid association '${include}' for include in model ${this.model.name}. Association does not exist.`
                );
            }
            return { association: include };
        });
    }

    /**
     * Builds FindOptions for named queries by merging named query settings with runtime options.
     * Handles parameter substitution by replacing placeholders like $paramName with actual values.
     * Also handles dynamic field search queries that build where clauses from field configurations.
     * Combines the named query's base options with default initial query and runtime filters/options.
     *
     * @param namedQuery - The named query configuration object
     * @param options - Optional runtime query configuration (excludes initialQuery)
     * @param parameters - Optional parameters to substitute in the named query placeholders
     * @returns Sequelize FindOptions object with merged settings and substituted parameters
     * @protected
     */
    protected buildNamedQueryOptions(
        namedQuery: NamedQuery,
        options?: Omit<QueryOptions, 'initialQuery'>,
        parameters?: Record<string, any>
    ): FindOptions {
        let baseOptions: FindOptions;
        let queryFilterOptions: FindOptions;

        let attributes: string[] | undefined;
        if (options && options.search) {
            if (!options.filter) {
                options.filter = {};
            }
            options.filter['search'] = options.search;
        }

        // Check if this is a field search query
        const ncFsc = (namedQuery as any).fieldSearchConfig;
        if (ncFsc) {
            //this is the "search" function
            baseOptions = this.buildFieldSearchOptions(ncFsc, options?.filter || {}, namedQuery.findOptions);
            //this will add all filter[foo]=bar Querys
            queryFilterOptions = this.buildFilterSearchOptions(ncFsc, options?.filter || {});
            attributes = ncFsc.attributes;
        } else {
            // Regular named query - start with the named query's base options and substitute parameters
            baseOptions = { ...namedQuery.findOptions };
            queryFilterOptions = {};
            // Add options.filter to parameters
            if (options && options.filter) {
                if (parameters === undefined) {
                    // set it if its empty
                    parameters = {};
                }

                Object.keys(options.filter).forEach((searchKey) => {
                    const pKey = SafePropertyAccess.get(parameters, searchKey);
                    if (pKey === undefined) {
                        // only if its not set .. do not override existing ones
                        SafePropertyAccess.set(
                            parameters,
                            searchKey,
                            SafePropertyAccess.get(options.filter, searchKey)
                        );
                    }
                });
            }
            if (parameters && Object.keys(parameters).length > 0) {
                const transform = namedQuery.transform;
                baseOptions = this.substituteParameters(baseOptions, parameters, transform!);
            }
        }

        // Combine where clauses
        const combinedWhere = {
            ...this.defaultInitialQuery,
            ...baseOptions.where,
            ...queryFilterOptions.where,
            ...options?.rawfilter
        };

        const findOptions: FindOptions = {
            ...baseOptions,
            where:
                Object.keys(combinedWhere).length > 0 || Object.getOwnPropertySymbols(combinedWhere).length > 0
                    ? combinedWhere
                    : undefined
        };

        // Override/merge sorting if provided in options

        if (options && options.sort) {
            findOptions.order = this.buildOrderClause(options.sort);
        }

        // Merge includes if provided in options
        if (options && options?.include) {
            const namedIncludes = Array.isArray(baseOptions.include) ? baseOptions.include : [];
            const optionIncludes = this.buildIncludeClause(options.include);
            findOptions.include = [...namedIncludes, ...optionIncludes];
        }

        if (options && options.rawResult) {
            findOptions.raw = options.rawResult;
        }

        if (attributes) {
            // add the attributes if set wich will come from the query
            findOptions.attributes = attributes;
        }

        return findOptions;
    }

    /**
     * Validates that required parameters are provided and match expected types.
     *
     * @param namedQuery - The named query configuration containing parameter definitions
     * @param parameters - The parameters provided at runtime
     * @returns Validation result with isValid flag and error message if invalid
     * @protected
     */
    protected validateParameters(
        namedQuery: NamedQuery,
        parameters?: Record<string, any>
    ): { isValid: boolean; error?: string } {
        if (!namedQuery.parameters || namedQuery.parameters.length === 0) {
            return { isValid: true };
        }

        const providedParams = parameters || {};

        for (const paramDef of namedQuery.parameters) {
            const { name, type, required = true } = paramDef;
            const providedValue = SafePropertyAccess.get(providedParams, name);

            if (required && (providedValue === undefined || providedValue === null)) {
                return {
                    isValid: false,
                    error: `Required parameter '${name}' is missing`
                };
            }

            if (providedValue !== undefined && providedValue !== null) {
                const actualType = typeof providedValue;
                if (actualType !== type) {
                    return {
                        isValid: false,
                        error: `Parameter '${name}' expected type '${type}' but got '${actualType}'`
                    };
                }
            }
        }

        return { isValid: true };
    }

    /**
     * Configuration for filter type validation behavior.
     */
    protected filterTypeValidation: {
        enabled: boolean;
        mode: 'throw' | 'coerce' | 'warn';
        logErrors: boolean;
    } = {
            enabled: false,
            mode: 'warn',
            logErrors: true
        };

    /**
     * Enables filter type validation with the specified mode.
     * Call this in your store's constructor to enable type checking for filters.
     *
     * @param mode - Validation mode:
     *   - 'throw': Throws an error when type mismatch is detected
     *   - 'coerce': Attempts to convert the value to the correct type
     *   - 'warn': Logs a warning but continues with the original value
     * @param logErrors - Whether to log validation errors (default: true)
     *
     * @example
     * constructor() {
     *   super(MyModel);
     *   this.enableFilterTypeValidation('coerce');
     * }
     */
    enableFilterTypeValidation(mode: 'throw' | 'coerce' | 'warn' = 'warn', logErrors: boolean = true): void {
        this.filterTypeValidation = {
            enabled: true,
            mode,
            logErrors
        };
    }

    /**
     * Validates filter values against model field types.
     * Checks if the filter value type matches the expected model field type.
     *
     * @param fieldName - The name of the field being filtered
     * @param value - The filter value to validate
     * @returns Object with validation result and optionally coerced value
     * @protected
     */
    protected validateFilterType(fieldName: string, value: any): { valid: boolean; value: any; error?: string } {
        if (!this.filterTypeValidation.enabled) {
            return { valid: true, value };
        }

        if (value === null || value === undefined) {
            return { valid: true, value };
        }

        const attributes = this.model.getAttributes();
        const field = attributes[fieldName];

        if (!field) {
            return { valid: true, value };
        }

        const sequelizeType = field.type.constructor.name;
        const actualType = typeof value;

        let expectedJsType: string;
        let canCoerce = false;

        switch (sequelizeType) {
            case 'INTEGER':
            case 'BIGINT':
            case 'SMALLINT':
            case 'DECIMAL':
            case 'FLOAT':
            case 'DOUBLE':
            case 'REAL':
                expectedJsType = 'number';
                canCoerce = actualType === 'string' && !isNaN(Number(value));
                break;
            case 'BOOLEAN':
                expectedJsType = 'boolean';
                canCoerce = actualType === 'string' && (value === 'true' || value === 'false');
                break;
            case 'DATE':
            case 'DATEONLY':
            case 'TIME':
                expectedJsType = 'object';
                if (actualType === 'string') {
                    canCoerce = !isNaN(Date.parse(value));
                }
                break;
            case 'STRING':
            case 'TEXT':
            case 'CHAR':
            case 'UUID':
                expectedJsType = 'string';
                canCoerce = true;
                break;
            default:
                return { valid: true, value };
        }

        const isMatch =
            expectedJsType === actualType ||
            (expectedJsType === 'object' && value instanceof Date) ||
            (sequelizeType === 'BOOLEAN' && actualType === 'boolean');

        if (isMatch) {
            return { valid: true, value };
        }

        const error = `Type mismatch for field '${fieldName}': expected ${expectedJsType} (${sequelizeType}) but got ${actualType}`;

        if (this.filterTypeValidation.logErrors) {
            this.logger.warn(error);
        }

        switch (this.filterTypeValidation.mode) {
            case 'throw':
                return { valid: false, value, error };

            case 'coerce':
                if (canCoerce) {
                    let coercedValue: any;
                    switch (sequelizeType) {
                        case 'INTEGER':
                        case 'BIGINT':
                        case 'SMALLINT':
                            coercedValue = parseInt(value, 10);
                            break;
                        case 'DECIMAL':
                        case 'FLOAT':
                        case 'DOUBLE':
                        case 'REAL':
                            coercedValue = parseFloat(value);
                            break;
                        case 'BOOLEAN':
                            coercedValue = value === 'true';
                            break;
                        case 'DATE':
                        case 'DATEONLY':
                            coercedValue = new Date(value);
                            break;
                        default:
                            coercedValue = String(value);
                    }
                    if (this.filterTypeValidation.logErrors) {
                        this.logger.debug(`Coerced filter value for '${fieldName}': ${value} -> ${coercedValue}`);
                    }
                    return { valid: true, value: coercedValue };
                }
                return { valid: false, value, error };

            case 'warn':
            default:
                return { valid: true, value };
        }
    }

    /**
     * Validates all filter values against their corresponding model field types.
     * Returns a new filters object with validated/coerced values.
     *
     * @param filters - The filters object to validate
     * @returns Validated filters object
     * @protected
     */
    protected validateFilterTypes(filters: Record<string, any>): Record<string, any> {
        if (!this.filterTypeValidation.enabled) {
            return filters;
        }

        const validatedFilters: Record<string, any> = {};
        const errors: string[] = [];

        for (const [key, value] of Object.entries(filters)) {
            if (value !== null && value !== undefined && typeof value === 'object' && !Array.isArray(value)) {
                validatedFilters[key] = {};
                for (const [opKey, opValue] of Object.entries(value)) {
                    const result = this.validateFilterType(key, opValue);
                    if (!result.valid && result.error) {
                        errors.push(result.error);
                    }
                    validatedFilters[key][opKey] = result.value;
                }
            } else {
                const result = this.validateFilterType(key, value);
                if (!result.valid && result.error) {
                    errors.push(result.error);
                }
                validatedFilters[key] = result.value;
            }
        }

        if (errors.length > 0 && this.filterTypeValidation.mode === 'throw') {
            throw new Error(`Filter type validation failed: ${errors.join('; ')}`);
        }

        return validatedFilters;
    }

    /**
     * Recursively substitutes parameter placeholders in the findOptions object.
     * Replaces placeholder strings like '$paramName' with actual parameter values.
     *
     * This is a type-preserving recursive function that handles:
     * - Primitive values (strings, numbers, booleans, etc.)
     * - Arrays (maps over elements recursively)
     * - Objects (recursively processes all properties and symbols)
     *
     * **Wildcard Support:**
     * Use `$paramName%` (with trailing `%`) to append a wildcard to the parameter value.
     * This is useful for SQL LIKE queries with prefix matching.
     *
     * @param obj - The object to process (findOptions or nested objects)
     * @param parameters - The parameter values to substitute
     * @param transform - a list of key value tranformation functions to apply on a parameter
     * @returns A new object with parameters substituted (same structure as input)
     * @protected
     *
     * @example
     * // Basic parameter substitution
     * substituteParameters(
     *   { where: { id: '$userId' } },
     *   { userId: '123' }
     * )
     * // Result: { where: { id: '123' } }
     *
     * @example
     * // Wildcard parameter (for LIKE queries)
     * substituteParameters(
     *   { where: { name: { [Op.like]: '$name%' } } },
     *   { name: 'John' }
     * )
     * // Result: { where: { name: { [Op.like]: 'John%' } } }
     */
    protected substituteParameters<O>(
        obj: O,
        parameters: Record<string, any>,
        transform: FindOptionParameterTransform
    ): O {
        if (obj === null || obj === undefined) {
            return obj;
        }

        if (typeof obj === 'string') {
            // Check if it's a parameter placeholder
            if (obj.startsWith('$')) {
                let paramName = obj.substring(1);
                const wildChar = paramName.endsWith('%');
                if (wildChar) {
                    paramName = paramName.slice(0, -1); // cut off the %
                }
                let paramValue = wildChar ? `${parameters[paramName]}%` : parameters[paramName];

                if (transform && transform[paramName]) {
                    const transformationFunc = transform[paramName];
                    paramValue = transformationFunc(paramValue);
                }
                return parameters[paramName] !== undefined ? paramValue : obj;
            }
            return obj;
        }

        if (Array.isArray(obj)) {
            return obj.map((item) => this.substituteParameters(item, parameters, transform)) as any;
        }

        if (typeof obj === 'object') {
            const result: any = {};

            // Handle string keys
            for (const [key, value] of Object.entries(obj)) {
                SafePropertyAccess.set(result, key, this.substituteParameters(value, parameters, transform));
            }

            // Handle Symbol keys (preserve operators)
            for (const symbol of Object.getOwnPropertySymbols(obj)) {
                //nosemgrep: gitlab.eslint.detect-object-injection -> its a symbol
                result[symbol] = this.substituteParameters(obj as any [symbol], parameters, transform);
            }

            return result;
        }

        return obj;
    }

    /**
     * Builds FindOptions for filtering data based on multiple field conditions.
     * Used internally by field search queries to construct WHERE clauses from filter parameters.
     * Supports multiple match types and case sensitivity options.
     * Validates that all field names exist in the model schema.
     *
     * @param config - Configuration object defining field names, operators, and match behavior
     * @param filters - Key-value pairs of filter conditions from the query
     * @returns FindOptions with constructed WHERE clause
     * @throws Error if any field name does not exist in the model
     * @protected
     */
    buildFilterSearchOptions(
        config: {
            filterName: string;
            fields: string[];
            operator: 'and' | 'or';
            matchType?: 'exact' | 'contains' | 'startsWith' | 'endsWith';
            caseSensitive?: boolean;
            include?: Includeable[];
        },
        filters: Record<string, any>
    ): FindOptions {
        const subQuerys: Record<string, unknown>[] = [];
        const { fields, operator, matchType = 'contains', caseSensitive = false } = config;

        // Validate all field names exist in the model
        fields.forEach((field) => {
            this.validateFieldName(field, 'filter search');
        });

        // Validate filter types against model schema
        const validatedFilters = this.validateFilterTypes(filters);

        // loop thru all filters
        Object.keys(validatedFilters).forEach((field) => {
            const fdata = SafePropertyAccess.get(validatedFilters, field);
            if (fields.includes(field) && fdata !== '*') {
                // check if the fields List contains the filter
                const condition: Record<string, unknown> = {};
                const searchValue = fdata;
                switch (matchType) {
                    case 'exact':
                        // nosemgrep: gitlab.eslint.detect-object-injection -> we will check the fields beforehand
                        condition[field] = caseSensitive ? searchValue : { [Op.iLike]: searchValue };
                        break;
                    case 'contains':
                        // nosemgrep: gitlab.eslint.detect-object-injection -> we will check the fields beforehand
                        condition[field] = caseSensitive
                            ? { [Op.like]: `%${searchValue}%` }
                            : { [Op.iLike]: `%${searchValue}%` };
                        break;
                    case 'startsWith':
                        // nosemgrep: gitlab.eslint.detect-object-injection -> we will check the fields beforehand
                        condition[field] = caseSensitive
                            ? { [Op.like]: `${searchValue}%` }
                            : { [Op.iLike]: `${searchValue}%` };
                        break;
                    case 'endsWith':
                        // nosemgrep: gitlab.eslint.detect-object-injection -> we will check the fields beforehand
                        condition[field] = caseSensitive
                            ? { [Op.like]: `%${searchValue}` }
                            : { [Op.iLike]: `%${searchValue}` };
                        break;
                    default:
                        // nosemgrep: gitlab.eslint.detect-object-injection -> we will check the fields beforehand
                        condition[field] = caseSensitive
                            ? { [Op.like]: `%${searchValue}%` }
                            : { [Op.iLike]: `%${searchValue}%` };
                }

                subQuerys.push(condition);
            }
        });

        let searchWhere: any;
        if (subQuerys.length > 0) {
            if (operator === 'or') {
                searchWhere = { [Op.or]: subQuerys };
            } else {
                searchWhere = { [Op.and]: subQuerys };
            }

            return { where: searchWhere };
        } else return {};
    }

    /**
     * Builds FindOptions for dynamic field search queries.
     * Creates where clauses that search across multiple fields with configurable logic and matching.
     * Validates that all field names exist in the model schema.
     *
     * @param config - Field search configuration object
     * @param filters - Runtime filters containing the search value
     * @param baseFindOptions - Base FindOptions from the named query
     * @returns FindOptions with dynamically built where clause
     * @throws Error if any field name does not exist in the model
     * @protected
     */
    protected buildFieldSearchOptions(
        config: {
            filterName: string;
            fields: string[];
            operator: 'and' | 'or';
            matchType?: 'exact' | 'contains' | 'startsWith' | 'endsWith';
            caseSensitive?: boolean;
            include?: Includeable[];
        },
        filters: Record<string, any>,
        baseFindOptions: FindOptions = {}
    ): FindOptions {
        const { filterName, fields, operator, matchType = 'contains', caseSensitive = false, include } = config;

        // Validate all field names exist in the model
        fields.forEach((field) => {
            this.validateFieldName(field, 'field search');
        });

        // Validate filter types against model schema
        const validatedFilters = this.validateFilterTypes(filters);
        const searchValue = SafePropertyAccess.get(validatedFilters, filterName);

        const findOptions: FindOptions = { ...baseFindOptions };

        // Add includes from config if specified
        const tmpInclude = findOptions.include || [];
        const includes = Array.isArray(tmpInclude) ? tmpInclude : [tmpInclude];

        if (include && include.length > 0) {
            findOptions.include = [...includes, ...include];
        }

        // If no search value provided, return base options
        if (!searchValue || (typeof searchValue === 'string' && searchValue.trim() === '')) {
            return findOptions;
        }

        // Build field conditions based on match type
        const fieldConditions = fields.map((field) => {
            const condition: any = {};

            switch (matchType) {
                case 'exact':
                    // nosemgrep: gitlab.eslint.detect-object-injection -> we will check the fields beforehand
                    condition[field] = caseSensitive ? searchValue : { [Op.iLike]: searchValue };
                    break;
                case 'contains':
                    // nosemgrep: gitlab.eslint.detect-object-injection -> we will check the fields beforehand
                    condition[field] = caseSensitive
                        ? { [Op.like]: `%${searchValue}%` }
                        : { [Op.iLike]: `%${searchValue}%` };
                    break;
                case 'startsWith':
                    // nosemgrep: gitlab.eslint.detect-object-injection -> we will check the fields beforehand
                    condition[field] = caseSensitive
                        ? { [Op.like]: `${searchValue}%` }
                        : { [Op.iLike]: `${searchValue}%` };
                    break;
                case 'endsWith':
                    // nosemgrep: gitlab.eslint.detect-object-injection -> we will check the fields beforehand
                    condition[field] = caseSensitive
                        ? { [Op.like]: `%${searchValue}` }
                        : { [Op.iLike]: `%${searchValue}` };
                    break;
                default:
                    // nosemgrep: gitlab.eslint.detect-object-injection -> we will check the fields beforehand
                    condition[field] = caseSensitive
                        ? { [Op.like]: `%${searchValue}%` }
                        : { [Op.iLike]: `%${searchValue}%` };
            }

            return condition;
        });

        // Combine field conditions with the specified operator
        let searchWhere: any;
        if (operator === 'or') {
            searchWhere = { [Op.or]: fieldConditions };
        } else {
            searchWhere = { [Op.and]: fieldConditions };
        }

        // Merge with existing where clause
        if (findOptions.where) {
            findOptions.where = {
                [Op.and]: [findOptions.where, searchWhere]
            };
        } else {
            findOptions.where = searchWhere;
        }

        return findOptions;
    }

    /**
     * Builds FindOptions specifically for field search queries used by controllers.
     * Separates field search logic from regular named query parameter substitution.
     * Handles the search term from QueryOptions.filters and combines with other filters.
     *
     * @param namedQuery - The named query with field search configuration
     * @param options - Query options from controller including filters, pagination, etc.
     * @returns FindOptions with field search where clause and combined filters
     * @protected
     */
    protected buildFieldSearchQueryOptions(namedQuery: NamedQuery, options?: QueryOptions): FindOptions {
        const fieldSearchConfig = (namedQuery as any).fieldSearchConfig;
        const filter = { ...(options?.filter ?? {}) };
        const otherOptions = { ...(options ?? {}) };

        if (options?.search) {
            filter.search = options.search;
        }

        // Extract the search value from filters
        const searchValue = SafePropertyAccess.get(filter, fieldSearchConfig.filterName);

        // Remove the search parameter from filters to avoid duplication
        const remainingFilters = { ...filter };
        SafePropertyAccess.delete(remainingFilters, fieldSearchConfig.filterName);

        // Validate remaining filter types against model schema
        const validatedRemainingFilters = this.validateFilterTypes(remainingFilters);

        // Build the field search where clause
        const fieldSearchFindOptions = this.buildFieldSearchOptions(
            fieldSearchConfig,
            { [fieldSearchConfig.filterName]: searchValue },
            namedQuery.findOptions
        );

        // Combine with remaining filters and initial queries
        const combinedWhere = {
            ...this.defaultInitialQuery,
            ...fieldSearchFindOptions.where,
            ...validatedRemainingFilters
        };

        const findOptions: FindOptions = {
            ...fieldSearchFindOptions,
            where:
                Object.keys(combinedWhere).length > 0 || Object.getOwnPropertySymbols(combinedWhere).length > 0
                    ? combinedWhere
                    : undefined
        };

        // Apply sorting if provided
        if (otherOptions.sort) {
            findOptions.order = this.buildOrderClause(otherOptions.sort);
        }

        // Merge includes if provided
        if (otherOptions.include) {
            const existingIncludes = Array.isArray(findOptions.include) ? findOptions.include : [];
            const optionIncludes = this.buildIncludeClause(otherOptions.include);
            findOptions.include = [...existingIncludes, ...optionIncludes];
        }

        if (options?.rawResult === true) {
            findOptions.raw = true;
        }
        return findOptions;
    }

    /**
   *Exports data based on a named query into a csv file
   * @param options - Query options from controller including filters, pagination, etc. inlcuding the named query 
   * @returns an subscription to csv builder ...
   * you can subscribt to it : like this .subscribe({
          next: (line: string) => {
              response.write(line + '\n');
          },
          complete: () => {
              response.end();
          }
      });
   */
    createCSV(options: CSVExportOptions): Observable<string> {
        return new Observable((subscriber) => {
            const queryOptions = { ...options.options, rawResult: true };
            try {
                this.findAllByFieldSearch(options.queryName, queryOptions).then((data) => {
                    if (data) {
                        const keys: string[] = Object.keys(data[0]);
                        // check if all the columns are present
                        const keySet = new Set(keys.map((item) => String(item)));
                        const colSet = new Set(options.columns.map((item) => item.name));
                        if ([...colSet].every((item) => keySet.has(item))) {
                            subscriber.next(options.columns.map((item) => item.name).join(',')); // put out the field names
                            data.forEach((item: T) => {
                                const dataObject: string[] = [];
                                options.columns.forEach((col) => {
                                    const itemData = SafePropertyAccess.get(item, col.name);
                                    switch (col.type) {
                                        case 'json':
                                            dataObject.push(`"${JSON.stringify(itemData)}"`);
                                            break;
                                        case 'number':
                                            dataObject.push(`"${itemData}"`);
                                            break;
                                        case 'boolean':
                                            dataObject.push(`"${itemData === true ? 'true' : 'false'}"`);
                                            break;
                                        default:
                                            dataObject.push(`"${itemData}"`);
                                    }
                                });
                                subscriber.next(dataObject.join(',')); // put out the next line
                            });
                            subscriber.complete();
                        } else {
                            subscriber.error(
                                new Error(`Columns doesnt match ${keys} vs ${options.columns.map((item) => item.name)}`)
                            );
                        }
                    } else {
                        subscriber.error(new Error(`Query Error no results`));
                    }
                });
            } catch (error) {
                this.logger.error(`createCSV  error ${error}`);
                throw error;
            }
        });
    }

    /**
     * Checks if a user has access to a specific record.
     * Default implementation always returns true.
     * Override this method in child classes to implement custom access control logic.
     *
     * @param item - The record to check access for
     * @param user - The user requesting access
     * @returns True if the user has access, false otherwise
     *
     * @example
     * // In your custom store class
     * hasAccess(item: MyModel, user: MyUser): boolean {
     *   return item.ownerId === user.id || user.isAdmin;
     * }
     */
    hasAccess(item: T, user: U): boolean {
        if (item && user) {
            return true;
        }
        return true;
    }

    /**
     * Processes a CSV file and prepares data for import.
     * Parses CSV records, applies field transformations, filters, and generates deletion lists.
     * Used internally by importFromCSV().
     *
     * @param options - CSV import configuration including file path, columns, and filters
     * @returns Promise resolving to an object with deletionList and updates arrays
     * @protected
     */
    protected processCsv(options: CSVImportOptions): Promise<CSVProcessResult<T['_attributes']>> {
        return new Promise((resolve, reject) => {
            const updates: Partial<T['_attributes']>[] = [];
            parseCSV<T>({
                filePath: options.fileName,
                columns: options.columns
            })
                .pipe(
                    map((record: T) => {
                        let doImport = true;
                        if (options.ignoreLines) {
                            options.ignoreLines.forEach((line) => {
                                const recordData = SafePropertyAccess.get(record, line.fieldName);
                                if (recordData === line.fieldValue) {
                                    doImport = false;
                                }
                            });
                        }
                        if (doImport === true) {
                            const data = { ...record };
                            if (!options.keepuuid) {
                                SafePropertyAccess.set(data, this.idFieldName, crypto.randomUUID());
                            }
                            if (options.fixedFields) {
                                options.fixedFields.forEach((field) => {
                                    SafePropertyAccess.set(data, field.fieldName, field.fieldValue);
                                });
                            }

                            if (options.replacements) {
                                //find the replacement
                                options.replacements.forEach((r) => {
                                    const dt = SafePropertyAccess.get(data, r.field);
                                    if (dt === r.key) {
                                        SafePropertyAccess.set(data, r.field, r.rpl);
                                    }
                                });
                            }

                            updates.push(data);
                        }
                    }),
                    finalize(() => {
                        const deletionList: (string | number)[] = updates.map((item) => {
                            const value = options.indexName
                                ? SafePropertyAccess.get(item, options.indexName)
                                : SafePropertyAccess.get(item, 'uuid');
                            return value as string | number;
                        });
                        resolve({ deletionList, updates });
                    }),
                    catchError((err) => {
                        reject(err as Error);
                        return of([]);
                    })
                )
                .subscribe();
        });
    }

    /**
     * Imports data from a CSV file, replacing existing records.
     * Deletes existing records matching the index and creates new ones from the CSV.
     * The CSV file is deleted after successful import.
     *
     * @param options - CSV import configuration including file path, columns, and field mappings
     * @param transaction - Optional transaction to ensure atomic operations
     * @returns Promise resolving to the import result with deletion list and created records
     *
     * @example
     * const result = await store.importFromCSV({
     *   fileName: '/path/to/data.csv',
     *   columns: [
     *     { name: 'uuid', type: 'string' },
     *     { name: 'name', type: 'string' },
     *     { name: 'age', type: 'number' }
     *   ],
     *   indexName: 'uuid',
     *   fixedFields: [{ fieldName: 'status', fieldValue: 'active' }]
     * });
     *
     * @example
     * // With transaction for atomic import
     * const transaction = await sequelize.transaction();
     * try {
     *   const result = await store.importFromCSV(options, transaction);
     *   await transaction.commit();
     * } catch (error) {
     *   await transaction.rollback();
     *   throw error;
     * }
     */
    async importFromCSV(options: CSVImportOptions, transaction?: Transaction): Promise<CSVImportResult<T>> {
        this.logger.debug('importFromCSV');

        if (!fs.existsSync(options.fileName)) {
            throw new Error('File Not found');
        }

        try {
            this.logger.debug(`importFromCSV processing ${options.fileName}`);
            const { deletionList, updates } = await this.processCsv(options);
            const indexName = options.indexName ?? 'uuid';
            const where: any = {};
            where[indexName] = { [Op.in]: deletionList };
            await this.model.destroy({ where, transaction });
            await this.model.bulkCreate(updates as any, { transaction });
            fs.unlinkSync(options.fileName);
            // CSV imports replace records and therefore invalidate all cached reads for this store.
            await this.invalidateCache();
            this.logger.debug('completed');
            return { deletionList: deletionList as any, updates: updates as any };
        } catch (error) {
            this.logger.error(`importFromCSV error: ${error}`);
            throw error;
        }
    }

    /**
     * Applies extended field-level validation rules (pattern, min, max, enum) after
     * CsvValidator has already handled type coercion.
     *
     * @returns true if the value passes all rules, false otherwise (error pushed to errors array)
     */
    private applyExtendedValidation(
        value: any,
        field: CsvUpdateFieldDescriptor,
        rowNumber: number,
        errors: string[]
    ): boolean {
        const v = field.validation;
        if (!v) return true;

        const strVal = String(value ?? '');

        if (v.pattern !== undefined && !new RegExp(v.pattern).test(strVal)) {
            errors.push(`Row ${rowNumber}: '${field.csvColumn}' does not match pattern '${v.pattern}': '${strVal}'`);
            return false;
        }

        if (v.enum !== undefined && !v.enum.includes(strVal)) {
            errors.push(`Row ${rowNumber}: '${field.csvColumn}' value '${strVal}' not in [${v.enum.join(', ')}]`);
            return false;
        }

        if (field.type === 'number' && typeof value === 'number') {
            if (v.min !== undefined && value < v.min) {
                errors.push(`Row ${rowNumber}: '${field.csvColumn}' value ${value} is below min ${v.min}`);
                return false;
            }
            if (v.max !== undefined && value > v.max) {
                errors.push(`Row ${rowNumber}: '${field.csvColumn}' value ${value} exceeds max ${v.max}`);
                return false;
            }
        } else if (typeof value === 'string') {
            if (v.min !== undefined && value.length < v.min) {
                errors.push(
                    `Row ${rowNumber}: '${field.csvColumn}' length ${value.length} is below min length ${v.min}`
                );
                return false;
            }
            if (v.max !== undefined && value.length > v.max) {
                errors.push(
                    `Row ${rowNumber}: '${field.csvColumn}' length ${value.length} exceeds max length ${v.max}`
                );
                return false;
            }
        }

        return true;
    }

    /**
     * Partially updates records by matching rows from a CSV file against the database
     * using a composite key, then writing only the specified fields.
     *
     * Unlike importFromCSV (which deletes + recreates), this method issues an UPDATE
     * per row. Invalid rows are skipped and counted; no exception is thrown for row-level failures.
     *
     * @param fileName - Absolute path to the CSV file
     * @param descriptor - Describes the composite id key and which fields to update
     * @param transaction - Optional Sequelize transaction for atomic batches
     * @returns Summary of updated, skipped, and failed rows
     *
     * @example
     * const result = await store.updateFromCsv('/tmp/upload.csv', {
     *   idFields: [{ csvColumn: 'zone' }, { csvColumn: 'contractnr', dbColumn: 'contract_nr' , type:'string' }],
     *   fields: [
     *     { csvColumn: 'status', type: 'number', required: true, validation: { min: 0, max: 5 } },
     *     { csvColumn: 'label', type: 'string', validation: { pattern: '^[A-Z]' } },
     *   ],
     * });
     * console.log(`${result.updated} updated, ${result.skipped} not found, ${result.failed} invalid`);
     */
    async updateFromCsv(
        fileName: string,
        descriptor: CsvUpdateDescriptor,
        transaction?: Transaction
    ): Promise<CsvUpdateResult> {
        const start = Date.now();
        const result: CsvUpdateResult = { updated: 0, skipped: 0, failed: 0, warnings: [], errors: [], duration: 0 };

        this.logger.debug(`updateFromCsv ${fileName}`);

        if (!fs.existsSync(fileName)) {
            throw new Error(`File not found: ${fileName}`);
        }

        // Map descriptor fields to CSVColumn format for the parser.
        // 'date' is parsed as string and left to the DB driver to coerce.
        const csvColumns = [
            ...descriptor.idFields.map((f) => ({ name: f.csvColumn, type: 'string' as const })),
            ...descriptor.fields.map((f) => ({
                name: f.csvColumn,
                type: (f.type === 'date' ? 'string' : (f.type ?? 'string')) as 'string' | 'number' | 'boolean' | 'json'
            }))
        ];

        const rawRecords: Record<string, any>[] = await new Promise((resolve, reject) => {
            const records: Record<string, any>[] = [];
            parseCSV<any>({ filePath: fileName, columns: csvColumns })
                .pipe(
                    catchError((err) => {
                        reject(err);
                        return of(null);
                    })
                )
                .subscribe({
                    next: (record) => {
                        if (record) records.push(record);
                    },
                    error: reject,
                    complete: () => resolve(records)
                });
        });

        this.logger.debug(`updateFromCsv parsed ${rawRecords.length} records`);

        // Validate all rows via CsvValidator (handles type coercion, required, trim, maxLength)
        const schema = {
            fields: [
                ...descriptor.idFields.map((f) => ({ name: f.csvColumn, type: 'string' as const, required: true })),
                ...descriptor.fields.map((f) => ({
                    name: f.csvColumn,
                    type: f.type ?? ('string' as const),
                    required: f.required ?? false,
                    trim: f.trim ?? true
                }))
            ]
        };

        const { sanitizedRecords, allWarnings } = CsvValidator.validateBatch(rawRecords, schema, {
            logWarnings: false
        });
        result.warnings.push(...allWarnings);
        this.logger.debug(`Updating ${sanitizedRecords.length} records...`);
        for (let i = 0; i < sanitizedRecords.length; i++) {
            const row = sanitizedRecords[i];
            const rowNumber = i + 1;

            // Reject rows missing any composite id field
            const missingId = descriptor.idFields.find(
                (f) => row[f.csvColumn] === null || row[f.csvColumn] === undefined
            );
            if (missingId) {
                result.failed++;
                result.errors.push(`Row ${rowNumber}: Missing required id field '${missingId.csvColumn}'`);
                continue;
            }

            // Apply extended validation and build update payload
            let rowValid = true;
            const updateData: Record<string, any> = {};

            for (const field of descriptor.fields) {
                const value = row[field.csvColumn];
                if (!this.applyExtendedValidation(value, field, rowNumber, result.errors)) {
                    rowValid = false;
                    break;
                }
                updateData[field.dbColumn ?? field.csvColumn] = value;
            }

            if (!rowValid) {
                result.failed++;
                continue;
            }

            // Composite Op.and WHERE clause from all id fields
            const where: WhereOptions = {
                [Op.and]: descriptor.idFields.map((f) =>
                    f.type === 'string'
                        ? Sequelize.where(
                            Sequelize.fn('LOWER', Sequelize.col(f.dbColumn ?? f.csvColumn)),
                            Sequelize.fn('LOWER', row[f.csvColumn])
                        )
                        : {
                            [f.dbColumn ?? f.csvColumn]: row[f.csvColumn]
                        }
                )
            } as WhereOptions;

            try {
                const [affectedCount] = await this.model.update(updateData as any, { where, transaction });
                if (affectedCount > 0) {
                    result.updated++;
                } else {
                    result.skipped++;
                }
                if (result.updated % 100 === 0) {
                    this.logger.debug(`Status : ${result.updated} records updated. ${result.skipped} ignored`);
                }
            } catch (e) {
                result.failed++;
                result.errors.push(`Row ${rowNumber}: DB error — ${toError(e).message}`);
            }
        }
        this.logger.debug('Done ...');
        result.duration = Date.now() - start;
        this.logger.debug(
            `updateFromCsv complete: ${result.updated} updated, ${result.skipped} skipped, ${result.failed} failed in ${result.duration}ms`
        );
        // CSV updates can touch many records and query result shapes.
        if (result.updated > 0) {
            await this.invalidateCache();
        }
        return result;
    }

    /**
     * Logs query details for debugging purposes when logQueries is enabled.
     * Outputs formatted query objects with colors and proper depth.
     * Set this.logQueries = true to enable query logging.
     *
     * @param query - The query object to log (typically Sequelize FindOptions)
     */
    debugLog(query: unknown): void {
        if (this.logQueries) {
            this.logger.debug(
                inspect(query, {
                    showHidden: false,
                    depth: null,
                    colors: true,
                    compact: true,
                    breakLength: 100
                })
            );
        }
    }
}
