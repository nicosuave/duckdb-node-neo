import duckdb from '@duckdb/node-bindings';
import { expect, suite, test } from 'vitest';

suite('Arrow C Data Interface', () => {
  test('connection_get_arrow_options returns options', async () => {
    const db = await duckdb.open(':memory:');
    const conn = await duckdb.connect(db);

    const options = duckdb.connection_get_arrow_options(conn);
    expect(options).toBeDefined();

    duckdb.destroy_arrow_options(options);
    duckdb.disconnect_sync(conn);
    duckdb.close_sync(db);
  });

  test('result_get_arrow_options returns options', async () => {
    const db = await duckdb.open(':memory:');
    const conn = await duckdb.connect(db);
    const result = await duckdb.query(conn, 'SELECT 1 as a');

    const options = duckdb.result_get_arrow_options(result);
    expect(options).toBeDefined();

    duckdb.destroy_arrow_options(options);
    duckdb.disconnect_sync(conn);
    duckdb.close_sync(db);
  });

  test('to_arrow_schema creates schema from types and names', async () => {
    const db = await duckdb.open(':memory:');
    const conn = await duckdb.connect(db);
    const result = await duckdb.query(conn, 'SELECT 1::INTEGER as a, 2::BIGINT as b');
    const options = duckdb.result_get_arrow_options(result);

    const columnCount = duckdb.column_count(result);
    const types: duckdb.LogicalType[] = [];
    const names: string[] = [];

    for (let i = 0; i < columnCount; i++) {
      types.push(duckdb.column_logical_type(result, i));
      names.push(duckdb.column_name(result, i));
    }

    const schema = duckdb.to_arrow_schema(options, types, names, columnCount);

    expect(schema).toBeDefined();
    expect(typeof schema.pointer).toBe('bigint');
    expect(schema.pointer).not.toBe(0n);
    expect(typeof schema.release).toBe('function');

    schema.release();
    duckdb.destroy_arrow_options(options);
    duckdb.disconnect_sync(conn);
    duckdb.close_sync(db);
  });

  test('data_chunk_to_arrow converts chunk to arrow array', async () => {
    const db = await duckdb.open(':memory:');
    const conn = await duckdb.connect(db);
    const result = await duckdb.query(conn, 'SELECT i::INTEGER as val FROM range(10) t(i)');
    const options = duckdb.result_get_arrow_options(result);
    const chunk = await duckdb.fetch_chunk(result);

    expect(chunk).toBeDefined();

    const arrowArray = duckdb.data_chunk_to_arrow(options, chunk!);

    expect(arrowArray).toBeDefined();
    expect(typeof arrowArray.pointer).toBe('bigint');
    expect(arrowArray.pointer).not.toBe(0n);
    expect(typeof arrowArray.release).toBe('function');

    arrowArray.release();
    duckdb.destroy_arrow_options(options);
    duckdb.disconnect_sync(conn);
    duckdb.close_sync(db);
  });

  test('schema pointer is valid memory address', async () => {
    const db = await duckdb.open(':memory:');
    const conn = await duckdb.connect(db);
    const result = await duckdb.query(conn, 'SELECT 1 as a');
    const options = duckdb.result_get_arrow_options(result);
    const types = [duckdb.column_logical_type(result, 0)];
    const names = [duckdb.column_name(result, 0)];

    const schema = duckdb.to_arrow_schema(options, types, names, 1);

    // Pointer should be a positive bigint (valid memory address)
    expect(schema.pointer > 0n).toBe(true);

    schema.release();
    duckdb.destroy_arrow_options(options);
    duckdb.disconnect_sync(conn);
    duckdb.close_sync(db);
  });

  test('complex types: struct', async () => {
    const db = await duckdb.open(':memory:');
    const conn = await duckdb.connect(db);
    const result = await duckdb.query(
      conn,
      "SELECT {'x': 1, 'y': 2}::STRUCT(x INTEGER, y INTEGER) as point"
    );
    const options = duckdb.result_get_arrow_options(result);
    const chunk = await duckdb.fetch_chunk(result);

    const arrowArray = duckdb.data_chunk_to_arrow(options, chunk!);
    expect(arrowArray.pointer).not.toBe(0n);

    arrowArray.release();
    duckdb.destroy_arrow_options(options);
    duckdb.disconnect_sync(conn);
    duckdb.close_sync(db);
  });

  test('complex types: list', async () => {
    const db = await duckdb.open(':memory:');
    const conn = await duckdb.connect(db);
    const result = await duckdb.query(conn, 'SELECT [1, 2, 3]::INTEGER[] as arr');
    const options = duckdb.result_get_arrow_options(result);
    const chunk = await duckdb.fetch_chunk(result);

    const arrowArray = duckdb.data_chunk_to_arrow(options, chunk!);
    expect(arrowArray.pointer).not.toBe(0n);

    arrowArray.release();
    duckdb.destroy_arrow_options(options);
    duckdb.disconnect_sync(conn);
    duckdb.close_sync(db);
  });
});
