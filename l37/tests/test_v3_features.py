import unittest
import os
import sys
import json
import tempfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from protocol_reverse_fuzzer.state_machine import (
    PrefixSpan, ProtocolStateMachineInference, Pattern, State, Transition, StateMachine
)


class TestPrefixSpan(unittest.TestCase):
    def test_prefix_span_basic(self):
        sequences = [
            [1, 2, 3, 4],
            [1, 2, 5, 6],
            [1, 2, 3, 7],
            [2, 3, 4, 5]
        ]

        miner = PrefixSpan(min_support=2, max_pattern_length=4)
        patterns = miner.mine(sequences)

        self.assertGreater(len(patterns), 0)

        pattern_12 = [p for p in patterns if p.sequence == [1, 2]]
        self.assertEqual(len(pattern_12), 1)
        self.assertGreaterEqual(pattern_12[0].support, 2)

    def test_prefix_span_empty(self):
        miner = PrefixSpan()
        patterns = miner.mine([])
        self.assertEqual(len(patterns), 0)

    def test_prefix_span_single(self):
        sequences = [[1, 2, 3]]
        miner = PrefixSpan(min_support=1, max_pattern_length=5)
        patterns = miner.mine(sequences)
        self.assertGreater(len(patterns), 0)

    def test_get_patterns_by_length(self):
        sequences = [
            [1, 2, 3],
            [1, 2, 4],
            [2, 3, 5]
        ]
        miner = PrefixSpan(min_support=1, max_pattern_length=3)
        miner.mine(sequences)

        len_2 = miner.get_patterns_by_length(2)
        self.assertGreater(len(len_2), 0)
        for p in len_2:
            self.assertEqual(len(p.sequence), 2)

    def test_get_max_patterns(self):
        sequences = [
            [1, 2, 3, 4],
            [1, 2, 3, 5],
            [1, 2, 6, 7]
        ]
        miner = PrefixSpan(min_support=1, max_pattern_length=4)
        miner.mine(sequences)

        max_p = miner.get_max_patterns(5)
        self.assertLessEqual(len(max_p), 5)


class TestStateMachineInference(unittest.TestCase):
    def setUp(self):
        self.infer = ProtocolStateMachineInference(
            min_support=1,
            min_confidence=0.1
        )

    def test_infer_state_machine_basic(self):
        packets = [
            b'\x01\x02\x03',
            b'\x04\x05\x06',
            b'\x01\x02\x03',
            b'\x04\x05\x06',
            b'\x01\x02\x07'
        ]

        result = self.infer.infer_state_machine(packets)

        self.assertIn("state_machine", result)
        self.assertIn("frequent_patterns", result)
        self.assertGreater(result["state_machine"]["state_count"], 0)
        self.assertGreater(result["state_machine"]["transition_count"], 0)

    def test_infer_empty_packets(self):
        result = self.infer.infer_state_machine([])
        self.assertEqual(result["total_packets"], 0)

    def test_generate_dot_graph(self):
        sm_dict = {
            "states": {
                "0": {"label": "S0", "packet_count": 5},
                "1": {"label": "T1", "packet_count": 3},
            },
            "transitions": [
                {"from": 0, "to": 1, "message_type": 1, "probability": 0.8, "count": 5}
            ],
            "start_state": 0,
            "end_states": [1]
        }

        dot = self.infer.generate_dot_graph(sm_dict)

        self.assertIn("digraph", dot)
        self.assertIn("S0", dot)
        self.assertIn("T1", dot)
        self.assertIn("->", dot)

    def test_generate_dot_graph_with_output(self):
        sm_dict = {
            "states": {
                "0": {"label": "S0", "packet_count": 1},
            },
            "transitions": [],
            "start_state": 0,
            "end_states": []
        }

        with tempfile.NamedTemporaryFile(mode='w', suffix='.dot', delete=False) as f:
            dot_path = f.name

        try:
            dot = self.infer.generate_dot_graph(sm_dict, dot_path)
            self.assertTrue(os.path.exists(dot_path))
        finally:
            if os.path.exists(dot_path):
                os.unlink(dot_path)

    def test_find_protocol_patterns(self):
        packets = [
            b'\x01\x02',
            b'\x03\x04',
            b'\x01\x02',
            b'\x03\x05',
            b'\x01\x06'
        ]

        patterns = self.infer.find_protocol_patterns(packets, min_length=1)
        self.assertGreater(len(patterns), 0)


