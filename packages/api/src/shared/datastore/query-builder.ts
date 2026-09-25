import { Model } from 'sequelize';
import { BaseCrudStore } from './base-crud.store';
import { QueryOptions, SortOptions, PaginatedResult, IStoreUser } from './query-options.type';

/**
 * Fluent query builder for BaseCrudStore.
 * Provides a chainable API for building and executing queries.
 *
 * @template T - The model type (extends Sequelize Model)
 * @template U - The user type (implements IStoreUser)
 *
 * @example
 * const results = await store
 *   .query()
 *   .where({ active: true })
 *   .orderBy('name', 'ASC')
 *   .limit(10)
 *   .execute();
 *
 * @example
 * const paginatedResults = await store
 *   .query()
 *   .where({ category: 'electronics' })
 *   .orderBy('price', 'DESC')
 *   .paginate(1, 20);
 */
export class QueryBuilder<T extends Model, U extends IStoreUser = IStoreUser> {
    private options: QueryOptions = {};
    private namedQueryName?: string;
    private namedQueryParameters?: Record<string, any>;

    constructor(private store: BaseCrudStore<T, U>) {}

    /**
     * Add WHERE conditions to the query.
     * Can be called multiple times to add more conditions (will be merged).
     *
     * @param conditions - Key-value pairs of filter conditions
     * @returns This query builder for chaining
     *
     * @example
     * query.where({ active: true, category: 'books' })
     */
    where(conditions: { [key: string]: any }): this {
        this.options.filter = {
            ...this.options.filter,
            ...conditions
        };
        return this;
    }

    /**
     * Add raw WHERE conditions to the query.
     * Use this for Sequelize operators.
     *
     * @param conditions - Raw filter conditions with Sequelize operators
     * @returns This query builder for chaining
     *
     * @example
     * import { Op } from 'sequelize';
     * query.rawWhere({ age: { [Op.gte]: 18 } })
     */
    rawWhere(conditions: { [key: string]: any }): this {
        this.options.rawfilter = {
            ...this.options.rawfilter,
            ...conditions
        };
        return this;
    }

    /**
     * Add sorting to the query.
     * Can be called multiple times to add multiple sort fields.
     *
     * @param field - The field name to sort by
     * @param direction - Sort direction (default: 'ASC')
     * @returns This query builder for chaining
     *
     * @example
     * query.orderBy('name', 'ASC').orderBy('createdAt', 'DESC')
     */
    orderBy(field: string, direction: 'ASC' | 'DESC' = 'ASC'): this {
        if (!this.options.sort) {
            this.options.sort = [];
        }

        // Ensure sort is an array of SortOptions
        if (typeof this.options.sort[0] === 'string') {
            this.options.sort = [];
        }

        (this.options.sort as SortOptions[]).push({ field, direction });
        return this;
    }

    /**
     * Limit the number of results.
     *
     * @param pageSize - Maximum number of results to return
     * @returns This query builder for chaining
     *
     * @example
     * query.limit(10)
     */
    limit(pageSize: number): this {
        if (!this.options.pagination) {
            this.options.pagination = { page: 1, pageSize };
        } else {
            this.options.pagination.pageSize = pageSize;
        }
        return this;
    }

    /**
     * Skip a number of results (offset).
     *
     * @param count - Number of results to skip
     * @returns This query builder for chaining
     *
     * @example
     * query.skip(20) // Skip first 20 results
     */
    skip(count: number): this {
        const pageSize = this.options.pagination?.pageSize || 10;
        const page = Math.floor(count / pageSize) + 1;

        this.options.pagination = {
            page,
            pageSize
        };
        return this;
    }

    /**
     * Include related associations in the query.
     * Can be called multiple times to include multiple associations.
     *
     * @param associations - Association names to include
     * @returns This query builder for chaining
     *
     * @example
     * query.include('profile', 'posts')
     */
    include(...associations: string[]): this {
        if (!this.options.include) {
            this.options.include = [];
        }
        this.options.include.push(...associations);
        return this;
    }

    /**
     * Return raw data instead of model instances.
     *
     * @returns This query builder for chaining
     *
     * @example
     * query.raw()
     */
    raw(): this {
        this.options.rawResult = true;
        return this;
    }

    /**
     * Search across multiple fields (uses field search if configured).
     *
     * @param term - Search term
     * @returns This query builder for chaining
     *
     * @example
     * query.search('john')
     */
    search(term: string): this {
        this.options.search = term;
        return this;
    }

    /**
     * Use a named query.
     * This will override the regular query building.
     *
     * @param queryName - Name of the registered named query
     * @param parameters - Parameters for the named query
     * @returns This query builder for chaining
     *
     * @example
     * query.named('findActiveUsers', { minAge: 18 })
     */
    named(queryName: string, parameters?: Record<string, any>): this {
        this.namedQueryName = queryName;
        this.namedQueryParameters = parameters;
        return this;
    }

    /**
     * Execute the query and return all matching results.
     *
     * @returns Promise resolving to array of results
     *
     * @example
     * const users = await query.where({ active: true }).execute();
     */
    async execute(): Promise<T[]> {
        if (this.namedQueryName) {
            return this.store.findAllNamed(this.namedQueryName, this.options, this.namedQueryParameters);
        }
        return this.store.findAll(this.options);
    }

    /**
     * Execute the query and return the first matching result.
     *
     * @returns Promise resolving to single result or null
     *
     * @example
     * const user = await query.where({ email: 'test@example.com' }).first();
     */
    async first(): Promise<T | null> {
        if (this.namedQueryName) {
            return this.store.findOneNamed(this.namedQueryName, this.options, this.namedQueryParameters);
        }
        return this.store.findOne(this.options);
    }

    /**
     * Execute the query and return paginated results.
     *
     * @param page - Page number (1-based)
     * @param pageSize - Number of items per page
     * @returns Promise resolving to paginated result
     *
     * @example
     * const result = await query.where({ active: true }).paginate(1, 20);
     * console.log(result.items); // Array of items
     * console.log(result.totalPages); // Total number of pages
     */
    async paginate(page: number, pageSize: number): Promise<PaginatedResult<T>> {
        this.options.pagination = { page, pageSize };

        if (this.namedQueryName) {
            return this.store.findNamedWithPagination(this.namedQueryName, this.options, this.namedQueryParameters);
        }
        return this.store.findWithPagination(this.options);
    }

    /**
     * Execute the query and return count of matching results.
     *
     * @returns Promise resolving to count
     *
     * @example
     * const count = await query.where({ active: true }).count();
     */
    async count(): Promise<number> {
        return this.store.count(this.options);
    }
}
