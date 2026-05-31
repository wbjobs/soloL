use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::error::QuantumError;
use crate::quantum::gates::{Gate, GateType};
use crate::quantum::optimizer::{CircuitOptimizer, OptimizationResult};

pub fn expand_toffoli(control1: usize, control2: usize, target: usize) -> Vec<Gate> {
    let mut gates = Vec::with_capacity(21);

    gates.push(Gate::new(GateType::Hadamard, vec![target]).unwrap());
    gates.push(Gate::new(GateType::CNOT, vec![control2, target]).unwrap());
    gates.push(Gate::new(GateType::TDag, vec![target]).unwrap());
    gates.push(Gate::new(GateType::CNOT, vec![control1, target]).unwrap());
    gates.push(Gate::new(GateType::T, vec![target]).unwrap());
    gates.push(Gate::new(GateType::CNOT, vec![control2, target]).unwrap());
    gates.push(Gate::new(GateType::TDag, vec![target]).unwrap());
    gates.push(Gate::new(GateType::CNOT, vec![control1, target]).unwrap());
    gates.push(Gate::new(GateType::T, vec![control2]).unwrap());
    gates.push(Gate::new(GateType::T, vec![target]).unwrap());
    gates.push(Gate::new(GateType::Hadamard, vec![target]).unwrap());
    gates.push(Gate::new(GateType::CNOT, vec![control1, control2]).unwrap());
    gates.push(Gate::new(GateType::T, vec![control1]).unwrap());
    gates.push(Gate::new(GateType::TDag, vec![control2]).unwrap());
    gates.push(Gate::new(GateType::CNOT, vec![control1, control2]).unwrap());

    gates
}