from protocol_reverse_fuzzer.distributed_fuzzer import (
    TaskStatus, WorkerStatus, FuzzTask, WorkerInfo,
    DistributedFuzzerMaster, DistributedFuzzerWorker
)


class TestFuzzTask(unittest.TestCase):
    def test_task_serialization(self):
        task = FuzzTask(
            task_id="test-123",
            message_data=b'\x01\x02\x03',
            mutation_strategies=["random_bytes", "bit_flip"]
        )

        task_dict = task.to_dict()
        self.assertEqual(task_dict["task_id"], "test-123")
        self.assertIn("message_data", task_dict)

        restored = FuzzTask.from_dict(task_dict)
        self.assertEqual(restored.task_id, "test-123")
        self.assertEqual(restored.message_data, b'\x01\x02\x03')

    def test_task_status_enum(self):
        self.assertEqual(TaskStatus.PENDING.value, "pending")
        self.assertEqual(TaskStatus.COMPLETED.value, "completed")
        self.assertEqual(TaskStatus.CRASHED.value, "crashed")

    def test_worker_info(self):
        info = WorkerInfo(
            worker_id="worker-1",
            hostname="test-host"
        )
        d = info.to_dict()
        self.assertEqual(d["worker_id"], "worker-1")
        self.assertEqual(d["worker_hostname"], "test-host")


class TestDistributedFuzzerNoRedis(unittest.TestCase):
    def test_master_creation(self):
        master = DistributedFuzzerMaster(
            redis_host="localhost",
            redis_port=6379,
            target_host="127.0.0.1",
            target_port=8080
        )
        self.assertIsNotNone(master)
        self.assertEqual(master.target_host, "127.0.0.1")
        self.assertEqual(master.target_port, 8080)

    def test_worker_creation(self):
        worker = DistributedFuzzerWorker(
            redis_host="localhost",
            redis_port=6379,
            worker_id="test-worker",
            target_host="127.0.0.1",
            target_port=8080
        )
        self.assertEqual(worker.worker_id, "test-worker")
        self.assertEqual(worker.target_host, "127.0.0.1")

    def test_redis_not_available(self):
        master = DistributedFuzzerMaster(
            redis_host="nonexistent-host",
            redis_port=9999
        )
        self.assertFalse(master.is_available())


from protocol_reverse_fuzzer.poc_generator import (
    POCGenerationMode, VerificationStatus, CrashReplayer, POCGenerator
)


class TestPOCGenerationMode(unittest.TestCase):
    def test_modes_exist(self):
        self.assertEqual(POCGenerationMode.PYTHON.value, "python")
        self.assertEqual(POCGenerationMode.RUST.value, "rust")
        self.assertEqual(POCGenerationMode.BASH.value, "bash")
        self.assertEqual(POCGenerationMode.POWERSHELL.value, "powershell")


class TestVerificationStatus(unittest.TestCase):
    def test_statuses_exist(self):
        self.assertEqual(VerificationStatus.CONFIRMED.value, "confirmed")
        self.assertEqual(VerificationStatus.PARTIAL.value, "partial")
        self.assertEqual(VerificationStatus.NOT_REPRODUCIBLE.value, "not_reproducible")


class TestCrashReplayer(unittest.TestCase):
    def test_replayer_creation(self):
        replayer = CrashReplayer(
            target_host="127.0.0.1",
            target_port=9999,
            protocol="tcp"
        )
        self.assertEqual(replayer.target_host, "127.0.0.1")
        self.assertEqual(replayer.target_port, 9999)

    def test_replayer_udp(self):
        replayer = CrashReplayer(
            target_host="127.0.0.1",
            target_port=9999,
            protocol="udp"
        )
        self.assertEqual(replayer.protocol, "udp")


