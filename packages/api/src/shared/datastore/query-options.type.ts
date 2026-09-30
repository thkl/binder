import { Type } from 'class-transformer';
import { IsObject, IsOptional } from 'class-validator';
import { FindOptions, Includeable } from 'sequelize';

/**
 * Configuration for sorting query results.
 * Defines a field name and optional sort direction.
 */
export interface SortOptions {
  /** The field name to sort by */
  field: string;
  /** The sort direction (default: 'ASC') */
  direction?: 'ASC' | 'DESC';
}

/**
 * Configuration for pagination.
 * Defines the page number and number of items per page.
 */
export interface PaginationOptions {
  /** The page number to retrieve (0-based or 1-based depending on implementation) */
  page: number;
  /** The number of items per page */
  pageSize: number;
}

/**
 * Flexible filter options for query conditions.
 * Supports any key-value pairs including Sequelize operators.
 */
export interface FilterOptions {
  [key: string]: any;
}

/**
 * Column definition for CSV import/export operations.
 * Specifies the column name and its data type for proper parsing.
 */
export interface CSVColumn {
  /** The name of the column in the CSV file */
  name: string;
  /** The data type of the column for proper type conversion */
  type: 'string' | 'number' | 'boolean' | 'json';
}

/**
 * Key-value pair for field settings.
 * Used for specifying fixed field values or ignore conditions in CSV operations.
 */
export interface KVSettings {
  /** The name of the field */
  fieldName: string;
  /** The value to set or match for the field */
  fieldValue: any;
}

/**
 * Configuration options for CSV export operations.
 * Defines the query to execute and how to format the exported data.
 */
export interface CSVExportOptions {
  /** Query options including filters and pagination */
  options?: QueryOptions;
  /** The name of the named query to execute for data retrieval */
  queryName: string;
  /** Column definitions for the CSV output */
  columns: CSVColumn[];
}

export interface ReplacementOptions {
  field: string;
  key: string;
  type: string;
  rpl: any;
}

/**
 * Configuration options for CSV import operations.
 * Defines how to parse and import CSV data into the database.
 */
export interface CSVImportOptions {
  /** Path to the CSV file to import */
  fileName: string;
  /** Column definitions matching the CSV structure */
  columns: CSVColumn[];
  /** Lines to ignore during import based on field values */
  ignoreLines?: KVSettings[];
  /** Field name to use as index for record matching (default: 'uuid') */
  indexName?: string;
  /** Fixed field values to apply to all imported records */
  fixedFields?: KVSettings[];
  /** Optional buffer containing CSV data (alternative to fileName) */
  buffer?: Buffer;
  /** keep uuid from csv */
  keepuuid?: boolean;
  // replace any values */
  replacements?: ReplacementOptions[];
}

/**
 * Main query options class for configuring database queries.
 * Supports filtering, sorting, pagination, associations, and more.
 * Compatible with class-validator and class-transformer decorators.
 *
 * @example
 * const queryOptions: QueryOptions = {
 *   filter: { active: true },
 *   sort: [{ field: 'createdAt', direction: 'DESC' }],
 *   pagination: { page: 1, pageSize: 10 }
 * };
 */
export class QueryOptions {
  /** Key-value filter conditions for the query */
  @IsOptional()
  @IsObject()
  @Type(() => Object)
  filter?: { [key: string]: any };

  /** Raw filter conditions (bypasses some processing) */
  @IsOptional()
  @IsObject()
  @Type(() => Object)
  rawfilter?: { [key: string]: any };

  /** Search term for field search queries */
  search?: string;
  /** Array of sort configurations or simple field:direction strings */
  sort?: SortOptions[] | string[];
  /** Pagination configuration */
  pagination?: PaginationOptions;

  /** Legacy: Direct page number (use pagination.page instead) */
  page?: number; // for Legacy
  /** Legacy: Direct page size (use pagination.pageSize instead) */
  pageSize?: number; // for Legacy

  /** Array of association names to include in the query */
  include?: string[]; // For Sequelize associations
  /** Base query conditions that will be combined with filters */
  initialQuery?: FilterOptions; // Base query that filters will be combined with
  /** Return raw data instead of model instances */
  rawResult?: boolean;
  /** Return null on error instead of throwing */
  nullOnError?: boolean;
}

/**
 * Named query definition.
 * Defines a reusable query pattern with optional parameters and field search configuration.
 */
