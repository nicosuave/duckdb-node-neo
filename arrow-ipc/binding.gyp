{
  'targets': [
    {
      'target_name': 'arrow_ipc',
      'dependencies': [
        '<!(node -p "require(\'node-addon-api\').targets"):node_addon_api_except_all',
      ],
      'sources': [
        'src/arrow_ipc.cpp',
        # nanoarrow core
        'nanoarrow/src/nanoarrow/common/array.c',
        'nanoarrow/src/nanoarrow/common/array_stream.c',
        'nanoarrow/src/nanoarrow/common/schema.c',
        'nanoarrow/src/nanoarrow/common/utils.c',
        # nanoarrow IPC
        'nanoarrow/src/nanoarrow/ipc/codecs.c',
        'nanoarrow/src/nanoarrow/ipc/decoder.c',
        'nanoarrow/src/nanoarrow/ipc/encoder.c',
        'nanoarrow/src/nanoarrow/ipc/reader.c',
        'nanoarrow/src/nanoarrow/ipc/writer.c',
        # flatcc runtime (required by nanoarrow IPC)
        'nanoarrow/thirdparty/flatcc/src/runtime/builder.c',
        'nanoarrow/thirdparty/flatcc/src/runtime/emitter.c',
        'nanoarrow/thirdparty/flatcc/src/runtime/refmap.c',
        'nanoarrow/thirdparty/flatcc/src/runtime/verifier.c',
      ],
      'include_dirs': [
        '<(module_root_dir)/nanoarrow-config',
        '<(module_root_dir)/nanoarrow/src',
        '<(module_root_dir)/nanoarrow/thirdparty/flatcc/include',
      ],
      'conditions': [
        ['OS=="mac"', {
          'cflags+': ['-fvisibility=hidden'],
          'xcode_settings': {
            'GCC_SYMBOLS_PRIVATE_EXTERN': 'YES',
          },
        }],
      ],
    },
    {
      'target_name': 'copy_arrow_ipc_node',
      'type': 'none',
      'dependencies': ['arrow_ipc'],
      'conditions': [
        ['OS=="linux" and target_arch=="x64"', {
          'copies': [
            {
              'files': ['<(module_root_dir)/build/Release/arrow_ipc.node'],
              'destination': '<(module_root_dir)/pkgs/@duckdb/node-arrow-ipc',
            },
          ],
        }],
        ['OS=="linux" and target_arch=="arm64"', {
          'copies': [
            {
              'files': ['<(module_root_dir)/build/Release/arrow_ipc.node'],
              'destination': '<(module_root_dir)/pkgs/@duckdb/node-arrow-ipc',
            },
          ],
        }],
        ['OS=="mac" and target_arch=="arm64"', {
          'copies': [
            {
              'files': ['<(module_root_dir)/build/Release/arrow_ipc.node'],
              'destination': '<(module_root_dir)/pkgs/@duckdb/node-arrow-ipc',
            },
          ],
        }],
        ['OS=="mac" and target_arch=="x64"', {
          'copies': [
            {
              'files': ['<(module_root_dir)/build/Release/arrow_ipc.node'],
              'destination': '<(module_root_dir)/pkgs/@duckdb/node-arrow-ipc',
            },
          ],
        }],
        ['OS=="win" and target_arch=="x64"', {
          'copies': [
            {
              'files': ['<(module_root_dir)/build/Release/arrow_ipc.node'],
              'destination': '<(module_root_dir)/pkgs/@duckdb/node-arrow-ipc',
            },
          ],
        }],
      ],
    },
  ],
}
