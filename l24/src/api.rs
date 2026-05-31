use actix_web::{web, HttpResponse, Responder};
use serde::{Deserialize, Serialize};

use crate::cache::CacheManager;
use crate::error::QuantumError;
use crate::quantum::circuit::QuantumCircuit;
use crate::quantum::error_correction::ECCType;
use crate::quantum::gates::{Gate, GateType};
use crate::quantum::simulator::{QuantumSimulator, SimulationResult};

#[derive(Debug, Deserialize)]
pub struct GateRequest {
    pub gate_type: String,
    pub qubits: Vec<usize>,
}

#[derive(Debug, Deserialize)]
pub struct NoiseConfigRequest {
    pub bit_flip_prob: Option<f64>,
    pub phase_flip_prob: Option<f64>,
    pub after_each_gate: Option<bool>,
}

#[derive(Debug, Deserialize)]
pub struct ECCConfigRequest {
    pub ecc_type: Option<String>,
    pub enable_correction: Option<bool>,
    pub noise_config: Option<NoiseConfigRequest>,
}

#[derive(Debug, Deserialize)]
pub struct CircuitRequest {
    pub num_qubits: usize,
    pub gates: Vec<GateRequest>,
    pub use_optimization: Option<bool>,
    pub expand_toffoli: Option<bool>,
    pub use_kahan_sum: Option<bool>,
    pub ecc_config: Option<ECCConfigRequest>,
}

#[derive(Debug, Deserialize)]
pub struct MeasurementRequest {
    pub num_qubits: usize,
    pub gates: Vec<GateRequest>,
    pub shots: Option<usize>,
    pub use_optimization: Option<bool>,
    pub expand_toffoli: Option<bool>,
    pub use_kahan_sum: Option<bool>,
    pub ecc_config: Option<ECCConfigRequest>,
}

#[derive(Debug, Serialize)]
pub struct CircuitInfoResponse {
    pub num_qubits: usize,
    pub gate_count: usize,
    pub single_qubit_gate_count: usize,
    pub multi_qubit_gate_count: usize,
    pub circuit_depth: usize,
    pub circuit_hash: String,
}

#[derive(Debug, Serialize)]
pub struct CompileResponse {
    pub num_qubits: usize,
    pub original_gates: Vec<GateInfo>,
    pub optimized_gates: Vec<GateInfo>,
    pub optimization_result: OptimizationInfo,
    pub circuit_hash: String,
    pub from_cache: bool,
    pub toffoli_expanded: bool,
    pub toffoli_count: usize,
    pub expanded_gate_count: usize,
}

#[derive(Debug, Serialize)]
pub struct GateInfo {
    pub gate_type: String,
    pub qubits: Vec<usize>,
}

#[derive(Debug, Serialize)]
pub struct OptimizationInfo {
    pub original_gate_count: usize,
    pub optimized_gate_count: usize,
    pub gates_removed: usize,
    pub merged_groups: Vec<MergedGroupInfo>,
}

#[derive(Debug, Serialize)]
pub struct MergedGroupInfo {
    pub qubit: usize,
    pub original_gates: Vec<String>,
    pub merged: bool,
}

#[derive(Debug, Serialize)]
pub struct ECCInfoResponse {
    pub ecc_type: String,
    pub logical_qubits: usize,
    pub physical_qubits: usize,
    pub ancilla_qubits: usize,
    pub total_qubits: usize,
    pub logical_gate_count: usize,
    pub physical_gate_count: usize,
    pub noise_applied: bool,
    pub bit_flip_prob: f64,
    pub phase_flip_prob: f64,
    pub correction_enabled: bool,
    pub logical_fidelity: f64,
    pub encoding_fidelity: f64,
}

#[derive(Debug, Serialize)]
pub struct SimulationResponse {
    pub num_qubits: usize,
    pub probability_distribution: Vec<ProbabilityEntry>,
    pub amplitudes: Vec<AmplitudeEntry>,
    pub top_probabilities: Vec<ProbabilityEntry>,
    pub execution_time_ms: u128,
    pub circuit_hash: String,
    pub optimization_result: Option<OptimizationInfo>,
    pub from_cache: bool,
    pub total_probability_error: f64,
    pub toffoli_expanded: bool,
    pub toffoli_count: usize,
    pub use_kahan_sum: bool,
    pub ecc_result: Option<ECCInfoResponse>,
}

#[derive(Debug, Serialize)]
pub struct ProbabilityEntry {
    pub state: String,
    pub probability: f64,
}

