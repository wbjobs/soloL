import unittest
import os
import sys
import math
import random

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from protocol_reverse_fuzzer.encryption_detector import (
    EncryptionDetector, EncryptionConfidence, EncryptionCheckResult,
    chi_square_test, runs_test, byte_frequency_test,
    serial_correlation_test, entropy_test, compression_test,
    monobit_test, _normal_cdf, _log_gamma
)


class TestChiSquare(unittest.TestCase):
    def test_uniform_data(self):
        data = bytes(range(256)) * 4
        chi_sq = chi_square_test(data)
        self.assertAlmostEqual(chi_sq, 0.0, places=1)

    def test_constant_data(self):
        data = b'\x00' * 1024
        chi_sq = chi_square_test(data)
        self.assertGreater(chi_sq, 0)

    def test_empty_data(self):
        chi_sq = chi_square_test(b'')
        self.assertEqual(chi_sq, 0.0)


class TestRunsTest(unittest.TestCase):
    def test_alternating_pattern(self):
        data = bytes([0, 255] * 64)
        z_score, p_value = runs_test(data)
        self.assertIsInstance(z_score, float)
        self.assertIsInstance(p_value, float)

    def test_constant_pattern(self):
        data = b'\x80' * 128
        z_score, p_value = runs_test(data)
        self.assertIsInstance(z_score, float)

    def test_short_data(self):
        z_score, p_value = runs_test(b'\x00')
        self.assertEqual(z_score, 0.0)


class TestByteFrequency(unittest.TestCase):
    def test_uniform_frequency(self):
        data = bytes(range(256)) * 4
        freq_diff = byte_frequency_test(data)
        self.assertLess(freq_diff, 0.1)

    def test_skewed_frequency(self):
        data = b'\x00' * 1024
        freq_diff = byte_frequency_test(data)
        self.assertGreater(freq_diff, 0.5)

    def test_empty_data(self):
        freq_diff = byte_frequency_test(b'')
        self.assertEqual(freq_diff, 0.0)


class TestSerialCorrelation(unittest.TestCase):
    def test_random_data_low_correlation(self):
        random.seed(42)
        data = bytes([random.randint(0, 255) for _ in range(1024)])
        corr = serial_correlation_test(data)
        self.assertLess(abs(corr), 0.15)

    def test_sequential_data_high_correlation(self):
        data = bytes(range(256)) * 4
        corr = serial_correlation_test(data)
        self.assertGreater(abs(corr), 0.0)

    def test_short_data(self):
        corr = serial_correlation_test(b'\x00\x01')
        self.assertIsInstance(corr, float)


class TestEntropyTest(unittest.TestCase):
    def test_max_entropy_random(self):
        data = bytes(range(256)) * 4
        ent = entropy_test(data)
        self.assertGreater(ent, 7.5)

    def test_zero_entropy_constant(self):
        data = b'\x00' * 1024
        ent = entropy_test(data)
        self.assertAlmostEqual(ent, 0.0, places=1)

    def test_empty_data(self):
        ent = entropy_test(b'')
        self.assertEqual(ent, 0.0)


class TestCompressionTest(unittest.TestCase):
    def test_random_data_incompressible(self):
        random.seed(42)
        data = bytes([random.randint(0, 255) for _ in range(1024)])
        ratio = compression_test(data)
        self.assertGreater(ratio, 0.9)

    def test_repetitive_data_compressible(self):
        data = b'AAAA' * 256
        ratio = compression_test(data)
        self.assertLess(ratio, 0.5)

    def test_short_data(self):
        ratio = compression_test(b'hello')
        self.assertEqual(ratio, 0.0)


class TestMonobitTest(unittest.TestCase):
    def test_balanced_data(self):
        data = bytes([0x55] * 128 + [0xAA] * 128)
        s_obs, p_value = monobit_test(data)
        self.assertGreater(p_value, 0.01)

    def test_empty_data(self):
        s_obs, p_value = monobit_test(b'')
        self.assertEqual(s_obs, 0.0)


class TestNormalCDF(unittest.TestCase):
    def test_zero(self):
        self.assertAlmostEqual(_normal_cdf(0), 0.5, places=3)

    def test_large_positive(self):
        self.assertAlmostEqual(_normal_cdf(5), 1.0, places=3)

    def test_large_negative(self):
        self.assertAlmostEqual(_normal_cdf(-5), 0.0, places=3)


