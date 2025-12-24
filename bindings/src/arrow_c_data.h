// Arrow C Data Interface struct definitions
// From: https://arrow.apache.org/docs/format/CDataInterface.html
// These are ABI-stable and can be used to exchange Arrow data across libraries.

#ifndef ARROW_C_DATA_H
#define ARROW_C_DATA_H

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

struct ArrowSchema {
  const char* format;
  const char* name;
  const char* metadata;
  int64_t flags;
  int64_t n_children;
  struct ArrowSchema** children;
  struct ArrowSchema* dictionary;
  void (*release)(struct ArrowSchema*);
  void* private_data;
};

struct ArrowArray {
  int64_t length;
  int64_t null_count;
  int64_t offset;
  int64_t n_buffers;
  int64_t n_children;
  const void** buffers;
  struct ArrowArray** children;
  struct ArrowArray* dictionary;
  void (*release)(struct ArrowArray*);
  void* private_data;
};

#ifdef __cplusplus
}
#endif

#endif  // ARROW_C_DATA_H