#[derive(Debug, Serialize)]
pub struct AmplitudeEntry {
    pub state: String,
    pub real: f64,
    pub imag: f64,
}

#[derive(Debug, Serialize)]
pub struct MeasurementResponse {
    pub circuit_hash: String,
    pub counts: std::collections::HashMap<String, usize>,
    pub probabilities: Vec<ProbabilityEntry>,
    pub shots: usize,
    pub from_cache: bool,
    pub total_probability_error: f64,
    pub use_kahan_sum: bool,
    pub ecc_result: Option<ECCInfoResponse>,
}
impl GateRequest {
    fn to_gate(&self) -> Result<Gate, QuantumError> {
        let gate_type: GateType = self.gate_type.parse()?;
        Gate::new(gate_type, self.qubits.clone())
    }
}

fn parse_circuit(request: &CircuitRequest) -> Result<QuantumCircuit, QuantumError> {
    let mut circuit = QuantumCircuit::new(request.num_qubits)?;

    for gate_req in &request.gates {
        let gate = gate_req.to_gate()?;
        circuit.add_gate(gate)?;
    }

    Ok(circuit)
}

fn parse_circuit_from_measurement(
    request: &MeasurementRequest,
) -> Result<QuantumCircuit, QuantumError> {
    let mut circuit = QuantumCircuit::new(request.num_qubits)?;

    for gate_req in &request.gates {
        let gate = gate_req.to_gate()?;
        circuit.add_gate(gate)?;
    }

    Ok(circuit)
}

fn build_compile_options(request: &CircuitRequest) -> crate::quantum::circuit::CompileOptions {
    use crate::quantum::circuit::CompileOptions;

    CompileOptions {
        expand_toffoli: request.expand_toffoli.unwrap_or(true),
        optimize_gates: request.use_optimization.unwrap_or(true),
        use_kahan_sum: request.use_kahan_sum.unwrap_or(true),
    }
}

fn build_compile_options_from_measurement(
    request: &MeasurementRequest,
) -> crate::quantum::circuit::CompileOptions {
    use crate::quantum::circuit::CompileOptions;

    CompileOptions {
        expand_toffoli: request.expand_toffoli.unwrap_or(true),
        optimize_gates: request.use_optimization.unwrap_or(true),
        use_kahan_sum: request.use_kahan_sum.unwrap_or(true),
    }
}

fn build_simulator(request: &CircuitRequest) -> QuantumSimulator {
    let options = build_compile_options(request);
    QuantumSimulator::new().with_compile_options(options)
}

fn build_simulator_from_measurement(request: &MeasurementRequest) -> QuantumSimulator {
    let options = build_compile_options_from_measurement(request);
    QuantumSimulator::new().with_compile_options(options)
}

fn parse_ecc_type(ecc_type: &str) -> Result<ECCType, QuantumError> {
    match ecc_type.to_uppercase().as_str() {
        "NONE" => Ok(ECCType::None),
        "STEANE" => Ok(ECCType::Steane),
        "SHOR" => Ok(ECCType::Shor),
        "SURFACE" => Ok(ECCType::Surface),
        _ => Err(QuantumError::InvalidGateType(format!("Invalid ECC type: {}", ecc_type))),
    }
}

fn build_ecc_config(
    ecc_request: &Option<ECCConfigRequest>,
    logical_qubits: usize,
) -> Option<crate::quantum::error_correction::ECCConfig> {
    ecc_request.as_ref().map(|req| {
        use crate::quantum::error_correction::{ECCConfig, NoiseConfig};

        let ecc_type = req.ecc_type
            .as_ref()
            .and_then(|s| parse_ecc_type(s).ok())
            .unwrap_or(ECCType::None);

        let noise_config = req.noise_config.as_ref()
            .map(|n| NoiseConfig {
                bit_flip_prob: n.bit_flip_prob.unwrap_or(0.0),
                phase_flip_prob: n.phase_flip_prob.unwrap_or(0.0),
                after_each_gate: n.after_each_gate.unwrap_or(true),
            })
            .unwrap_or_default();

        ECCConfig {
            ecc_type,
            logical_qubits,
            noise_config,
            enable_correction: req.enable_correction.unwrap_or(true),
        }
    })
}

