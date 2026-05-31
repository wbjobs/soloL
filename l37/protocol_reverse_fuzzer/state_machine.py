import hashlib
import os
from typing import List, Dict, Set, Tuple, Optional
from dataclasses import dataclass, field
from collections import defaultdict
import json


@dataclass
class Pattern:
    sequence: List[int]
    support: int
    confidence: float = 0.0

    def to_dict(self) -> Dict:
        return {
            "sequence": self.sequence,
            "support": self.support,
            "confidence": round(self.confidence, 4)
        }


@dataclass
class State:
    state_id: int
    label: str
    message_type: Optional[int] = None
    packet_count: int = 0
    outgoing_edges: Dict[int, "Transition"] = field(default_factory=dict)
    incoming_edges: Dict[int, "Transition"] = field(default_factory=dict)

    def to_dict(self) -> Dict:
        return {
            "state_id": self.state_id,
            "label": self.label,
            "message_type": self.message_type,
            "packet_count": self.packet_count,
            "outgoing_count": len(self.outgoing_edges),
            "incoming_count": len(self.incoming_edges)
        }


@dataclass
class Transition:
    from_state: int
    to_state: int
    message_type: int
    count: int = 0
    probability: float = 0.0
    payloads: List[bytes] = field(default_factory=list)

    def to_dict(self) -> Dict:
        return {
            "from": self.from_state,
            "to": self.to_state,
            "message_type": self.message_type,
            "count": self.count,
            "probability": round(self.probability, 4)
        }


@dataclass
class StateMachine:
    states: Dict[int, State] = field(default_factory=dict)
    transitions: List[Transition] = field(default_factory=list)
    start_state: Optional[int] = None
    end_states: Set[int] = field(default_factory=set)
    patterns: List[Pattern] = field(default_factory=list)

    def to_dict(self) -> Dict:
        return {
            "states": {str(sid): s.to_dict() for sid, s in self.states.items()},
            "transitions": [t.to_dict() for t in self.transitions],
            "start_state": self.start_state,
            "end_states": list(self.end_states),
            "state_count": len(self.states),
            "transition_count": len(self.transitions),
            "top_patterns": [p.to_dict() for p in self.patterns[:20]]
        }


class PrefixSpan:
    def __init__(self, min_support: int = 2, min_confidence: float = 0.5,
                 max_pattern_length: int = 10):
        self.min_support = min_support
        self.min_confidence = min_confidence
        self.max_pattern_length = max_pattern_length
        self._frequent_patterns: List[Pattern] = []

    def _is_subsequence(self, pattern: List[int], sequence: List[int]) -> bool:
        if not pattern:
            return True
        if len(pattern) > len(sequence):
            return False

        pi = 0
        for item in sequence:
            if item == pattern[pi]:
                pi += 1
                if pi == len(pattern):
                    return True
        return False

    def _calculate_support(self, sequences: List[List[int]], pattern: List[int]) -> int:
        count = 0
        for seq in sequences:
            if self._is_subsequence(pattern, seq):
                count += 1
        return count

    def _generate_candidates(self, prefix: List[int], sequences: List[List[int]]) -> List[int]:
        next_items = set()
        for seq in sequences:
            for i in range(len(seq)):
                if not prefix or self._is_subsequence(prefix, seq[:i + 1]):
                    for j in range(i + 1, len(seq)):
                        next_items.add(seq[j])
        return list(next_items)

    def _mine_recursive(self, prefix: List[int], sequences: List[List[int]]):
        if len(prefix) >= self.max_pattern_length:
            return

        next_items = self._generate_candidates(prefix, sequences)

        for item in next_items:
            new_pattern = prefix + [item]
            support = self._calculate_support(sequences, new_pattern)

            if support >= self.min_support:
                prefix_support = self._calculate_support(sequences, prefix) if prefix else len(sequences)
                confidence = support / prefix_support if prefix_support > 0 else 0.0

                pattern = Pattern(
                    sequence=new_pattern,
                    support=support,
                    confidence=confidence
                )
                self._frequent_patterns.append(pattern)

                self._mine_recursive(new_pattern, sequences)

    def mine(self, sequences: List[List[int]]) -> List[Pattern]:
        self._frequent_patterns = []

        all_items = set()
        for seq in sequences:
            all_items.update(seq)

        for item in all_items:
            pattern = [item]
            support = self._calculate_support(sequences, pattern)

            if support >= self.min_support:
                self._frequent_patterns.append(Pattern(
                    sequence=pattern,
                    support=support,
                    confidence=1.0
                ))
                self._mine_recursive(pattern, sequences)

        self._frequent_patterns.sort(key=lambda p: (-p.support, -p.confidence))

        return self._frequent_patterns

    def get_patterns_by_length(self, length: int) -> List[Pattern]:
        return [p for p in self._frequent_patterns if len(p.sequence) == length]

    def get_max_patterns(self, n: int = 10) -> List[Pattern]:
        return sorted(
            self._frequent_patterns,
            key=lambda p: (-p.support, -len(p.sequence))
        )[:n]