pub fn expand_toffoli_gates(gates: &[Gate]) -> Result<Vec<Gate>, QuantumError> {
    let mut expanded = Vec::with_capacity(gates.len() * 2);

    for gate in gates {
        if gate.gate_type == GateType::Toffoli {
            let expanded_gates = expand_toffoli(gate.qubits[0], gate.qubits[1], gate.qubits[2]);
            expanded.extend(expanded_gates);
        } else {
            expanded.push(gate.clone());
        }
    }

    Ok(expanded)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QuantumCircuit {
    pub num_qubits: usize,
    pub gates: Vec<Gate>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompileOptions {
    pub expand_toffoli: bool,
    pub optimize_gates: bool,
    pub use_kahan_sum: bool,
}

impl Default for CompileOptions {
    fn default() -> Self {
        CompileOptions {
            expand_toffoli: true,
            optimize_gates: true,
            use_kahan_sum: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompiledCircuit {
    pub num_qubits: usize,
    pub original_gates: Vec<Gate>,
    pub optimized_gates: Vec<Gate>,
    pub optimization_result: OptimizationResult,
    pub circuit_hash: String,
    pub toffoli_expanded: bool,
    pub toffoli_count: usize,
    pub expanded_gate_count: usize,
}

impl QuantumCircuit {
    pub fn new(num_qubits: usize) -> Result<Self, QuantumError> {
        if num_qubits == 0 || num_qubits > 30 {
            return Err(QuantumError::InvalidQubitCount(num_qubits));
        }

        Ok(QuantumCircuit {
            num_qubits,
            gates: Vec::new(),
        })
    }

    pub fn with_gates(num_qubits: usize, gates: Vec<Gate>) -> Result<Self, QuantumError> {
        if num_qubits == 0 || num_qubits > 30 {
            return Err(QuantumError::InvalidQubitCount(num_qubits));
        }

        for gate in &gates {
            for &qubit in &gate.qubits {
                if qubit >= num_qubits {
                    return Err(QuantumError::InvalidQubitIndex(qubit, num_qubits));
                }
            }
        }

        Ok(QuantumCircuit { num_qubits, gates })
    }

    pub fn add_gate(&mut self, gate: Gate) -> Result<(), QuantumError> {
        for &qubit in &gate.qubits {
            if qubit >= self.num_qubits {
                return Err(QuantumError::InvalidQubitIndex(qubit, self.num_qubits));
            }
        }
        self.gates.push(gate);
        Ok(())
    }

    pub fn add_hadamard(&mut self, qubit: usize) -> Result<(), QuantumError> {
        self.add_gate(Gate::new(GateType::Hadamard, vec![qubit])?)
    }

    pub fn add_x(&mut self, qubit: usize) -> Result<(), QuantumError> {
        self.add_gate(Gate::new(GateType::PauliX, vec![qubit])?)
    }

    pub fn add_y(&mut self, qubit: usize) -> Result<(), QuantumError> {
        self.add_gate(Gate::new(GateType::PauliY, vec![qubit])?)
    }

    pub fn add_z(&mut self, qubit: usize) -> Result<(), QuantumError> {
        self.add_gate(Gate::new(GateType::PauliZ, vec![qubit])?)
    }

    pub fn add_cnot(&mut self, control: usize, target: usize) -> Result<(), QuantumError> {
        self.add_gate(Gate::new(GateType::CNOT, vec![control, target])?)
    }

    pub fn add_toffoli(&mut self, control1: usize, control2: usize, target: usize) -> Result<(), QuantumError> {
        self.add_gate(Gate::new(GateType::Toffoli, vec![control1, control2, target])?)
    }

    pub fn compile(&self) -> Result<CompiledCircuit, QuantumError> {
        self.compile_with_options(CompileOptions::default())
    }

    pub fn compile_with_options(&self, options: CompileOptions) -> Result<CompiledCircuit, QuantumError> {
        if self.gates.is_empty() {
            return Err(QuantumError::EmptyCircuit);
        }

        let toffoli_count = self.gates.iter().filter(|g| g.gate_type == GateType::Toffoli).count();

        let mut processed_gates = self.gates.clone();
        let mut toffoli_expanded = false;
        let mut expanded_gate_count = 0;

        if options.expand_toffoli && toffoli_count > 0 {
            processed_gates = expand_toffoli_gates(&processed_gates)?;
            toffoli_expanded = true;
            expanded_gate_count = processed_gates.len();
        }

        let (optimized_gates, optimization_result) = if options.optimize_gates {
            let optimizer = CircuitOptimizer::new();
            optimizer.optimize(&processed_gates)?
        } else {
            (processed_gates.clone(), OptimizationResult {
                original_gate_count: processed_gates.len(),
                optimized_gate_count: processed_gates.len(),
                gates_removed: 0,
                merged_groups: Vec::new(),
            })
        };

        let circuit_hash = self.compute_hash();

        Ok(CompiledCircuit {
            num_qubits: self.num_qubits,
            original_gates: self.gates.clone(),
            optimized_gates,
            optimization_result,
            circuit_hash,
            toffoli_expanded,
            toffoli_count,
            expanded_gate_count,
        })
    }

    pub fn toffoli_count(&self) -> usize {
        self.gates.iter().filter(|g| g.gate_type == GateType::Toffoli).count()
    }

    pub fn compute_hash(&self) -> String {
        let mut hasher = Sha256::new();
        hasher.update(self.num_qubits.to_le_bytes());
        for gate in &self.gates {
            hasher.update(format!("{:?}{:?}", gate.gate_type, gate.qubits));
        }
        let result = hasher.finalize();
        hex::encode(result)
    }

    pub fn depth(&self) -> usize {
        let mut last_use: Vec<usize> = vec![0; self.num_qubits];
        let mut max_depth = 0;

        for gate in &self.gates {
            let mut gate_depth = 0;
            for &qubit in &gate.qubits {
                gate_depth = gate_depth.max(last_use[qubit]);
            }
            gate_depth += 1;

            for &qubit in &gate.qubits {
                last_use[qubit] = gate_depth;
            }

            max_depth = max_depth.max(gate_depth);
        }

        max_depth
    }

    pub fn gate_count(&self) -> usize {
        self.gates.len()
    }

    pub fn single_qubit_gate_count(&self) -> usize {
        self.gates.iter().filter(|g| g.is_single_qubit()).count()
    }

    pub fn multi_qubit_gate_count(&self) -> usize {
        self.gates.iter().filter(|g| !g.is_single_qubit()).count()
    }
}

impl CompiledCircuit {
    pub fn compute_hash(&self) -> String {
        let mut hasher = Sha256::new();
        hasher.update(self.num_qubits.to_le_bytes());
        for gate in &self.optimized_gates {
            hasher.update(format!("{:?}{:?}", gate.gate_type, gate.qubits));
        }
        let result = hasher.finalize();
        hex::encode(result)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_circuit_creation() {
        let circuit = QuantumCircuit::new(3).unwrap();
        assert_eq!(circuit.num_qubits, 3);
        assert_eq!(circuit.gate_count(), 0);
    }

    #[test]
    fn test_invalid_qubit_count() {
        assert!(QuantumCircuit::new(0).is_err());
        assert!(QuantumCircuit::new(31).is_err());
    }

    #[test]
    fn test_add_gates() {
        let mut circuit = QuantumCircuit::new(3).unwrap();
        circuit.add_hadamard(0).unwrap();
        circuit.add_x(1).unwrap();
        circuit.add_cnot(0, 1).unwrap();
        circuit.add_toffoli(0, 1, 2).unwrap();

        assert_eq!(circuit.gate_count(), 4);
        assert_eq!(circuit.single_qubit_gate_count(), 2);
        assert_eq!(circuit.multi_qubit_gate_count(), 2);
    }

    #[test]
    fn test_invalid_qubit_index() {
        let mut circuit = QuantumCircuit::new(2).unwrap();
        assert!(circuit.add_hadamard(2).is_err());
        assert!(circuit.add_cnot(0, 2).is_err());
        assert!(circuit.add_toffoli(0, 1, 2).is_err());
    }

    #[test]
    fn test_circuit_depth() {
        let mut circuit = QuantumCircuit::new(3).unwrap();
        circuit.add_hadamard(0).unwrap();
        circuit.add_hadamard(1).unwrap();
        circuit.add_cnot(0, 1).unwrap();
        circuit.add_hadamard(2).unwrap();

        assert_eq!(circuit.depth(), 2);
    }

    #[test]
    fn test_compile() {
        let mut circuit = QuantumCircuit::new(2).unwrap();
        circuit.add_hadamard(0).unwrap();
        circuit.add_hadamard(0).unwrap();
        circuit.add_cnot(0, 1).unwrap();

        let compiled = circuit.compile().unwrap();
        assert_eq!(compiled.num_qubits, 2);
        assert_eq!(compiled.original_gates.len(), 3);
        assert_eq!(compiled.optimized_gates.len(), 1);
        assert_eq!(compiled.optimization_result.gates_removed, 2);
    }

    #[test]
    fn test_compile_empty_circuit() {
        let circuit = QuantumCircuit::new(2).unwrap();
        assert!(circuit.compile().is_err());
    }

    #[test]
    fn test_circuit_hash() {
        let mut circuit1 = QuantumCircuit::new(2).unwrap();
        circuit1.add_hadamard(0).unwrap();
        circuit1.add_cnot(0, 1).unwrap();

        let mut circuit2 = QuantumCircuit::new(2).unwrap();
        circuit2.add_hadamard(0).unwrap();
        circuit2.add_cnot(0, 1).unwrap();

        let mut circuit3 = QuantumCircuit::new(2).unwrap();
        circuit3.add_hadamard(1).unwrap();
        circuit3.add_cnot(0, 1).unwrap();

        assert_eq!(circuit1.compute_hash(), circuit2.compute_hash());
        assert_ne!(circuit1.compute_hash(), circuit3.compute_hash());
    }
}
