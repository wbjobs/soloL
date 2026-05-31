#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
报文聚类模块单元测试
"""

import sys
import os
import unittest
import random
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from protocol_reverse_fuzzer.packet_clustering import (
    hamming_distance,
    levenshtein_distance,
    extract_n_gram_features,
    DBSCAN,
    PacketClustering
)


class TestDistanceMetrics(unittest.TestCase):
    """测试距离度量函数"""
    
    def test_hamming_distance_equal(self):
        """测试相同数据的汉明距离"""
        d = hamming_distance(b'\x01\x02\x03', b'\x01\x02\x03')
        self.assertEqual(d, 0.0)
    
    def test_hamming_distance_different(self):
        """测试不同数据的汉明距离"""
        d = hamming_distance(b'\x01\x02\x03', b'\x01\x03\x03')
        self.assertAlmostEqual(d, 1/3, places=3)
    
    def test_hamming_distance_different_length(self):
        """测试不同长度数据的汉明距离"""
        d = hamming_distance(b'\x01\x02', b'\x01\x02\x03')
        self.assertGreater(d, 0)
    
    def test_levenshtein_distance_equal(self):
        """测试相同数据的编辑距离"""
        d = levenshtein_distance(b'hello', b'hello')
        self.assertEqual(d, 0.0)
    
    def test_levenshtein_distance_insert(self):
        """测试插入操作的编辑距离"""
        d = levenshtein_distance(b'helo', b'hello')
        self.assertAlmostEqual(d, 1/5, places=3)
    
    def test_levenshtein_distance_substitute(self):
        """测试替换操作的编辑距离"""
        d = levenshtein_distance(b'hello', b'hallo')
        self.assertAlmostEqual(d, 1/5, places=3)


class TestFeatureExtraction(unittest.TestCase):
    """测试特征提取函数"""
    
    def test_n_gram_features(self):
        """测试n-gram特征提取"""
        data = b'\x01\x02\x03\x04'
        features = extract_n_gram_features(data, n=2)
        self.assertIsInstance(features, np.ndarray)
        self.assertEqual(len(features), 256 ** 2)
        self.assertGreater(np.sum(features), 0)
    
    def test_n_gram_normalization(self):
        """测试n-gram特征归一化"""
        data = b'\x01\x01\x02\x02'
        features = extract_n_gram_features(data, n=1)
        self.assertAlmostEqual(features[0x01], 0.5, places=5)
        self.assertAlmostEqual(features[0x02], 0.5, places=5)
        self.assertAlmostEqual(np.sum(features), 1.0, places=5)


class TestDBSCAN(unittest.TestCase):
    """测试DBSCAN聚类算法"""
    
    def setUp(self):
        """设置测试数据"""
        random.seed(42)
        self.cluster1 = [bytes([0x01, 0x02, i % 256]) for i in range(10)]
        self.cluster2 = [bytes([0x10, 0x20, i % 256]) for i in range(8)]
        self.noise = [bytes([random.randint(0, 255) for _ in range(3)]) for _ in range(3)]
        self.all_data = self.cluster1 + self.cluster2 + self.noise
    
    def test_dbscan_clustering(self):
        """测试DBSCAN基本聚类功能"""
        dbscan = DBSCAN(eps=0.5, min_samples=3)
        dbscan.fit(self.all_data)
        labels = dbscan.labels_
        
        unique_labels = set(labels)
        self.assertIn(-1, unique_labels)
        
        non_noise = [l for l in labels if l != -1]
        self.assertGreaterEqual(len(set(non_noise)), 1)
    
    def test_dbscan_noise_detection(self):
        """测试噪声检测"""
        dbscan = DBSCAN(eps=0.1, min_samples=5)
        dbscan.fit(self.noise)
        labels = dbscan.labels_
        
        for label in labels:
            self.assertEqual(label, -1)
    
    def test_dbscan_single_cluster(self):
        """测试单聚类情况"""
        dbscan = DBSCAN(eps=0.5, min_samples=2)
        dbscan.fit(self.cluster1)
        labels = dbscan.labels_
        
        for label in labels:
            self.assertNotEqual(label, -1)
        self.assertEqual(len(set(labels)), 1)


class TestPacketClustering(unittest.TestCase):
    """测试报文聚类类"""
    
    def setUp(self):
        """设置测试数据"""
        self.packets = []
        for i in range(20):
            if i < 10:
                payload = bytes([0x01, 0x00, i, 0x00]) + b'hello' * 5
            else:
                payload = bytes([0x02, 0x00, i - 10, 0x00]) + b'world' * 5
            self.packets.append(payload)
    
    def test_cluster_packets(self):
        """测试报文聚类"""
        clustering = PacketClustering(eps=0.2, min_samples=3, use_sklearn=False)
        clusters = clustering.cluster(self.packets)
        
        self.assertIsInstance(clusters, dict)
        self.assertGreater(len(clusters), 1)
        
        non_noise_clusters = [c for c in clusters.values() if c.cluster_id != -1]
        self.assertGreaterEqual(len(non_noise_clusters), 2)
    
    def test_auto_tune_eps(self):
        """测试eps参数自动调优"""
        clustering = PacketClustering(use_sklearn=False)
        best_eps = clustering.auto_tune_eps(self.packets, target_clusters=2)
        
        self.assertGreater(best_eps, 0)
        self.assertLess(best_eps, 1.0)
    
    def test_optimize_parameters(self):
        """测试参数优化"""
        clustering = PacketClustering(use_sklearn=False)
        params = clustering.optimize_parameters(self.packets, target_clusters_range=(2, 5))
        
        self.assertIn('eps', params)
        self.assertIn('min_samples', params)
        self.assertIsInstance(params['eps'], float)
        self.assertIsInstance(params['min_samples'], int)
        self.assertGreater(params['eps'], 0)
        self.assertGreater(params['min_samples'], 0)
    
    def test_cluster_labels(self):
        """测试聚类标签"""
        clustering = PacketClustering(eps=0.2, min_samples=3, use_sklearn=False)
        clustering.cluster(self.packets)
        
        self.assertIsNotNone(clustering.labels_)
        self.assertEqual(len(clustering.labels_), len(self.packets))


if __name__ == '__main__':
    unittest.main()
