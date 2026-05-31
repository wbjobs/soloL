$ErrorActionPreference = "Stop"

Write-Host "Building gRPC proto files..." -ForegroundColor Green

$protoPath = "proto\render.proto"
$jsOut = "scheduler\proto"
$pyOut = "node\proto"

if (-not (Test-Path $jsOut)) {
    New-Item -ItemType Directory -Force -Path $jsOut | Out-Null
}

if (-not (Test-Path $pyOut)) {
    New-Item -ItemType Directory -Force -Path $pyOut | Out-Null
}

Write-Host "Generating JavaScript gRPC code..." -ForegroundColor Cyan
npx grpc_tools_node_protoc `
    --proto_path=proto `
    --js_out=import_style=commonjs:$jsOut `
    --grpc_out=grpc_js:$jsOut `
    $protoPath

Write-Host "Generating Python gRPC code..." -ForegroundColor Cyan
python -m grpc_tools.protoc `
    --proto_path=proto `
    --python_out=$pyOut `
    --grpc_python_out=$pyOut `
    $protoPath

Write-Host "Proto files built successfully!" -ForegroundColor Green
