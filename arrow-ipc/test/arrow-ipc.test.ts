import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import duckdb from '@duckdb/node-bindings';
import arrowIpc from '@duckdb/node-arrow-ipc';

describe('Arrow IPC', () => {
  let db: duckdb.Database;
  let conn: duckdb.Connection;

  beforeAll(async () => {
    db = await duckdb.open(':memory:');
    conn = await duckdb.connect(db);
  });

  afterAll(() => {
    duckdb.disconnect_sync(conn);
    duckdb.close_sync(db);
  });

  // Helper to convert a result to full IPC stream
  async function resultToIpc(result: duckdb.Result): Promise<Uint8Array> {
    const arrowOptions = duckdb.result_get_arrow_options(result);
    const columnCount = duckdb.column_count(result);
    const types: duckdb.LogicalType[] = [];
    const names: string[] = [];

    for (let i = 0; i < columnCount; i++) {
      types.push(duckdb.column_logical_type(result, i));
      names.push(duckdb.column_name(result, i));
    }

    const schema = duckdb.to_arrow_schema(arrowOptions, types, names, columnCount);
    const chunks: Uint8Array[] = [arrowIpc.schemaToIpc(schema)];

    let chunk = await duckdb.fetch_chunk(result);
    while (chunk && duckdb.data_chunk_get_size(chunk) > 0) {
      const array = duckdb.data_chunk_to_arrow(arrowOptions, chunk);
      chunks.push(arrowIpc.arrayToIpc(schema, array));
      array.release();
      chunk = await duckdb.fetch_chunk(result);
    }

    schema.release();
    duckdb.destroy_arrow_options(arrowOptions);

    const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
    const ipc = new Uint8Array(totalLength);
    let offset = 0;
    for (const c of chunks) {
      ipc.set(c, offset);
      offset += c.length;
    }
    return ipc;
  }

  function assertValidIpcHeader(ipc: Uint8Array) {
    expect(ipc).toBeInstanceOf(Uint8Array);
    expect(ipc.length).toBeGreaterThan(0);
    // Arrow IPC stream starts with continuation marker 0xFFFFFFFF
    expect(ipc[0]).toBe(0xff);
    expect(ipc[1]).toBe(0xff);
    expect(ipc[2]).toBe(0xff);
    expect(ipc[3]).toBe(0xff);
  }

  describe('schemaToIpc', () => {
    test('returns valid IPC schema bytes', async () => {
      const result = await duckdb.query(conn, 'SELECT 1 as a, 2 as b, 3 as c');
      const arrowOptions = duckdb.result_get_arrow_options(result);
      const types = [
        duckdb.column_logical_type(result, 0),
        duckdb.column_logical_type(result, 1),
        duckdb.column_logical_type(result, 2),
      ];
      const names = ['a', 'b', 'c'];

      const schema = duckdb.to_arrow_schema(arrowOptions, types, names, 3);
      const ipc = arrowIpc.schemaToIpc(schema);

      assertValidIpcHeader(ipc);

      schema.release();
      duckdb.destroy_arrow_options(arrowOptions);
    });
  });

  describe('arrayToIpc', () => {
    test('returns valid IPC record batch bytes', async () => {
      const result = await duckdb.query(conn, 'SELECT i::INTEGER as val FROM range(10) t(i)');
      const arrowOptions = duckdb.result_get_arrow_options(result);
      const types = [duckdb.column_logical_type(result, 0)];
      const names = ['val'];

      const schema = duckdb.to_arrow_schema(arrowOptions, types, names, 1);
      const chunk = await duckdb.fetch_chunk(result);
      expect(chunk).toBeDefined();

      const array = duckdb.data_chunk_to_arrow(arrowOptions, chunk!);
      const ipc = arrowIpc.arrayToIpc(schema, array);

      assertValidIpcHeader(ipc);

      array.release();
      schema.release();
      duckdb.destroy_arrow_options(arrowOptions);
    });
  });

  describe('type coverage', () => {
    test('integers', async () => {
      const result = await duckdb.query(conn, 'SELECT i::INTEGER as val FROM range(10) t(i)');
      const ipc = await resultToIpc(result);
      assertValidIpcHeader(ipc);
    });

    test('bigints', async () => {
      const result = await duckdb.query(conn, 'SELECT i::BIGINT as val FROM range(10) t(i)');
      const ipc = await resultToIpc(result);
      assertValidIpcHeader(ipc);
    });

    test('floats', async () => {
      const result = await duckdb.query(conn, 'SELECT 3.14::FLOAT as f, 2.71::DOUBLE as d');
      const ipc = await resultToIpc(result);
      assertValidIpcHeader(ipc);
    });

    test('strings', async () => {
      const result = await duckdb.query(conn, "SELECT 'hello'::VARCHAR as str");
      const ipc = await resultToIpc(result);
      assertValidIpcHeader(ipc);
    });

    test('booleans', async () => {
      const result = await duckdb.query(conn, 'SELECT true as yes, false as no');
      const ipc = await resultToIpc(result);
      assertValidIpcHeader(ipc);
    });

    test('dates', async () => {
      const result = await duckdb.query(conn, "SELECT DATE '2024-01-15' as d");
      const ipc = await resultToIpc(result);
      assertValidIpcHeader(ipc);
    });

    test('timestamps', async () => {
      const result = await duckdb.query(conn, "SELECT TIMESTAMP '2024-01-15 10:30:00' as ts");
      const ipc = await resultToIpc(result);
      assertValidIpcHeader(ipc);
    });

    test('intervals', async () => {
      const result = await duckdb.query(conn, "SELECT INTERVAL '1 year 2 months 3 days' as i");
      const ipc = await resultToIpc(result);
      assertValidIpcHeader(ipc);
    });

    test('decimals', async () => {
      const result = await duckdb.query(conn, 'SELECT 123.456::DECIMAL(10,3) as d');
      const ipc = await resultToIpc(result);
      assertValidIpcHeader(ipc);
    });

    test('blobs', async () => {
      const result = await duckdb.query(conn, "SELECT '\\xDEADBEEF'::BLOB as b");
      const ipc = await resultToIpc(result);
      assertValidIpcHeader(ipc);
    });

    test('uuids', async () => {
      const result = await duckdb.query(conn, "SELECT '550e8400-e29b-41d4-a716-446655440000'::UUID as u");
      const ipc = await resultToIpc(result);
      assertValidIpcHeader(ipc);
    });

    // Skip: nanoarrow IPC doesn't support dictionary types
    test.skip('enums', async () => {
      await duckdb.query(conn, "CREATE TYPE mood AS ENUM ('happy', 'sad', 'neutral')");
      const result = await duckdb.query(conn, "SELECT 'happy'::mood as m");
      const ipc = await resultToIpc(result);
      assertValidIpcHeader(ipc);
    });

    test('various types combined', async () => {
      const result = await duckdb.query(conn, `
        SELECT
          42::INTEGER as int_col,
          3.14::DOUBLE as double_col,
          'hello'::VARCHAR as str_col,
          true::BOOLEAN as bool_col,
          DATE '2024-01-15' as date_col
      `);
      const ipc = await resultToIpc(result);
      assertValidIpcHeader(ipc);
      expect(ipc.length).toBeGreaterThan(100);
    });
  });

  describe('complex types', () => {
    test('lists', async () => {
      const result = await duckdb.query(conn, "SELECT [1, 2, 3]::INTEGER[] as arr");
      const ipc = await resultToIpc(result);
      assertValidIpcHeader(ipc);
    });

    test('structs', async () => {
      const result = await duckdb.query(conn, "SELECT {'a': 1, 'b': 'hello'}::STRUCT(a INTEGER, b VARCHAR) as obj");
      const ipc = await resultToIpc(result);
      assertValidIpcHeader(ipc);
    });

    test('maps', async () => {
      const result = await duckdb.query(conn, "SELECT MAP {'a': 1, 'b': 2} as m");
      const ipc = await resultToIpc(result);
      assertValidIpcHeader(ipc);
    });

    test('nested: list of structs', async () => {
      const result = await duckdb.query(conn, `
        SELECT [{'x': 1, 'y': 2}, {'x': 3, 'y': 4}]::STRUCT(x INTEGER, y INTEGER)[] as arr
      `);
      const ipc = await resultToIpc(result);
      assertValidIpcHeader(ipc);
    });

    test('nested: struct with list', async () => {
      const result = await duckdb.query(conn, `
        SELECT {'items': [1, 2, 3], 'name': 'test'}::STRUCT(items INTEGER[], name VARCHAR) as obj
      `);
      const ipc = await resultToIpc(result);
      assertValidIpcHeader(ipc);
    });
  });

  describe('edge cases', () => {
    test('nulls', async () => {
      const result = await duckdb.query(conn, `
        SELECT * FROM (VALUES
          (1, 'a'),
          (NULL, 'b'),
          (3, NULL),
          (NULL, NULL)
        ) AS t(num, str)
      `);
      const ipc = await resultToIpc(result);
      assertValidIpcHeader(ipc);
    });

    test('empty result', async () => {
      const result = await duckdb.query(conn, 'SELECT 1 as a WHERE false');
      const ipc = await resultToIpc(result);
      assertValidIpcHeader(ipc);
    });

    test('large data with multiple chunks', async () => {
      const result = await duckdb.query(conn, 'SELECT i::BIGINT as val FROM range(50000) t(i)');
      const ipc = await resultToIpc(result);
      assertValidIpcHeader(ipc);
      expect(ipc.length).toBeGreaterThan(50000);
    });

    test('large strings', async () => {
      const result = await duckdb.query(conn, "SELECT repeat('x', 10000) as long_str");
      const ipc = await resultToIpc(result);
      assertValidIpcHeader(ipc);
      expect(ipc.length).toBeGreaterThan(10000);
    });

    test('multiple columns of same type', async () => {
      const result = await duckdb.query(conn, 'SELECT 1 as a, 2 as b, 3 as c, 4 as d, 5 as e');
      const ipc = await resultToIpc(result);
      assertValidIpcHeader(ipc);
    });

    test('consistent output for same query', async () => {
      const result1 = await duckdb.query(conn, 'SELECT 42 as val');
      const result2 = await duckdb.query(conn, 'SELECT 42 as val');

      const ipc1 = await resultToIpc(result1);
      const ipc2 = await resultToIpc(result2);

      expect(ipc1.length).toBe(ipc2.length);
      expect(Array.from(ipc1)).toEqual(Array.from(ipc2));
    });
  });

  describe('streaming', () => {
    test('schema + batches can be concatenated', async () => {
      const result = await duckdb.query(conn, 'SELECT i::INTEGER as val FROM range(100) t(i)');
      const arrowOptions = duckdb.result_get_arrow_options(result);
      const types = [duckdb.column_logical_type(result, 0)];
      const names = ['val'];

      const schema = duckdb.to_arrow_schema(arrowOptions, types, names, 1);
      const schemaIpc = arrowIpc.schemaToIpc(schema);
      assertValidIpcHeader(schemaIpc);

      const batchIpcs: Uint8Array[] = [];
      let chunk = await duckdb.fetch_chunk(result);
      while (chunk && duckdb.data_chunk_get_size(chunk) > 0) {
        const array = duckdb.data_chunk_to_arrow(arrowOptions, chunk);
        const batchIpc = arrowIpc.arrayToIpc(schema, array);
        assertValidIpcHeader(batchIpc);
        batchIpcs.push(batchIpc);
        array.release();
        chunk = await duckdb.fetch_chunk(result);
      }

      expect(batchIpcs.length).toBeGreaterThanOrEqual(1);

      // Concatenate
      const totalLength = schemaIpc.length + batchIpcs.reduce((sum, b) => sum + b.length, 0);
      const fullIpc = new Uint8Array(totalLength);
      let offset = 0;
      fullIpc.set(schemaIpc, offset);
      offset += schemaIpc.length;
      for (const batch of batchIpcs) {
        fullIpc.set(batch, offset);
        offset += batch.length;
      }

      assertValidIpcHeader(fullIpc);

      schema.release();
      duckdb.destroy_arrow_options(arrowOptions);
    });
  });
});
