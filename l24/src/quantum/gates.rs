use ndarray::{array, Array2};
use num_complex::Complex64;
use serde::{Deserialize, Serialize};
use std::f64::consts::SQRT_2;

use crate::error::QuantumError;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum GateType {
    Hadamard,
    PauliX,
    PauliY,
    PauliZ,
    CNOT,
    Toffoli,
    T,
    TDag,
    S,
    SDag,
}

impl std::fmt::Display for GateType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            GateType::Hadamard => write!(f, "H"),
            GateType::PauliX => write!(f, "X"),
            GateType::PauliY => write!(f, "Y"),
            GateType::PauliZ => write!(f, "Z"),
            GateType::CNOT => write!(f, "CNOT"),
            GateType::Toffoli => write!(f, "Toffoli"),
            GateType::T => write!(f, "T"),
            GateType::TDag => write!(f, "T†"),
            GateType::S => write!(f, "S"),
            GateType::SDag => write!(f, "S†"),
        }
    }
}

impl GateType {
    pub fn is_external(&self) -> bool {
        matches!(
            self,
            GateType::Hadamard
                | GateType::PauliX
                | GateType::PauliY
                | GateType::PauliZ
                | GateType::CNOT
                | GateType::Toffoli
        )
    }
}

impl std::str::FromStr for GateType {
    type Err = QuantumError;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.to_uppercase().as_str() {
            "H" | "HADAMARD" => Ok(GateType::Hadamard),
            "X" | "PAULIX" => Ok(GateType::PauliX),
            "Y" | "PAULIY" => Ok(GateType::PauliY),
            "Z" | "PAULIZ" => Ok(GateType::PauliZ),
            "CNOT" | "CX" => Ok(GateType::CNOT),
            "TOFFOLI" | "CCNOT" => Ok(GateType::Toffoli),
            "T" => Ok(GateType::T),
            "TDAG" | "T+" | "T†" => Ok(GateType::TDag),
            "S" => Ok(GateType::S),
            "SDAG" | "S+" | "S†" => Ok(GateType::SDag),
            _ => Err(QuantumError::InvalidGateType(s.to_string())),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct Gate {
    pub gate_type: GateType,
    pub qubits: Vec<usize>,
}

impl Gate {
    pub fn new(gate_type: GateType, qubits: Vec<usize>) -> Result<Self, QuantumError> {
        let expected = match gate_type {
            GateType::Hadamard
            | GateType::PauliX
            | GateType::PauliY
            | GateType::PauliZ
            | GateType::T
            | GateType::TDag
            | GateType::S
            | GateType::SDag => 1,
            GateType::CNOT => 2,
            GateType::Toffoli => 3,
        };

        if qubits.len() != expected {
            return Err(QuantumError::InvalidQubitCountForGate(
                gate_type.to_string(),
                expected,
                qubits.len(),
            ));
        }

        Ok(Gate { gate_type, qubits })
    }

    pub fn is_single_qubit(&self) -> bool {
        matches!(
            self.gate_type,
            GateType::Hadamard
                | GateType::PauliX
                | GateType::PauliY
                | GateType::PauliZ
                | GateType::T
                | GateType::TDag
                | GateType::S
                | GateType::SDag
        )
    }

    pub fn target_qubit(&self) -> usize {
        self.qubits[self.qubits.len() - 1]
    }

    pub fn get_matrix(&self) -> Array2<Complex64> {
        match self.gate_type {
            GateType::Hadamard => hadamard_matrix(),
            GateType::PauliX => pauli_x_matrix(),
            GateType::PauliY => pauli_y_matrix(),
            GateType::PauliZ => pauli_z_matrix(),
            GateType::CNOT => pauli_x_matrix(),
            GateType::Toffoli => pauli_x_matrix(),
            GateType::T => t_matrix(),
            GateType::TDag => t_dag_matrix(),
            GateType::S => s_matrix(),
            GateType::SDag => s_dag_matrix(),
        }
    }

    pub fn compose_matrices(matrices: &[Array2<Complex64>]) -> Result<Array2<Complex64>, QuantumError> {
        if matrices.is_empty() {
            return Err(QuantumError::EmptyMatrixList);
        }

        let mut result = matrices[0].clone();
        for m in &matrices[1..] {
            result = m.dot(&result);
        }
        Ok(result)
    }
}

pub fn hadamard_matrix() -> Array2<Complex64> {
    let inv_sqrt2 = 1.0 / SQRT_2;
    array![
        [Complex64::new(inv_sqrt2, 0.0), Complex64::new(inv_sqrt2, 0.0)],
        [Complex64::new(inv_sqrt2, 0.0), Complex64::new(-inv_sqrt2, 0.0)]
    ]
}

pub fn pauli_x_matrix() -> Array2<Complex64> {
    array![
        [Complex64::new(0.0, 0.0), Complex64::new(1.0, 0.0)],
        [Complex64::new(1.0, 0.0), Complex64::new(0.0, 0.0)]
    ]
}

pub fn pauli_y_matrix() -> Array2<Complex64> {
    array![
        [Complex64::new(0.0, 0.0), Complex64::new(0.0, -1.0)],
        [Complex64::new(0.0, 1.0), Complex64::new(0.0, 0.0)]
    ]
}

pub fn pauli_z_matrix() -> Array2<Complex64> {
    array![
        [Complex64::new(1.0, 0.0), Complex64::new(0.0, 0.0)],
        [Complex64::new(0.0, 0.0), Complex64::new(-1.0, 0.0)]
    ]
}

pub fn t_matrix() -> Array2<Complex64> {
    let theta = std::f64::consts::PI / 4.0;
    array![
        [Complex64::new(1.0, 0.0), Complex64::new(0.0, 0.0)],
        [Complex64::new(0.0, 0.0), Complex64::new(theta.cos(), theta.sin())]
    ]
}

pub fn t_dag_matrix() -> Array2<Complex64> {
    let theta = std::f64::consts::PI / 4.0;
    array![
        [Complex64::new(1.0, 0.0), Complex64::new(0.0, 0.0)],
        [Complex64::new(0.0, 0.0), Complex64::new(theta.cos(), -theta.sin())]
    ]
}

pub fn s_matrix() -> Array2<Complex64> {
    array![
        [Complex64::new(1.0, 0.0), Complex64::new(0.0, 0.0)],
        [Complex64::new(0.0, 0.0), Complex64::new(0.0, 1.0)]
    ]
}

pub fn s_dag_matrix() -> Array2<Complex64> {
    array![
        [Complex64::new(1.0, 0.0), Complex64::new(0.0, 0.0)],
        [Complex64::new(0.0, 0.0), Complex64::new(0.0, -1.0)]
    ]
}

pub fn identity_matrix() -> Array2<Complex64> {
    array![
        [Complex64::new(1.0, 0.0), Complex64::new(0.0, 0.0)],
        [Complex64::new(0.0, 0.0), Complex64::new(1.0, 0.0)]
    ]
}

pub fn is_identity(matrix: &Array2<Complex64>, tolerance: f64) -> bool {
    let identity = identity_matrix();
    for i in 0..2 {
        for j in 0..2 {
            let diff = (matrix[[i, j]] - identity[[i, j]]).norm();
            if diff > tolerance {
                return false;
            }
        }
    }
    true
}

pub fn are_matrices_equal(a: &Array2<Complex64>, b: &Array2<Complex64>, tolerance: f64) -> bool {
    for i in 0..2 {
        for j in 0..2 {
            let diff = (a[[i, j]] - b[[i, j]]).norm();
            if diff > tolerance {
                return false;
            }
        }
    }
    true
}

pub fn inverse_matrix(matrix: &Array2<Complex64>) -> Array2<Complex64> {
    let det = matrix[[0, 0]] * matrix[[1, 1]] - matrix[[0, 1]] * matrix[[1, 0]];
    if det.norm() < 1e-10 {
        return matrix.clone();
    }

    let inv_det = Complex64::new(1.0, 0.0) / det;
    array![
        [matrix[[1, 1]] * inv_det, -matrix[[0, 1]] * inv_det],
        [-matrix[[1, 0]] * inv_det, matrix[[0, 0]] * inv_det]
    ]
}

pub fn dagger(matrix: &Array2<Complex64>) -> Array2<Complex64> {
    let mut result = Array2::<Complex64>::zeros((2, 2));
    for i in 0..2 {
        for j in 0..2 {
            result[[i, j]] = matrix[[j, i]].conj();
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_gate_creation() {
        let h = Gate::new(GateType::Hadamard, vec![0]).unwrap();
        assert_eq!(h.gate_type, GateType::Hadamard);
        assert_eq!(h.qubits, vec![0]);
        assert!(h.is_single_qubit());

        let cnot = Gate::new(GateType::CNOT, vec![0, 1]).unwrap();
        assert_eq!(cnot.gate_type, GateType::CNOT);
        assert_eq!(cnot.qubits, vec![0, 1]);
        assert!(!cnot.is_single_qubit());

        let toffoli = Gate::new(GateType::Toffoli, vec![0, 1, 2]).unwrap();
        assert_eq!(toffoli.gate_type, GateType::Toffoli);
        assert_eq!(toffoli.qubits, vec![0, 1, 2]);
    }

    #[test]
    fn test_invalid_gate_qubit_count() {
        let result = Gate::new(GateType::Hadamard, vec![0, 1]);
        assert!(result.is_err());

        let result = Gate::new(GateType::CNOT, vec![0]);
        assert!(result.is_err());

        let result = Gate::new(GateType::Toffoli, vec![0, 1]);
        assert!(result.is_err());
    }

    #[test]
    fn test_hadamard_matrix() {
        let h = hadamard_matrix();
        let inv_sqrt2 = 1.0 / SQRT_2;
        assert_eq!(h[[0, 0]], Complex64::new(inv_sqrt2, 0.0));
        assert_eq!(h[[0, 1]], Complex64::new(inv_sqrt2, 0.0));
        assert_eq!(h[[1, 0]], Complex64::new(inv_sqrt2, 0.0));
        assert_eq!(h[[1, 1]], Complex64::new(-inv_sqrt2, 0.0));
    }

    #[test]
    fn test_pauli_matrices() {
        let x = pauli_x_matrix();
        assert_eq!(x[[0, 1]], Complex64::new(1.0, 0.0));
        assert_eq!(x[[1, 0]], Complex64::new(1.0, 0.0));

        let y = pauli_y_matrix();
        assert_eq!(y[[0, 1]], Complex64::new(0.0, -1.0));
        assert_eq!(y[[1, 0]], Complex64::new(0.0, 1.0));

        let z = pauli_z_matrix();
        assert_eq!(z[[0, 0]], Complex64::new(1.0, 0.0));
        assert_eq!(z[[1, 1]], Complex64::new(-1.0, 0.0));
    }

    #[test]
    fn test_matrix_composition() {
        let x = pauli_x_matrix();
        let result = Gate::compose_matrices(&[x.clone(), x.clone()]).unwrap();
        assert!(are_matrices_equal(&result, &identity_matrix(), 1e-10));
    }

    #[test]
    fn test_dagger() {
        let h = hadamard_matrix();
        let h_dagger = dagger(&h);
        assert!(are_matrices_equal(&h, &h_dagger, 1e-10));

        let y = pauli_y_matrix();
        let y_dagger = dagger(&y);
        assert!(are_matrices_equal(&y, &y_dagger, 1e-10));
    }
}
