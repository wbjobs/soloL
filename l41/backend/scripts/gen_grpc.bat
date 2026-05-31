@echo off
setlocal enabledelayedexpansion

set SCRIPT_DIR=%~dp0
set PROTO_DIR=%SCRIPT_DIR%..\proto
set OUTPUT_DIR=%SCRIPT_DIR%..\proto\fingerprintpb

if not exist "%OUTPUT_DIR%" mkdir "%OUTPUT_DIR%"

echo Generating gRPC Go code...

protoc ^
    --proto_path="%PROTO_DIR%" ^
    --go_out="%OUTPUT_DIR%" ^
    --go_opt=paths=source_relative ^
    --go-grpc_out="%OUTPUT_DIR%" ^
    --go-grpc_opt=paths=source_relative ^
    "%PROTO_DIR%\fingerprint.proto"

echo gRPC code generation complete!
