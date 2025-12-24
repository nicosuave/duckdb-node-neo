// Arrow IPC serialization via nanoarrow
// Takes Arrow C Data Interface wrapper objects (with .pointer property) and returns IPC bytes

#include <napi.h>
#include <cstring>

// nanoarrow provides ArrowSchema and ArrowArray definitions
#include "nanoarrow/nanoarrow.h"
#include "nanoarrow/nanoarrow_ipc.h"

class ArrowIpcAddon : public Napi::Addon<ArrowIpcAddon> {
public:
  ArrowIpcAddon(Napi::Env env, Napi::Object exports) {
    DefineAddon(exports, {
      InstanceMethod("schemaToIpc", &ArrowIpcAddon::schemaToIpc),
      InstanceMethod("arrayToIpc", &ArrowIpcAddon::arrayToIpc),
    });
  }

private:
  // schemaToIpc(schema: { pointer: bigint }): Uint8Array
  // Writes an Arrow schema message to IPC format
  Napi::Value schemaToIpc(const Napi::CallbackInfo& info) {
    auto env = info.Env();

    if (info.Length() < 1 || !info[0].IsObject()) {
      throw Napi::TypeError::New(env, "Expected schema wrapper object");
    }

    auto obj = info[0].As<Napi::Object>();
    auto pointer_val = obj.Get("pointer");
    if (!pointer_val.IsBigInt()) {
      throw Napi::TypeError::New(env, "Expected schema.pointer to be BigInt");
    }

    bool lossless;
    int64_t ptr_value = pointer_val.As<Napi::BigInt>().Int64Value(&lossless);
    if (!lossless) {
      throw Napi::Error::New(env, "Pointer value out of range");
    }

    ArrowSchema* schema = reinterpret_cast<ArrowSchema*>(ptr_value);
    if (!schema) {
      throw Napi::Error::New(env, "Null schema pointer");
    }

    // Initialize output buffer and IPC writer
    ArrowBuffer output_buffer;
    ArrowBufferInit(&output_buffer);

    ArrowIpcOutputStream output_stream;
    ArrowErrorCode err = ArrowIpcOutputStreamInitBuffer(&output_stream, &output_buffer);
    if (err != NANOARROW_OK) {
      ArrowBufferReset(&output_buffer);
      throw Napi::Error::New(env, "Failed to initialize Arrow IPC output stream");
    }

    ArrowIpcWriter writer;
    err = ArrowIpcWriterInit(&writer, &output_stream);
    if (err != NANOARROW_OK) {
      if (output_stream.release) output_stream.release(&output_stream);
      ArrowBufferReset(&output_buffer);
      throw Napi::Error::New(env, "Failed to initialize Arrow IPC writer");
    }

    // Write schema
    ArrowError arrow_error;
    err = ArrowIpcWriterWriteSchema(&writer, schema, &arrow_error);
    if (err != NANOARROW_OK) {
      std::string error_str = "Failed to write Arrow schema: ";
      error_str += arrow_error.message;
      ArrowIpcWriterReset(&writer);
      ArrowBufferReset(&output_buffer);
      throw Napi::Error::New(env, error_str);
    }

    ArrowIpcWriterReset(&writer);

    // Create result buffer with zero-copy
    auto finalizer = [](Napi::Env, uint8_t*, ArrowBuffer* buffer) {
      ArrowBufferReset(buffer);
      delete buffer;
    };

    ArrowBuffer* persistent_buffer = new ArrowBuffer;
    *persistent_buffer = output_buffer;
    // Don't reset output_buffer - ownership transferred to persistent_buffer

    auto result = Napi::Buffer<uint8_t>::New(
      env,
      reinterpret_cast<uint8_t*>(persistent_buffer->data),
      persistent_buffer->size_bytes,
      finalizer,
      persistent_buffer
    );

    return result;
  }

