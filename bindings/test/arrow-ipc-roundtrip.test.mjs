#!/usr/bin/env node
// Test that Arrow IPC roundtrips correctly using flechette
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const duckdb = require('../pkgs/@duckdb/node-bindings-darwin-arm64/duckdb.node');

// Dynamic import for flechette
const { tableFromIPC } = await import('@uwdata/flechette');

async function test(name, fn) {
  try {
    await fn();
    console.log(`✓ ${name}`);
  } catch (e) {
    console.log(`✗ ${name}`);
    console.error(`  ${e.message}`);
    process.exitCode = 1;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message || 'Assertion failed');
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(message || `Expected ${expected}, got ${actual}`);
  }
}

function assertDeepEqual(actual, expected, message) {
  const actualStr = JSON.stringify(actual);
  const expectedStr = JSON.stringify(expected);
  if (actualStr !== expectedStr) {
    throw new Error(message || `Expected ${expectedStr}, got ${actualStr}`);
  }
}

async function main() {
  console.log('Testing Arrow IPC roundtrip with flechette...\n');

  const db = await duckdb.open(':memory:');
  const conn = await duckdb.connect(db);

  await test('integers roundtrip', async () => {
    const result = await duckdb.query(conn, 'SELECT 1 as a, 2 as b, 3 as c');
    const ipc = duckdb.result_to_arrow_ipc(result);
    const table = tableFromIPC(ipc);

    assertEqual(table.numCols, 3, 'column count');
    assertEqual(table.numRows, 1, 'row count');

    const row = table.toArray()[0];
    assertEqual(row.a, 1);
    assertEqual(row.b, 2);
    assertEqual(row.c, 3);
  });

  await test('multiple rows', async () => {
    const result = await duckdb.query(conn, 'SELECT i::INTEGER as val FROM range(5) t(i)');
    const ipc = duckdb.result_to_arrow_ipc(result);
    const table = tableFromIPC(ipc);

    assertEqual(table.numCols, 1);
    assertEqual(table.numRows, 5);

    const rows = table.toArray();
    for (let i = 0; i < 5; i++) {
      assertEqual(rows[i].val, i, `row ${i} value`);
    }
  });

  await test('strings', async () => {
    const result = await duckdb.query(conn, "SELECT 'hello' as greeting, 'world' as target");
    const ipc = duckdb.result_to_arrow_ipc(result);
    const table = tableFromIPC(ipc);

    const row = table.toArray()[0];
    assertEqual(row.greeting, 'hello');
    assertEqual(row.target, 'world');
  });

  await test('floats', async () => {
    const result = await duckdb.query(conn, 'SELECT 3.14::DOUBLE as pi, 2.71::DOUBLE as e');
    const ipc = duckdb.result_to_arrow_ipc(result);
    const table = tableFromIPC(ipc);

    const row = table.toArray()[0];
    assert(Math.abs(row.pi - 3.14) < 0.001, 'pi value');
    assert(Math.abs(row.e - 2.71) < 0.001, 'e value');
  });

  await test('booleans', async () => {
    const result = await duckdb.query(conn, 'SELECT true as yes, false as no');
    const ipc = duckdb.result_to_arrow_ipc(result);
    const table = tableFromIPC(ipc);

    const row = table.toArray()[0];
    assertEqual(row.yes, true);
    assertEqual(row.no, false);
  });

  await test('nulls', async () => {
    const result = await duckdb.query(conn, "SELECT NULL::INTEGER as nullable");
    const ipc = duckdb.result_to_arrow_ipc(result);
    const table = tableFromIPC(ipc);

    const row = table.toArray()[0];
    assertEqual(row.nullable, null);
  });

  await test('mixed nulls and values', async () => {
    const result = await duckdb.query(conn, `
      SELECT * FROM (VALUES (1), (NULL), (3)) AS t(val)
    `);
    const ipc = duckdb.result_to_arrow_ipc(result);
    const table = tableFromIPC(ipc);

    const rows = table.toArray();
    assertEqual(rows[0].val, 1);
    assertEqual(rows[1].val, null);
    assertEqual(rows[2].val, 3);
  });

  await test('large result (50k rows)', async () => {
    const result = await duckdb.query(conn, 'SELECT i::BIGINT as val FROM range(50000) t(i)');
    const ipc = duckdb.result_to_arrow_ipc(result);
    const table = tableFromIPC(ipc);

    assertEqual(table.numRows, 50000);

    // Spot check some values
    const rows = table.toArray();
    assertEqual(Number(rows[0].val), 0);
    assertEqual(Number(rows[999].val), 999);
    assertEqual(Number(rows[49999].val), 49999);
  });

  await test('list type', async () => {
    const result = await duckdb.query(conn, "SELECT [1, 2, 3]::INTEGER[] as arr");
    const ipc = duckdb.result_to_arrow_ipc(result);
    const table = tableFromIPC(ipc);

    const row = table.toArray()[0];
    assertDeepEqual(Array.from(row.arr), [1, 2, 3]);
  });

  await test('struct type', async () => {
    const result = await duckdb.query(conn, "SELECT {'x': 10, 'y': 20}::STRUCT(x INTEGER, y INTEGER) as point");
    const ipc = duckdb.result_to_arrow_ipc(result);
    const table = tableFromIPC(ipc);

    const row = table.toArray()[0];
    assertEqual(row.point.x, 10);
    assertEqual(row.point.y, 20);
  });

  await test('empty result', async () => {
    const result = await duckdb.query(conn, 'SELECT 1 as a WHERE false');
    const ipc = duckdb.result_to_arrow_ipc(result);
    const table = tableFromIPC(ipc);

    assertEqual(table.numCols, 1);
    assertEqual(table.numRows, 0);
  });

  await test('column names preserved', async () => {
    const result = await duckdb.query(conn, 'SELECT 1 as my_column, 2 as another_col');
    const ipc = duckdb.result_to_arrow_ipc(result);
    const table = tableFromIPC(ipc);

    const schema = table.schema;
    assertEqual(schema.fields[0].name, 'my_column');
    assertEqual(schema.fields[1].name, 'another_col');
  });

  await test('bigint', async () => {
    const result = await duckdb.query(conn, 'SELECT 9223372036854775807::BIGINT as big');
    const ipc = duckdb.result_to_arrow_ipc(result);
    // Need useBigInt: true for large int64 values that exceed Number.MAX_SAFE_INTEGER
    const table = tableFromIPC(ipc, { useBigInt: true });

    const row = table.toArray()[0];
    assert(typeof row.big === 'bigint', `Expected bigint, got ${typeof row.big}`);
    assert(row.big === 9223372036854775807n, `Expected 9223372036854775807n, got ${row.big}`);
  });

  // Streaming API tests
  await test('streaming: schema only', async () => {
    const result = await duckdb.query(conn, 'SELECT 1 as a, 2 as b');
    const schemaIpc = duckdb.result_schema_to_arrow_ipc(result);

    assert(schemaIpc instanceof Uint8Array, 'schema should be Uint8Array');
    assert(schemaIpc.length > 0, 'schema should have bytes');
    // Arrow IPC stream format starts with continuation marker
    assertEqual(schemaIpc[0], 0xff);
    assertEqual(schemaIpc[1], 0xff);
    assertEqual(schemaIpc[2], 0xff);
    assertEqual(schemaIpc[3], 0xff);
  });

  await test('streaming: chunk to IPC', async () => {
    const result = await duckdb.query(conn, 'SELECT i::INTEGER as val FROM range(10) t(i)');
    const chunk = await duckdb.fetch_chunk(result);

    const chunkIpc = duckdb.data_chunk_to_arrow_ipc(chunk, result);

    assert(chunkIpc instanceof Uint8Array, 'chunk IPC should be Uint8Array');
    assert(chunkIpc.length > 0, 'chunk IPC should have bytes');
  });

  await test('streaming: concatenated equals full IPC', async () => {
    const result1 = await duckdb.query(conn, 'SELECT i::INTEGER as val FROM range(100) t(i)');
    const fullIpc = duckdb.result_to_arrow_ipc(result1);

    // Get streaming version
    const result2 = await duckdb.query(conn, 'SELECT i::INTEGER as val FROM range(100) t(i)');
    const schemaIpc = duckdb.result_schema_to_arrow_ipc(result2);

    const chunks = [];
    while (true) {
      const chunk = await duckdb.fetch_chunk(result2);
      if (!chunk || duckdb.data_chunk_get_size(chunk) === 0) break;
      chunks.push(duckdb.data_chunk_to_arrow_ipc(chunk, result2));
    }

    // Concatenate schema + chunks
    const totalLength = schemaIpc.length + chunks.reduce((sum, c) => sum + c.length, 0);
    const streamedIpc = new Uint8Array(totalLength);
    let offset = 0;
    streamedIpc.set(schemaIpc, offset);
    offset += schemaIpc.length;
    for (const chunk of chunks) {
      streamedIpc.set(chunk, offset);
      offset += chunk.length;
    }

    // Both should decode to the same data
    const fullTable = tableFromIPC(fullIpc);
    const streamedTable = tableFromIPC(streamedIpc);

    assertEqual(fullTable.numRows, streamedTable.numRows, 'row counts should match');
    assertEqual(fullTable.numCols, streamedTable.numCols, 'column counts should match');

    const fullRows = fullTable.toArray();
    const streamedRows = streamedTable.toArray();
    for (let i = 0; i < 100; i++) {
      assertEqual(fullRows[i].val, streamedRows[i].val, `row ${i} should match`);
    }
  });

  await test('streaming: large result yields multiple chunks', async () => {
    // This should produce multiple chunks due to DuckDB's vector size limit
    const result = await duckdb.query(conn, 'SELECT i::BIGINT as val FROM range(10000) t(i)');
    const schemaIpc = duckdb.result_schema_to_arrow_ipc(result);

    const chunkIpcs = [];
    while (true) {
      const chunk = await duckdb.fetch_chunk(result);
      if (!chunk || duckdb.data_chunk_get_size(chunk) === 0) break;
      chunkIpcs.push(duckdb.data_chunk_to_arrow_ipc(chunk, result));
    }

    assert(chunkIpcs.length >= 1, 'should have at least one chunk');

    // Concatenate and verify
    const totalLength = schemaIpc.length + chunkIpcs.reduce((sum, c) => sum + c.length, 0);
    const streamedIpc = new Uint8Array(totalLength);
    let offset = 0;
    streamedIpc.set(schemaIpc, offset);
    offset += schemaIpc.length;
    for (const chunk of chunkIpcs) {
      streamedIpc.set(chunk, offset);
      offset += chunk.length;
    }

    const table = tableFromIPC(streamedIpc);
    assertEqual(table.numRows, 10000, 'should have all 10000 rows');
  });

  // === Date/Time types ===
  await test('date', async () => {
    const result = await duckdb.query(conn, "SELECT DATE '2024-06-15' as d");
    const ipc = duckdb.result_to_arrow_ipc(result);
    const table = tableFromIPC(ipc);
    const row = table.toArray()[0];
    // Arrow represents dates as days since epoch
    assert(row.d !== null, 'date should not be null');
  });

  await test('timestamp', async () => {
    const result = await duckdb.query(conn, "SELECT TIMESTAMP '2024-06-15 10:30:45.123' as ts");
    const ipc = duckdb.result_to_arrow_ipc(result);
    const table = tableFromIPC(ipc);
    const row = table.toArray()[0];
    assert(row.ts !== null, 'timestamp should not be null');
  });

  await test('timestamp with time zone', async () => {
    const result = await duckdb.query(conn, "SELECT TIMESTAMPTZ '2024-06-15 10:30:45+02' as tstz");
    const ipc = duckdb.result_to_arrow_ipc(result);
    const table = tableFromIPC(ipc);
    const row = table.toArray()[0];
    assert(row.tstz !== null, 'timestamptz should not be null');
  });

  await test('time', async () => {
    const result = await duckdb.query(conn, "SELECT TIME '14:30:45' as t");
    const ipc = duckdb.result_to_arrow_ipc(result);
    const table = tableFromIPC(ipc);
    const row = table.toArray()[0];
    assert(row.t !== null, 'time should not be null');
  });

  await test('interval', async () => {
    const result = await duckdb.query(conn, "SELECT INTERVAL '1 year 2 months 3 days 4 hours' as i");
    const ipc = duckdb.result_to_arrow_ipc(result);
    const table = tableFromIPC(ipc);
    const row = table.toArray()[0];
    assert(row.i !== null, 'interval should not be null');
  });

  // === Map type ===
  await test('map', async () => {
    const result = await duckdb.query(conn, "SELECT MAP {'a': 1, 'b': 2, 'c': 3} as m");
    const ipc = duckdb.result_to_arrow_ipc(result);
    const table = tableFromIPC(ipc);
    const row = table.toArray()[0];
    assert(row.m !== null, 'map should not be null');
    // Map is represented as list of key-value structs in Arrow
  });

  // === Nested types ===
  await test('nested list', async () => {
    const result = await duckdb.query(conn, "SELECT [[1, 2], [3, 4, 5], [6]]::INTEGER[][] as nested");
    const ipc = duckdb.result_to_arrow_ipc(result);
    const table = tableFromIPC(ipc);
    const row = table.toArray()[0];
    assertEqual(row.nested.length, 3, 'outer list length');
    assertDeepEqual(Array.from(row.nested[0]), [1, 2]);
    assertDeepEqual(Array.from(row.nested[1]), [3, 4, 5]);
    assertDeepEqual(Array.from(row.nested[2]), [6]);
  });

  await test('struct with list', async () => {
    const result = await duckdb.query(conn, `
      SELECT {'name': 'Alice', 'scores': [95, 87, 92]}::STRUCT(name VARCHAR, scores INTEGER[]) as s
    `);
    const ipc = duckdb.result_to_arrow_ipc(result);
    const table = tableFromIPC(ipc);
    const row = table.toArray()[0];
    assertEqual(row.s.name, 'Alice');
    assertDeepEqual(Array.from(row.s.scores), [95, 87, 92]);
  });

  await test('list of structs', async () => {
    const result = await duckdb.query(conn, `
      SELECT [{'x': 1, 'y': 2}, {'x': 3, 'y': 4}]::STRUCT(x INTEGER, y INTEGER)[] as points
    `);
    const ipc = duckdb.result_to_arrow_ipc(result);
    const table = tableFromIPC(ipc);
    const row = table.toArray()[0];
    assertEqual(row.points.length, 2);
    assertEqual(row.points[0].x, 1);
    assertEqual(row.points[0].y, 2);
    assertEqual(row.points[1].x, 3);
    assertEqual(row.points[1].y, 4);
  });

  await test('deeply nested struct', async () => {
    const result = await duckdb.query(conn, `
      SELECT {
        'level1': {
          'level2': {
            'value': 42
          }
        }
      }::STRUCT(level1 STRUCT(level2 STRUCT(value INTEGER))) as deep
    `);
    const ipc = duckdb.result_to_arrow_ipc(result);
    const table = tableFromIPC(ipc);
    const row = table.toArray()[0];
    assertEqual(row.deep.level1.level2.value, 42);
  });

  // === Binary/Blob ===
  await test('blob', async () => {
    const result = await duckdb.query(conn, "SELECT '\\xDE\\xAD\\xBE\\xEF'::BLOB as b");
    const ipc = duckdb.result_to_arrow_ipc(result);
    const table = tableFromIPC(ipc);
    const row = table.toArray()[0];
    // flechette returns Buffer (which is a Uint8Array subclass in Node.js)
    assert(ArrayBuffer.isView(row.b), 'blob should be ArrayBuffer view');
    assertEqual(row.b.length, 4);
    assertEqual(row.b[0], 0xDE);
    assertEqual(row.b[1], 0xAD);
    assertEqual(row.b[2], 0xBE);
    assertEqual(row.b[3], 0xEF);
  });

  await test('large blob', async () => {
    const result = await duckdb.query(conn, "SELECT repeat('\\x00\\xFF'::BLOB, 5000) as b");
    const ipc = duckdb.result_to_arrow_ipc(result);
    const table = tableFromIPC(ipc);
    const row = table.toArray()[0];
    assertEqual(row.b.length, 10000);
  });

  // === UUID ===
  await test('uuid', async () => {
    const result = await duckdb.query(conn, "SELECT '550e8400-e29b-41d4-a716-446655440000'::UUID as id");
    const ipc = duckdb.result_to_arrow_ipc(result);
    const table = tableFromIPC(ipc);
    const row = table.toArray()[0];
    assert(row.id !== null, 'uuid should not be null');
  });

  // === Decimal ===
  await test('decimal', async () => {
    const result = await duckdb.query(conn, "SELECT 123.456::DECIMAL(10, 3) as d");
    const ipc = duckdb.result_to_arrow_ipc(result);
    const table = tableFromIPC(ipc);
    const row = table.toArray()[0];
    // Decimal representation varies by Arrow library
    assert(row.d !== null, 'decimal should not be null');
  });

  await test('high precision decimal', async () => {
    const result = await duckdb.query(conn, "SELECT 12345678901234567890.12345::DECIMAL(38, 5) as d");
    const ipc = duckdb.result_to_arrow_ipc(result);
    const table = tableFromIPC(ipc);
    const row = table.toArray()[0];
    assert(row.d !== null, 'high precision decimal should not be null');
  });

  // === Enum ===
  // Note: nanoarrow IPC doesn't support dictionary encoding, so we cast enum to varchar
  await test('enum (as varchar)', async () => {
    await duckdb.query(conn, "DROP TYPE IF EXISTS mood");
    await duckdb.query(conn, "CREATE TYPE mood AS ENUM ('happy', 'sad', 'neutral')");
    const result = await duckdb.query(conn, "SELECT 'happy'::mood::VARCHAR as m");
    const ipc = duckdb.result_to_arrow_ipc(result);
    const table = tableFromIPC(ipc);
    const row = table.toArray()[0];
    assertEqual(row.m, 'happy');
  });

  // === Unicode strings ===
  await test('unicode: basic multilingual plane', async () => {
    const result = await duckdb.query(conn, "SELECT 'Hello 世界 🌍 مرحبا' as s");
    const ipc = duckdb.result_to_arrow_ipc(result);
    const table = tableFromIPC(ipc);
    const row = table.toArray()[0];
    assertEqual(row.s, 'Hello 世界 🌍 مرحبا');
  });

  await test('unicode: emojis', async () => {
    const result = await duckdb.query(conn, "SELECT '👨‍👩‍👧‍👦 🏳️‍🌈 🇺🇸' as s");
    const ipc = duckdb.result_to_arrow_ipc(result);
    const table = tableFromIPC(ipc);
    const row = table.toArray()[0];
    assertEqual(row.s, '👨‍👩‍👧‍👦 🏳️‍🌈 🇺🇸');
  });

  await test('unicode: escape sequences', async () => {
    const result = await duckdb.query(conn, "SELECT E'line1\\nline2\\ttab' as s");
    const ipc = duckdb.result_to_arrow_ipc(result);
    const table = tableFromIPC(ipc);
    const row = table.toArray()[0];
    assertEqual(row.s, 'line1\nline2\ttab');
  });

  // === Float edge cases ===
  await test('float: infinity', async () => {
    const result = await duckdb.query(conn, "SELECT 'infinity'::DOUBLE as pos_inf, '-infinity'::DOUBLE as neg_inf");
    const ipc = duckdb.result_to_arrow_ipc(result);
    const table = tableFromIPC(ipc);
    const row = table.toArray()[0];
    assertEqual(row.pos_inf, Infinity);
    assertEqual(row.neg_inf, -Infinity);
  });

  await test('float: NaN', async () => {
    const result = await duckdb.query(conn, "SELECT 'nan'::DOUBLE as nan_val");
    const ipc = duckdb.result_to_arrow_ipc(result);
    const table = tableFromIPC(ipc);
    const row = table.toArray()[0];
    assert(Number.isNaN(row.nan_val), 'should be NaN');
  });

  await test('float: negative zero', async () => {
    const result = await duckdb.query(conn, "SELECT -0.0::DOUBLE as neg_zero");
    const ipc = duckdb.result_to_arrow_ipc(result);
    const table = tableFromIPC(ipc);
    const row = table.toArray()[0];
    assertEqual(row.neg_zero, 0);
    // Check it's actually -0
    assertEqual(1 / row.neg_zero, -Infinity);
  });

  await test('float: very small', async () => {
    const result = await duckdb.query(conn, "SELECT 2.2250738585072014e-308::DOUBLE as tiny");
    const ipc = duckdb.result_to_arrow_ipc(result);
    const table = tableFromIPC(ipc);
    const row = table.toArray()[0];
    assert(row.tiny > 0 && row.tiny < 1e-300, 'should be very small positive');
  });

  // === Integer boundaries ===
  await test('integer: boundaries', async () => {
    const result = await duckdb.query(conn, `
      SELECT
        127::TINYINT as ti_max,
        (-128)::TINYINT as ti_min,
        32767::SMALLINT as si_max,
        (-32768)::SMALLINT as si_min,
        2147483647::INTEGER as i_max,
        (-2147483648)::INTEGER as i_min
    `);
    const ipc = duckdb.result_to_arrow_ipc(result);
    const table = tableFromIPC(ipc);
    const row = table.toArray()[0];
    assertEqual(row.ti_max, 127);
    assertEqual(row.ti_min, -128);
    assertEqual(row.si_max, 32767);
    assertEqual(row.si_min, -32768);
    assertEqual(row.i_max, 2147483647);
    assertEqual(row.i_min, -2147483648);
  });

  await test('integer: unsigned boundaries', async () => {
    const result = await duckdb.query(conn, `
      SELECT
        255::UTINYINT as uti_max,
        65535::USMALLINT as usi_max,
        4294967295::UINTEGER as ui_max
    `);
    const ipc = duckdb.result_to_arrow_ipc(result);
    const table = tableFromIPC(ipc);
    const row = table.toArray()[0];
    assertEqual(row.uti_max, 255);
    assertEqual(row.usi_max, 65535);
    assertEqual(row.ui_max, 4294967295);
  });

  await test('bigint: boundaries', async () => {
    const result = await duckdb.query(conn, `
      SELECT
        9223372036854775807::BIGINT as bi_max,
        (-9223372036854775808)::BIGINT as bi_min
    `);
    const ipc = duckdb.result_to_arrow_ipc(result);
    const table = tableFromIPC(ipc, { useBigInt: true });
    const row = table.toArray()[0];
    assertEqual(row.bi_max, 9223372036854775807n);
    assertEqual(row.bi_min, -9223372036854775808n);
  });

  await test('ubigint: boundary', async () => {
    const result = await duckdb.query(conn, "SELECT 18446744073709551615::UBIGINT as ubi_max");
    const ipc = duckdb.result_to_arrow_ipc(result);
    const table = tableFromIPC(ipc, { useBigInt: true });
    const row = table.toArray()[0];
    assertEqual(row.ubi_max, 18446744073709551615n);
  });

  await test('hugeint', async () => {
    const result = await duckdb.query(conn, "SELECT 170141183460469231731687303715884105727::HUGEINT as huge");
    const ipc = duckdb.result_to_arrow_ipc(result);
    const table = tableFromIPC(ipc, { useBigInt: true });
    const row = table.toArray()[0];
    assert(row.huge !== null, 'hugeint should not be null');
  });

  // === Error handling ===
  await test('error: result already consumed', async () => {
    const result = await duckdb.query(conn, 'SELECT 1 as a');
    // Consume the result
    duckdb.result_to_arrow_ipc(result);
    // Second call should still work (result is materialized)
    const ipc2 = duckdb.result_to_arrow_ipc(result);
    assert(ipc2 instanceof Uint8Array, 'should still return valid IPC');
  });

  // === Streaming with complex types ===
  await test('streaming: with structs', async () => {
    const result = await duckdb.query(conn, `
      SELECT {'id': i, 'name': 'item' || i::VARCHAR}::STRUCT(id INTEGER, name VARCHAR) as item
      FROM range(100) t(i)
    `);
    const schemaIpc = duckdb.result_schema_to_arrow_ipc(result);

    const chunks = [];
    while (true) {
      const chunk = await duckdb.fetch_chunk(result);
      if (!chunk || duckdb.data_chunk_get_size(chunk) === 0) break;
      chunks.push(duckdb.data_chunk_to_arrow_ipc(chunk, result));
    }

    // Concatenate
    const totalLength = schemaIpc.length + chunks.reduce((sum, c) => sum + c.length, 0);
    const streamedIpc = new Uint8Array(totalLength);
    let offset = 0;
    streamedIpc.set(schemaIpc, offset);
    offset += schemaIpc.length;
    for (const chunk of chunks) {
      streamedIpc.set(chunk, offset);
      offset += chunk.length;
    }

    const table = tableFromIPC(streamedIpc);
    assertEqual(table.numRows, 100);
    const rows = table.toArray();
    assertEqual(rows[0].item.id, 0);
    assertEqual(rows[0].item.name, 'item0');
    assertEqual(rows[99].item.id, 99);
    assertEqual(rows[99].item.name, 'item99');
  });

  await test('streaming: with lists', async () => {
    const result = await duckdb.query(conn, `
      SELECT list_value(i, i+1, i+2)::INTEGER[] as nums
      FROM range(100) t(i)
    `);
    const schemaIpc = duckdb.result_schema_to_arrow_ipc(result);

    const chunks = [];
    while (true) {
      const chunk = await duckdb.fetch_chunk(result);
      if (!chunk || duckdb.data_chunk_get_size(chunk) === 0) break;
      chunks.push(duckdb.data_chunk_to_arrow_ipc(chunk, result));
    }

    const totalLength = schemaIpc.length + chunks.reduce((sum, c) => sum + c.length, 0);
    const streamedIpc = new Uint8Array(totalLength);
    let offset = 0;
    streamedIpc.set(schemaIpc, offset);
    offset += schemaIpc.length;
    for (const chunk of chunks) {
      streamedIpc.set(chunk, offset);
      offset += chunk.length;
    }

    const table = tableFromIPC(streamedIpc);
    assertEqual(table.numRows, 100);
    const rows = table.toArray();
    assertDeepEqual(Array.from(rows[0].nums), [0, 1, 2]);
    assertDeepEqual(Array.from(rows[50].nums), [50, 51, 52]);
  });

  duckdb.disconnect_sync(conn);
  duckdb.close_sync(db);

  if (process.exitCode !== 1) {
    console.log('\nAll tests passed!');
  } else {
    console.log('\nSome tests failed.');
  }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
