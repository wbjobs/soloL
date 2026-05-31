use ndarray::{Array1, Array2};
use num_complex::Complex64;
use num_traits::{Zero, One};
use serde::{Deserialize, Serialize};

use crate::error::QuantumError;

const MAX_QUBITS: usize = 30;

pub fn kahan_sum<I>(iter: I) -> f64
where
    I: Iterator<Item = f64>,
{
    let mut sum = 0.0;
    let mut compensation = 0.0;

    for value in iter {
        let y = value - compensation;
        let t = sum + y;
        compensation = (t - sum) - y;
        sum = t;
    }

    sum
}

pub fn kahan_sum_squared<I>(iter: I) -> f64
where
    I: Iterator<Item = Complex64>,
{
    let mut sum = 0.0;
    let mut compensation = 0.0;

    for value in iter {
        let norm_sqr = value.norm_sqr();
        let y = norm_sqr - compensation;
        let t = sum + y;
        compensation = (t - sum) - y;
        sum = t;
    }

    sum
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QuantumState {
    pub num_qubits: usize,
    #[serde(with = "complex_array_serde")]
    pub amplitudes: Array1<Complex64>,
}

mod complex_array_serde {
    use ndarray::Array1;
    use num_complex::Complex64;
    use serde::{Deserialize, Deserializer, Serialize, Serializer};

    pub fn serialize<S>(amplitudes: &Array1<Complex64>, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        let vec: Vec<(f64, f64)> = amplitudes
            .iter()
            .map(|c| (c.re, c.im))
            .collect();
        vec.serialize(serializer)
    }

    pub fn deserialize<'de, D>(deserializer: D) -> Result<Array1<Complex64>, D::Error>
    where
        D: Deserializer<'de>,
    {
        let vec = Vec::<(f64, f64)>::deserialize(deserializer)?;
        Ok(Array1::from_vec(
            vec.into_iter().map(|(re, im)| Complex64::new(re, im)).collect(),
        ))
    }
}

impl QuantumState {
    pub fn new(num_qubits: usize) -> Result<Self, QuantumError> {
        if num_qubits == 0 || num_qubits > MAX_QUBITS {
            return Err(QuantumError::InvalidQubitCount(num_qubits));
        }

        let dim = 1 << num_qubits;
        let mut amplitudes = Array1::<Complex64>::zeros(dim);
        amplitudes[[0]] = Complex64::one();

        Ok(QuantumState {
            num_qubits,
            amplitudes,
        })
    }

    pub fn from_amplitudes(num_qubits: usize, amplitudes: Array1<Complex64>) -> Result<Self, QuantumError> {
        if num_qubits == 0 || num_qubits > MAX_QUBITS {
            return Err(QuantumError::InvalidQubitCount(num_qubits));
        }

        let dim = 1 << num_qubits;
        if amplitudes.len() != dim {
            return Err(QuantumError::InvalidAmplitudeLength(amplitudes.len(), dim));
        }

        Ok(QuantumState {
            num_qubits,
            amplitudes,
        })
    }

    pub fn normalize(&mut self) {
        let norm_sqr = kahan_sum_squared(self.amplitudes.iter().cloned());
        let norm = norm_sqr.sqrt();

        if norm > 0.0 && (norm - 1.0).abs() > 1e-15 {
            let inv_norm = 1.0 / norm;
            self.amplitudes.mapv_inplace(|c| c * inv_norm);
        }
    }

    pub fn total_probability(&self) -> f64 {
        kahan_sum_squared(self.amplitudes.iter().cloned())
    }

    pub fn total_probability_error(&self) -> f64 {
        (self.total_probability() - 1.0).abs()
    }

    pub fn get_probability(&self, index: usize) -> f64 {
        if index >= self.amplitudes.len() {
            return 0.0;
        }
        self.amplitudes[[index]].norm_sqr()
    }

    pub fn get_probability_distribution(&self) -> Vec<(String, f64)> {
        let mut dist: Vec<(String, f64)> = self
            .amplitudes
            .iter()
            .enumerate()
            .map(|(i, amp)| {
                let binary = format!("{:0width$b}", i, width = self.num_qubits);
                (binary, amp.norm_sqr())
            })
            .filter(|(_, p)| *p > 1e-10)
            .collect();

        dist.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
        dist
    }

    pub fn get_top_probabilities(&self, n: usize) -> Vec<(String, f64)> {
        let mut dist = self.get_probability_distribution();
        dist.truncate(n);
        dist
    }

    pub fn measure(&self) -> String {
        use rand::Rng;
        let mut rng = rand::thread_rng();
        let r: f64 = rng.gen();

        let mut cumulative = 0.0;
        let mut compensation = 0.0;

        for (i, amp) in self.amplitudes.iter().enumerate() {
            let prob = amp.norm_sqr();
            let y = prob - compensation;
            let t = cumulative + y;
            compensation = (t - cumulative) - y;
            cumulative = t;

            if r <= cumulative {
                return format!("{:0width$b}", i, width = self.num_qubits);
            }
        }

        format!("{:0width$b}", self.amplitudes.len() - 1, width = self.num_qubits)
    }

    pub fn measure_qubit(&self, qubit: usize) -> Result<(bool, QuantumState), QuantumError> {
        if qubit >= self.num_qubits {
            return Err(QuantumError::InvalidQubitIndex(qubit, self.num_qubits));
        }

        let dim = self.amplitudes.len();
        let mask = 1 << (self.num_qubits - 1 - qubit);

        let mut prob_zero = 0.0;
        let mut compensation = 0.0;

        for i in 0..dim {
            if i & mask == 0 {
                let prob = self.amplitudes[[i]].norm_sqr();
                let y = prob - compensation;
                let t = prob_zero + y;
                compensation = (t - prob_zero) - y;
                prob_zero = t;
            }
        }

        use rand::Rng;
        let mut rng = rand::thread_rng();
        let r: f64 = rng.gen();
        let result = r > prob_zero;

        let mut new_amplitudes = self.amplitudes.clone();
        let factor = if result {
            1.0 / (1.0 - prob_zero).sqrt()
        } else {
            1.0 / prob_zero.sqrt()
        };

        for i in 0..dim {
            let is_one = (i & mask) != 0;
            if is_one != result {
                new_amplitudes[[i]] = Complex64::zero();
            } else {
                new_amplitudes[[i]] *= factor;
            }
        }

        Ok((result, QuantumState {
            num_qubits: self.num_qubits,
            amplitudes: new_amplitudes,
        }))
    }

    pub fn apply_single_qubit_gate(&mut self, qubit: usize, gate_matrix: &Array2<Complex64>) -> Result<(), QuantumError> {
        if qubit >= self.num_qubits {
            return Err(QuantumError::InvalidQubitIndex(qubit, self.num_qubits));
        }

        let n = self.num_qubits;
        let dim = 1 << n;
        let qubit_mask = 1 << (n - 1 - qubit);
        let stride = qubit_mask;

        let mut new_amplitudes = Array1::<Complex64>::zeros(dim);

        for i in 0..dim {
            let has_bit = (i & qubit_mask) != 0;
            let base = i & !qubit_mask;

            if !has_bit {
                let j = base;
                let k = base | qubit_mask;

                new_amplitudes[[j]] += gate_matrix[[0, 0]] * self.amplitudes[[j]]
                    + gate_matrix[[0, 1]] * self.amplitudes[[k]];
                new_amplitudes[[k]] += gate_matrix[[1, 0]] * self.amplitudes[[j]]
                    + gate_matrix[[1, 1]] * self.amplitudes[[k]];
            }
        }

        self.amplitudes = new_amplitudes;
        Ok(())
    }

    pub fn apply_two_qubit_gate(
        &mut self,
        control: usize,
        target: usize,
        gate_matrix: &Array2<Complex64>,
    ) -> Result<(), QuantumError> {
        if control >= self.num_qubits {
            return Err(QuantumError::InvalidQubitIndex(control, self.num_qubits));
        }
        if target >= self.num_qubits {
            return Err(QuantumError::InvalidQubitIndex(target, self.num_qubits));
        }
        if control == target {
            return Err(QuantumError::SameQubit(control));
        }

        let n = self.num_qubits;
        let dim = 1 << n;
        let control_mask = 1 << (n - 1 - control);
        let target_mask = 1 << (n - 1 - target);

        let mut new_amplitudes = self.amplitudes.clone();

        for i in 0..dim {
            if (i & control_mask) != 0 {
                let target_bit = (i & target_mask) != 0;
                let base = i & !target_mask;

                if !target_bit {
                    let j = base;
                    let k = base | target_mask;

                    let amp_j = self.amplitudes[[j]];
                    let amp_k = self.amplitudes[[k]];

                    new_amplitudes[[j]] = gate_matrix[[0, 0]] * amp_j + gate_matrix[[0, 1]] * amp_k;
                    new_amplitudes[[k]] = gate_matrix[[1, 0]] * amp_j + gate_matrix[[1, 1]] * amp_k;
                }
            }
        }

        self.amplitudes = new_amplitudes;
        Ok(())
    }

    pub fn apply_three_qubit_gate(
        &mut self,
        control1: usize,
        control2: usize,
        target: usize,
        gate_matrix: &Array2<Complex64>,
    ) -> Result<(), QuantumError> {
        if control1 >= self.num_qubits || control2 >= self.num_qubits || target >= self.num_qubits {
            return Err(QuantumError::InvalidThreeQubitIndices(
                control1,
                control2,
                target,
                self.num_qubits,
            ));
        }
        if control1 == control2 || control1 == target || control2 == target {
            return Err(QuantumError::DuplicateQubits);
        }

        let n = self.num_qubits;
        let dim = 1 << n;
        let c1_mask = 1 << (n - 1 - control1);
        let c2_mask = 1 << (n - 1 - control2);
        let t_mask = 1 << (n - 1 - target);

        let mut new_amplitudes = self.amplitudes.clone();

        for i in 0..dim {
            if (i & c1_mask) != 0 && (i & c2_mask) != 0 {
                let target_bit = (i & t_mask) != 0;
                let base = i & !t_mask;

                if !target_bit {
                    let j = base;
                    let k = base | t_mask;

                    let amp_j = self.amplitudes[[j]];
                    let amp_k = self.amplitudes[[k]];

                    new_amplitudes[[j]] = gate_matrix[[0, 0]] * amp_j + gate_matrix[[0, 1]] * amp_k;
                    new_amplitudes[[k]] = gate_matrix[[1, 0]] * amp_j + gate_matrix[[1, 1]] * amp_k;
                }
            }
        }

        self.amplitudes = new_amplitudes;
        Ok(())
    }

    pub fn fidelity(&self, other: &QuantumState) -> f64 {
        if self.num_qubits != other.num_qubits {
            return 0.0;
        }

        let mut inner_product = Complex64::zero();
        for (a, b) in self.amplitudes.iter().zip(other.amplitudes.iter()) {
            inner_product += a.conj() * b;
        }

        inner_product.norm_sqr()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ndarray::array;

    #[test]
    fn test_new_state() {
        let state = QuantumState::new(2).unwrap();
        assert_eq!(state.num_qubits, 2);
        assert_eq!(state.amplitudes.len(), 4);
        assert_eq!(state.amplitudes[[0]], Complex64::one());
    }

    #[test]
    fn test_invalid_qubit_count() {
        assert!(QuantumState::new(0).is_err());
        assert!(QuantumState::new(31).is_err());
    }

    #[test]
    fn test_probability_distribution() {
        let state = QuantumState::new(1).unwrap();
        let dist = state.get_probability_distribution();
        assert_eq!(dist.len(), 1);
        assert_eq!(dist[0].0, "0");
        assert!((dist[0].1 - 1.0).abs() < 1e-10);
    }

    #[test]
    fn test_normalize() {
        let mut state = QuantumState::new(1).unwrap();
        state.amplitudes[[0]] = Complex64::new(1.0, 0.0);
        state.amplitudes[[1]] = Complex64::new(1.0, 0.0);
        state.normalize();
        let sum: f64 = state.amplitudes.iter().map(|c| c.norm_sqr()).sum();
        assert!((sum - 1.0).abs() < 1e-10);
    }
}