  // arrayToIpc(schema: { pointer: bigint }, array: { pointer: bigint }): Uint8Array
  // Writes an Arrow record batch message to IPC format
  Napi::Value arrayToIpc(const Napi::CallbackInfo& info) {
    auto env = info.Env();

    if (info.Length() < 2 || !info[0].IsObject() || !info[1].IsObject()) {
      throw Napi::TypeError::New(env, "Expected schema and array wrapper objects");
    }

    auto schema_obj = info[0].As<Napi::Object>();
    auto schema_ptr_val = schema_obj.Get("pointer");
    if (!schema_ptr_val.IsBigInt()) {
      throw Napi::TypeError::New(env, "Expected schema.pointer to be BigInt");
    }

    auto array_obj = info[1].As<Napi::Object>();
    auto array_ptr_val = array_obj.Get("pointer");
    if (!array_ptr_val.IsBigInt()) {
      throw Napi::TypeError::New(env, "Expected array.pointer to be BigInt");
    }

    bool lossless;
    int64_t schema_ptr = schema_ptr_val.As<Napi::BigInt>().Int64Value(&lossless);
    if (!lossless) {
      throw Napi::Error::New(env, "Schema pointer value out of range");
    }

    int64_t array_ptr = array_ptr_val.As<Napi::BigInt>().Int64Value(&lossless);
    if (!lossless) {
      throw Napi::Error::New(env, "Array pointer value out of range");
    }

    ArrowSchema* schema = reinterpret_cast<ArrowSchema*>(schema_ptr);
    ArrowArray* array = reinterpret_cast<ArrowArray*>(array_ptr);

    if (!schema) {
      throw Napi::Error::New(env, "Null schema pointer");
    }
    if (!array) {
      throw Napi::Error::New(env, "Null array pointer");
    }

    // Initialize output buffer and IPC writer
    ArrowBuffer output_buffer;
    ArrowBufferInit(&output_buffer);

    ArrowIpcOutputStream output_stream;
    ArrowErrorCode err = ArrowIpcOutputStreamInitBuffer(&output_stream, &output_buffer);
    if (err != NANOARROW_OK) {
      ArrowBufferReset(&output_buffer);
      throw Napi::Error::New(env, "Failed to initialize Arrow IPC output stream");
    }

    ArrowIpcWriter writer;
    err = ArrowIpcWriterInit(&writer, &output_stream);
    if (err != NANOARROW_OK) {
      if (output_stream.release) output_stream.release(&output_stream);
      ArrowBufferReset(&output_buffer);
      throw Napi::Error::New(env, "Failed to initialize Arrow IPC writer");
    }

    // Create ArrowArrayView for writing
    ArrowArrayView array_view;
    ArrowError arrow_error;

    err = ArrowArrayViewInitFromSchema(&array_view, schema, &arrow_error);
    if (err != NANOARROW_OK) {
      std::string error_str = "Failed to init array view: ";
      error_str += arrow_error.message;
      ArrowIpcWriterReset(&writer);
      ArrowBufferReset(&output_buffer);
      throw Napi::Error::New(env, error_str);
    }

    err = ArrowArrayViewSetArray(&array_view, array, &arrow_error);
    if (err != NANOARROW_OK) {
      std::string error_str = "Failed to set array view: ";
      error_str += arrow_error.message;
      ArrowArrayViewReset(&array_view);
      ArrowIpcWriterReset(&writer);
      ArrowBufferReset(&output_buffer);
      throw Napi::Error::New(env, error_str);
    }

    // Write record batch
    err = ArrowIpcWriterWriteArrayView(&writer, &array_view, &arrow_error);

    ArrowArrayViewReset(&array_view);

    if (err != NANOARROW_OK) {
      std::string error_str = "Failed to write record batch: ";
      error_str += arrow_error.message;
      ArrowIpcWriterReset(&writer);
      ArrowBufferReset(&output_buffer);
      throw Napi::Error::New(env, error_str);
    }

    ArrowIpcWriterReset(&writer);

    // Create result buffer with zero-copy
    auto finalizer = [](Napi::Env, uint8_t*, ArrowBuffer* buffer) {
      ArrowBufferReset(buffer);
      delete buffer;
    };

    ArrowBuffer* persistent_buffer = new ArrowBuffer;
    *persistent_buffer = output_buffer;

    auto result = Napi::Buffer<uint8_t>::New(
      env,
      reinterpret_cast<uint8_t*>(persistent_buffer->data),
      persistent_buffer->size_bytes,
      finalizer,
      persistent_buffer
    );

    return result;
  }
};

NODE_API_ADDON(ArrowIpcAddon)
