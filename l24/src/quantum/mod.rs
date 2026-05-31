pub mod state;
pub mod gates;
pub mod optimizer;
pub mod circuit;
pub mod simulator;
pub mod error_correction;

pub use state::{QuantumState, kahan_sum, kahan_sum_squared};
pub use gates::{
    Gate, GateType, hadamard_matrix, pauli_x_matrix, pauli_y_matrix, pauli_z_matrix,
    t_matrix, t_dag_matrix, s_matrix, s_dag_matrix,
};
pub use optimizer::{CircuitOptimizer, OptimizationResult, MergedGroup};
pub use circuit::{
    QuantumCircuit, CompiledCircuit, CompileOptions,
    expand_toffoli, expand_toffoli_gates,
};
pub use simulator::{QuantumSimulator, SimulationResult, MeasurementResult};
pub use error_correction::{
    ECCConfig, ECCType, ECCResult, NoiseConfig, ErrorType, SteaneCode,
    apply_noise_to_state, calculate_logical_fidelity, calculate_encoding_fidelity,
    decode_state,
};