class ProtocolStateMachineInference:
    def __init__(self, min_support: int = 2, min_confidence: float = 0.5,
                 max_pattern_length: int = 10,
                 state_similarity_threshold: float = 0.85):
        self.min_support = min_support
        self.min_confidence = min_confidence
        self.max_pattern_length = max_pattern_length
        self.state_similarity_threshold = state_similarity_threshold
        self.prefix_span = PrefixSpan(
            min_support=min_support,
            min_confidence=min_confidence,
            max_pattern_length=max_pattern_length
        )
        self._packet_to_cluster: Dict[bytes, int] = {}
        self._cluster_to_state: Dict[int, int] = {}

    def _packet_signature(self, packet: bytes) -> str:
        if len(packet) >= 4:
            return hashlib.md5(packet[:4]).hexdigest()[:8]
        return hashlib.md5(packet).hexdigest()[:8]

    def _cluster_packets(self, packets: List[bytes]) -> Dict[bytes, int]:
        signatures = {}
        clusters: Dict[int, List[bytes]] = defaultdict(list)

        for pkt in packets:
            sig = self._packet_signature(pkt)
            if sig not in signatures:
                signatures[sig] = len(signatures)
            clusters[signatures[sig]].append(pkt)
            self._packet_to_cluster[pkt] = signatures[sig]

        return self._packet_to_cluster

    def _convert_to_sequences(self, packet_sessions: List[List[bytes]]) -> List[List[int]]:
        sequences = []

        for session in packet_sessions:
            sequence = []
            for pkt in session:
                if pkt in self._packet_to_cluster:
                    sequence.append(self._packet_to_cluster[pkt])
            if sequence:
                sequences.append(sequence)

        return sequences

    def _extract_sessions_from_pcap(self, packets: List[bytes],
                                     max_session_gap: float = 30.0) -> List[List[bytes]]:
        if not packets:
            return []

        sessions = []
        current_session = [packets[0]]

        for i in range(1, len(packets)):
            current_session.append(packets[i])

        if current_session:
            sessions.append(current_session)

        return sessions

    def _build_state_machine(self, sequences: List[List[int]]) -> StateMachine:
        sm = StateMachine()

        state_counter = 0
        state_map: Dict[Tuple[int, ...], int] = {}

        def get_or_create_state(context: Tuple[int, ...],
                                msg_type: Optional[int] = None) -> int:
            nonlocal state_counter
            if context not in state_map:
                state_id = state_counter
                state_counter += 1
                label = f"S{state_id}"
                if msg_type is not None:
                    label = f"T{msg_type}"
                sm.states[state_id] = State(
                    state_id=state_id,
                    label=label,
                    message_type=msg_type
                )
                state_map[context] = state_id
            return state_map[context]

        start_state = get_or_create_state(tuple(), None)
        sm.start_state = start_state

        for seq in sequences:
            current_state = start_state
            sm.states[current_state].packet_count += 1

            for i, msg_type in enumerate(seq):
                context = tuple(seq[max(0, i - 2):i])
                next_state = get_or_create_state(context + (msg_type,), msg_type)

                if next_state not in sm.states[current_state].outgoing_edges:
                    transition = Transition(
                        from_state=current_state,
                        to_state=next_state,
                        message_type=msg_type
                    )
                    sm.states[current_state].outgoing_edges[next_state] = transition
                    sm.states[next_state].incoming_edges[current_state] = transition
                    sm.transitions.append(transition)
                else:
                    transition = sm.states[current_state].outgoing_edges[next_state]

                transition.count += 1
                sm.states[next_state].packet_count += 1
                current_state = next_state

            sm.end_states.add(current_state)

        for state in sm.states.values():
            total_outgoing = sum(t.count for t in state.outgoing_edges.values())
            for transition in state.outgoing_edges.values():
                if total_outgoing > 0:
                    transition.probability = transition.count / total_outgoing

        return sm

    def infer_state_machine(self, packets: List[bytes],
                            sessions: Optional[List[List[bytes]]] = None
                            ) -> Dict:
        self._packet_to_cluster = self._cluster_packets(packets)

        if sessions is None:
            sessions = self._extract_sessions_from_pcap(packets)

        sequences = self._convert_to_sequences(sessions)

        patterns = self.prefix_span.mine(sequences)

        state_machine = self._build_state_machine(sequences)
        state_machine.patterns = patterns

        return {
            "state_machine": state_machine.to_dict(),
            "frequent_patterns": [p.to_dict() for p in patterns],
            "session_count": len(sessions),
            "unique_message_types": len(set(self._packet_to_cluster.values())),
            "total_packets": len(packets)
        }

    def generate_dot_graph(self, state_machine_dict: Dict,
                           output_file: Optional[str] = None) -> str:
        lines = ['digraph ProtocolStateMachine {']
        lines.append('    rankdir=LR;')
        lines.append('    node [shape=circle, style=filled];')
        lines.append('    compound=true;')
        lines.append('')

        start_state = state_machine_dict.get("start_state")
        end_states = set(state_machine_dict.get("end_states", []))

        for sid_str, state in state_machine_dict.get("states", {}).items():
            sid = int(sid_str)
            label = state.get("label", f"S{sid}")
            count = state.get("packet_count", 0)

            if sid == start_state:
                color = "green"
            elif sid in end_states:
                color = "red"
            else:
                color = "lightblue"

            lines.append(f'    n{sid} [label="{label}\\n({count})", fillcolor={color}];')

        lines.append('')

        for trans in state_machine_dict.get("transitions", []):
            from_s = trans.get("from")
            to_s = trans.get("to")
            msg_type = trans.get("message_type")
            prob = trans.get("probability", 0)
            count = trans.get("count", 0)

            label = f"T{msg_type}\\n{count} ({prob:.2f})"
            if prob > 0.8:
                penwidth = "3.0"
                color = "darkblue"
            elif prob > 0.4:
                penwidth = "2.0"
                color = "blue"
            else:
                penwidth = "1.0"
                color = "gray"

            lines.append(
                f'    n{from_s} -> n{to_s} '
                f'[label="{label}", penwidth={penwidth}, color={color}];'
            )

        lines.append('}')

        dot_content = '\n'.join(lines)

        if output_file:
            with open(output_file, 'w') as f:
                f.write(dot_content)

        return dot_content

    def render_graph(self, dot_content: str, output_file: str,
                     format: str = "png") -> bool:
        try:
            import subprocess
            import tempfile

            with tempfile.NamedTemporaryFile(mode='w', suffix='.dot', delete=False) as f:
                f.write(dot_content)
                dot_path = f.name

            try:
                subprocess.run(
                    ['dot', f'-T{format}', dot_path, '-o', output_file],
                    check=True, capture_output=True
                )
                return True
            finally:
                os.unlink(dot_path)
        except Exception:
            return False

    def find_protocol_patterns(self, packets: List[bytes],
                                min_length: int = 3) -> List[Dict]:
        self._packet_to_cluster = self._cluster_packets(packets)
        sessions = self._extract_sessions_from_pcap(packets)
        sequences = self._convert_to_sequences(sessions)
        patterns = self.prefix_span.mine(sequences)

        return [p.to_dict() for p in patterns if len(p.sequence) >= min_length]
