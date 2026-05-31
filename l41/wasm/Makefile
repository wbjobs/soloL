.PHONY: all build clean

WASM_SRC = fingerprint.cpp
OUTPUT_DIR = ../frontend/src/wasm

all: build

build:
	@echo "Building WebAssembly module..."
	@mkdir -p $(OUTPUT_DIR)
	emcc $(WASM_SRC) \
		-o $(OUTPUT_DIR)/fingerprint.js \
		-std=c++17 \
		-O3 \
		-s WASM=1 \
		-s ALLOW_MEMORY_GROWTH=1 \
		-s MODULARIZE=1 \
		-s EXPORT_ES6=1 \
		-s USE_ES6_IMPORT_META=0 \
		-s EXPORT_NAME='FingerprintModule' \
		-s "EXPORTED_FUNCTIONS=['_extract_fingerprint', '_hamming_distance', '_free_fingerprint_result', '_malloc', '_free']" \
		-s "EXPORTED_RUNTIME_METHODS=['ccall', 'cwrap', 'getValue', 'setValue', 'HEAPU8', 'HEAPF32']" \
		-s FILESYSTEM=0 \
		-s ENVIRONMENT="web,worker" \
		-s MAXIMUM_MEMORY=128MB \
		-s INITIAL_MEMORY=16MB \
		-s STACK_SIZE=1MB \
		-flto \
		--bind
	@echo "Build complete!"

clean:
	rm -f $(OUTPUT_DIR)/fingerprint.js $(OUTPUT_DIR)/fingerprint.wasm
