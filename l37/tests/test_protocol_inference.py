#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
协议推断模块单元测试
"""

import sys
import os
import unittest
import struct
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from protocol_reverse_fuzzer.protocol_inference import (
    calculate_byte_entropy,
    sliding_window_entropy,
    multiple_sequence_alignment,
    calculate_position_entropies,
    detect_boundaries_from_entropy,
    analyze_field_type,
    ProtocolInference,
    Field
)


class TestEntropyCalculation(unittest.TestCase):
    """测试熵值计算函数"""
    
    def test_zero_entropy(self):
        """测试常量数据的熵值"""
        data = [0x00] * 100
        entropy = calculate_byte_entropy(data)
        self.assertEqual(entropy, 0.0)
    
    def test_max_entropy(self):
        """测试随机数据的熵值"""
        data = list(range(256))
        entropy = calculate_byte_entropy(data)
        self.assertAlmostEqual(entropy, 8.0, delta=0.1)
    
    def test_sliding_window(self):
        """测试滑动窗口熵值"""
        data = bytes([0x00] * 50) + bytes([0xFF] * 50)
        entropies = sliding_window_entropy(data, window_size=10)
        self.assertEqual(len(entropies), len(data))
        self.assertAlmostEqual(entropies[0], 0.0, delta=0.1)
        self.assertAlmostEqual(entropies[-1], 0.0, delta=0.1)
        self.assertGreater(entropies[49], 0.0)
    
    def test_multiple_sequence_alignment(self):
        """测试多序列对齐"""
        packets = [
            b'\x01\x02\x03\x04',
            b'\x01\x02\x05',
            b'\x01\x02\x03\x04\x05'
        ]
        aligned = multiple_sequence_alignment(packets)
        self.assertEqual(aligned.shape[0], 3)
        self.assertEqual(aligned.shape[1], 5)
        self.assertEqual(aligned[0, 0], 0x01)
        self.assertEqual(aligned[1, 3], -1)
    
    def test_position_entropies(self):
        """测试位置熵值计算"""
        packets = [
            b'\x01\x02\x03\x04',
            b'\x01\x02\x05\x06',
            b'\x01\x02\x07\x08'
        ]
        aligned = multiple_sequence_alignment(packets)
        entropies = calculate_position_entropies(aligned)
        self.assertEqual(len(entropies), 4)
        self.assertEqual(entropies[0], 0.0)
        self.assertEqual(entropies[1], 0.0)
        self.assertGreater(entropies[2], 0.0)


class TestBoundaryDetection(unittest.TestCase):
    """测试边界检测函数"""
    
    def test_simple_boundary(self):
        """测试简单的边界检测"""
        entropies = np.array([0.0, 0.0, 7.0, 7.0, 7.0, 0.0, 0.0, 0.0])
        boundaries = detect_boundaries_from_entropy(entropies, threshold=0.5)
        self.assertIsInstance(boundaries, list)
        self.assertGreater(len(boundaries), 0)
        
        offsets = [b[0] for b in boundaries]
        lengths = [b[1] for b in boundaries]
        self.assertIn(0, offsets)
        self.assertIn(2, offsets)
        self.assertIn(5, offsets)
    
    def test_no_boundary(self):
        """测试无边界情况"""
        entropies = np.array([0.0, 0.0, 0.0, 0.0])
        boundaries = detect_boundaries_from_entropy(entropies, threshold=0.5)
        self.assertEqual(len(boundaries), 1)
        self.assertEqual(boundaries[0], (0, 4))
    
    def test_boundary_with_params(self):
        """测试带参数的边界检测"""
        entropies = np.array([0.0, 0.0, 7.0, 7.0, 7.0, 0.0, 0.0])
        boundaries = detect_boundaries_from_entropy(
            entropies, threshold=0.5, min_field_length=2, max_field_length=4)
        
        offsets = [b[0] for b in boundaries]
        self.assertIn(0, offsets)
        self.assertIn(2, offsets)
        self.assertIn(5, offsets)


class TestFieldTypeAnalysis(unittest.TestCase):
    """测试字段类型分析"""
    
    def test_constant_field(self):
        """测试常量字段"""
        packets = [b'\x01\x00' + bytes([i]) for i in range(10)]
        aligned = multiple_sequence_alignment(packets)
        entropies = calculate_position_entropies(aligned)
        
        field_type, is_fixed, is_length, is_checksum = analyze_field_type(
            aligned, offset=0, length=2, entropies=entropies)
        
        self.assertTrue(is_fixed)
        self.assertIn(field_type, ['constant', 'low_entropy'])
    
    def test_variable_field(self):
        """测试可变字段"""
        packets = [b'\x01' + bytes([i]) for i in range(10)]
        aligned = multiple_sequence_alignment(packets)
        entropies = calculate_position_entropies(aligned)
        
        field_type, is_fixed, is_length, is_checksum = analyze_field_type(
            aligned, offset=1, length=1, entropies=entropies)
        
        self.assertFalse(is_fixed)
    
    def test_ascii_string_field(self):
        """测试ASCII字符串字段"""
        packets = [b'hello', b'world', b'test!']
        aligned = multiple_sequence_alignment(packets)
        entropies = calculate_position_entropies(aligned)
        
        field_type, _, _, _ = analyze_field_type(
            aligned, offset=0, length=5, entropies=entropies)
        
        self.assertIn(field_type, ['ascii_string', 'binary_data', 'high_entropy_data'])


class TestFieldDataclass(unittest.TestCase):
    """测试Field数据类"""
    
    def test_field_creation(self):
        """测试字段创建"""
        field = Field(
            name="test_field",
            offset=0,
            length=4,
            field_type="constant",
            entropy=0.0,
            values=[b'\x00\x00\x00\x00'],
            is_fixed=True
        )
        
        self.assertEqual(field.name, "test_field")
        self.assertEqual(field.offset, 0)
        self.assertEqual(field.length, 4)
        self.assertTrue(field.is_fixed)
    
    def test_field_to_dict(self):
        """测试字段转换为字典"""
        field = Field(
            name="length",
            offset=0,
            length=2,
            field_type="length",
            entropy=1.5,
            values=[b'\x00\x10', b'\x00\x20'],
            is_length=True
        )
        
        d = field.to_dict()
        self.assertEqual(d['name'], 'length')
        self.assertEqual(d['offset'], 0)
        self.assertEqual(d['length'], 2)
        self.assertEqual(d['type'], 'length')
        self.assertTrue(d['is_length'])


class TestProtocolInference(unittest.TestCase):
    """测试协议推断类"""
    
    def setUp(self):
        """设置测试数据"""
        self.cluster1_packets = []
        self.cluster2_packets = []
        
        for i in range(50):
            length = struct.pack('>H', 16 + i % 10)
            msg_type = b'\x01\x00'
            seq = struct.pack('>I', i)
            payload = bytes([0x41 + i % 26]) * (6 + i % 5)
            data = length + msg_type + seq + payload
            self.cluster1_packets.append(data)
        
        for i in range(30):
            length = struct.pack('>H', 12)
            msg_type = b'\x02\x00'
            status = b'\x00' if i % 2 else b'\x01'
            response = b'OK' * 4
            data = length + msg_type + status + response
            self.cluster2_packets.append(data)
        
        self.clusters = {
            0: type('Cluster', (), {
                'cluster_id': 0,
                'packets': self.cluster1_packets,
                'representative': self.cluster1_packets[0]
            })(),
            1: type('Cluster', (), {
                'cluster_id': 1,
                'packets': self.cluster2_packets,
                'representative': self.cluster2_packets[0]
            })()
        }
    
    def test_infer_protocol(self):
        """测试协议推断"""
        inference = ProtocolInference()
        fields = inference.infer(self.cluster1_packets)
        
        self.assertIsInstance(fields, list)
        self.assertGreater(len(fields), 0)
        for field in fields:
            self.assertIsInstance(field, Field)
    
    def test_infer_multiple_clusters(self):
        """测试多聚类协议推断"""
        inference1 = ProtocolInference()
        fields1 = inference1.infer(self.cluster1_packets)
        
        inference2 = ProtocolInference()
        fields2 = inference2.infer(self.cluster2_packets)
        
        self.assertGreater(len(fields1), 0)
        self.assertGreater(len(fields2), 0)
    
    def test_get_entropy_profile(self):
        """测试获取熵值分布"""
        inference = ProtocolInference()
        inference.infer(self.cluster1_packets)
        
        profile = inference.get_entropy_profile()
        self.assertIn('positions', profile)
        self.assertIn('entropies', profile)
        self.assertEqual(len(profile['positions']), len(profile['entropies']))
    
    def test_visualize_fields(self):
        """测试字段可视化"""
        inference = ProtocolInference()
        inference.infer(self.cluster1_packets)
        
        visualization = inference.visualize_fields(self.cluster1_packets[0])
        self.assertIsInstance(visualization, str)
        self.assertGreater(len(visualization), 0)
        self.assertIn('\n', visualization)
    
    def test_field_count(self):
        """测试字段数量"""
        inference = ProtocolInference()
        fields = inference.infer(self.cluster1_packets)
        
        self.assertGreater(len(fields), 0)
        self.assertIsInstance(fields, list)
    
    def test_infer_with_noise_threshold(self):
        """测试带噪声阈值的推断"""
        inference = ProtocolInference(
            entropy_threshold=0.3,
            min_field_length=2,
            max_field_length=32
        )
        fields = inference.infer(self.cluster1_packets)
        
        self.assertIsInstance(fields, list)
        self.assertGreater(len(fields), 0)
    
    def test_infer_single_packet(self):
        """测试单报文推断"""
        inference = ProtocolInference()
        fields = inference.infer([self.cluster1_packets[0]])
        
        self.assertIsInstance(fields, list)
        self.assertGreater(len(fields), 0)
    
    def test_infer_empty(self):
        """测试空报文列表推断"""
        inference = ProtocolInference()
        fields = inference.infer([])
        
        self.assertEqual(fields, [])


if __name__ == '__main__':
    unittest.main()
