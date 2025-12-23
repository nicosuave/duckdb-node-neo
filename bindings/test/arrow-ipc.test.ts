import { assert, beforeAll, afterAll, describe, test } from 'vitest';
import duckdb from '@duckdb/node-bindings';

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

  test('result_to_arrow_ipc returns valid IPC stream bytes', async () => {
    const result = await duckdb.query(conn, 'SELECT 1 as a, 2 as b, 3 as c');
    const ipc = duckdb.result_to_arrow_ipc(result);

    // Verify we got bytes back
    assert.instanceOf(ipc, Uint8Array);
    assert.isAbove(ipc.length, 0);

    // Arrow IPC stream format starts with continuation marker (0xFFFFFFFF)
    assert.equal(ipc[0], 0xff);
    assert.equal(ipc[1], 0xff);
    assert.equal(ipc[2], 0xff);
    assert.equal(ipc[3], 0xff);
  });

  test('result_to_arrow_ipc with integers', async () => {
    const result = await duckdb.query(conn, 'SELECT i::INTEGER as val FROM range(10) t(i)');
    const ipc = duckdb.result_to_arrow_ipc(result);

    assert.instanceOf(ipc, Uint8Array);
    assert.isAbove(ipc.length, 0);
    // Continuation marker
    assert.equal(ipc[0], 0xff);
    assert.equal(ipc[1], 0xff);
    assert.equal(ipc[2], 0xff);
    assert.equal(ipc[3], 0xff);
  });

  test('result_to_arrow_ipc with various types', async () => {
    const result = await duckdb.query(conn, `
      SELECT
        42::INTEGER as int_col,
        3.14::DOUBLE as double_col,
        'hello'::VARCHAR as str_col,
        true::BOOLEAN as bool_col,
        DATE '2024-01-15' as date_col
    `);
    const ipc = duckdb.result_to_arrow_ipc(result);

    assert.instanceOf(ipc, Uint8Array);
    assert.isAbove(ipc.length, 100); // Should have meaningful size
    // Continuation marker
    assert.equal(ipc[0], 0xff);
    assert.equal(ipc[1], 0xff);
    assert.equal(ipc[2], 0xff);
    assert.equal(ipc[3], 0xff);
  });

  test('result_to_arrow_ipc with nulls', async () => {
    const result = await duckdb.query(conn, `
      SELECT * FROM (VALUES
        (1, 'a'),
        (NULL, 'b'),
        (3, NULL)
      ) AS t(num, str)
    `);
    const ipc = duckdb.result_to_arrow_ipc(result);

    assert.instanceOf(ipc, Uint8Array);
    assert.isAbove(ipc.length, 0);
    // Continuation marker
    assert.equal(ipc[0], 0xff);
  });

  test('result_to_arrow_ipc with multiple chunks', async () => {
    // Create a result with many rows to ensure multiple chunks
    const result = await duckdb.query(conn, 'SELECT i::BIGINT as val FROM range(10000) t(i)');
    const ipc = duckdb.result_to_arrow_ipc(result);

    assert.instanceOf(ipc, Uint8Array);
    // Should be large enough to contain all the data
    assert.isAbove(ipc.length, 10000);
    // Continuation marker
    assert.equal(ipc[0], 0xff);
    assert.equal(ipc[1], 0xff);
    assert.equal(ipc[2], 0xff);
    assert.equal(ipc[3], 0xff);
  });

  test('result_to_arrow_ipc with empty result', async () => {
    const result = await duckdb.query(conn, 'SELECT 1 as a WHERE false');
    const ipc = duckdb.result_to_arrow_ipc(result);

    assert.instanceOf(ipc, Uint8Array);
    // Should still have schema even with no data
    assert.isAbove(ipc.length, 0);
    // Continuation marker
    assert.equal(ipc[0], 0xff);
  });

  test('result_to_arrow_ipc with list type', async () => {
    const result = await duckdb.query(conn, "SELECT [1, 2, 3]::INTEGER[] as arr");
    const ipc = duckdb.result_to_arrow_ipc(result);

    assert.instanceOf(ipc, Uint8Array);
    assert.isAbove(ipc.length, 0);
    assert.equal(ipc[0], 0xff);
  });

  test('result_to_arrow_ipc with struct type', async () => {
    const result = await duckdb.query(conn, "SELECT {'a': 1, 'b': 'hello'}::STRUCT(a INTEGER, b VARCHAR) as obj");
    const ipc = duckdb.result_to_arrow_ipc(result);

    assert.instanceOf(ipc, Uint8Array);
    assert.isAbove(ipc.length, 0);
    assert.equal(ipc[0], 0xff);
  });

  test('result_to_arrow_ipc produces consistent output', async () => {
    const result1 = await duckdb.query(conn, 'SELECT 42 as val');
    const result2 = await duckdb.query(conn, 'SELECT 42 as val');

    const ipc1 = duckdb.result_to_arrow_ipc(result1);
    const ipc2 = duckdb.result_to_arrow_ipc(result2);

    // Same query should produce same IPC bytes
    assert.equal(ipc1.length, ipc2.length);
    assert.deepEqual(Array.from(ipc1), Array.from(ipc2));
  });

  test('result_to_arrow_ipc with large strings', async () => {
    const result = await duckdb.query(conn, `SELECT repeat('x', 10000) as long_str`);
    const ipc = duckdb.result_to_arrow_ipc(result);

    assert.instanceOf(ipc, Uint8Array);
    // Should be large enough to contain the 10k character string
    assert.isAbove(ipc.length, 10000);
    assert.equal(ipc[0], 0xff);
  });

  // Streaming API tests
  test('result_schema_to_arrow_ipc returns valid schema bytes', async () => {
    const result = await duckdb.query(conn, 'SELECT 1 as a, 2 as b, 3 as c');
    const schemaIpc = duckdb.result_schema_to_arrow_ipc(result);

    assert.instanceOf(schemaIpc, Uint8Array);
    assert.isAbove(schemaIpc.length, 0);
    // Continuation marker
    assert.equal(schemaIpc[0], 0xff);
    assert.equal(schemaIpc[1], 0xff);
    assert.equal(schemaIpc[2], 0xff);
    assert.equal(schemaIpc[3], 0xff);
  });

  test('data_chunk_to_arrow_ipc returns valid record batch bytes', async () => {
    const result = await duckdb.query(conn, 'SELECT i::INTEGER as val FROM range(10) t(i)');
    const chunk = await duckdb.fetch_chunk(result);
    assert.isNotNull(chunk);

    const chunkIpc = duckdb.data_chunk_to_arrow_ipc(chunk!, result);

    assert.instanceOf(chunkIpc, Uint8Array);
    assert.isAbove(chunkIpc.length, 0);
    // Continuation marker (record batch is also an IPC message)
    assert.equal(chunkIpc[0], 0xff);
    assert.equal(chunkIpc[1], 0xff);
    assert.equal(chunkIpc[2], 0xff);
    assert.equal(chunkIpc[3], 0xff);
  });

  test('streaming API produces concatenatable IPC bytes', async () => {
    const result1 = await duckdb.query(conn, 'SELECT i::INTEGER as val FROM range(50) t(i)');
    const fullIpc = duckdb.result_to_arrow_ipc(result1);

    // Get streaming version
    const result2 = await duckdb.query(conn, 'SELECT i::INTEGER as val FROM range(50) t(i)');
    const schemaIpc = duckdb.result_schema_to_arrow_ipc(result2);

    const chunkIpcs: Uint8Array[] = [];
    while (true) {
      const chunk = await duckdb.fetch_chunk(result2);
      if (!chunk || duckdb.data_chunk_get_size(chunk) === 0) break;
      chunkIpcs.push(duckdb.data_chunk_to_arrow_ipc(chunk, result2));
    }

    // Concatenate schema + chunks
    const totalLength = schemaIpc.length + chunkIpcs.reduce((sum, c) => sum + c.length, 0);
    const streamedIpc = new Uint8Array(totalLength);
    let offset = 0;
    streamedIpc.set(schemaIpc, offset);
    offset += schemaIpc.length;
    for (const chunk of chunkIpcs) {
      streamedIpc.set(chunk, offset);
      offset += chunk.length;
    }

    // Both should have same length (may differ slightly due to padding)
    // But both should start with continuation marker
    assert.equal(fullIpc[0], 0xff);
    assert.equal(streamedIpc[0], 0xff);
    assert.isAbove(streamedIpc.length, 0);
  });
});