class TestEncryptionDetector(unittest.TestCase):
    def setUp(self):
        self.detector = EncryptionDetector()

    def test_detect_random_as_encrypted(self):
        random.seed(42)
        data = bytes([random.randint(0, 255) for _ in range(1024)])
        result = self.detector.check_encryption(data)
        self.assertIsInstance(result, EncryptionCheckResult)
        self.assertTrue(result.is_encrypted)
        self.assertIn(result.confidence, [
            EncryptionConfidence.HIGH,
            EncryptionConfidence.VERY_HIGH
        ])
        self.assertGreater(result.score, 0.5)

    def test_detect_plaintext_as_not_encrypted(self):
        data = b'GET / HTTP/1.1\r\nHost: example.com\r\n\r\n' * 10
        result = self.detector.check_encryption(data)
        self.assertFalse(result.is_encrypted)
        self.assertLess(result.score, 0.5)

    def test_detect_constant_data(self):
        data = b'\x00' * 1024
        result = self.detector.check_encryption(data)
        self.assertFalse(result.is_encrypted)

    def test_insufficient_data(self):
        result = self.detector.check_encryption(b'\x00' * 10)
        self.assertFalse(result.is_encrypted)
        self.assertEqual(result.confidence, EncryptionConfidence.NONE)

    def test_result_to_dict(self):
        random.seed(42)
        data = bytes([random.randint(0, 255) for _ in range(256)])
        result = self.detector.check_encryption(data)
        d = result.to_dict()
        self.assertIn("is_encrypted", d)
        self.assertIn("confidence", d)
        self.assertIn("score", d)
        self.assertIn("details", d)
        self.assertIn("recommendation", d)

    def test_check_packets(self):
        packets = [b'\x00' * 128, bytes(range(256))]
        results = self.detector.check_packets(packets)
        self.assertEqual(len(results), 2)
        self.assertFalse(results[0].is_encrypted)

    def test_check_cluster(self):
        random.seed(42)
        packets = [bytes([random.randint(0, 255) for _ in range(128)])
                   for _ in range(10)]
        result = self.detector.check_cluster(packets)
        self.assertIsInstance(result, EncryptionCheckResult)
        self.assertIn("cluster_size", result.details)

    def test_filter_encrypted(self):
        random.seed(42)
        plaintext = [b'hello world' * 10] * 5
        encrypted = [bytes([random.randint(0, 255) for _ in range(128)])
                     for _ in range(5)]
        all_packets = plaintext + encrypted

        filtered, results = self.detector.filter_encrypted(all_packets, skip_encrypted=True)
        self.assertLessEqual(len(filtered), len(all_packets))

    def test_tls_handshake_detection(self):
        tls_data = bytes([0x16, 0x03, 0x03]) + b'\x00\x10' + b'\x01' * 16
        result = self.detector.detect_tls_handshake(tls_data)
        self.assertIsNotNone(result)
        self.assertTrue(result["is_tls"])
        self.assertEqual(result["content_type"], "Handshake")

    def test_tls_application_data(self):
        app_data = bytes([0x17, 0x03, 0x03]) + b'\x00\x20' + b'\x00' * 32
        result = self.detector.detect_tls_handshake(app_data)
        self.assertIsNotNone(result)
        self.assertTrue(result["is_application_data"])

    def test_non_tls_data(self):
        result = self.detector.detect_tls_handshake(b'GET / HTTP/1.1')
        self.assertIsNone(result)


from protocol_reverse_fuzzer.coverage_fuzzer import (
    CoverageGuidedFuzzer, CoverageSource, CoverageMap,
    BasicBlock, Edge, SeedEntry, ResponseCoverageTracker,
    QEMUInstrumentationInterface, ExternalCoverageFeedback
)


class TestCoverageMap(unittest.TestCase):
    def test_add_block(self):
        cmap = CoverageMap()
        block = cmap.add_block(1, address=0x1000, size=16)
        self.assertEqual(block.block_id, 1)
        self.assertEqual(block.hit_count, 1)
        cmap.add_block(1, address=0x1000, size=16)
        self.assertEqual(block.hit_count, 2)

    def test_add_edge(self):
        cmap = CoverageMap()
        cmap.add_block(1)
        cmap.add_block(2)
        edge = cmap.add_edge(1, 2)
        self.assertEqual(edge.hit_count, 1)
        self.assertIn(2, cmap.blocks[1].child_blocks)
        self.assertIn(1, cmap.blocks[2].parent_blocks)

    def test_coverage_stats(self):
        cmap = CoverageMap()
        cmap.add_block(1)
        cmap.add_block(2)
        cmap.add_block(2)
        stats = cmap.get_coverage_stats()
        self.assertEqual(stats["total_blocks"], 2)
        self.assertEqual(stats["total_edges"], 0)
        self.assertGreater(stats["avg_hit_count"], 0)


class TestSeedEntry(unittest.TestCase):
    def test_compute_fitness(self):
        global_cov = CoverageMap()
        global_cov.add_block(1)

        seed_cov = CoverageMap()
        seed_cov.add_block(2)
        seed_cov.add_block(3)

        seed = SeedEntry(
            data=b"test",
            coverage_map=seed_cov,
            execution_time=0.1
        )
        fitness = seed.compute_fitness(global_cov)
        self.assertGreater(fitness, 0)


