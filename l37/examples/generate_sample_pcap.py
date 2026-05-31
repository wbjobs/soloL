#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
生成模拟PCAP文件用于测试
包含多种协议模式的报文
"""

import sys
import os
import random
import struct
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

try:
    from scapy.all import Ether, IP, TCP, UDP, Raw, wrpcap
except ImportError:
    print("请安装scapy: pip install scapy")
    sys.exit(1)


def generate_simple_protocol_packets():
    """生成简单的请求-响应协议报文"""
    packets = []
    base_seq = 1000
    
    for i in range(50):
        request_id = struct.pack('>I', i)
        length = struct.pack('>H', 8 + len(request_id))
        msg_type = b'\x01\x00'
        payload = b'Hello Server ' + str(i).encode()
        data = length + msg_type + request_id + payload
        
        pkt = Ether() / IP(src='192.168.1.100', dst='192.168.1.200') / \
              TCP(sport=12345, dport=8888, seq=base_seq + i * 100) / Raw(load=data)
        pkt.time = time.time() + i * 0.1
        packets.append(pkt)
        
        response_id = request_id
        resp_length = struct.pack('>H', 8 + len(response_id))
        resp_type = b'\x02\x00'
        resp_payload = b'Response OK ' + str(i).encode()
        resp_data = resp_length + resp_type + response_id + resp_payload
        
        resp_pkt = Ether() / IP(src='192.168.1.200', dst='192.168.1.100') / \
                   TCP(sport=8888, dport=12345, seq=base_seq + i * 100 + 50) / Raw(load=resp_data)
        resp_pkt.time = time.time() + i * 0.1 + 0.05
        packets.append(resp_pkt)
    
    return packets


def generate_file_transfer_protocol():
    """生成文件传输协议报文"""
    packets = []
    
    for i in range(30):
        seq_num = struct.pack('>I', i)
        flags = b'\x01' if i == 0 else b'\x02'
        chunk = b'DATA' * 64
        checksum = struct.pack('>H', sum(chunk) % 65536)
        data = flags + seq_num + checksum + chunk
        
        pkt = Ether() / IP(src='10.0.0.1', dst='10.0.0.2') / \
              UDP(sport=54321, dport=9999) / Raw(load=data)
        pkt.time = time.time() + i * 0.05
        packets.append(pkt)
    
    return packets


def generate_mixed_protocol():
    """生成混合多种消息类型的协议"""
    packets = []
    msg_types = [
        (b'\x00\x01', 'LOGIN'),
        (b'\x00\x02', 'DATA'),
        (b'\x00\x03', 'HEARTBEAT'),
        (b'\x00\x04', 'LOGOUT'),
    ]
    
    for i in range(100):
        msg_type_idx = random.randint(0, 3)
        msg_type = msg_types[msg_type_idx][0]
        msg_name = msg_types[msg_type_idx][1]
        
        if msg_name == 'LOGIN':
            payload = b'user:test' + str(i).encode()
        elif msg_name == 'DATA':
            payload = b'data:' + bytes([random.randint(0, 255) for _ in range(32)])
        elif msg_name == 'HEARTBEAT':
            payload = b'ping' + str(i % 10).encode()
        else:
            payload = b'bye'
        
        length = struct.pack('>H', len(msg_type) + len(payload))
        data = length + msg_type + payload
        
        pkt = Ether() / IP(src='172.16.0.1', dst='172.16.0.100') / \
              TCP(sport=33333, dport=7777) / Raw(load=data)
        pkt.time = time.time() + i * 0.08
        packets.append(pkt)
    
    return packets


def generate_noise_packets():
    """生成一些噪声/随机报文"""
    packets = []
    for i in range(20):
        random_data = bytes([random.randint(0, 255) for _ in range(random.randint(20, 200))])
        pkt = Ether() / IP(src='192.168.1.' + str(random.randint(1, 254)), 
                          dst='192.168.1.' + str(random.randint(1, 254))) / \
              TCP(sport=random.randint(1000, 65535), dport=random.randint(1000, 65535)) / Raw(load=random_data)
        pkt.time = time.time() + random.uniform(0, 10)
        packets.append(pkt)
    return packets


def main():
    os.makedirs('pcap_samples', exist_ok=True)
    
    print("正在生成简单协议PCAP...")
    pkts1 = generate_simple_protocol_packets()
    wrpcap('pcap_samples/simple_protocol.pcap', pkts1)
    print(f"  生成 {len(pkts1)} 个报文 -> pcap_samples/simple_protocol.pcap")
    
    print("\n正在生成文件传输协议PCAP...")
    pkts2 = generate_file_transfer_protocol()
    wrpcap('pcap_samples/file_transfer.pcap', pkts2)
    print(f"  生成 {len(pkts2)} 个报文 -> pcap_samples/file_transfer.pcap")
    
    print("\n正在生成混合协议PCAP...")
    pkts3 = generate_mixed_protocol()
    wrpcap('pcap_samples/mixed_protocol.pcap', pkts3)
    print(f"  生成 {len(pkts3)} 个报文 -> pcap_samples/mixed_protocol.pcap")
    
    print("\n正在生成含噪声的PCAP...")
    pkts4 = pkts3 + generate_noise_packets()
    random.shuffle(pkts4, lambda: 0.5)
    wrpcap('pcap_samples/with_noise.pcap', pkts4)
    print(f"  生成 {len(pkts4)} 个报文 -> pcap_samples/with_noise.pcap")
    
    print("\n✅ 所有PCAP文件生成完成！")
    print("\n使用示例:")
    print("  python main.py load --pcap pcap_samples/simple_protocol.pcap")
    print("  python main.py full --pcap pcap_samples/mixed_protocol.pcap --target 127.0.0.1:8888 --fuzz-cases 100")


if __name__ == '__main__':
    main()
