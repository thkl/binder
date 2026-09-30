import { EventEmitter } from 'node:events';
import * as fs from 'node:fs';
import * as readline from 'node:readline';
import { Observable } from 'rxjs';
import { CSVColumn } from './query-options.type';
import { Readable } from 'stream';
import { SafePropertyAccess } from '../util/savepropertyaccess';

/**
 * Configuration options for CSV parsing.
 * Defines the columns structure and data source (file path or buffer).
 */
export interface CSVParserOptions {
  /** Column definitions matching the CSV structure */
  columns: CSVColumn[];
  /** Path to the CSV file to parse */
  filePath: string;
  /** Optional buffer containing CSV data (alternative to filePath) */
  buffer?: Buffer;
}

/**
 * Readable stream implementation that reads from a Buffer.
 * Used internally to convert Buffer to a readable stream for CSV parsing.
 *
 * @private
 */
class BufferStream extends Readable {
  private buffer: Buffer;
  private position: number = 0;

  /**
   * Creates a BufferStream from a Buffer.
   *
   * @param buffer - The buffer to read from
   */
  constructor(buffer: Buffer) {
    super();
    this.buffer = buffer;
  }

  /**
   * Internal method to read chunks from the buffer.
   * Implements the Readable stream _read interface.
   *
   * @private
   */

  _read() {
    if (this.position >= this.buffer.length) {
      this.push(null); // End of stream
      return;
    }

    // Read in chunks
    const chunkSize = 1024;
    const chunk = this.buffer.slice(this.position, this.position + chunkSize);
    this.position += chunkSize;
    this.push(chunk);
  }
}

/**
 * CSV Parser class that parses CSV files and emits events for each row.
 * Extends EventEmitter to provide an event-based parsing interface.
 *
 * Events:
 * - 'prepare': Emitted before parsing starts
 * - 'data': Emitted for each parsed row with the row data
 * - 'error': Emitted when an error occurs during parsing
 * - 'complete': Emitted when parsing is complete with the total line count
 *
 * @example
 * const parser = new CSVParser();
 * parser.on('data', (row) => console.log(row));
 * parser.on('complete', (count) => console.log(`Parsed ${count} rows`));
 * parser.parse({ filePath: 'data.csv', columns: [...] });
 */
export class CSVParser extends EventEmitter {
  private pendingOperations = 0;
  private streamEnded = false;

  /**
   * Creates a new CSVParser instance.
   */
  constructor() {
    super();
  }

  /**
   * Parses a single CSV line, handling quoted fields and escaped quotes.
   * Supports CSV standard quoting rules with double quotes.
   *
   * @param line - The CSV line to parse
   * @returns Promise resolving to an array of field values
   * @private
   */
  private async parseCsvLine(line: string): Promise<string[]> {
    const result: any[] = [];
    let current = '';
    let inQuotes = false;
    const trimmed = line.trim();
    for (let i = 0; i < trimmed.length; i++) {
      // nosemgrep: gitlab.eslint.detect-object-injection -> its a number
      const char = trimmed[i];
      // nosemgrep: gitlab.eslint.detect-object-injection -> its a number
      const next = trimmed[i + 1];
      if (char === '"') {
        if (inQuotes && next === '"') {
          current += '"'; // escaped quote
          i++; // skip the next quote
        } else {
          inQuotes = !inQuotes; // toggle quote mode
        }
      } else if (char === ',' && !inQuotes) {
        result.push(current);
        current = '';
      } else {
        current += char;
      }
    }
    result.push(current); // last field
    return result;
  }