export interface NamedQuery {
  /** Unique identifier for the named query */
  name: string;
  /** Sequelize FindOptions that define the query behavior */
  findOptions: FindOptions;
  /** Optional constructor for the return type */
  returnType?: new () => any;
  /** Parameter definitions for validation and type checking */
  parameters?: Array<{
    /** Parameter name used in placeholders ($paramName) */
    name: string;
    /** Expected TypeScript type of the parameter */
    type: string;
    /** Whether the parameter is required (default: true) */
    required?: boolean;
  }>;
  /** Configuration for dynamic field search queries */
  fieldSearchConfig?: {
    /** Name of the filter parameter containing the search term */
    filterName: string;
    /** Fields to search across */
    fields: string[];
    /** Logical operator to combine field conditions */
    operator: 'and' | 'or';
    /** Type of string matching to perform */
    matchType?: 'exact' | 'contains' | 'startsWith' | 'endsWith';
    /** Whether the search should be case-sensitive */
    caseSensitive?: boolean;
    /** Associations to include in the query */
    include?: Includeable[];
    /** Specific attributes to select */
    attributes?: string[];
  };
  /** Parameter transformation functions */
  transform?: FindOptionParameterTransform;
}

/**
 * Map of named queries indexed by query name.
 * Used to store all registered named queries in a store.
 */
export type NamedQueryMap = Record<string, NamedQuery>;

/**
 * Paginated result container.
 * Wraps query results with pagination metadata.
 *
 * @template T - The type of items in the result
 */
export interface PaginatedResult<T> {
  /** Array of items for the current page */
  items: T[];
  /** Total number of items across all pages */
  total: number;
  /** Current page number */
  page: number;
  /** Legacy: Same as total (kept for backward compatibility) */
  size: number; //for legacy Only
  /** Number of items per page */
  pageSize: number;
  /** Total number of pages */
  totalPages: number;
  /** Whether there is a next page */
  hasNext: boolean;
  /** Whether there is a previous page */
  hasPrev: boolean;
}

/**
 * Configuration for field search queries.
 * Defines how to search across multiple fields dynamically.
 */
export type NamedQueryOptions = {
  /** Name of the filter parameter containing the search term */
  filterName: string;
  /** Fields to search across */
  fields: string[];
  /** Logical operator to combine field conditions */
  operator: 'and' | 'or';
  /** Type of string matching to perform */
  matchType?: 'exact' | 'contains' | 'startsWith' | 'endsWith';
  /** Whether the search should be case-sensitive */
  caseSensitive?: boolean;
  /** Associations to include in the query */
  include?: Includeable[];
  /** Specific attributes to select */
  attributes?: string[];
};

/**
 * Options for upsert operations.
 * Defines how to match existing records for update or create new ones.
 */
export type UpsertOptions = {
  /** Filter conditions to match existing records */
  match?: FilterOptions;
  /** Specific UUID to match for upsert */
  uuid?: string | number;
};

/**
 * Parameter definition for named queries.
 * Used to validate and type-check named query parameters.
 */
export type FindOptionParameters = {
  /** Parameter name */
  name: string;
  /** Expected TypeScript type */
  type: string;
  /** Whether the parameter is required (default: true) */
  required?: boolean;
};

/**
 * Map of parameter transformation functions.
 * Allows custom transformations to be applied to parameters before substitution.
 */
export type FindOptionParameterTransform = {
  [key: string]: any;
};

/**
 * Configuration object for adding named queries.
 * Contains all options needed to register a named query using addNamedQueryWithOptions.
 *
 * @template R - The return type for the named query
 */
export type NamedQueryAddingOptions<R, Q extends Record<string, any> = Record<string, never>> = {
  /** Unique identifier for the named query */
  name: keyof Q extends never ? string : keyof Q;

  /** Sequelize FindOptions that define the query behavior */
  findOptions: FindOptions;

  /** Optional constructor for the return type */
  returnType?: new () => R;

  /** Parameter definitions for validation and type checking */
  parameters?: Array<FindOptionParameters>;

  /** Parameter transformation functions */
  transform?: FindOptionParameterTransform;
};

/**
 * Result returned from CSV processing operations.
 * Contains the list of IDs to delete and the records to create/update.
 *
 * @template T - The model type being processed
 *
 * @example
 * const result: CSVProcessResult<Product> = await store.processCsv(options);
 * console.log(`Will delete ${result.deletionList.length} records`);
 * console.log(`Will create ${result.updates.length} records`);
 */
export interface CSVProcessResult<T> {
  /**
   * List of record identifiers that should be deleted before import.
   * These are typically extracted from the CSV using the indexName field.
   */
  deletionList: (string | number)[];

  /**
   * Array of records to be created from the CSV file.
   * Each record has been processed with fixed fields and filtering applied.
   */
  updates: Partial<T>[];
}

/**
 * Configuration for automatic timestamp field management.
 * Allows customization of field names used for tracking creation and modification metadata.
 * All fields are optional - if not specified, defaults are used for backward compatibility.
 *
 * @example
 * // Using custom field names
 * const config: TimestampFieldConfig = {
 *   createdAt: 'created_at',
 *   createdBy: 'created_by',
 *   updatedAt: 'updated_at',
 *   updatedBy: 'updated_by'
 * };
 *
 * @example
 * // Using defaults (backward compatible)
 * const store = new MyStore(MyModel); // Uses: created, createdby, changedAt, changedby
 */