fn apply_ecc_to_circuit(
    circuit: &QuantumCircuit,
    ecc_config: &crate::quantum::error_correction::ECCConfig,
) -> Result<(QuantumCircuit, crate::quantum::error_correction::ECCResult), QuantumError> {
    use crate::quantum::error_correction::{calculate_encoding_fidelity, SteaneCode};

    let logical_gate_count = circuit.gate_count();

    let (encoded_circuit, encoding_fidelity, logical_fidelity) = match ecc_config.ecc_type {
        ECCType::None => {
            (circuit.clone(), 1.0, 1.0)
        }
        ECCType::Steane => {
            let steane = SteaneCode::new(ecc_config.clone())?;
            let encoded = steane.encode_circuit(circuit)?;
            let physical_gate_count = encoded.gate_count();

            let original_sim = QuantumSimulator::new()
                .with_optimization(false)
                .with_expand_toffoli(false)
                .simulate(circuit)?;

            let encoded_sim = QuantumSimulator::new()
                .with_optimization(false)
                .with_expand_toffoli(false)
                .simulate(&encoded)?;

            let log_fid = calculate_encoding_fidelity(
                &original_sim.final_state,
                &encoded_sim.final_state,
                ecc_config,
            )?;

            (encoded, log_fid, log_fid)
        }
        ECCType::Shor | ECCType::Surface => {
            return Err(QuantumError::CompilationError(format!(
                "ECC type {:?} not implemented yet",
                ecc_config.ecc_type
            )));
        }
    };

    let noise_applied = ecc_config.noise_config.bit_flip_prob > 0.0
        || ecc_config.noise_config.phase_flip_prob > 0.0;

    let ecc_result = crate::quantum::error_correction::ECCResult {
        ecc_type: ecc_config.ecc_type,
        logical_qubits: ecc_config.logical_qubits,
        physical_qubits: ecc_config.physical_qubits(),
        ancilla_qubits: ecc_config.ancilla_qubits(),
        total_qubits: ecc_config.total_qubits(),
        logical_gate_count,
        physical_gate_count: encoded_circuit.gate_count(),
        noise_applied,
        bit_flip_count: 0,
        phase_flip_count: 0,
        correction_performed: ecc_config.enable_correction,
        detected_errors: Vec::new(),
        corrected_errors: Vec::new(),
        logical_fidelity,
        encoding_fidelity,
    };

    Ok((encoded_circuit, ecc_result))
}

pub async fn health_check() -> impl Responder {
    HttpResponse::Ok().json(serde_json::json!({
        "status": "ok",
        "service": "quantum_simulator",
        "version": env!("CARGO_PKG_VERSION")
    }))
}

pub async fn get_circuit_info(request: web::Json<CircuitRequest>) -> Result<HttpResponse, QuantumError> {
    let circuit = parse_circuit(&request)?;

    let response = CircuitInfoResponse {
        num_qubits: circuit.num_qubits,
        gate_count: circuit.gate_count(),
        single_qubit_gate_count: circuit.single_qubit_gate_count(),
        multi_qubit_gate_count: circuit.multi_qubit_gate_count(),
        circuit_depth: circuit.depth(),
        circuit_hash: circuit.compute_hash(),
    };

    Ok(HttpResponse::Ok().json(response))
}