  /**
   * Parses a CSV file or buffer according to the provided options.
   * Emits events for each row and for parsing lifecycle events.
   *
   * @param options - CSV parsing configuration
   *
   * @example
   * parser.parse({
   *   filePath: '/path/to/data.csv',
   *   columns: [
   *     { name: 'name', type: 'string' },
   *     { name: 'age', type: 'number' }
   *   ]
   * });
   */
  parse(options: CSVParserOptions): void {
    let lineCount = 0;
    let inputStream: Readable;
    if (
      !options ||
      !options.filePath ||
      (!fs.existsSync(options.filePath) && options.buffer === undefined)
    ) {
      this.emit('error', new Error(`File ${options.filePath} does not exist`));
      return;
    }

    if (
      !options ||
      !options.columns ||
      !Array.isArray(options.columns) ||
      options.columns.length === 0
    ) {
      this.emit('error', 'Columns not exist or empty');
      return;
    }

    this.emit('prepare');

    if (options.buffer !== undefined) {
      // Create readable stream from buffer
      inputStream = new BufferStream(options.buffer);
    } else if (options.filePath) {
      // Create file stream
      inputStream = fs.createReadStream(options.filePath);
    } else {
      throw new Error('Either filePath or buffer must be provided');
    }

    const rl = readline.createInterface({
      input: inputStream,
      crlfDelay: Infinity,
    });

    rl.on('error', (error) => {
      this.emit('error', error);
    });

    rl.on('close', async () => {
      this.streamEnded = true;
      this.checkIfComplete(lineCount);
      rl.close();
    });

    rl.on('line', async (line) => {
      lineCount++;
      this.pendingOperations++;
      const fields = await this.parseCsvLine(line);
      if (fields.length === options.columns.length) {
        const record: any = {};
        let col = 0;
        options.columns.forEach((cn) => {
          const fcolv = fields[col];
          // nosemgrep : gitlab.eslint.detect-object-injection -> its a number
          if (cn.type === 'json' && fcolv !== null && fcolv !== undefined && fcolv !== '') {
            try {
              const jsonField = JSON.parse(fcolv); // adjust index
              SafePropertyAccess.set(record, cn.name, jsonField);
            } catch (e) {
              SafePropertyAccess.set(record, cn.name, fcolv);
            }
          } else if (cn.type === 'number') {
            const pff = parseFloat(fcolv);
            SafePropertyAccess.set(record, cn.name, isNaN(pff) ? 0 : pff);
          } else if (cn.type === 'boolean') {
            SafePropertyAccess.set(record, cn.name, fcolv === 'true');
          } else {
            SafePropertyAccess.set(record, cn.name, fcolv ?? '');
          }
          col = col + 1;
        });
        this.emit('data', record);
      } else {
        this.emit(
          'error',
          new Error(
            `Columns do not match ${fields.length} vs ${options.columns.length}, ${JSON.stringify(line)}`,
          ),
        );
      }
      this.pendingOperations--;
      this.checkIfComplete(lineCount);
    });
  }

  /**
   * Checks if parsing is complete and emits the 'complete' event.
   * Called internally after each line is processed and when the stream ends.
   *
   * @param lineCount - Total number of lines parsed
   * @private
   */
  private checkIfComplete(lineCount: number) {
    if (this.streamEnded && this.pendingOperations === 0) {
      this.emit('complete', lineCount);
    }
  }

  /**
   * Stops the parser.
   * Currently a no-op placeholder for potential future cleanup logic.
   */
  stop(): void {}
}

/**
 * Parses a CSV file and returns an Observable that emits each parsed row.
 * Provides an RxJS-based interface to the CSV parser.
 *
 * @template T - The type of parsed row objects
 * @param options - CSV parsing configuration
 * @returns Observable that emits each parsed row and completes when parsing is done
 *
 * @example
 * parseCSV<User>({
 *   filePath: '/path/to/users.csv',
 *   columns: [
 *     { name: 'name', type: 'string' },
 *     { name: 'age', type: 'number' },
 *     { name: 'active', type: 'boolean' }
 *   ]
 * }).subscribe({
 *   next: (user) => console.log('Parsed user:', user),
 *   error: (err) => console.error('Parse error:', err),
 *   complete: () => console.log('Parsing complete')
 * });
 */
export function parseCSV<T>(options: CSVParserOptions): Observable<T> {
  return new Observable((subscriber) => {
    const parser = new CSVParser();

    const cleanup = () => parser.stop?.(); // if your parser supports stopping

    parser.on('data', (data) => {
      subscriber.next(data);
    });
    parser.on('error', (err) => subscriber.error(err));
    parser.on('complete', () => {
      subscriber.complete();
    });

    parser.parse(options);

    return cleanup; // Called when subscription ends
  });
}
