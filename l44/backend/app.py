import asyncio
import json
import numpy as np
from typing import List, Dict, Optional, Any
from datetime import datetime
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.encoders import jsonable_encoder
from pydantic import BaseModel, Field
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from quantum_core import QuantumState, QuantumGate, create_bell_state, create_ghz_state, interpolate_states
from entanglement_detection import detect_entanglement, ppt_criterion, concurrence_2qubit, von_neumann_entropy
from quantum_optimized import fast_quaternion_slerp_batch, fast_quaternion_to_bloch_batch
from database import QuantumDatabase, ComplexEncoder, convert_numpy_types
from parallel_evolution import parallel_evolve
from latex_export import export_full_latex


class CustomJSONResponse(JSONResponse):
    def render(self, content: Any) -> bytes:
        return json.dumps(
            convert_numpy_types(content),
            ensure_ascii=False,
            allow_nan=False,
            indent=None,
            separators=(",", ":"),
        ).encode("utf-8")


app = FastAPI(title="Quantum Visualization API", version="1.0.0", default_response_class=CustomJSONResponse)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(HTTPException)
async def http_exception_handler(request, exc):
    return CustomJSONResponse(
        status_code=exc.status_code,
        content={"detail": exc.detail}
    )


@app.exception_handler(Exception)
async def general_exception_handler(request, exc):
    return CustomJSONResponse(
        status_code=500,
        content={"detail": str(exc)}
    )


db = QuantumDatabase(db_path=os.path.join(os.path.dirname(__file__), "quantum_history.db"))

global_state_store: Dict[str, Dict] = {}


def _get_client_key(websocket: WebSocket) -> str:
    client = websocket.client
    if client:
        return f"{client.host}:{client.port}"
    return str(id(websocket))


def _serialize_state(qs: QuantumState) -> Dict:
    return {
        'n_qubits': qs.n_qubits,
        'state_vector': [[c.real, c.imag] for c in qs.state_vector]
    }


def _restore_state(data: Dict) -> QuantumState:
    if not data:
        return QuantumState(1)
    sv_data = data.get('state_vector')
    n_qubits = data.get('n_qubits', 1)
    if sv_data:
        sv = np.array([complex(re, im) for re, im in sv_data], dtype=np.complex128)
        qs = QuantumState.from_state_vector(sv)
    else:
        qs = QuantumState(n_qubits)
    return qs


class GateApplication(BaseModel):
    gate_type: str = Field(..., description="Gate type: H, X, Y, Z, CNOT")
    target_qubit: int = Field(..., ge=0, description="Target qubit index")
    control_qubit: Optional[int] = Field(None, ge=0, description="Control qubit for CNOT")


class QuantumStateRequest(BaseModel):
    n_qubits: int = Field(1, ge=1, le=5, description="Number of qubits (1-5)")
    state_vector: Optional[List[List[float]]] = Field(None, description="State vector as [[real, imag], ...]")
    gates: Optional[List[GateApplication]] = Field(None, description="Gates to apply")


class InterpolationRequest(BaseModel):
    state1: QuantumStateRequest
    state2: QuantumStateRequest
    steps: int = Field(50, ge=2, le=500, description="Number of interpolation steps")
    qubit_index: int = Field(0, ge=0, description="Qubit index for visualization")


class BlochSphereRequest(BaseModel):
    theta: float = Field(0.0, ge=0, le=3.1415926535, description="Polar angle theta")
    phi: float = Field(0.0, ge=0, le=6.283185307, description="Azimuthal angle phi")


class ParallelEvolutionTask(BaseModel):
    label: str = Field('', description="Task label")
    n_qubits: int = Field(1, ge=1, le=5)
    state_vector: Optional[List[List[float]]] = None
    gates: Optional[List[GateApplication]] = None


class ParallelEvolutionRequest(BaseModel):
    tasks: List[ParallelEvolutionTask] = Field(..., min_length=1, max_length=20)
    max_workers: Optional[int] = Field(None, ge=1, le=8)


