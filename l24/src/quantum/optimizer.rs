use ndarray::Array2;
use num_complex::Complex64;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use crate::error::QuantumError;
use crate::quantum::gates::{
    are_matrices_equal, identity_matrix, is_identity, Gate, GateType,
};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OptimizationResult {
    pub original_gate_count: usize,
    pub optimized_gate_count: usize,
    pub gates_removed: usize,
    pub merged_groups: Vec<MergedGroup>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MergedGroup {
    pub qubit: usize,
    pub original_gates: Vec<GateType>,
    pub merged: bool,
}

pub struct CircuitOptimizer {
    tolerance: f64,
    enable_cancellation: bool,
    enable_merging: bool,
}

impl Default for CircuitOptimizer {
    fn default() -> Self {
        CircuitOptimizer {
            tolerance: 1e-10,
            enable_cancellation: true,
            enable_merging: true,
        }
    }
}

impl CircuitOptimizer {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn with_tolerance(mut self, tolerance: f64) -> Self {
        self.tolerance = tolerance;
        self
    }

    pub fn optimize(&self, gates: &[Gate]) -> Result<(Vec<Gate>, OptimizationResult), QuantumError> {
        let original_count = gates.len();
        let mut merged_groups: Vec<MergedGroup> = Vec::new();

        let mut optimized = if self.enable_merging {
            let (merged, groups) = self.merge_consecutive_single_qubit_gates(gates)?;
            merged_groups = groups;
            merged
        } else {
            gates.to_vec()
        };

        if self.enable_cancellation {
            optimized = self.cancel_inverse_gates(&optimized);
        }

        let optimized_count = optimized.len();

        let result = OptimizationResult {
            original_gate_count: original_count,
            optimized_gate_count: optimized_count,
            gates_removed: original_count - optimized_count,
            merged_groups,
        };

        Ok((optimized, result))
    }

    fn merge_consecutive_single_qubit_gates(
        &self,
        gates: &[Gate],
    ) -> Result<(Vec<Gate>, Vec<MergedGroup>), QuantumError> {
        let mut result: Vec<Gate> = Vec::new();
        let mut merged_groups: Vec<MergedGroup> = Vec::new();

        let mut qubit_matrices: HashMap<usize, (Vec<GateType>, Array2<Complex64>)> = HashMap::new();

        for gate in gates {
            if gate.is_single_qubit() {
                let qubit = gate.qubits[0];
                let matrix = gate.get_matrix();

                qubit_matrices
                    .entry(qubit)
                    .and_modify(|(gates_list, accumulated)| {
                        gates_list.push(gate.gate_type);
                        *accumulated = matrix.dot(&*accumulated);
                    })
                    .or_insert_with(|| (vec![gate.gate_type], matrix));
            } else {
                for (qubit, (gates_list, accumulated)) in qubit_matrices.drain() {
                    if gates_list.len() > 1 {
                        merged_groups.push(MergedGroup {
                            qubit,
                            original_gates: gates_list.clone(),
                            merged: !is_identity(&accumulated, self.tolerance),
                        });
                    }

                    if !is_identity(&accumulated, self.tolerance) {
                        let merged_gate = self.create_gate_from_matrix(qubit, &accumulated)?;
                        result.push(merged_gate);
                    }
                }

                result.push(gate.clone());
            }
        }

        for (qubit, (gates_list, accumulated)) in qubit_matrices.drain() {
            if gates_list.len() > 1 {
                merged_groups.push(MergedGroup {
                    qubit,
                    original_gates: gates_list.clone(),
                    merged: !is_identity(&accumulated, self.tolerance),
                });
            }

            if !is_identity(&accumulated, self.tolerance) {
                let merged_gate = self.create_gate_from_matrix(qubit, &accumulated)?;
                result.push(merged_gate);
            }
        }

        Ok((result, merged_groups))
    }

    fn create_gate_from_matrix(
        &self,
        qubit: usize,
        matrix: &Array2<Complex64>,
    ) -> Result<Gate, QuantumError> {
        use crate::quantum::gates::{
            hadamard_matrix, pauli_x_matrix, pauli_y_matrix, pauli_z_matrix,
        };

        if are_matrices_equal(matrix, &hadamard_matrix(), self.tolerance) {
            return Gate::new(GateType::Hadamard, vec![qubit]);
        }
        if are_matrices_equal(matrix, &pauli_x_matrix(), self.tolerance) {
            return Gate::new(GateType::PauliX, vec![qubit]);
        }
        if are_matrices_equal(matrix, &pauli_y_matrix(), self.tolerance) {
            return Gate::new(GateType::PauliY, vec![qubit]);
        }
        if are_matrices_equal(matrix, &pauli_z_matrix(), self.tolerance) {
            return Gate::new(GateType::PauliZ, vec![qubit]);
        }

        Err(QuantumError::UnknownGateMatrix)
    }

    fn cancel_inverse_gates(&self, gates: &[Gate]) -> Vec<Gate> {
        let mut result: Vec<Gate> = Vec::new();

        for gate in gates {
            if let Some(last) = result.last() {
                if self.are_inverses(last, gate) {
                    result.pop();
                    continue;
                }
            }
            result.push(gate.clone());
        }

        result
    }

    fn are_inverses(&self, g1: &Gate, g2: &Gate) -> bool {
        if g1.qubits != g2.qubits {
            return false;
        }

        let m1 = g1.get_matrix();
        let m2 = g2.get_matrix();

        let product = m2.dot(&m1);
        is_identity(&product, self.tolerance)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::quantum::gates::GateType;

    #[test]
    fn test_merge_consecutive_hadamards() {
        let optimizer = CircuitOptimizer::new();
        let gates = vec![
            Gate::new(GateType::Hadamard, vec![0]).unwrap(),
            Gate::new(GateType::Hadamard, vec![0]).unwrap(),
        ];

        let (optimized, result) = optimizer.optimize(&gates).unwrap();
        assert_eq!(optimized.len(), 0);
        assert_eq!(result.gates_removed, 2);
    }

    #[test]
    fn test_merge_consecutive_pauli_x() {
        let optimizer = CircuitOptimizer::new();
        let gates = vec![
            Gate::new(GateType::PauliX, vec![0]).unwrap(),
            Gate::new(GateType::PauliX, vec![0]).unwrap(),
        ];

        let (optimized, result) = optimizer.optimize(&gates).unwrap();
        assert_eq!(optimized.len(), 0);
        assert_eq!(result.gates_removed, 2);
    }

    #[test]
    fn test_no_merge_different_qubits() {
        let optimizer = CircuitOptimizer::new();
        let gates = vec![
            Gate::new(GateType::Hadamard, vec![0]).unwrap(),
            Gate::new(GateType::Hadamard, vec![1]).unwrap(),
        ];

        let (optimized, _) = optimizer.optimize(&gates).unwrap();
        assert_eq!(optimized.len(), 2);
    }

    #[test]
    fn test_merge_with_cnot_between() {
        let optimizer = CircuitOptimizer::new();
        let gates = vec![
            Gate::new(GateType::Hadamard, vec![0]).unwrap(),
            Gate::new(GateType::Hadamard, vec![0]).unwrap(),
            Gate::new(GateType::CNOT, vec![0, 1]).unwrap(),
            Gate::new(GateType::PauliX, vec![1]).unwrap(),
            Gate::new(GateType::PauliX, vec![1]).unwrap(),
        ];

        let (optimized, result) = optimizer.optimize(&gates).unwrap();
        assert_eq!(optimized.len(), 1);
        assert_eq!(result.gates_removed, 4);
    }

    #[test]
    fn test_cancel_inverse_gates() {
        let optimizer = CircuitOptimizer::new();
        let gates = vec![
            Gate::new(GateType::PauliX, vec![0]).unwrap(),
            Gate::new(GateType::CNOT, vec![0, 1]).unwrap(),
            Gate::new(GateType::PauliX, vec![0]).unwrap(),
        ];

        let (optimized, _) = optimizer.optimize(&gates).unwrap();
        assert_eq!(optimized.len(), 1);
    }

    #[test]
    fn test_complex_optimization() {
        let optimizer = CircuitOptimizer::new();
        let gates = vec![
            Gate::new(GateType::Hadamard, vec![0]).unwrap(),
            Gate::new(GateType::PauliX, vec![0]).unwrap(),
            Gate::new(GateType::Hadamard, vec![0]).unwrap(),
            Gate::new(GateType::CNOT, vec![0, 1]).unwrap(),
            Gate::new(GateType::Hadamard, vec![1]).unwrap(),
            Gate::new(GateType::Hadamard, vec![1]).unwrap(),
            Gate::new(GateType::PauliZ, vec![1]).unwrap(),
            Gate::new(GateType::PauliZ, vec![1]).unwrap(),
        ];

        let (optimized, result) = optimizer.optimize(&gates).unwrap();
        assert!(optimized.len() < gates.len());
        assert!(result.gates_removed > 0);
    }

    #[test]
    fn test_merge_three_single_qubit_gates() {
        let optimizer = CircuitOptimizer::new();
        let gates = vec![
            Gate::new(GateType::Hadamard, vec![0]).unwrap(),
            Gate::new(GateType::PauliX, vec![0]).unwrap(),
            Gate::new(GateType::Hadamard, vec![0]).unwrap(),
        ];

        let (optimized, result) = optimizer.optimize(&gates).unwrap();
        assert_eq!(result.merged_groups.len(), 1);
        assert_eq!(result.merged_groups[0].original_gates.len(), 3);
    }
}
