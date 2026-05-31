use serde::{Deserialize, Serialize};
use std::time::Instant;

use crate::error::QuantumError;
use crate::quantum::circuit::{CompileOptions, CompiledCircuit, QuantumCircuit};
use crate::quantum::gates::GateType;
use crate::quantum::state::QuantumState;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SimulationResult {
    pub num_qubits: usize,
    pub final_state: QuantumState,
    pub probability_distribution: Vec<(String, f64)>,
    pub amplitudes: Vec<(String, (f64, f64))>,
    pub top_probabilities: Vec<(String, f64)>,
    pub execution_time_ms: u128,
    pub circuit_hash: String,
    pub optimization_result: Option<crate::quantum::optimizer::OptimizationResult>,
    pub total_probability_error: f64,
    pub toffoli_expanded: bool,
    pub toffoli_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MeasurementResult {
    pub circuit_hash: String,
    pub measurements: Vec<String>,
    pub counts: std::collections::HashMap<String, usize>,
    pub probabilities: Vec<(String, f64)>,
    pub shots: usize,
    pub total_probability_error: f64,
}

pub struct QuantumSimulator {
    compile_options: CompileOptions,
}

impl Default for QuantumSimulator {
    fn default() -> Self {
        QuantumSimulator {
            compile_options: CompileOptions::default(),
        }
    }
}

impl QuantumSimulator {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn with_optimization(mut self, use_optimization: bool) -> Self {
        self.compile_options.optimize_gates = use_optimization;
        self
    }

    pub fn with_expand_toffoli(mut self, expand_toffoli: bool) -> Self {
        self.compile_options.expand_toffoli = expand_toffoli;
        self
    }

    pub fn with_kahan_sum(mut self, use_kahan: bool) -> Self {
        self.compile_options.use_kahan_sum = use_kahan;
        self
    }

    pub fn with_compile_options(mut self, options: CompileOptions) -> Self {
        self.compile_options = options;
        self
    }

    pub fn simulate(&self, circuit: &QuantumCircuit) -> Result<SimulationResult, QuantumError> {
        let start = Instant::now();

        let compiled = circuit.compile_with_options(self.compile_options.clone())?;
        self.simulate_with_compiled(&compiled)
    }

    pub fn simulate_raw(&self, circuit: &QuantumCircuit) -> Result<SimulationResult, QuantumError> {
        let start = Instant::now();

        let compiled = CompiledCircuit {
            num_qubits: circuit.num_qubits,
            original_gates: circuit.gates.clone(),
            optimized_gates: circuit.gates.clone(),
            optimization_result: crate::quantum::optimizer::OptimizationResult {
                original_gate_count: circuit.gate_count(),
                optimized_gate_count: circuit.gate_count(),
                gates_removed: 0,
                merged_groups: Vec::new(),
            },
            circuit_hash: circuit.compute_hash(),
            toffoli_expanded: false,
            toffoli_count: circuit.toffoli_count(),
            expanded_gate_count: 0,
        };

        let result = self.simulate_with_compiled(&compiled)?;
        Ok(SimulationResult {
            execution_time_ms: start.elapsed().as_millis(),
            ..result
        })
    }

    pub fn simulate_with_compiled(&self, compiled: &CompiledCircuit) -> Result<SimulationResult, QuantumError> {
        let start = Instant::now();

        let mut state = QuantumState::new(compiled.num_qubits)?;

        for gate in &compiled.optimized_gates {
            let matrix = gate.get_matrix();

            match gate.gate_type {
                GateType::Hadamard
                | GateType::PauliX
                | GateType::PauliY
                | GateType::PauliZ
                | GateType::T
                | GateType::TDag
                | GateType::S
                | GateType::SDag => {
                    state.apply_single_qubit_gate(gate.qubits[0], &matrix)?;
                }
                GateType::CNOT => {
                    state.apply_two_qubit_gate(gate.qubits[0], gate.qubits[1], &matrix)?;
                }
                GateType::Toffoli => {
                    state.apply_three_qubit_gate(gate.qubits[0], gate.qubits[1], gate.qubits[2], &matrix)?;
                }
            }
        }

        state.normalize();

        let total_prob_error = state.total_probability_error();

        let probability_distribution = state.get_probability_distribution();
        let amplitudes = state
            .amplitudes
            .iter()
            .enumerate()
            .map(|(i, amp)| {
                let binary = format!("{:0width$b}", i, width = state.num_qubits);
                (binary, (amp.re, amp.im))
            })
            .filter(|(_, (re, im))| re.abs() > 1e-10 || im.abs() > 1e-10)
            .collect();

        let top_probabilities = state.get_top_probabilities(10);

        let execution_time = start.elapsed().as_millis();

        Ok(SimulationResult {
            num_qubits: compiled.num_qubits,
            final_state: state,
            probability_distribution,
            amplitudes,
            top_probabilities,
            execution_time_ms: execution_time,
            circuit_hash: compiled.circuit_hash.clone(),
            optimization_result: Some(compiled.optimization_result.clone()),
            total_probability_error: total_prob_error,
            toffoli_expanded: compiled.toffoli_expanded,
            toffoli_count: compiled.toffoli_count,
        })
    }

    pub fn measure(
        &self,
        circuit: &QuantumCircuit,
        shots: usize,
    ) -> Result<MeasurementResult, QuantumError> {
        let simulation = self.simulate(circuit)?;
        let circuit_hash = simulation.circuit_hash.clone();
        let total_prob_error = simulation.total_probability_error;

        let mut measurements = Vec::with_capacity(shots);
        let mut counts = std::collections::HashMap::new();

        for _ in 0..shots {
            let result = simulation.final_state.measure();
            *counts.entry(result.clone()).or_insert(0) += 1;
            measurements.push(result);
        }

        let mut probabilities: Vec<(String, f64)> = counts
            .iter()
            .map(|(k, v)| (k.clone(), *v as f64 / shots as f64))
            .collect();
        probabilities.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));

        Ok(MeasurementResult {
            circuit_hash,
            measurements,
            counts,
            probabilities,
            shots,
            total_probability_error: total_prob_error,
        })
    }

    pub fn measure_state(
        &self,
        state: &QuantumState,
        shots: usize,
        circuit_hash: String,
    ) -> MeasurementResult {
        let total_prob_error = state.total_probability_error();

        let mut measurements = Vec::with_capacity(shots);
        let mut counts = std::collections::HashMap::new();

        for _ in 0..shots {
            let result = state.measure();
            *counts.entry(result.clone()).or_insert(0) += 1;
            measurements.push(result);
        }

        let mut probabilities: Vec<(String, f64)> = counts
            .iter()
            .map(|(k, v)| (k.clone(), *v as f64 / shots as f64))
            .collect();
        probabilities.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));

        MeasurementResult {
            circuit_hash,
            measurements,
            counts,
            probabilities,
            shots,
            total_probability_error: total_prob_error,
        }
    }

    pub fn get_amplitudes(
        &self,
        circuit: &QuantumCircuit,
    ) -> Result<Vec<(String, (f64, f64))>, QuantumError> {
        let result = self.simulate(circuit)?;
        Ok(result.amplitudes)
    }

    pub fn get_probability_distribution(
        &self,
        circuit: &QuantumCircuit,
    ) -> Result<Vec<(String, f64)>, QuantumError> {
        let result = self.simulate(circuit)?;
        Ok(result.probability_distribution)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::f64::consts::SQRT_2;

    #[test]
    fn test_simulate_bell_state() {
        let simulator = QuantumSimulator::new();
        let mut circuit = QuantumCircuit::new(2).unwrap();
        circuit.add_hadamard(0).unwrap();
        circuit.add_cnot(0, 1).unwrap();

        let result = simulator.simulate(&circuit).unwrap();
        assert_eq!(result.num_qubits, 2);

        let prob_00 = result
            .probability_distribution
            .iter()
            .find(|(state, _)| state == "00")
            .map(|(_, p)| *p)
            .unwrap_or(0.0);

        let prob_11 = result
            .probability_distribution
            .iter()
            .find(|(state, _)| state == "11")
            .map(|(_, p)| *p)
            .unwrap_or(0.0);

        assert!((prob_00 - 0.5).abs() < 1e-10);
        assert!((prob_11 - 0.5).abs() < 1e-10);
    }

    #[test]
    fn test_simulate_hadamard() {
        let simulator = QuantumSimulator::new();
        let mut circuit = QuantumCircuit::new(1).unwrap();
        circuit.add_hadamard(0).unwrap();

        let result = simulator.simulate(&circuit).unwrap();
        let inv_sqrt2 = 1.0 / SQRT_2;

        let amp_0 = result
            .amplitudes
            .iter()
            .find(|(state, _)| state == "0")
            .map(|(_, (re, im))| (*re, *im))
            .unwrap_or((0.0, 0.0));

        let amp_1 = result
            .amplitudes
            .iter()
            .find(|(state, _)| state == "1")
            .map(|(_, (re, im))| (*re, *im))
            .unwrap_or((0.0, 0.0));

        assert!((amp_0.0 - inv_sqrt2).abs() < 1e-10);
        assert!((amp_1.0 - inv_sqrt2).abs() < 1e-10);
    }

    #[test]
    fn test_simulate_pauli_x() {
        let simulator = QuantumSimulator::new();
        let mut circuit = QuantumCircuit::new(1).unwrap();
        circuit.add_x(0).unwrap();

        let result = simulator.simulate(&circuit).unwrap();

        let prob_1 = result
            .probability_distribution
            .iter()
            .find(|(state, _)| state == "1")
            .map(|(_, p)| *p)
            .unwrap_or(0.0);

        assert!((prob_1 - 1.0).abs() < 1e-10);
    }

    #[test]
    fn test_simulate_toffoli() {
        let simulator = QuantumSimulator::new();
        let mut circuit = QuantumCircuit::new(3).unwrap();
        circuit.add_x(0).unwrap();
        circuit.add_x(1).unwrap();
        circuit.add_toffoli(0, 1, 2).unwrap();

        let result = simulator.simulate(&circuit).unwrap();

        let prob_111 = result
            .probability_distribution
            .iter()
            .find(|(state, _)| state == "111")
            .map(|(_, p)| *p)
            .unwrap_or(0.0);

        assert!((prob_111 - 1.0).abs() < 1e-10);
    }

    #[test]
    fn test_measurement() {
        let simulator = QuantumSimulator::new();
        let mut circuit = QuantumCircuit::new(1).unwrap();
        circuit.add_hadamard(0).unwrap();

        let result = simulator.measure(&circuit, 1000).unwrap();
        assert_eq!(result.shots, 1000);
        assert_eq!(result.measurements.len(), 1000);

        let count_0 = *result.counts.get("0").unwrap_or(&0);
        let count_1 = *result.counts.get("1").unwrap_or(&0);

        assert!(count_0 > 400 && count_0 < 600);
        assert!(count_1 > 400 && count_1 < 600);
    }

    #[test]
    fn test_optimization_usage() {
        let mut circuit = QuantumCircuit::new(1).unwrap();
        circuit.add_hadamard(0).unwrap();
        circuit.add_hadamard(0).unwrap();

        let simulator_with_opt = QuantumSimulator::new().with_optimization(true);
        let result_with_opt = simulator_with_opt.simulate(&circuit).unwrap();
        assert_eq!(result_with_opt.optimization_result.as_ref().unwrap().gates_removed, 2);

        let simulator_without_opt = QuantumSimulator::new().with_optimization(false);
        let result_without_opt = simulator_without_opt.simulate(&circuit).unwrap();
        assert_eq!(result_without_opt.optimization_result.as_ref().unwrap().gates_removed, 0);

        let prob_0_opt = result_with_opt
            .probability_distribution
            .iter()
            .find(|(state, _)| state == "0")
            .map(|(_, p)| *p)
            .unwrap_or(0.0);

        let prob_0_no_opt = result_without_opt
            .probability_distribution
            .iter()
            .find(|(state, _)| state == "0")
            .map(|(_, p)| *p)
            .unwrap_or(0.0);

        assert!((prob_0_opt - prob_0_no_opt).abs() < 1e-10);
    }
}