class GateSequenceRequest(BaseModel):
    n_qubits: int = Field(1, ge=1, le=5)
    gates: List[GateApplication] = Field(..., min_length=1)
    label: str = Field('', description="Circuit label")


class LaTeXExportRequest(BaseModel):
    entanglement_result: Dict[str, Any] = Field(..., description="Entanglement detection result")
    precision: int = Field(4, ge=2, le=8)


def parse_state_vector(sv_data: Optional[List[List[float]]], n_qubits: int) -> Optional[np.ndarray]:
    if sv_data is None:
        return None
    size = 2 ** n_qubits
    if len(sv_data) != size:
        raise ValueError(f"State vector must have {size} elements")
    state = np.array([complex(re, im) for re, im in sv_data], dtype=np.complex128)
    return state / np.linalg.norm(state)


def create_quantum_state(request: QuantumStateRequest) -> QuantumState:
    if request.state_vector:
        sv = parse_state_vector(request.state_vector, request.n_qubits)
        qs = QuantumState.from_state_vector(sv)
    else:
        qs = QuantumState(request.n_qubits)

    if request.gates:
        for gate_app in request.gates:
            if gate_app.gate_type.upper() == 'H':
                qs.apply_hadamard(gate_app.target_qubit)
            elif gate_app.gate_type.upper() == 'X':
                qs.apply_x(gate_app.target_qubit)
            elif gate_app.gate_type.upper() == 'Y':
                qs.apply_y(gate_app.target_qubit)
            elif gate_app.gate_type.upper() == 'Z':
                qs.apply_z(gate_app.target_qubit)
            elif gate_app.gate_type.upper() == 'CNOT':
                if gate_app.control_qubit is None:
                    raise ValueError("CNOT requires control_qubit")
                qs.apply_cnot(gate_app.control_qubit, gate_app.target_qubit)
            else:
                raise ValueError(f"Unknown gate type: {gate_app.gate_type}")

    return qs


def state_to_response(qs: QuantumState, include_entanglement: bool = True) -> Dict[str, Any]:
    response = {
        'n_qubits': qs.n_qubits,
        'state_vector': [[c.real, c.imag] for c in qs.state_vector],
        'bloch_spheres': []
    }

    for i in range(qs.n_qubits):
        x, y, z = qs.to_bloch_sphere(i)
        q = qs.to_quaternion(i)
        response['bloch_spheres'].append({
            'qubit': i,
            'x': float(x),
            'y': float(y),
            'z': float(z),
            'quaternion': [float(q[0]), float(q[1]), float(q[2]), float(q[3])]
        })

    if include_entanglement:
        try:
            ent_result = detect_entanglement(qs)
            response['entanglement_result'] = convert_numpy_types(ent_result)
        except Exception as e:
            response['entanglement_result'] = {'error': str(e)}

    return convert_numpy_types(response)


@app.get("/")
async def root():
    return {
        "name": "Quantum Visualization API",
        "version": "1.0.0",
        "endpoints": {
            "/api/state": "POST - Create and manipulate quantum state",
            "/api/entanglement": "POST - Detect entanglement",
            "/api/interpolate": "POST - Interpolate between two states",
            "/api/bloch": "POST - Create state from Bloch coordinates",
            "/api/bell/{bell_type}": "GET - Create Bell state",
            "/api/ghz/{n_qubits}": "GET - Create GHZ state",
            "/api/history": "GET - Get calculation history",
            "/api/saved-states": "GET - Get saved states",
            "/api/stats": "GET - Get database statistics",
            "/ws": "WebSocket - Real-time updates"
        }
    }


