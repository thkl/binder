export interface CsvValidationField {
  name: string;
  type?: 'string' | 'number' | 'date' | 'boolean' | 'json';
  required?: boolean;
  trim?: boolean;
}

export interface CsvValidationSchema {
  fields: CsvValidationField[];
}

export interface CsvValidationResult {
  sanitizedRecords: Record<string, unknown>[];
  allWarnings: string[];
}

/** Small, dependency-free validator for CSV update rows. */
export class CsvValidator {
  static validateBatch(
    records: Record<string, unknown>[],
    schema: CsvValidationSchema,
    options: { logWarnings?: boolean } = {},
  ): CsvValidationResult {
    const allWarnings: string[] = [];
    const sanitizedRecords = records.map((record, index) => {
      const sanitized: Record<string, unknown> = { ...record };

      for (const field of schema.fields) {
        const rawValue = sanitized[field.name];
        const value =
          typeof rawValue === 'string' && field.trim !== false ? rawValue.trim() : rawValue;

        if (field.required && (value === undefined || value === null || value === '')) {
          throw new Error(`Row ${index + 1}: Missing required field '${field.name}'`);
        }

        if (value === undefined || value === null || value === '') {
          sanitized[field.name] = value;
          continue;
        }

        try {
          sanitized[field.name] = CsvValidator.coerce(value, field.type);
        } catch (error) {
          const message = `Row ${index + 1}: Invalid ${field.type ?? 'string'} value for '${field.name}'`;
          allWarnings.push(message);
          if (options.logWarnings) console.warn(message, error);
        }
      }

      return sanitized;
    });

    return { sanitizedRecords, allWarnings };
  }

  private static coerce(value: unknown, type: CsvValidationField['type']): unknown {
    switch (type) {
      case 'number': {
        const numberValue = Number(value);
        if (Number.isNaN(numberValue)) throw new Error('not a number');
        return numberValue;
      }
      case 'boolean':
        if (value === true || value === 'true' || value === '1') return true;
        if (value === false || value === 'false' || value === '0') return false;
        throw new Error('not a boolean');
      case 'json':
        return typeof value === 'string' ? JSON.parse(value) : value;
      case 'date':
      case 'string':
      default:
        return String(value);
    }
  }
}