class TestPOCGenerator(unittest.TestCase):
    def setUp(self):
        self.generator = POCGenerator(
            target_host="127.0.0.1",
            target_port=8080,
            protocol="tcp"
        )

    def test_generate_python_poc(self):
        payload = b'\x01\x02\x03\x04'
        poc = self.generator.generate_poc(
            payload=payload,
            mode=POCGenerationMode.PYTHON,
            description="Test exploit"
        )

        self.assertIn("#!/usr/bin/env python3", poc)
        self.assertIn("127.0.0.1", poc)
        self.assertIn("8080", poc)
        self.assertIn("socket", poc)

    def test_generate_rust_poc(self):
        payload = b'\x01\x02\x03\x04'
        poc = self.generator.generate_poc(
            payload=payload,
            mode=POCGenerationMode.RUST
        )

        self.assertIn("// Exploit POC", poc)
        self.assertIn("TcpStream", poc)

    def test_generate_bash_poc(self):
        payload = b'\x01\x02\x03\x04'
        poc = self.generator.generate_poc(
            payload=payload,
            mode=POCGenerationMode.BASH
        )

        self.assertIn("#!/bin/bash", poc)
        self.assertIn("nc", poc)

    def test_generate_powershell_poc(self):
        payload = b'\x01\x02\x03\x04'
        poc = self.generator.generate_poc(
            payload=payload,
            mode=POCGenerationMode.POWERSHELL
        )

        self.assertIn("TcpClient", poc)

    def test_save_poc(self):
        payload = b'\x01\x02\x03\x04'

        with tempfile.NamedTemporaryFile(mode='w', suffix='.py', delete=False) as f:
            output_file = f.name

        try:
            result = self.generator.save_poc(
                payload=payload,
                output_file=output_file,
                mode=POCGenerationMode.PYTHON
            )
            self.assertEqual(result, output_file)
            self.assertTrue(os.path.exists(output_file))

            with open(output_file, 'r') as f:
                content = f.read()
            self.assertIn("python3", content)
        finally:
            if os.path.exists(output_file):
                os.unlink(output_file)

    def test_generate_sequence_poc(self):
        sequence = [b'\x01\x02', b'\x03\x04', b'\x05\x06']
        poc = self.generator.generate_sequence_poc(
            payload_sequence=sequence,
            mode=POCGenerationMode.PYTHON,
            delay_between=0.5
        )

        self.assertIn("PAYLOAD_SEQUENCE", poc)
        self.assertIn("exploit_sequence", poc)
        self.assertIn("time.sleep", poc)

    def test_default_mode(self):
        payload = b'\x01\x02\x03'
        poc = self.generator.generate_poc(payload)
        self.assertIn("python", poc.lower())


class TestDataClasses(unittest.TestCase):
    def test_pattern_to_dict(self):
        pattern = Pattern(
            sequence=[1, 2, 3],
            support=5,
            confidence=0.75
        )
        d = pattern.to_dict()
        self.assertEqual(d["sequence"], [1, 2, 3])
        self.assertEqual(d["support"], 5)
        self.assertAlmostEqual(d["confidence"], 0.75, places=4)

    def test_state_to_dict(self):
        state = State(
            state_id=1,
            label="T1",
            message_type=1,
            packet_count=42
        )
        d = state.to_dict()
        self.assertEqual(d["state_id"], 1)
        self.assertEqual(d["label"], "T1")
        self.assertEqual(d["packet_count"], 42)

    def test_transition_to_dict(self):
        trans = Transition(
            from_state=0,
            to_state=1,
            message_type=1,
            count=10,
            probability=0.5
        )
        d = trans.to_dict()
        self.assertEqual(d["from"], 0)
        self.assertEqual(d["to"], 1)
        self.assertEqual(d["count"], 10)
        self.assertAlmostEqual(d["probability"], 0.5)

    def test_state_machine_to_dict(self):
        sm = StateMachine()
        sm.start_state = 0
        sm.end_states.add(1)

        d = sm.to_dict()
        self.assertIn("states", d)
        self.assertIn("transitions", d)
        self.assertEqual(d["start_state"], 0)


if __name__ == '__main__':
    unittest.main()