@app.post("/api/state")
async def create_state(request: QuantumStateRequest, save: bool = True):
    try:
        qs = create_quantum_state(request)
        response = state_to_response(qs)

        if save:
            gates_list = [g.dict() for g in request.gates] if request.gates else None
            bloch_coords = [tuple(bs.values()) for bs in response['bloch_spheres'][:3]]
            ent_result = response.get('entanglement_result')

            db.save_calculation(
                operation_type='state_creation',
                n_qubits=qs.n_qubits,
                state_vector=qs.state_vector,
                gates_applied=gates_list,
                bloch_coordinates=bloch_coords,
                entanglement_result=ent_result,
                parameters={'n_qubits': qs.n_qubits}
            )

        return response
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/api/entanglement")
async def check_entanglement(request: QuantumStateRequest):
    try:
        qs = create_quantum_state(request)
        result = detect_entanglement(qs)

        db.save_calculation(
            operation_type='entanglement_detection',
            n_qubits=qs.n_qubits,
            state_vector=qs.state_vector,
            entanglement_result=result
        )

        return convert_numpy_types(result)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/api/interpolate")
async def interpolate(request: InterpolationRequest):
    try:
        qs1 = create_quantum_state(request.state1)
        qs2 = create_quantum_state(request.state2)

        q1 = qs1.to_quaternion(request.qubit_index)
        q2 = qs2.to_quaternion(request.qubit_index)

        quats = fast_quaternion_slerp_batch(q1, q2, request.steps)
        bloch_points = fast_quaternion_to_bloch_batch(quats)

        response = {
            'steps': request.steps,
            'qubit_index': request.qubit_index,
            'state1': state_to_response(qs1, include_entanglement=False),
            'state2': state_to_response(qs2, include_entanglement=False),
            'interpolation_points': [
                {'x': float(p[0]), 'y': float(p[1]), 'z': float(p[2])}
                for p in bloch_points
            ],
            'quaternions': quats.tolist()
        }

        db.save_calculation(
            operation_type='interpolation',
            n_qubits=qs1.n_qubits,
            state_vector=qs1.state_vector,
            parameters={
                'steps': request.steps,
                'qubit_index': request.qubit_index,
                'state2_vector': qs2.state_vector.tolist()
            }
        )

        return response
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/api/bloch")
async def create_from_bloch(request: BlochSphereRequest):
    try:
        qs = QuantumState.from_bloch_sphere(request.theta, request.phi)
        response = state_to_response(qs)

        db.save_calculation(
            operation_type='bloch_creation',
            n_qubits=1,
            state_vector=qs.state_vector,
            parameters={'theta': request.theta, 'phi': request.phi}
        )

        return response
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/api/bell/{bell_type}")
async def get_bell_state(bell_type: str = "phi+"):
    try:
        valid_types = ["phi+", "phi-", "psi+", "psi-"]
        if bell_type not in valid_types:
            raise HTTPException(status_code=400, detail=f"Bell type must be one of {valid_types}")

        qs = create_bell_state(bell_type)
        response = state_to_response(qs)

        db.save_calculation(
            operation_type='bell_state',
            n_qubits=2,
            state_vector=qs.state_vector,
            parameters={'bell_type': bell_type}
        )

        return response
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/api/ghz/{n_qubits}")
async def get_ghz_state(n_qubits: int):
    try:
        if n_qubits < 2 or n_qubits > 5:
            raise HTTPException(status_code=400, detail="n_qubits must be between 2 and 5")

        qs = create_ghz_state(n_qubits)
        response = state_to_response(qs)

        db.save_calculation(
            operation_type='ghz_state',
            n_qubits=n_qubits,
            state_vector=qs.state_vector,
            parameters={'n_qubits': n_qubits}
        )

        return response
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/api/history")
async def get_history(
    operation_type: Optional[str] = None,
    n_qubits: Optional[int] = None,
    limit: int = 100,
    offset: int = 0
):
    try:
        records = db.get_history(operation_type, n_qubits, limit, offset)
        for r in records:
            if 'state_vector_array' in r:
                del r['state_vector_array']
        stats = db.get_statistics()
        result = {'history': records, 'statistics': stats}
        return convert_numpy_types(result)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.delete("/api/history/{record_id}")
async def delete_history_record(record_id: int):
    try:
        success = db.delete_calculation(record_id)
        if not success:
            raise HTTPException(status_code=404, detail="Record not found")
        return {'success': True, 'message': 'Record deleted'}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/api/saved-states")
