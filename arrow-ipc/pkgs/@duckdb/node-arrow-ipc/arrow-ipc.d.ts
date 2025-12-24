/**
 * Arrow IPC serialization using nanoarrow.
 *
 * This package takes Arrow C Data Interface wrapper objects from
 * @duckdb/node-bindings and serializes them to Arrow IPC format bytes.
 */

/**
 * Wrapper object for an ArrowSchema pointer.
 */
export interface ArrowSchemaWrapper {
  pointer: bigint;
  release: () => void;
}

/**
 * Wrapper object for an ArrowArray pointer.
 */
export interface ArrowArrayWrapper {
  pointer: bigint;
  release: () => void;
}

/**
 * Converts an Arrow schema to IPC format bytes.
 *
 * @param schema ArrowSchema wrapper object
 *        (from @duckdb/node-bindings to_arrow_schema)
 * @returns Uint8Array containing the IPC schema message
 */
export function schemaToIpc(schema: ArrowSchemaWrapper): Uint8Array;

/**
 * Converts an Arrow array (record batch) to IPC format bytes.
 *
 * @param schema ArrowSchema wrapper object
 *        (from @duckdb/node-bindings to_arrow_schema)
 * @param array ArrowArray wrapper object
 *        (from @duckdb/node-bindings data_chunk_to_arrow)
 * @returns Uint8Array containing the IPC record batch message
 */
export function arrayToIpc(schema: ArrowSchemaWrapper, array: ArrowArrayWrapper): Uint8Array;