pub async fn compile_circuit(
    request: web::Json<CircuitRequest>,
    cache: web::Data<Option<CacheManager>>,
) -> Result<HttpResponse, QuantumError> {
    let circuit = parse_circuit(&request)?;
    let options = build_compile_options(&request);
    let circuit_hash = circuit.compute_hash();

    if let Some(cache) = cache.get_ref() {
        if let Ok(Some(compiled)) = cache.get_compiled_circuit(&circuit_hash).await {
            let response = CompileResponse {
                num_qubits: compiled.num_qubits,
                original_gates: compiled.original_gates.iter().map(|g| GateInfo {
                    gate_type: g.gate_type.to_string(),
                    qubits: g.qubits.clone(),
                }).collect(),
                optimized_gates: compiled.optimized_gates.iter().map(|g| GateInfo {
                    gate_type: g.gate_type.to_string(),
                    qubits: g.qubits.clone(),
                }).collect(),
                optimization_result: OptimizationInfo {
                    original_gate_count: compiled.optimization_result.original_gate_count,
                    optimized_gate_count: compiled.optimization_result.optimized_gate_count,
                    gates_removed: compiled.optimization_result.gates_removed,
                    merged_groups: compiled.optimization_result.merged_groups.iter().map(|g| MergedGroupInfo {
                        qubit: g.qubit,
                        original_gates: g.original_gates.iter().map(|gt| gt.to_string()).collect(),
                        merged: g.merged,
                    }).collect(),
                },
                circuit_hash: compiled.circuit_hash,
                from_cache: true,
                toffoli_expanded: compiled.toffoli_expanded,
                toffoli_count: compiled.toffoli_count,
                expanded_gate_count: compiled.expanded_gate_count,
            };

            return Ok(HttpResponse::Ok().json(response));
        }
    }

    let compiled = circuit.compile_with_options(options)?;

    if let Some(cache) = cache.get_ref() {
        let _ = cache.set_compiled_circuit(&circuit_hash, &compiled).await;
    }

    let response = CompileResponse {
        num_qubits: compiled.num_qubits,
        original_gates: compiled.original_gates.iter().map(|g| GateInfo {
            gate_type: g.gate_type.to_string(),
            qubits: g.qubits.clone(),
        }).collect(),
        optimized_gates: compiled.optimized_gates.iter().map(|g| GateInfo {
            gate_type: g.gate_type.to_string(),
            qubits: g.qubits.clone(),
        }).collect(),
        optimization_result: OptimizationInfo {
            original_gate_count: compiled.optimization_result.original_gate_count,
            optimized_gate_count: compiled.optimization_result.optimized_gate_count,
            gates_removed: compiled.optimization_result.gates_removed,
            merged_groups: compiled.optimization_result.merged_groups.iter().map(|g| MergedGroupInfo {
                qubit: g.qubit,
                original_gates: g.original_gates.iter().map(|gt| gt.to_string()).collect(),
                merged: g.merged,
            }).collect(),
        },
        circuit_hash: compiled.circuit_hash,
        from_cache: false,
        toffoli_expanded: compiled.toffoli_expanded,
        toffoli_count: compiled.toffoli_count,
        expanded_gate_count: compiled.expanded_gate_count,
    };

    Ok(HttpResponse::Ok().json(response))
}

pub async fn simulate_circuit(
    request: web::Json<CircuitRequest>,
    cache: web::Data<Option<CacheManager>>,
) -> Result<HttpResponse, QuantumError> {
    let logical_circuit = parse_circuit(&request)?;
    let options = build_compile_options(&request);
    let ecc_config = build_ecc_config(&request.ecc_config, logical_circuit.num_qubits);
    let circuit_hash = logical_circuit.compute_hash();
    let use_cache = options.optimize_gates && ecc_config.is_none();

    if use_cache {
        if let Some(cache) = cache.get_ref() {
            if let Ok(Some(result)) = cache.get_simulation_result(&circuit_hash).await {
                let response = build_simulation_response(&result, true, options.use_kahan_sum, None);
                return Ok(HttpResponse::Ok().json(response));
            }
        }
    }

    let (circuit_to_simulate, ecc_result) = if let Some(ref ecc) = ecc_config {
        apply_ecc_to_circuit(&logical_circuit, ecc)?
    } else {
        (logical_circuit.clone(), None)
    };

    let simulator = build_simulator(&request);
    let result = simulator.simulate(&circuit_to_simulate)?;

    if use_cache {
        if let Some(cache) = cache.get_ref() {
            let _ = cache.set_simulation_result(&circuit_hash, &result).await;
        }
    }

    let ecc_info = ecc_result.map(|ecc| {
        let noise_config = ecc_config.as_ref().unwrap().noise_config;
        ECCInfoResponse {
            ecc_type: format!("{:?}", ecc.ecc_type),
            logical_qubits: ecc.logical_qubits,
            physical_qubits: ecc.physical_qubits,
            ancilla_qubits: ecc.ancilla_qubits,
            total_qubits: ecc.total_qubits,
            logical_gate_count: ecc.logical_gate_count,
            physical_gate_count: ecc.physical_gate_count,
            noise_applied: ecc.noise_applied,
            bit_flip_prob: noise_config.bit_flip_prob,
            phase_flip_prob: noise_config.phase_flip_prob,
            correction_enabled: ecc.correction_performed,
            logical_fidelity: ecc.logical_fidelity,
            encoding_fidelity: ecc.encoding_fidelity,
        }
    });

    let response = build_simulation_response(&result, false, options.use_kahan_sum, ecc_info);
    Ok(HttpResponse::Ok().json(response))
}

