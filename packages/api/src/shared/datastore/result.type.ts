/**
 * Result type for update operations.
 * Contains a message, optional data, and optional error information.
 *
 * @template T - The type of data returned from the update operation
 */
export type UpdateResult<T> = {
  /** Human-readable message describing the update result */
  message: string;
  /** The updated data, if successful */
  data?: T;
  /** Error information, if the update failed */
  error?: Error;
};

/**
 * Result type for CSV import operations.
 * Contains the list of deleted record identifiers and the newly imported records.
 *
 * @template T - The type of records being imported
 */
export type CSVImportResult<T> = {
  /** Array of identifiers for records that were deleted before import */
  deletionList: string[];
  /** Array of newly imported records */
  updates: T[];
};