async def get_saved_states():
    try:
        states = db.get_all_saved_states()
        for s in states:
            if 'state_vector_array' in s:
                del s['state_vector_array']
        result = {'states': states, 'count': len(states)}
        return convert_numpy_types(result)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/api/saved-states")
async def save_state(name: str, request: QuantumStateRequest, description: Optional[str] = None):
    try:
        qs = create_quantum_state(request)
        state_id = db.save_state(name, qs.n_qubits, qs.state_vector, description)
        return {'success': True, 'state_id': state_id}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/api/stats")
async def get_statistics():
    try:
        stats = db.get_statistics()
        return stats
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/api/parallel-evolve")
async def parallel_evolve_endpoint(request: ParallelEvolutionRequest):
    try:
        tasks = []
        for task in request.tasks:
            task_dict = {
                'n_qubits': task.n_qubits,
                'label': task.label,
                'state_vector': task.state_vector,
                'gates': [g.dict() for g in task.gates] if task.gates else []
            }
            tasks.append(task_dict)

        results = parallel_evolve(tasks, request.max_workers)

        for r in results:
            if 'entanglement_result' in r:
                r['entanglement_result'] = convert_numpy_types(r['entanglement_result'])

        db.save_calculation(
            operation_type='parallel_evolution',
            n_qubits=max(t.n_qubits for t in request.tasks),
            state_vector=np.zeros(2, dtype=np.complex128),
            parameters={'num_tasks': len(tasks), 'max_workers': request.max_workers}
        )

        return {'results': results, 'num_tasks': len(results)}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/api/gate-sequence")
async def apply_gate_sequence(request: GateSequenceRequest):
    try:
        qs = QuantumState(request.n_qubits)

        for gate_app in request.gates:
            if gate_app.gate_type.upper() == 'H':
                qs.apply_hadamard(gate_app.target_qubit)
            elif gate_app.gate_type.upper() == 'X':
                qs.apply_x(gate_app.target_qubit)
            elif gate_app.gate_type.upper() == 'Y':
                qs.apply_y(gate_app.target_qubit)
            elif gate_app.gate_type.upper() == 'Z':
                qs.apply_z(gate_app.target_qubit)
            elif gate_app.gate_type.upper() == 'CNOT':
                if gate_app.control_qubit is None:
                    raise ValueError("CNOT requires control_qubit")
                qs.apply_cnot(gate_app.control_qubit, gate_app.target_qubit)

        response = state_to_response(qs)
        response['circuit_label'] = request.label
        response['gate_sequence'] = [g.dict() for g in request.gates]

        db.save_calculation(
            operation_type='gate_sequence',
            n_qubits=request.n_qubits,
            state_vector=qs.state_vector,
            gates_applied=[g.dict() for g in request.gates],
            parameters={'label': request.label}
        )

        return response
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/api/export-latex")
async def export_latex(request: LaTeXExportRequest):
    try:
        latex_code = export_full_latex(request.entanglement_result, request.precision)
        return {'latex': latex_code, 'format': 'latex'}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/api/entropy-heatmap")
