#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
测试服务器 - 用于模糊测试
包含一些故意设计的漏洞来演示崩溃检测
"""

import socket
import struct
import threading
import sys
import argparse


class VulnerableTCPServer:
    """故意包含漏洞的TCP服务器"""
    
    def __init__(self, host='127.0.0.1', port=8888):
        self.host = host
        self.port = port
        self.running = False
        
    def handle_client(self, client_sock, addr):
        """处理客户端连接"""
        try:
            client_sock.settimeout(5.0)
            while True:
                data = client_sock.recv(4096)
                if not data:
                    break
                
                response = self.process_data(data)
                if response:
                    client_sock.send(response)
                    
        except socket.timeout:
            pass
        except ConnectionResetError:
            pass
        except Exception as e:
            print(f"[!] 处理连接 {addr} 时出错: {e}")
        finally:
            client_sock.close()
    
    def process_data(self, data):
        """处理数据 - 包含故意的漏洞"""
        if len(data) < 4:
            return b'ERR: Too short'
        
        length = struct.unpack('>H', data[:2])[0]
        msg_type = data[2:4]
        
        if msg_type == b'\x01\x00':
            if length > 1000:
                buffer = bytearray(100)
                for i in range(length):
                    if i < len(data):
                        buffer[i] = data[i]
                return b'OK: Request processed'
            return b'OK: Normal request'
            
        elif msg_type == b'\x02\x00':
            if len(data) > 20 and data[4:8] == b'\xff\xff\xff\xff':
                null_ptr = None
                if len(null_ptr) > 0:
                    pass
            return b'OK: Response'
            
        elif msg_type == b'\x03\x00':
            if len(data) > 30:
                checksum = struct.unpack('>H', data[4:6])[0]
                calc_checksum = sum(data[6:]) % 65536
                if checksum == calc_checksum:
                    divider = 0
                    result = 100 / divider
            return b'OK: Data received'
            
        elif msg_type == b'\x00\x01':
            username = data[4:].decode('ascii', errors='replace')
            if len(username) > 50:
                large_alloc = bytearray(1024 * 1024 * 100)
                large_alloc[0] = 1
            return f'OK: Login {username[:20]}'.encode()
            
        elif msg_type == b'\x00\x03':
            ping_data = data[4:8]
            if ping_data == b'\xde\xad\xbe\xef':
                raise MemoryError("Simulated memory corruption")
            return b'PONG'
            
        else:
            return b'ERR: Unknown type'
    
    def start(self):
        """启动服务器"""
        self.running = True
        server_sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        server_sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        server_sock.bind((self.host, self.port))
        server_sock.listen(5)
        
        print(f"[*] TCP 测试服务器启动在 {self.host}:{self.port}")
        print(f"[*] 包含以下漏洞:")
        print(f"    1. 缓冲区溢出 (Type 0x0100, length > 1000)")
        print(f"    2. 空指针引用 (Type 0x0200, 包含 0xffffffff)")
        print(f"    3. 除零错误 (Type 0x0300, 正确校验和)")
        print(f"    4. 内存耗尽 (Type 0x0001, 用户名>50字节)")
        print(f"    5. 内存损坏 (Type 0x0003, ping=deadbeef)")
        
        try:
            while self.running:
                try:
                    client_sock, addr = server_sock.accept()
                    thread = threading.Thread(target=self.handle_client, 
                                            args=(client_sock, addr),
                                            daemon=True)
                    thread.start()
                except Exception as e:
                    if self.running:
                        print(f"[!] 接受连接出错: {e}")
        finally:
            server_sock.close()
    
    def stop(self):
        """停止服务器"""
        self.running = False


class VulnerableUDPServer:
    """故意包含漏洞的UDP服务器"""
    
    def __init__(self, host='127.0.0.1', port=9999):
        self.host = host
        self.port = port
        self.running = False
        
    def start(self):
        """启动服务器"""
        self.running = True
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.bind((self.host, self.port))
        sock.settimeout(1.0)
        
        print(f"[*] UDP 测试服务器启动在 {self.host}:{self.port}")
        print(f"[*] 包含以下漏洞:")
        print(f"    1. 数据处理崩溃 (flags=0x01, seq=0xffffffff)")
        print(f"    2. 缓冲区溢出 (数据长度 > 500)")
        
        try:
            while self.running:
                try:
                    data, addr = sock.recvfrom(4096)
                    response = self.process_udp_data(data)
                    if response:
                        sock.sendto(response, addr)
                except socket.timeout:
                    continue
                except Exception as e:
                    print(f"[!] UDP 处理出错: {e}")
        finally:
            sock.close()
    
    def process_udp_data(self, data):
        """处理UDP数据"""
        if len(data) < 5:
            return b'ERR'
        
        flags = data[0:1]
        seq = data[1:5]
        
        if flags == b'\x01' and seq == b'\xff\xff\xff\xff':
            raise BufferError("Simulated buffer overflow")
        
        if len(data) > 500:
            buffer = bytearray(256)
            for i in range(len(data)):
                buffer[i % 256] = data[i]
            return b'BIG OK'
        
        return b'OK'
    
    def stop(self):
        self.running = False


def main():
    parser = argparse.ArgumentParser(description='漏洞测试服务器')
    parser.add_argument('--tcp-port', type=int, default=8888, help='TCP端口')
    parser.add_argument('--udp-port', type=int, default=9999, help='UDP端口')
    parser.add_argument('--no-tcp', action='store_true', help='不启动TCP服务器')
    parser.add_argument('--no-udp', action='store_true', help='不启动UDP服务器')
    
    args = parser.parse_args()
    
    servers = []
    threads = []
    
    if not args.no_tcp:
        tcp_server = VulnerableTCPServer(port=args.tcp_port)
        servers.append(tcp_server)
        t = threading.Thread(target=tcp_server.start, daemon=True)
        threads.append(t)
    
    if not args.no_udp:
        udp_server = VulnerableUDPServer(port=args.udp_port)
        servers.append(udp_server)
        t = threading.Thread(target=udp_server.start, daemon=True)
        threads.append(t)
    
    if not servers:
        print("[-] 没有启动任何服务器")
        sys.exit(1)
    
    for t in threads:
        t.start()
    
    try:
        print("\n[*] 按 Ctrl+C 停止服务器")
        while True:
            for t in threads:
                if not t.is_alive():
                    print("[!] 服务器线程已退出")
                    sys.exit(1)
            threading.Event().wait(1.0)
    except KeyboardInterrupt:
        print("\n[*] 正在停止服务器...")
        for s in servers:
            s.stop()
        print("[*] 已停止")


if __name__ == '__main__':
    main()
