use thiserror::Error;

#[derive(Debug, Error)]
pub enum QuantumError {
    #[error("Invalid qubit count: {0}. Must be between 1 and 30.")]
    InvalidQubitCount(usize),

    #[error("Invalid amplitude length: {0}, expected {1}")]
    InvalidAmplitudeLength(usize, usize),

    #[error("Invalid qubit index: {0}, total qubits: {1}")]
    InvalidQubitIndex(usize, usize),

    #[error("Invalid three qubit indices: c1={0}, c2={1}, t={2}, total qubits: {3}")]
    InvalidThreeQubitIndices(usize, usize, usize, usize),

    #[error("Control and target qubits cannot be the same: {0}")]
    SameQubit(usize),

    #[error("Duplicate qubits in gate definition")]
    DuplicateQubits,

    #[error("Invalid gate type: {0}")]
    InvalidGateType(String),

    #[error("Invalid qubit count for gate '{0}': expected {1}, got {2}")]
    InvalidQubitCountForGate(String, usize, usize),

    #[error("Empty matrix list for composition")]
    EmptyMatrixList,

    #[error("Unknown gate matrix - cannot decompose to standard gates")]
    UnknownGateMatrix,

    #[error("Gate compilation error: {0}")]
    CompilationError(String),

    #[error("Simulation error: {0}")]
    SimulationError(String),

    #[error("Cache error: {0}")]
    CacheError(String),

    #[error("Serialization error: {0}")]
    SerializationError(String),

    #[error("Circuit is empty")]
    EmptyCircuit,

    #[error("Invalid JSON: {0}")]
    InvalidJson(String),
}

impl actix_web::ResponseError for QuantumError {
    fn status_code(&self) -> actix_web::http::StatusCode {
        match self {
            QuantumError::InvalidQubitCount(_)
            | QuantumError::InvalidAmplitudeLength(_, _)
            | QuantumError::InvalidQubitIndex(_, _)
            | QuantumError::InvalidThreeQubitIndices(_, _, _, _)
            | QuantumError::SameQubit(_)
            | QuantumError::DuplicateQubits
            | QuantumError::InvalidGateType(_)
            | QuantumError::InvalidQubitCountForGate(_, _, _)
            | QuantumError::EmptyMatrixList
            | QuantumError::UnknownGateMatrix
            | QuantumError::CompilationError(_)
            | QuantumError::EmptyCircuit
            | QuantumError::InvalidJson(_) => actix_web::http::StatusCode::BAD_REQUEST,
            QuantumError::SimulationError(_)
            | QuantumError::CacheError(_)
            | QuantumError::SerializationError(_) => actix_web::http::StatusCode::INTERNAL_SERVER_ERROR,
        }
    }

    fn error_response(&self) -> actix_web::HttpResponse {
        actix_web::HttpResponse::build(self.status_code())
            .json(serde_json::json!({
                "error": self.to_string(),
                "error_type": format!("{:?}", self)
            }))
    }
}

impl From<redis::RedisError> for QuantumError {
    fn from(err: redis::RedisError) -> Self {
        QuantumError::CacheError(err.to_string())
    }
}

impl From<serde_json::Error> for QuantumError {
    fn from(err: serde_json::Error) -> Self {
        QuantumError::SerializationError(err.to_string())
    }
}
