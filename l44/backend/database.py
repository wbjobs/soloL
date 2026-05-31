import sqlite3
import json
import numpy as np
from datetime import datetime
from typing import List, Dict, Optional, Union, Tuple, Any
import os


class ComplexEncoder(json.JSONEncoder):
    def default(self, obj):
        if isinstance(obj, complex):
            return {'__complex__': True, 'real': float(obj.real), 'imag': float(obj.imag)}
        if isinstance(obj, np.ndarray):
            return obj.tolist()
        if isinstance(obj, np.bool_):
            return bool(obj)
        if isinstance(obj, np.generic):
            return obj.item()
        return super().default(obj)

    def encode(self, o):
        return super().encode(convert_numpy_types(o))


def convert_numpy_types(obj: Any) -> Any:
    if isinstance(obj, np.bool_):
        return bool(obj)
    if isinstance(obj, np.generic):
        return obj.item()
    if isinstance(obj, complex):
        return {'__complex__': True, 'real': float(obj.real), 'imag': float(obj.imag)}
    if isinstance(obj, np.ndarray):
        return [convert_numpy_types(x) for x in obj.tolist()]
    if isinstance(obj, dict):
        return {k: convert_numpy_types(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [convert_numpy_types(v) for v in obj]
    return obj


def convert_complex(dct):
    if '__complex__' in dct:
        return complex(dct['real'], dct['imag'])
    return dct


class QuantumDatabase:
    def __init__(self, db_path: str = "quantum_history.db"):
        self.db_path = db_path
        self._init_database()

    def _get_connection(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def _init_database(self) -> None:
        with self._get_connection() as conn:
            cursor = conn.cursor()

            cursor.execute('''
                CREATE TABLE IF NOT EXISTS calculation_history (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    timestamp DATETIME NOT NULL,
                    operation_type TEXT NOT NULL,
                    n_qubits INTEGER NOT NULL,
                    state_vector REAL NOT NULL,
                    gates_applied TEXT,
                    bloch_coordinates TEXT,
                    entanglement_result TEXT,
                    parameters TEXT,
                    notes TEXT
                )
            ''')

            cursor.execute('''
                CREATE TABLE IF NOT EXISTS saved_states (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL,
                    created_at DATETIME NOT NULL,
                    n_qubits INTEGER NOT NULL,
                    state_vector REAL NOT NULL,
                    description TEXT,
                    tags TEXT
                )
            ''')

            cursor.execute('''
                CREATE TABLE IF NOT EXISTS gate_sequences (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL,
                    created_at DATETIME NOT NULL,
                    n_qubits INTEGER NOT NULL,
                    gates TEXT NOT NULL,
                    description TEXT
                )
            ''')

            cursor.execute('''
                CREATE INDEX IF NOT EXISTS idx_history_timestamp 
                ON calculation_history(timestamp)
            ''')
            cursor.execute('''
                CREATE INDEX IF NOT EXISTS idx_history_type 
                ON calculation_history(operation_type)
            ''')
            cursor.execute('''
                CREATE INDEX IF NOT EXISTS idx_history_qubits 
                ON calculation_history(n_qubits)
            ''')

            conn.commit()

    def save_calculation(self, operation_type: str, n_qubits: int,
                         state_vector: np.ndarray,
                         gates_applied: Optional[List[Dict]] = None,
                         bloch_coordinates: Optional[List[Tuple[float, float, float]]] = None,
                         entanglement_result: Optional[Dict] = None,
                         parameters: Optional[Dict] = None,
                         notes: Optional[str] = None) -> int:
        state_vector_bytes = state_vector.astype(np.complex128).tobytes()

        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('''
                INSERT INTO calculation_history 
                (timestamp, operation_type, n_qubits, state_vector, 
                 gates_applied, bloch_coordinates, entanglement_result, 
                 parameters, notes)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''', (
                datetime.now().isoformat(),
                operation_type,
                n_qubits,
                state_vector_bytes,
                json.dumps(gates_applied, cls=ComplexEncoder) if gates_applied else None,
                json.dumps(bloch_coordinates, cls=ComplexEncoder) if bloch_coordinates else None,
                json.dumps(entanglement_result, cls=ComplexEncoder) if entanglement_result else None,
                json.dumps(parameters, cls=ComplexEncoder) if parameters else None,
                notes
            ))
            conn.commit()
            return cursor.lastrowid

    def get_calculation(self, record_id: int) -> Optional[Dict]:
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('''
                SELECT * FROM calculation_history WHERE id = ?
            ''', (record_id,))
            row = cursor.fetchone()

            if row is None:
                return None

            return self._row_to_dict(row)

    def get_history(self, operation_type: Optional[str] = None,
                    n_qubits: Optional[int] = None,
                    limit: int = 100,
                    offset: int = 0) -> List[Dict]:
        query = 'SELECT * FROM calculation_history WHERE 1=1'
        params = []

        if operation_type:
            query += ' AND operation_type = ?'
            params.append(operation_type)

        if n_qubits:
            query += ' AND n_qubits = ?'
            params.append(n_qubits)

        query += ' ORDER BY timestamp DESC LIMIT ? OFFSET ?'
        params.extend([limit, offset])

        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(query, params)
            rows = cursor.fetchall()

            return [self._row_to_dict(row) for row in rows]

    def _row_to_dict(self, row: sqlite3.Row) -> Dict:
        state_vector = np.frombuffer(row['state_vector'], dtype=np.complex128)

        return {
            'id': row['id'],
            'timestamp': row['timestamp'],
            'operation_type': row['operation_type'],
            'n_qubits': row['n_qubits'],
            'state_vector': state_vector.tolist(),
            'state_vector_array': state_vector,
            'gates_applied': json.loads(row['gates_applied'], object_hook=convert_complex) if row['gates_applied'] else None,
            'bloch_coordinates': json.loads(row['bloch_coordinates'], object_hook=convert_complex) if row['bloch_coordinates'] else None,
            'entanglement_result': json.loads(row['entanglement_result'], object_hook=convert_complex) if row['entanglement_result'] else None,
            'parameters': json.loads(row['parameters'], object_hook=convert_complex) if row['parameters'] else None,
            'notes': row['notes']
        }

    def delete_calculation(self, record_id: int) -> bool:
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('DELETE FROM calculation_history WHERE id = ?', (record_id,))
            conn.commit()
            return cursor.rowcount > 0

    def clear_history(self, older_than_days: Optional[int] = None) -> int:
        with self._get_connection() as conn:
            cursor = conn.cursor()

            if older_than_days:
                cursor.execute('''
                    DELETE FROM calculation_history 
                    WHERE timestamp < datetime('now', ?)
                ''', (f'-{older_than_days} days',))
            else:
                cursor.execute('DELETE FROM calculation_history')

            conn.commit()
            return cursor.rowcount

    def save_state(self, name: str, n_qubits: int, state_vector: np.ndarray,
                   description: Optional[str] = None,
                   tags: Optional[List[str]] = None) -> int:
        state_vector_bytes = state_vector.astype(np.complex128).tobytes()

        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('''
                INSERT INTO saved_states 
                (name, created_at, n_qubits, state_vector, description, tags)
                VALUES (?, ?, ?, ?, ?, ?)
            ''', (
                name,
                datetime.now().isoformat(),
                n_qubits,
                state_vector_bytes,
                description,
                json.dumps(tags, cls=ComplexEncoder) if tags else None
            ))
            conn.commit()
            return cursor.lastrowid

    def get_saved_state(self, state_id: int) -> Optional[Dict]:
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('SELECT * FROM saved_states WHERE id = ?', (state_id,))
            row = cursor.fetchone()

            if row is None:
                return None

            state_vector = np.frombuffer(row['state_vector'], dtype=np.complex128)

            return {
                'id': row['id'],
                'name': row['name'],
                'created_at': row['created_at'],
                'n_qubits': row['n_qubits'],
                'state_vector': state_vector.tolist(),
                'state_vector_array': state_vector,
                'description': row['description'],
                'tags': json.loads(row['tags'], object_hook=convert_complex) if row['tags'] else None
            }

    def get_all_saved_states(self) -> List[Dict]:
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('SELECT * FROM saved_states ORDER BY created_at DESC')
            rows = cursor.fetchall()

            result = []
            for row in rows:
                state_vector = np.frombuffer(row['state_vector'], dtype=np.complex128)
                result.append({
                    'id': row['id'],
                    'name': row['name'],
                    'created_at': row['created_at'],
                    'n_qubits': row['n_qubits'],
                    'state_vector': state_vector.tolist(),
                    'description': row['description'],
                    'tags': json.loads(row['tags'], object_hook=convert_complex) if row['tags'] else None
                })

            return result

    def get_statistics(self) -> Dict:
        with self._get_connection() as conn:
            cursor = conn.cursor()

            cursor.execute('SELECT COUNT(*) as count FROM calculation_history')
            total_calculations = cursor.fetchone()['count']

            cursor.execute('''
                SELECT operation_type, COUNT(*) as count 
                FROM calculation_history 
                GROUP BY operation_type
            ''')
            by_type = {row['operation_type']: row['count'] for row in cursor.fetchall()}

            cursor.execute('''
                SELECT n_qubits, COUNT(*) as count 
                FROM calculation_history 
                GROUP BY n_qubits
            ''')
            by_qubits = {row['n_qubits']: row['count'] for row in cursor.fetchall()}

            cursor.execute('SELECT COUNT(*) as count FROM saved_states')
            saved_states_count = cursor.fetchone()['count']

            return {
                'total_calculations': total_calculations,
                'by_operation_type': by_type,
                'by_qubit_count': by_qubits,
                'saved_states_count': saved_states_count
            }

    def save_gate_sequence(self, name: str, n_qubits: int,
                           gates: List[Dict], description: Optional[str] = None) -> int:
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('''
                INSERT INTO gate_sequences 
                (name, created_at, n_qubits, gates, description)
                VALUES (?, ?, ?, ?, ?)
            ''', (
                name,
                datetime.now().isoformat(),
                n_qubits,
                json.dumps(gates, cls=ComplexEncoder),
                description
            ))
            conn.commit()
            return cursor.lastrowid

    def get_gate_sequences(self) -> List[Dict]:
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('SELECT * FROM gate_sequences ORDER BY created_at DESC')
            rows = cursor.fetchall()

            return [{
                'id': row['id'],
                'name': row['name'],
                'created_at': row['created_at'],
                'n_qubits': row['n_qubits'],
                'gates': json.loads(row['gates'], object_hook=convert_complex),
                'description': row['description']
            } for row in rows]
