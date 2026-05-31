#!/bin/bash

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WASM_DIR="$(dirname "$SCRIPT_DIR")"
FRONTEND_WASM_DIR="$SCRIPT_DIR/../../frontend/src/wasm"

mkdir -p "$FRONTEND_WASM_DIR"

echo "Building WebAssembly fingerprint module..."

emcc "$WASM_DIR/fingerprint.cpp" \
    -o "$FRONTEND_WASM_DIR/fingerprint.js" \
    -std=c++17 \
    -O3 \
    -s WASM=1 \
    -s ALLOW_MEMORY_GROWTH=1 \
    -s MODULARIZE=1 \
    -s EXPORT_ES6=1 \
    -s USE_ES6_IMPORT_META=0 \
    -s EXPORT_NAME="FingerprintModule" \
    -s EXPORTED_FUNCTIONS='["_extract_fingerprint", "_hamming_distance", "_free_fingerprint_result", "_malloc", "_free"]' \
    -s EXPORTED_RUNTIME_METHODS='["ccall", "cwrap", "getValue", "setValue", "HEAPU8", "HEAPF32"]' \
    -s FILESYSTEM=0 \
    -s ENVIRONMENT="web,worker" \
    -s MAXIMUM_MEMORY=128MB \
    -s INITIAL_MEMORY=16MB \
    -s STACK_SIZE=1MB \
    -flto \
    --bind

echo "Build complete!"
echo "Output files: $FRONTEND_WASM_DIR/fingerprint.js and fingerprint.wasm"
