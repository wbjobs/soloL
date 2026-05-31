use ndarray::Array2;
use num_complex::Complex64;
use rand::Rng;
use serde::{Deserialize, Serialize};

use crate::error::QuantumError;
use crate::quantum::circuit::QuantumCircuit;
use crate::quantum::gates::{Gate, GateType};
use crate::quantum::state::QuantumState;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum ErrorType {
    BitFlip,
    PhaseFlip,
    Both,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct NoiseConfig {
    pub bit_flip_prob: f64,
    pub phase_flip_prob: f64,
    pub after_each_gate: bool,
}

impl Default for NoiseConfig {
    fn default() -> Self {
        NoiseConfig {
            bit_flip_prob: 0.0,
            phase_flip_prob: 0.0,
            after_each_gate: true,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum ECCType {
    None,
    Steane,
    Shor,
    Surface,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ECCConfig {
    pub ecc_type: ECCType,
    pub logical_qubits: usize,
    pub noise_config: NoiseConfig,
    pub enable_correction: bool,
}

impl Default for ECCConfig {
    fn default() -> Self {
        ECCConfig {
            ecc_type: ECCType::None,
            logical_qubits: 1,
            noise_config: NoiseConfig::default(),
            enable_correction: true,
        }
    }
}

impl ECCConfig {
    pub fn physical_qubits(&self) -> usize {
        match self.ecc_type {
            ECCType::None => self.logical_qubits,
            ECCType::Steane => self.logical_qubits * 7,
            ECCType::Shor => self.logical_qubits * 9,
            ECCType::Surface => self.logical_qubits * 25,
        }
    }

    pub fn ancilla_qubits(&self) -> usize {
        match self.ecc_type {
            ECCType::None => 0,
            ECCType::Steane => self.logical_qubits * 6,
            ECCType::Shor => self.logical_qubits * 8,
            ECCType::Surface => self.logical_qubits * 20,
        }
    }

    pub fn total_qubits(&self) -> usize {
        self.physical_qubits() + self.ancilla_qubits()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ECCResult {
    pub ecc_type: ECCType,
    pub logical_qubits: usize,
    pub physical_qubits: usize,
    pub ancilla_qubits: usize,
    pub total_qubits: usize,
    pub logical_gate_count: usize,
    pub physical_gate_count: usize,
    pub noise_applied: bool,
    pub bit_flip_count: usize,
    pub phase_flip_count: usize,
    pub correction_performed: bool,
    pub detected_errors: Vec<(usize, ErrorType)>,
    pub corrected_errors: Vec<(usize, ErrorType)>,
    pub logical_fidelity: f64,
    pub encoding_fidelity: f64,
}

pub struct SteaneCode {
    config: ECCConfig,
}

impl SteaneCode {
    pub fn new(config: ECCConfig) -> Result<Self, QuantumError> {
        if config.ecc_type != ECCType::Steane {
            return Err(QuantumError::CompilationError(
                "SteaneCode requires ECCType::Steane".to_string(),
            ));
        }
        Ok(SteaneCode { config })
    }

    pub fn logical_to_physical(&self, logical_qubit: usize) -> usize {
        logical_qubit * 7
    }

    pub fn logical_to_ancilla(&self, logical_qubit: usize) -> usize {
        self.config.physical_qubits() + logical_qubit * 6
    }

    pub fn encode_circuit(&self, base_circuit: &QuantumCircuit) -> Result<QuantumCircuit, QuantumError> {
        let total_qubits = self.config.total_qubits();
        let mut encoded = QuantumCircuit::new(total_qubits)?;

        for logical_q in 0..base_circuit.num_qubits {
            let base = self.logical_to_physical(logical_q);

            encoded.add_hadamard(base)?;
            encoded.add_hadamard(base + 2)?;
            encoded.add_hadamard(base + 4)?;

            encoded.add_cnot(base, base + 1)?;
            encoded.add_cnot(base, base + 3)?;
            encoded.add_cnot(base + 2, base + 5)?;
            encoded.add_cnot(base + 2, base + 6)?;
            encoded.add_cnot(base + 4, base + 3)?;
            encoded.add_cnot(base + 4, base + 6)?;

            encoded.add_cnot(base, base + 5)?;
        }

        for gate in &base_circuit.gates {
            self.add_encoded_gate(&mut encoded, gate)?;
        }

        if self.config.enable_correction {
            for logical_q in 0..base_circuit.num_qubits {
                self.add_correction_circuit(&mut encoded, logical_q)?;
            }
        }

        Ok(encoded)
    }

    fn add_encoded_gate(&self, circuit: &mut QuantumCircuit, gate: &Gate) -> Result<(), QuantumError> {
        match gate.gate_type {
            GateType::Hadamard => {
                let base = self.logical_to_physical(gate.qubits[0]);
                for i in 0..7 {
                    circuit.add_hadamard(base + i)?;
                }
            }
            GateType::PauliX => {
                let base = self.logical_to_physical(gate.qubits[0]);
                for i in 0..7 {
                    circuit.add_x(base + i)?;
                }
            }
            GateType::PauliZ => {
                let base = self.logical_to_physical(gate.qubits[0]);
                for i in 0..7 {
                    circuit.add_z(base + i)?;
                }
            }
            GateType::PauliY => {
                let base = self.logical_to_physical(gate.qubits[0]);
                for i in 0..7 {
                    circuit.add_y(base + i)?;
                }
            }
            GateType::CNOT => {
                let control_base = self.logical_to_physical(gate.qubits[0]);
                let target_base = self.logical_to_physical(gate.qubits[1]);
                for i in 0..7 {
                    circuit.add_cnot(control_base + i, target_base + i)?;
                }
            }
            GateType::Toffoli => {
                let c1_base = self.logical_to_physical(gate.qubits[0]);
                let c2_base = self.logical_to_physical(gate.qubits[1]);
                let t_base = self.logical_to_physical(gate.qubits[2]);
                for i in 0..7 {
                    circuit.add_toffoli(c1_base + i, c2_base + i, t_base + i)?;
                }
            }
            GateType::T | GateType::TDag => {
                return Err(QuantumError::CompilationError(
                    "T gate requires transversal implementation for Steane code".to_string(),
                ));
            }
            GateType::S | GateType::SDag => {
                return Err(QuantumError::CompilationError(
                    "S gate requires transversal implementation for Steane code".to_string(),
                ));
            }
        }

        if self.config.noise_config.after_each_gate {
            self.apply_noise_to_physical_qubits(circuit, &gate.qubits)?;
        }

        Ok(())
    }

    fn apply_noise_to_physical_qubits(
        &self,
        circuit: &mut QuantumCircuit,
        logical_qubits: &[usize],
    ) -> Result<(), QuantumError> {
        if self.config.noise_config.bit_flip_prob <= 0.0
            && self.config.noise_config.phase_flip_prob <= 0.0
        {
            return Ok(());
        }

        let mut rng = rand::thread_rng();

        for &logical_q in logical_qubits {
            let base = self.logical_to_physical(logical_q);
            for i in 0..7 {
                let qubit = base + i;

                if rng.gen::<f64>() < self.config.noise_config.bit_flip_prob {
                    circuit.add_x(qubit)?;
                }

                if rng.gen::<f64>() < self.config.noise_config.phase_flip_prob {
                    circuit.add_z(qubit)?;
                }
            }
        }

        Ok(())
    }

    fn add_correction_circuit(
        &self,
        circuit: &mut QuantumCircuit,
        logical_q: usize,
    ) -> Result<(), QuantumError> {
        let base = self.logical_to_physical(logical_q);
        let ancilla_base = self.logical_to_ancilla(logical_q);

        circuit.add_hadamard(ancilla_base)?;
        circuit.add_hadamard(ancilla_base + 1)?;
        circuit.add_hadamard(ancilla_base + 2)?;

        circuit.add_cnot(ancilla_base, base)?;
        circuit.add_cnot(ancilla_base, base + 2)?;
        circuit.add_cnot(ancilla_base, base + 4)?;
        circuit.add_cnot(ancilla_base + 1, base + 1)?;
        circuit.add_cnot(ancilla_base + 1, base + 2)?;
        circuit.add_cnot(ancilla_base + 1, base + 5)?;
        circuit.add_cnot(ancilla_base + 2, base + 3)?;
        circuit.add_cnot(ancilla_base + 2, base + 4)?;
        circuit.add_cnot(ancilla_base + 2, base + 5)?;

        circuit.add_hadamard(ancilla_base)?;
        circuit.add_hadamard(ancilla_base + 1)?;
        circuit.add_hadamard(ancilla_base + 2)?;

        let phase_base = ancilla_base + 3;
        circuit.add_hadamard(phase_base)?;
        circuit.add_hadamard(phase_base + 1)?;
        circuit.add_hadamard(phase_base + 2)?;

        circuit.add_hadamard(base)?;
        circuit.add_hadamard(base + 1)?;
        circuit.add_hadamard(base + 2)?;
        circuit.add_hadamard(base + 3)?;
        circuit.add_hadamard(base + 4)?;
        circuit.add_hadamard(base + 5)?;
        circuit.add_hadamard(base + 6)?;

        circuit.add_cnot(phase_base, base)?;
        circuit.add_cnot(phase_base, base + 2)?;
        circuit.add_cnot(phase_base, base + 4)?;
        circuit.add_cnot(phase_base + 1, base + 1)?;
        circuit.add_cnot(phase_base + 1, base + 2)?;
        circuit.add_cnot(phase_base + 1, base + 5)?;
        circuit.add_cnot(phase_base + 2, base + 3)?;
        circuit.add_cnot(phase_base + 2, base + 4)?;
        circuit.add_cnot(phase_base + 2, base + 5)?;

        circuit.add_hadamard(base)?;
        circuit.add_hadamard(base + 1)?;
        circuit.add_hadamard(base + 2)?;
        circuit.add_hadamard(base + 3)?;
        circuit.add_hadamard(base + 4)?;
        circuit.add_hadamard(base + 5)?;
        circuit.add_hadamard(base + 6)?;

        circuit.add_hadamard(phase_base)?;
        circuit.add_hadamard(phase_base + 1)?;
        circuit.add_hadamard(phase_base + 2)?;

        Ok(())
    }
}

pub fn apply_noise_to_state(
    state: &mut QuantumState,
    noise_config: &NoiseConfig,
    qubit: usize,
) -> Result<(bool, bool), QuantumError> {
    if qubit >= state.num_qubits {
        return Err(QuantumError::InvalidQubitIndex(qubit, state.num_qubits));
    }

    let mut rng = rand::thread_rng();
    let mut bit_flip_applied = false;
    let mut phase_flip_applied = false;

    if rng.gen::<f64>() < noise_config.bit_flip_prob {
        let x_matrix = crate::quantum::gates::pauli_x_matrix();
        state.apply_single_qubit_gate(qubit, &x_matrix)?;
        bit_flip_applied = true;
    }

    if rng.gen::<f64>() < noise_config.phase_flip_prob {
        let z_matrix = crate::quantum::gates::pauli_z_matrix();
        state.apply_single_qubit_gate(qubit, &z_matrix)?;
        phase_flip_applied = true;
    }

    Ok((bit_flip_applied, phase_flip_applied))
}

pub fn calculate_logical_fidelity(
    logical_state: &QuantumState,
    encoded_state: &QuantumState,
    ecc_config: &ECCConfig,
) -> Result<f64, QuantumError> {
    if logical_state.num_qubits != ecc_config.logical_qubits {
        return Err(QuantumError::CompilationError(format!(
            "Logical state has {} qubits, expected {}",
            logical_state.num_qubits, ecc_config.logical_qubits
        )));
    }

    let logical_dim = 1 << logical_state.num_qubits;
    let physical_dim = 1 << ecc_config.physical_qubits();

    if encoded_state.amplitudes.len() < physical_dim {
        return Err(QuantumError::InvalidAmplitudeLength(
            encoded_state.amplitudes.len(),
            physical_dim,
        ));
    }

    let mut logical_fidelity = 0.0;

    for logical_idx in 0..logical_dim {
        let logical_amp = logical_state.amplitudes[[logical_idx]];

        let codeword_indices = generate_codeword_indices(ecc_config, logical_idx);

        let mut encoded_amp_sum = Complex64::new(0.0, 0.0);
        for &idx in &codeword_indices {
            if idx < encoded_state.amplitudes.len() {
                encoded_amp_sum += encoded_state.amplitudes[[idx]];
            }
        }

        let norm_factor = 1.0 / (codeword_indices.len() as f64).sqrt();
        encoded_amp_sum *= norm_factor;

        logical_fidelity += logical_amp.norm() * encoded_amp_sum.norm();
    }

    Ok(logical_fidelity.min(1.0))
}

fn generate_codeword_indices(ecc_config: &ECCConfig, logical_idx: usize) -> Vec<usize> {
    let mut indices = Vec::new();

    match ecc_config.ecc_type {
        ECCType::None => {
            indices.push(logical_idx);
        }
        ECCType::Steane => {
            let codewords = steane_codewords();
            for (i, &mask) in codewords.iter().enumerate() {
                if (logical_idx & 1) == (i & 1) {
                    indices.push(mask);
                }
            }
        }
        ECCType::Shor | ECCType::Surface => {
            indices.push(logical_idx);
        }
    }

    indices
}

fn steane_codewords() -> &'static [usize; 8] {
    &[
        0b0000000, 0b0001111, 0b0110011, 0b0111100, 0b1010101, 0b1011010, 0b1100110, 0b1101001,
    ]
}

pub fn calculate_encoding_fidelity(
    original_state: &QuantumState,
    encoded_state: &QuantumState,
    ecc_config: &ECCConfig,
) -> Result<f64, QuantumError> {
    if original_state.num_qubits > ecc_config.logical_qubits {
        return Err(QuantumError::CompilationError(format!(
            "Original state has {} qubits, max logical {}",
            original_state.num_qubits, ecc_config.logical_qubits
        )));
    }

    let logical_fidelity = calculate_logical_fidelity(original_state, encoded_state, ecc_config)?;
    let total_prob = encoded_state.total_probability();

    Ok(logical_fidelity * total_prob)
}

pub fn decode_state(
    encoded_state: &QuantumState,
    ecc_config: &ECCConfig,
) -> Result<QuantumState, QuantumError> {
    if ecc_config.ecc_type == ECCType::None {
        return Ok(encoded_state.clone());
    }

    let logical_dim = 1 << ecc_config.logical_qubits;
    let mut logical_amplitudes = Array2::<Complex64>::zeros((1, logical_dim));

    for logical_idx in 0..logical_dim {
        let codeword_indices = generate_codeword_indices(ecc_config, logical_idx);

        let mut amp = Complex64::new(0.0, 0.0);
        for &idx in &codeword_indices {
            if idx < encoded_state.amplitudes.len() {
                amp += encoded_state.amplitudes[[idx]];
            }
        }

        let norm_factor = 1.0 / (codeword_indices.len() as f64).sqrt();
        logical_amplitudes[[0, logical_idx]] = amp * norm_factor;
    }

    let mut result = QuantumState::from_amplitudes(
        ecc_config.logical_qubits,
        logical_amplitudes.row(0).to_owned(),
    )?;
    result.normalize();
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_ecc_config_physical_qubits() {
        let config = ECCConfig {
            ecc_type: ECCType::Steane,
            logical_qubits: 1,
            noise_config: NoiseConfig::default(),
            enable_correction: true,
        };

        assert_eq!(config.physical_qubits(), 7);
        assert_eq!(config.ancilla_qubits(), 6);
        assert_eq!(config.total_qubits(), 13);
    }

    #[test]
    fn test_ecc_config_multiple_logical() {
        let config = ECCConfig {
            ecc_type: ECCType::Steane,
            logical_qubits: 2,
            noise_config: NoiseConfig::default(),
            enable_correction: true,
        };

        assert_eq!(config.physical_qubits(), 14);
        assert_eq!(config.ancilla_qubits(), 12);
        assert_eq!(config.total_qubits(), 26);
    }

    #[test]
    fn test_steane_code_creation() {
        let config = ECCConfig {
            ecc_type: ECCType::Steane,
            logical_qubits: 1,
            noise_config: NoiseConfig::default(),
            enable_correction: false,
        };

        let steane = SteaneCode::new(config).unwrap();
        assert_eq!(steane.logical_to_physical(0), 0);
        assert_eq!(steane.logical_to_ancilla(0), 7);
    }

    #[test]
    fn test_encode_circuit() {
        let config = ECCConfig {
            ecc_type: ECCType::Steane,
            logical_qubits: 1,
            noise_config: NoiseConfig::default(),
            enable_correction: false,
        };

        let steane = SteaneCode::new(config).unwrap();

        let mut logical_circuit = QuantumCircuit::new(1).unwrap();
        logical_circuit.add_hadamard(0).unwrap();

        let encoded = steane.encode_circuit(&logical_circuit).unwrap();
        assert_eq!(encoded.num_qubits, 13);
        assert!(encoded.gate_count() > 0);
    }

    #[test]
    fn test_noise_config_default() {
        let config = NoiseConfig::default();
        assert_eq!(config.bit_flip_prob, 0.0);
        assert_eq!(config.phase_flip_prob, 0.0);
        assert!(config.after_each_gate);
    }

    #[test]
    fn test_ecc_type_none() {
        let config = ECCConfig {
            ecc_type: ECCType::None,
            logical_qubits: 5,
            noise_config: NoiseConfig::default(),
            enable_correction: true,
        };

        assert_eq!(config.physical_qubits(), 5);
        assert_eq!(config.ancilla_qubits(), 0);
        assert_eq!(config.total_qubits(), 5);
    }
}