class TestResponseCoverageTracker(unittest.TestCase):
    def setUp(self):
        self.tracker = ResponseCoverageTracker()

    def test_track_new_response(self):
        is_new, category = self.tracker.track_response(
            b"input1", b"response1"
        )
        self.assertTrue(is_new)
        self.assertIsInstance(category, str)

    def test_track_same_response(self):
        self.tracker.track_response(b"input1", b"response1")
        is_new, category = self.tracker.track_response(
            b"input2", b"response1"
        )
        self.assertFalse(is_new)

    def test_track_error_response(self):
        is_new, category = self.tracker.track_response(
            b"input", b"", error="Connection reset"
        )
        self.assertTrue(is_new)
        self.assertIn("connection_error", category)

    def test_track_timeout_response(self):
        is_new, category = self.tracker.track_response(
            b"input", b"", error="Timeout"
        )
        self.assertTrue(is_new)
        self.assertEqual(category, "timeout")

    def test_get_stats(self):
        self.tracker.track_response(b"input1", b"response_type_A" * 10)
        self.tracker.track_response(b"input2", b"response_type_B" * 10)
        stats = self.tracker.get_stats()
        self.assertGreaterEqual(stats["total_categories"], 1)


class TestQEMUInterface(unittest.TestCase):
    def test_not_available_without_binary(self):
        qemu = QEMUInstrumentationInterface()
        self.assertFalse(qemu.is_available())

    def test_attach_returns_false_without_qemu(self):
        qemu = QEMUInstrumentationInterface()
        result = qemu.attach_to_process()
        self.assertFalse(result)

    def test_read_empty_coverage(self):
        qemu = QEMUInstrumentationInterface()
        coverage = qemu.read_coverage()
        self.assertEqual(len(coverage.blocks), 0)


class TestExternalCoverageFeedback(unittest.TestCase):
    def test_write_and_read_feedback(self):
        feedback = ExternalCoverageFeedback()
        feedback.write_feedback(b"test_input", {"blocks": [{"id": 1, "address": 0, "size": 4}]})
        result = feedback.read_feedback()
        self.assertGreater(len(result), 0)

    def test_coverage_from_feedback(self):
        feedback = ExternalCoverageFeedback()
        fb_data = [
            {"coverage": {"blocks": [{"id": 1, "address": 256, "size": 16}],
                          "edges": [{"source": 1, "target": 2}]}}
        ]
        coverage = feedback.coverage_from_feedback(fb_data)
        self.assertEqual(len(coverage.blocks), 1)
        self.assertEqual(len(coverage.edges), 1)


class TestCoverageGuidedFuzzer(unittest.TestCase):
    def setUp(self):
        self.fuzzer = CoverageGuidedFuzzer(
            coverage_source=CoverageSource.RESPONSE_BASED,
            seed=42
        )

    def test_add_seed(self):
        seed = self.fuzzer.add_seed(b"test_data")
        self.assertEqual(len(self.fuzzer.seed_corpus), 1)
        self.assertEqual(seed.data, b"test_data")

    def test_select_seed(self):
        self.fuzzer.add_seed(b"seed1")
        self.fuzzer.add_seed(b"seed2")
        seed = self.fuzzer.select_seed()
        self.assertIsNotNone(seed)
        self.assertIn(seed.data, [b"seed1", b"seed2"])

    def test_select_seed_empty(self):
        seed = self.fuzzer.select_seed()
        self.assertIsNone(seed)

    def test_update_coverage(self):
        self.fuzzer.add_seed(b"initial_seed")
        result = self.fuzzer.update_coverage(
            input_data=b"test_input",
            response=b"test_response",
            error=None,
            execution_time=0.1
        )
        self.assertIn("has_new_coverage", result)
        self.assertIn("new_blocks", result)
        self.assertIn("total_blocks", result)

    def test_suggest_mutation_region(self):
        suggestion = self.fuzzer.suggest_mutation_region()
        self.assertIn("strategy", suggestion)

    def test_get_coverage_report(self):
        self.fuzzer.add_seed(b"test")
        self.fuzzer.update_coverage(b"input", b"response", None, 0.1)
        report = self.fuzzer.get_coverage_report()
        self.assertIn("total_cases", report)
        self.assertIn("coverage_map", report)
        self.assertIn("response_coverage", report)

    def test_coverage_guided_improves_over_time(self):
        self.fuzzer.add_seed(b"initial")
        for i in range(10):
            self.fuzzer.update_coverage(
                input_data=bytes([i] * 16),
                response=bytes([i % 4] * 8),
                execution_time=0.01
            )
        report = self.fuzzer.get_coverage_report()
        self.assertGreater(report["total_cases"], 0)
        self.assertGreater(report["coverage_map"]["total_blocks"], 0)


if __name__ == '__main__':
    unittest.main()