export interface TimestampFieldConfig {
  /**
   * Field name for creation timestamp.
   * @default 'created'
   */
  createdAt?: string;

  /**
   * Field name for the user who created the record.
   * @default 'createdby'
   */
  createdBy?: string;

  /**
   * Field name for last update timestamp.
   * @default 'changedAt'
   */
  updatedAt?: string;

  /**
   * Field name for the user who last updated the record.
   * @default 'changedby'
   */
  updatedBy?: string;
}

/**
 * Generic user interface for store operations.
 * Defines the minimum required properties for user objects used in CRUD operations.
 *
 * Your application's User model should extend or be compatible with this interface.
 *
 * @example
 * ```typescript
 * // Your User model
 * export class User extends Model {
 *     gid: string;
 *     id: string;
 *     email: string;
 *     // ... other properties
 * }
 *
 * // Use with BaseCrudStore
 * export class ProductStore extends BaseCrudStore<Product, User> {
 *     constructor() {
 *         super(Product);
 *     }
 * }
 * ```
 */
/**
 * Identifies a single column in the CSV used as part of the composite DB lookup key.
 */
export interface CsvIdField {
  /** Column header in the CSV file */
  csvColumn: string;
  /** DB column name — defaults to csvColumn when omitted */
  dbColumn?: string;

  type?: string;
}

/**
 * Extended validation rules for a single update field.
 * Serializable to JSON so the descriptor can be sent over HTTP.
 */
export interface CsvFieldValidation {
  /** Regex pattern the string value must match */
  pattern?: string;
  /** Minimum numeric value or minimum string length */
  min?: number;
  /** Maximum numeric value or maximum string length */
  max?: number;
  /** Exhaustive list of accepted string values */
  enum?: string[];
}

/**
 * Describes one field to update — extends the existing FieldSchema from csv-schema.dto.
 */
export interface CsvUpdateFieldDescriptor {
  /** Column header in the CSV */
  csvColumn: string;
  /** DB column name — defaults to csvColumn when omitted */
  dbColumn?: string;
  /** Data type for parsing and coercion */
  type?: 'string' | 'number' | 'date' | 'boolean';
  /** Whether this field must be present and non-empty */
  required?: boolean;
  /** Trim whitespace from string values before validation */
  trim?: boolean;
  /** Extended validation rules applied after type coercion */
  validation?: CsvFieldValidation;
}

/**
 * Descriptor for a partial CSV update operation.
 * Passed to updateFromCsv() to define lookup keys and which fields to update.
 *
 * @example
 * const descriptor: CsvUpdateDescriptor = {
 *   idFields: [{ csvColumn: 'zone' }, { csvColumn: 'contractnr', dbColumn: 'contract_nr' }],
 *   fields: [
 *     { csvColumn: 'status', type: 'number', required: true, validation: { min: 0, max: 5 } },
 *     { csvColumn: 'label', type: 'string', validation: { pattern: '^[A-Z]' } },
 *   ],
 * };
 */
export interface CsvUpdateDescriptor {
  /** One or more columns that form the composite WHERE key (joined with Op.and) */
  idFields: CsvIdField[];
  /** Fields to update on the matched record */
  fields: CsvUpdateFieldDescriptor[];
}

/**
 * Result summary returned by updateFromCsv().
 */
export interface CsvUpdateResult {
  /** Rows where Model.update() affected ≥1 record */
  updated: number;
  /** Rows that passed validation but matched no DB record */
  skipped: number;
  /** Rows that failed validation — never written to DB */
  failed: number;
  /** Non-fatal warnings (truncation, coercion issues) */
  warnings: string[];
  /** Per-row error messages for failed rows */
  errors: string[];
  /** Total processing time in milliseconds */
  duration: number;
}

/**
 * Generic user interface for store operations.
 * Defines the minimum required properties for user objects used in CRUD operations.
 *
 * Your application's User model should extend or be compatible with this interface.
 *
 * @example
 * ```typescript
 * // Your User model
 * export class User extends Model {
 *     gid: string;
 *     id: string;
 *     email: string;
 *     // ... other properties
 * }
 *
 * // Use with BaseCrudStore
 * export class ProductStore extends BaseCrudStore<Product, User> {
 *     constructor() {
 *         super(Product);
 *     }
 * }
 * ```
 */

export interface IStoreUser {
  /**
   * Global identifier for the user.
   * Used for tracking who created/updated records.
   */
  gid?: string;

  /**
   * User's unique identifier.
   * Alternative to gid for user identification.
   */
  id?: string;

  /**
   * Allow any other properties for flexibility.
   * This makes the interface compatible with any User model.
   */
  [key: string]: any;
}