fn build_simulation_response(
    result: &SimulationResult,
    from_cache: bool,
    use_kahan: bool,
    ecc_info: Option<ECCInfoResponse>,
) -> SimulationResponse {
    SimulationResponse {
        num_qubits: result.num_qubits,
        probability_distribution: result.probability_distribution.iter().map(|(state, prob)| ProbabilityEntry {
            state: state.clone(),
            probability: *prob,
        }).collect(),
        amplitudes: result.amplitudes.iter().map(|(state, (re, im))| AmplitudeEntry {
            state: state.clone(),
            real: *re,
            imag: *im,
        }).collect(),
        top_probabilities: result.top_probabilities.iter().map(|(state, prob)| ProbabilityEntry {
            state: state.clone(),
            probability: *prob,
        }).collect(),
        execution_time_ms: result.execution_time_ms,
        circuit_hash: result.circuit_hash.clone(),
        optimization_result: result.optimization_result.as_ref().map(|opt| OptimizationInfo {
            original_gate_count: opt.original_gate_count,
            optimized_gate_count: opt.optimized_gate_count,
            gates_removed: opt.gates_removed,
            merged_groups: opt.merged_groups.iter().map(|g| MergedGroupInfo {
                qubit: g.qubit,
                original_gates: g.original_gates.iter().map(|gt| gt.to_string()).collect(),
                merged: g.merged,
            }).collect(),
        }),
        from_cache,
        total_probability_error: result.total_probability_error,
        toffoli_expanded: result.toffoli_expanded,
        toffoli_count: result.toffoli_count,
        use_kahan_sum: use_kahan,
        ecc_result: ecc_info,
    }
}

pub async fn measure_circuit(
    request: web::Json<MeasurementRequest>,
    cache: web::Data<Option<CacheManager>>,
) -> Result<HttpResponse, QuantumError> {
    let logical_circuit = parse_circuit_from_measurement(&request)?;
    let options = build_compile_options_from_measurement(&request);
    let ecc_config = build_ecc_config(&request.ecc_config, logical_circuit.num_qubits);
    let circuit_hash = logical_circuit.compute_hash();
    let shots = request.shots.unwrap_or(1024);
    let use_cache = options.optimize_gates && ecc_config.is_none();

    if use_cache {
        if let Some(cache) = cache.get_ref() {
            if let Ok(Some(result)) = cache.get_measurement_result(&circuit_hash, shots).await {
                let response = MeasurementResponse {
                    circuit_hash: result.circuit_hash.clone(),
                    counts: result.counts.clone(),
                    probabilities: result.probabilities.iter().map(|(state, prob)| ProbabilityEntry {
                        state: state.clone(),
                        probability: *prob,
                    }).collect(),
                    shots: result.shots,
                    from_cache: true,
                    total_probability_error: result.total_probability_error,
                    use_kahan_sum: options.use_kahan_sum,
                    ecc_result: None,
                };
                return Ok(HttpResponse::Ok().json(response));
            }
        }
    }

    let (circuit_to_simulate, ecc_result) = if let Some(ref ecc) = ecc_config {
        apply_ecc_to_circuit(&logical_circuit, ecc)?
    } else {
        (logical_circuit.clone(), None)
    };

    let simulator = build_simulator_from_measurement(&request);
    let result = simulator.measure(&circuit_to_simulate, shots)?;

    if use_cache {
        if let Some(cache) = cache.get_ref() {
            let _ = cache.set_measurement_result(&circuit_hash, shots, &result).await;
        }
    }

    let ecc_info = ecc_result.map(|ecc| {
        let noise_config = ecc_config.as_ref().unwrap().noise_config;
        ECCInfoResponse {
            ecc_type: format!("{:?}", ecc.ecc_type),
            logical_qubits: ecc.logical_qubits,
            physical_qubits: ecc.physical_qubits,
            ancilla_qubits: ecc.ancilla_qubits,
            total_qubits: ecc.total_qubits,
            logical_gate_count: ecc.logical_gate_count,
            physical_gate_count: ecc.physical_gate_count,
            noise_applied: ecc.noise_applied,
            bit_flip_prob: noise_config.bit_flip_prob,
            phase_flip_prob: noise_config.phase_flip_prob,
            correction_enabled: ecc.correction_performed,
            logical_fidelity: ecc.logical_fidelity,
            encoding_fidelity: ecc.encoding_fidelity,
        }
    });

    let response = MeasurementResponse {
        circuit_hash: result.circuit_hash.clone(),
        counts: result.counts.clone(),
        probabilities: result.probabilities.iter().map(|(state, prob)| ProbabilityEntry {
            state: state.clone(),
            probability: *prob,
        }).collect(),
        shots: result.shots,
        from_cache: false,
        total_probability_error: result.total_probability_error,
        use_kahan_sum: options.use_kahan_sum,
        ecc_result: ecc_info,
    };

    Ok(HttpResponse::Ok().json(response))
}

