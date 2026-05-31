#!/bin/bash

BASE_URL="http://localhost:8080/api/v1"

echo "=== Testing Quantum Circuit Simulator API ==="
echo ""

echo "1. Health Check:"
curl -s "$BASE_URL/health" | python -m json.tool
echo ""

echo "2. Get Available Gates:"
curl -s "$BASE_URL/gates" | python -m json.tool
echo ""

echo "3. Get Circuit Info (Bell State):"
curl -s -X POST "$BASE_URL/circuit/info" \
  -H "Content-Type: application/json" \
  -d '{
    "num_qubits": 2,
    "gates": [
      {"gate_type": "H", "qubits": [0]},
      {"gate_type": "CNOT", "qubits": [0, 1]}
    ]
  }' | python -m json.tool
echo ""

echo "4. Compile Circuit with optimization:"
curl -s -X POST "$BASE_URL/circuit/compile" \
  -H "Content-Type: application/json" \
  -d '{
    "num_qubits": 2,
    "gates": [
      {"gate_type": "H", "qubits": [0]},
      {"gate_type": "H", "qubits": [0]},
      {"gate_type": "CNOT", "qubits": [0, 1]}
    ]
  }' | python -m json.tool
echo ""

echo "5. Simulate Bell State:"
curl -s -X POST "$BASE_URL/circuit/simulate" \
  -H "Content-Type: application/json" \
  -d '{
    "num_qubits": 2,
    "gates": [
      {"gate_type": "H", "qubits": [0]},
      {"gate_type": "CNOT", "qubits": [0, 1]}
    ]
  }' | python -m json.tool
echo ""

echo "6. Measure Circuit (1000 shots):"
curl -s -X POST "$BASE_URL/circuit/measure" \
  -H "Content-Type: application/json" \
  -d '{
    "num_qubits": 2,
    "gates": [
      {"gate_type": "H", "qubits": [0]},
      {"gate_type": "CNOT", "qubits": [0, 1]}
    ],
    "shots": 1000
  }' | python -m json.tool
echo ""

echo "7. Simulate Toffoli Gate:"
curl -s -X POST "$BASE_URL/circuit/simulate" \
  -H "Content-Type: application/json" \
  -d '{
    "num_qubits": 3,
    "gates": [
      {"gate_type": "X", "qubits": [0]},
      {"gate_type": "X", "qubits": [1]},
      {"gate_type": "Toffoli", "qubits": [0, 1, 2]}
    ]
  }' | python -m json.tool
echo ""

echo "8. Get Cache Stats:"
curl -s "$BASE_URL/cache/stats" | python -m json.tool
echo ""

echo "=== All tests completed ==="
