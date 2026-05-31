#!/bin/bash

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROTO_DIR="$SCRIPT_DIR/../proto"
OUTPUT_DIR="$SCRIPT_DIR/../proto/fingerprintpb"

mkdir -p "$OUTPUT_DIR"

echo "Generating gRPC Go code..."

protoc \
    --proto_path="$PROTO_DIR" \
    --go_out="$OUTPUT_DIR" \
    --go_opt=paths=source_relative \
    --go-grpc_out="$OUTPUT_DIR" \
    --go-grpc_opt=paths=source_relative \
    "$PROTO_DIR/fingerprint.proto"

echo "gRPC code generation complete!"
