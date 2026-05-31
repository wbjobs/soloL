#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
模糊测试模块单元测试
"""

import sys
import os
import unittest
import random
import struct

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from protocol_reverse_fuzzer.fuzzer import (
    MutationStrategy,
    FuzzingPhase,
    Mutator,
    Fuzzer,
    FuzzCase
)
from protocol_reverse_fuzzer.protocol_description import MessageType


class TestMutationStrategy(unittest.TestCase):
    """测试变异策略枚举"""
    
    def test_strategy_values(self):
        """测试策略枚举值"""
        self.assertEqual(MutationStrategy.BIT_FLIP.value, 'bit_flip')
        self.assertEqual(MutationStrategy.BOUNDARY_VALUE.value, 'boundary_value')
        self.assertEqual(MutationStrategy.RANDOM_BYTES.value, 'random_bytes')
        self.assertEqual(MutationStrategy.ARITHMETIC.value, 'arithmetic')
        self.assertEqual(MutationStrategy.INTERESTING_VALUES.value, 'interesting_values')
        self.assertEqual(MutationStrategy.BLOCK_OPERATION.value, 'block_operation')


class TestMutator(unittest.TestCase):
    """测试变异器"""
    
    def setUp(self):
        """设置测试数据"""
        random.seed(42)
        self.mutator = Mutator(seed=42)
        self.test_data = b'\x01\x02\x03\x04\x05\x06\x07\x08'
    
    def test_bit_flip(self):
        """测试位翻转变异"""
        mutated, details = self.mutator.bit_flip(self.test_data, bit_position=0, num_bits=3)
        self.assertEqual(len(mutated), len(self.test_data))
        self.assertNotEqual(mutated, self.test_data)
        self.assertIn('flipped_bits', details)
    
    def test_bit_flip_single(self):
        """测试单位翻转"""
        mutated, details = self.mutator.bit_flip(self.test_data, bit_position=0, num_bits=1)
        diff_count = sum(1 for a, b in zip(mutated, self.test_data) if a != b)
        self.assertEqual(diff_count, 1)
        self.assertEqual(len(details['flipped_bits']), 1)
    
    def test_boundary_value(self):
        """测试边界值变异"""
        mutated, details = self.mutator.boundary_value(self.test_data, offset=0, length=2)
        self.assertEqual(len(mutated), len(self.test_data))
        self.assertIn('boundary_value', details)
        self.assertIn('offset', details)
        self.assertIn('length', details)
    
    def test_boundary_value_1byte(self):
        """测试1字节边界值"""
        mutated, details = self.mutator.boundary_value(self.test_data, offset=0, length=1)
        self.assertEqual(len(mutated), len(self.test_data))
        self.assertIn(details['boundary_value'], [0x00, 0x01, 0xFE, 0xFF, 0x7F, 0x80])
    
    def test_random_bytes(self):
        """测试随机字节变异"""
        mutated, details = self.mutator.random_bytes(self.test_data, offset=2, length=3)
        self.assertEqual(len(mutated), len(self.test_data))
        self.assertNotEqual(mutated, self.test_data)
        self.assertEqual(details['offset'], 2)
        self.assertEqual(details['length'], 3)
    
    def test_random_bytes_random_offset(self):
        """测试随机偏移的随机字节"""
        mutated, details = self.mutator.random_bytes(self.test_data)
        self.assertEqual(len(mutated), len(self.test_data))
        self.assertIn('offset', details)
        self.assertIn('length', details)
    
    def test_interesting_value(self):
        """测试有趣值变异"""
        mutated, details = self.mutator.interesting_value(self.test_data, offset=0, length=2)
        self.assertEqual(len(mutated), len(self.test_data))
        self.assertIn('value', details)
    
    def test_block_operation_delete(self):
        """测试块删除操作"""
        original_len = len(self.test_data)
        mutated, details = self.mutator.block_operation(self.test_data, operation='delete', offset=2, length=3)
        self.assertEqual(len(mutated), original_len - 3)
        self.assertEqual(details['operation'], 'delete')
    
    def test_block_operation_duplicate(self):
        """测试块复制操作"""
        original_len = len(self.test_data)
        mutated, details = self.mutator.block_operation(self.test_data, operation='duplicate', offset=2, length=3)
        self.assertEqual(len(mutated), original_len + 3)
        self.assertEqual(details['operation'], 'duplicate')
    
    def test_block_operation_overwrite(self):
        """测试块覆盖操作"""
        mutated, details = self.mutator.block_operation(self.test_data, operation='overwrite', offset=0, length=2)
        self.assertEqual(len(mutated), len(self.test_data))
        self.assertEqual(details['operation'], 'overwrite')
    
    def test_arithmetic_mutation(self):
        """测试算术变异"""
        data = struct.pack('>I', 1000)
        mutated, details = self.mutator.arithmetic(data, offset=0, length=4)
        self.assertEqual(len(mutated), len(data))
        value = struct.unpack('>I', mutated)[0]
        self.assertNotEqual(value, 1000)
        self.assertIn('delta', details)
    
    def test_mutate_random(self):
        """测试随机变异"""
        mutated, details, strategy = self.mutator.mutate_random(self.test_data)
        self.assertIsInstance(strategy, MutationStrategy)
        self.assertIn(strategy, list(MutationStrategy))
    
    def test_mutate_random_with_strategy(self):
        """测试指定策略的随机变异"""
        mutated, details, strategy = self.mutator.mutate_random(
            self.test_data, strategy=MutationStrategy.BIT_FLIP)
        self.assertEqual(strategy, MutationStrategy.BIT_FLIP)
    
    def test_interesting_values_list(self):
        """测试有趣值列表"""
        self.assertIsInstance(self.mutator.interesting_values, list)
        self.assertIn(0, self.mutator.interesting_values)
        self.assertIn(0xFF, self.mutator.interesting_values)
        self.assertIn(0xFFFFFFFF, self.mutator.interesting_values)


class TestFuzzCase(unittest.TestCase):
    """测试测试用例"""
    
    def test_fuzz_case_creation(self):
        """测试测试用例创建"""
        case = FuzzCase(
            case_id=1,
            original_data=b'\x01\x02\x03',
            mutated_data=b'\x01\x03\x03',
            mutation_strategy=MutationStrategy.BIT_FLIP,
            message_type='test'
        )
        
        self.assertEqual(case.case_id, 1)
        self.assertEqual(case.original_data, b'\x01\x02\x03')
        self.assertEqual(case.mutated_data, b'\x01\x03\x03')
        self.assertEqual(case.mutation_strategy, MutationStrategy.BIT_FLIP)
        self.assertEqual(case.message_type, 'test')
        self.assertFalse(case.has_crashed)
    
    def test_fuzz_case_to_dict(self):
        """测试测试用例转换为字典"""
        case = FuzzCase(
            case_id=1,
            original_data=b'\x01\x02\x03',
            mutated_data=b'\x01\x03\x03',
            mutation_strategy=MutationStrategy.RANDOM_BYTES,
            message_type='test'
        )
        
        d = case.to_dict()
        self.assertEqual(d['case_id'], 1)
        self.assertEqual(d['message_type'], 'test')
        self.assertEqual(d['original_hex'], '010203')
        self.assertEqual(d['mutated_hex'], '010303')
        self.assertEqual(d['mutation_strategy'], 'random_bytes')
        self.assertFalse(d['has_crashed'])


class TestFuzzer(unittest.TestCase):
    """测试模糊测试器"""
    
    def setUp(self):
        """设置测试数据"""
        self.message_types = [
            MessageType(
                name='Request',
                cluster_id=0,
                representative=b'\x00\x01\x00\x10\x00\x00\x00\x01Hello',
                fields=[]
            ),
            MessageType(
                name='Response',
                cluster_id=1,
                representative=b'\x00\x02\x00\x0c\x00\x00\x00\x01OK',
                fields=[]
            )
        ]
        
        self.fuzzer = Fuzzer(
            target_host='127.0.0.1',
            target_port=9999,
            protocol='tcp',
            timeout=5.0,
            seed=42
        )
    
    def test_fuzzer_initialization(self):
        """测试模糊测试器初始化"""
        self.assertEqual(self.fuzzer.target_host, '127.0.0.1')
        self.assertEqual(self.fuzzer.target_port, 9999)
        self.assertEqual(self.fuzzer.protocol, 'tcp')
        self.assertEqual(self.fuzzer.phase, FuzzingPhase.INIT)
        self.assertIsInstance(self.fuzzer.mutator, Mutator)
    
    def test_load_templates(self):
        """测试加载模板"""
        self.fuzzer.load_templates(self.message_types)
        self.assertEqual(len(self.fuzzer.message_templates), 2)
        self.assertEqual(self.fuzzer.message_templates[0].name, 'Request')
    
    def test_set_strategy_weights(self):
        """测试设置策略权重"""
        weights = {
            MutationStrategy.BIT_FLIP: 10,
            MutationStrategy.RANDOM_BYTES: 1
        }
        self.fuzzer.set_strategy_weights(weights)
        
        selected = []
        for _ in range(100):
            selected.append(self.fuzzer._select_strategy())
        
        bit_flip_count = selected.count(MutationStrategy.BIT_FLIP)
        self.assertGreater(bit_flip_count, 50)
    
    def test_generate_case(self):
        """测试生成测试用例"""
        self.fuzzer.load_templates(self.message_types)
        
        case = self.fuzzer._generate_case(
            case_id=1,
            message_type=self.message_types[0]
        )
        
        self.assertIsInstance(case, FuzzCase)
        self.assertEqual(case.case_id, 1)
        self.assertEqual(case.message_type, 'Request')
        self.assertIsInstance(case.mutation_strategy, MutationStrategy)
        self.assertNotEqual(case.mutated_data, case.original_data)
    
    def test_get_stats(self):
        """测试获取统计信息"""
        self.fuzzer._stats['total_cases'] = 100
        self.fuzzer._stats['crashes'] = 5
        self.fuzzer._stats['timeouts'] = 10
        self.fuzzer._stats['errors'] = 3
        self.fuzzer.max_cases = 1000
        
        stats = self.fuzzer.get_stats()
        
        self.assertEqual(stats['total_cases'], 100)
        self.assertEqual(stats['crashes'], 5)
        self.assertEqual(stats['timeouts'], 10)
        self.assertEqual(stats['errors'], 3)
    
    def test_check_crash_network(self):
        """测试网络崩溃检测"""
        has_crashed, details = self.fuzzer._check_crash(b'', 'Connection reset', 1.0)
        self.assertTrue(has_crashed)
        self.assertIn('Network crash', details)
    
    def test_check_crash_timeout(self):
        """测试超时崩溃检测"""
        has_crashed, details = self.fuzzer._check_crash(b'', 'Timeout', 6.0)
        self.assertTrue(has_crashed)
        self.assertIn('Timeout crash', details)
    
    def test_check_crash_signature(self):
        """测试崩溃签名检测"""
        has_crashed, details = self.fuzzer._check_crash(b'Segmentation fault', None, 0.1)
        self.assertTrue(has_crashed)
        self.assertIn('Crash signature', details)
    
    def test_check_no_crash(self):
        """测试无崩溃情况"""
        has_crashed, details = self.fuzzer._check_crash(b'OK', None, 0.1)
        self.assertFalse(has_crashed)
        self.assertIsNone(details)


class TestFuzzingPhase(unittest.TestCase):
    """测试模糊测试阶段枚举"""
    
    def test_phase_values(self):
        """测试阶段枚举值"""
        self.assertEqual(FuzzingPhase.INIT.value, 'init')
        self.assertEqual(FuzzingPhase.RUNNING.value, 'running')
        self.assertEqual(FuzzingPhase.PAUSED.value, 'paused')
        self.assertEqual(FuzzingPhase.COMPLETED.value, 'completed')
        self.assertEqual(FuzzingPhase.ERROR.value, 'error')


if __name__ == '__main__':
    unittest.main()