async def compute_entropy_heatmap(n_qubits: int = 2, resolution: int = 20):
    try:
        if n_qubits < 2 or n_qubits > 5:
            raise HTTPException(status_code=400, detail="n_qubits must be 2-5 for heatmap")

        heatmap_data = []
        for qi in range(n_qubits):
            points = []
            for theta_idx in range(resolution):
                for phi_idx in range(resolution):
                    theta = np.pi * theta_idx / (resolution - 1)
                    phi = 2 * np.pi * phi_idx / (resolution - 1)

                    sv = np.zeros(2 ** n_qubits, dtype=np.complex128)
                    sv[0] = 1.0
                    single = np.array([np.cos(theta / 2), np.sin(theta / 2) * np.exp(1j * phi)])
                    if qi == 0:
                        for k in range(1, n_qubits):
                            single = np.kron(single, np.array([1, 0], dtype=np.complex128))
                    else:
                        left = np.array([1, 0], dtype=np.complex128)
                        for k in range(1, qi):
                            left = np.kron(left, np.array([1, 0], dtype=np.complex128))
                        right = np.array([1, 0], dtype=np.complex128)
                        for k in range(qi + 1, n_qubits):
                            right = np.kron(right, np.array([1, 0], dtype=np.complex128))
                        single = np.kron(np.kron(left, np.array([np.cos(theta / 2), np.sin(theta / 2) * np.exp(1j * phi)])), right)

                    norm = np.linalg.norm(single)
                    if norm > 1e-10:
                        single = single / norm

                    qs = QuantumState.from_state_vector(single)
                    rho_i = qs.reduced_density_matrix(qi)
                    entropy = float(von_neumann_entropy(rho_i))

                    x = np.sin(theta) * np.cos(phi)
                    y = np.sin(theta) * np.sin(phi)
                    z = np.cos(theta)

                    points.append({
                        'theta': float(theta),
                        'phi': float(phi),
                        'x': float(x), 'y': float(y), 'z': float(z),
                        'entropy': entropy
                    })
            heatmap_data.append({'qubit': qi, 'points': points})

        return {'heatmap': heatmap_data, 'resolution': resolution, 'n_qubits': n_qubits}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    client_id = id(websocket)
    client_key = _get_client_key(websocket)
    print(f"WebSocket client {client_id} connected (key={client_key})")

    current_state: Optional[QuantumState] = None

    if client_key in global_state_store:
        saved = global_state_store[client_key]
        current_state = _restore_state(saved)
        try:
            response = state_to_response(current_state)
            response['action'] = 'state_sync'
            response['sync_source'] = 'reconnected'
            await websocket.send_json(response)
        except Exception:
            pass

    try:
        while True:
            data = await websocket.receive_text()

            try:
                message = json.loads(data)
                action = message.get('action')

                if action == 'ping':
                    await websocket.send_json({'action': 'pong', 'timestamp': datetime.now().isoformat()})

                elif action == 'sync_state':
                    if current_state is not None:
                        response = state_to_response(current_state)
                        response['action'] = 'state_sync'
                        response['sync_source'] = 'server'
                    elif client_key in global_state_store:
                        current_state = _restore_state(global_state_store[client_key])
                        response = state_to_response(current_state)
                        response['action'] = 'state_sync'
                        response['sync_source'] = 'restored'
                    else:
                        current_state = QuantumState(1)
                        response = state_to_response(current_state)
                        response['action'] = 'state_sync'
                        response['sync_source'] = 'fresh'
                    await websocket.send_json(response)

                elif action == 'create_state':
                    request = QuantumStateRequest(**message.get('data', {}))
                    qs = create_quantum_state(request)
                    current_state = qs
                    global_state_store[client_key] = _serialize_state(qs)
                    response = state_to_response(qs)
                    response['action'] = 'state_update'

                    await websocket.send_json(response)

                elif action == 'apply_gate':
                    if current_state is None:
                        if client_key in global_state_store:
                            current_state = _restore_state(global_state_store[client_key])
                        else:
                            current_state = QuantumState(1)

                    gate_data = message.get('data', {})
                    gate_app = GateApplication(**gate_data)

                    if gate_app.gate_type.upper() == 'H':
                        current_state.apply_hadamard(gate_app.target_qubit)
                    elif gate_app.gate_type.upper() == 'X':
                        current_state.apply_x(gate_app.target_qubit)
                    elif gate_app.gate_type.upper() == 'Y':
                        current_state.apply_y(gate_app.target_qubit)
                    elif gate_app.gate_type.upper() == 'Z':
                        current_state.apply_z(gate_app.target_qubit)
                    elif gate_app.gate_type.upper() == 'CNOT':
                        if gate_app.control_qubit is None:
                            await websocket.send_json({
                                'action': 'error',
                                'message': 'CNOT requires control_qubit'
                            })
                            continue
                        current_state.apply_cnot(gate_app.control_qubit, gate_app.target_qubit)

                    global_state_store[client_key] = _serialize_state(current_state)
                    response = state_to_response(current_state)
                    response['action'] = 'state_update'

                    db.save_calculation(
                        operation_type='gate_application',
                        n_qubits=current_state.n_qubits,
                        state_vector=current_state.state_vector,
                        gates_applied=[gate_app.dict()]
                    )

                    await websocket.send_json(response)

                elif action == 'detect_entanglement':
                    if current_state is None:
                        if client_key in global_state_store:
                            current_state = _restore_state(global_state_store[client_key])
                        else:
                            current_state = QuantumState(1)

                    result = detect_entanglement(current_state)
                    result['action'] = 'entanglement_result'

                    db.save_calculation(
                        operation_type='entanglement_detection',
                        n_qubits=current_state.n_qubits,
                        state_vector=current_state.state_vector,
                        entanglement_result=result
                    )

                    await websocket.send_json(result)

                elif action == 'interpolate':
                    data = message.get('data', {})
                    request = InterpolationRequest(**data)

                    qs1 = create_quantum_state(request.state1)
                    qs2 = create_quantum_state(request.state2)
                    q1 = qs1.to_quaternion(request.qubit_index)
                    q2 = qs2.to_quaternion(request.qubit_index)

                    quats = fast_quaternion_slerp_batch(q1, q2, request.steps)
                    bloch_points = fast_quaternion_to_bloch_batch(quats)

                    for i, point in enumerate(bloch_points):
                        await websocket.send_json({
                            'action': 'interpolation_step',
                            'step': i,
                            'total': request.steps,
                            'x': float(point[0]),
                            'y': float(point[1]),
                            'z': float(point[2]),
                            'quaternion': quats[i].tolist()
                        })
                        await asyncio.sleep(0.01)

                    await websocket.send_json({
                        'action': 'interpolation_complete',
                        'total_steps': request.steps
                    })

                elif action == 'get_bell':
                    bell_type = message.get('data', {}).get('type', 'phi+')
                    qs = create_bell_state(bell_type)
                    current_state = qs
                    global_state_store[client_key] = _serialize_state(qs)
                    response = state_to_response(qs)
                    response['action'] = 'state_update'
                    await websocket.send_json(response)

                elif action == 'get_ghz':
                    n_qubits = message.get('data', {}).get('n_qubits', 3)
                    qs = create_ghz_state(n_qubits)
                    current_state = qs
                    global_state_store[client_key] = _serialize_state(qs)
                    response = state_to_response(qs)
                    response['action'] = 'state_update'
                    await websocket.send_json(response)

                elif action == 'set_qubits':
                    n_qubits = message.get('data', {}).get('n_qubits', 1)
                    current_state = QuantumState(n_qubits)
                    global_state_store[client_key] = _serialize_state(current_state)
                    response = state_to_response(current_state)
                    response['action'] = 'state_update'
                    await websocket.send_json(response)

                elif action == 'reset':
                    n_qubits = current_state.n_qubits if current_state else 1
                    current_state = QuantumState(n_qubits)
                    global_state_store[client_key] = _serialize_state(current_state)
                    response = state_to_response(current_state)
                    response['action'] = 'state_update'
                    await websocket.send_json(response)

                else:
                    await websocket.send_json({
                        'action': 'error',
                        'message': f'Unknown action: {action}'
                    })

            except Exception as e:
                await websocket.send_json({
                    'action': 'error',
                    'message': str(e)
                })

    except WebSocketDisconnect:
        if current_state is not None:
            global_state_store[client_key] = _serialize_state(current_state)
        print(f"WebSocket client {client_id} disconnected (state saved)")
    except Exception as e:
        if current_state is not None:
            global_state_store[client_key] = _serialize_state(current_state)
        print(f"WebSocket error for client {client_id}: {e}")
        try:
            await websocket.send_json({'action': 'error', 'message': str(e)})
        except:
            pass


if __name__ == "__main__":
    import uvicorn
    print("Starting Quantum Visualization Server on port 8000...")
    print("WebSocket endpoint: ws://localhost:8000/ws")
    print("API docs: http://localhost:8000/docs")
    uvicorn.run(app, host="0.0.0.0", port=8000)