pub async fn get_available_gates() -> impl Responder {
    let gates = vec![
        serde_json::json!({
            "name": "Hadamard",
            "symbol": "H",
            "qubit_count": 1,
            "description": "Creates superposition state"
        }),
        serde_json::json!({
            "name": "Pauli-X",
            "symbol": "X",
            "qubit_count": 1,
            "description": "Quantum NOT gate"
        }),
        serde_json::json!({
            "name": "Pauli-Y",
            "symbol": "Y",
            "qubit_count": 1,
            "description": "Pauli-Y rotation"
        }),
        serde_json::json!({
            "name": "Pauli-Z",
            "symbol": "Z",
            "qubit_count": 1,
            "description": "Phase flip gate"
        }),
        serde_json::json!({
            "name": "CNOT",
            "symbol": "CNOT",
            "qubit_count": 2,
            "description": "Controlled-NOT gate"
        }),
        serde_json::json!({
            "name": "Toffoli",
            "symbol": "Toffoli",
            "qubit_count": 3,
            "description": "Controlled-controlled-NOT gate"
        }),
    ];

    HttpResponse::Ok().json(serde_json::json!({
        "gates": gates,
        "max_qubits": 30
    }))
}

pub async fn get_available_ecc() -> impl Responder {
    let ecc_types = vec![
        serde_json::json!({
            "name": "None",
            "symbol": "None",
            "logical_to_physical_ratio": 1,
            "description": "No error correction"
        }),
        serde_json::json!({
            "name": "Steane Code",
            "symbol": "Steane",
            "logical_to_physical_ratio": 7,
            "ancilla_qubits": 6,
            "description": "7-qubit CSS code, corrects arbitrary single-qubit errors (bit-flip and phase-flip)",
            "corrects": ["bit_flip", "phase_flip"],
            "transversal_gates": ["H", "X", "Z", "CNOT"]
        }),
        serde_json::json!({
            "name": "Shor Code",
            "symbol": "Shor",
            "logical_to_physical_ratio": 9,
            "ancilla_qubits": 8,
            "description": "9-qubit code, first quantum error-correcting code",
            "corrects": ["bit_flip", "phase_flip", "arbitrary_single_qubit"]
        }),
        serde_json::json!({
            "name": "Surface Code",
            "symbol": "Surface",
            "logical_to_physical_ratio": 25,
            "ancilla_qubits": 20,
            "description": "2D topological code, high threshold for fault tolerance",
            "corrects": ["bit_flip", "phase_flip"]
        }),
    ];

    HttpResponse::Ok().json(serde_json::json!({
        "ecc_types": ecc_types
    }))
}

pub async fn clear_cache(
    cache: web::Data<Option<CacheManager>>,
) -> Result<HttpResponse, QuantumError> {
    if let Some(cache) = cache.get_ref() {
        cache.clear_all().await?;
        Ok(HttpResponse::Ok().json(serde_json::json!({
            "status": "success",
            "message": "Cache cleared"
        })))
    } else {
        Ok(HttpResponse::BadRequest().json(serde_json::json!({
            "error": "Cache is not configured"
        })))
    }
}

pub async fn get_cache_stats(
    cache: web::Data<Option<CacheManager>>,
) -> Result<HttpResponse, QuantumError> {
    if let Some(cache) = cache.get_ref() {
        let stats = cache.get_stats().await?;
        Ok(HttpResponse::Ok().json(stats))
    } else {
        Ok(HttpResponse::Ok().json(serde_json::json!({
            "cache_enabled": false
        })))
    }
}

pub fn configure_routes(cfg: &mut web::ServiceConfig) {
    cfg.service(
        web::scope("/api/v1")
            .route("/health", web::get().to(health_check))
            .route("/gates", web::get().to(get_available_gates))
            .route("/ecc", web::get().to(get_available_ecc))
            .route("/circuit/info", web::post().to(get_circuit_info))
            .route("/circuit/compile", web::post().to(compile_circuit))
            .route("/circuit/simulate", web::post().to(simulate_circuit))
            .route("/circuit/measure", web::post().to(measure_circuit))
            .route("/cache/clear", web::post().to(clear_cache))
            .route("/cache/stats", web::get().to(get_cache_stats))
    );
}
