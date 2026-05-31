import os
import time
import threading
from typing import List, Optional, Callable, Dict
from dataclasses import dataclass, field
from datetime import datetime

try:
    from scapy.all import (
        sniff, wrpcap, rdpcap, IP, TCP, UDP, Raw,
        conf, get_if_list, get_if_addr, Packet, PacketList
    )
    SCAPY_AVAILABLE = True
except ImportError:
    SCAPY_AVAILABLE = False
    print("Warning: scapy not installed. Traffic capture will be limited.")


@dataclass
class PacketInfo:
    timestamp: float
    src_ip: str
    dst_ip: str
    src_port: int
    dst_port: int
    protocol: str
    payload: bytes
    packet_length: int
    direction: str = "outbound"


class TrafficCapture:
    def __init__(self, interface: Optional[str] = None):
        self.interface = interface
        self.packets: List[PacketInfo] = []
        self.capturing = False
        self.capture_thread: Optional[threading.Thread] = None
        self.packet_callback: Optional[Callable] = None
        self.filter_expression = ""
        self._raw_packets: List[Packet] = []

    def get_interfaces(self) -> List[Dict]:
        if not SCAPY_AVAILABLE:
            return []
        interfaces = []
        for iface in get_if_list():
            try:
                addr = get_if_addr(iface)
            except Exception:
                addr = "N/A"
            interfaces.append({"name": iface, "address": addr})
        return interfaces

    def set_filter(self, protocol: str = "tcp",
                   src_port: Optional[int] = None,
                   dst_port: Optional[int] = None,
                   src_ip: Optional[str] = None,
                   dst_ip: Optional[str] = None) -> None:
        filters = []
        protocol = protocol.lower()
        if protocol in ["tcp", "udp"]:
            filters.append(protocol)
        elif protocol == "both":
            filters.append("(tcp or udp)")

        if src_port:
            filters.append(f"src port {src_port}")
        if dst_port:
            filters.append(f"dst port {dst_port}")
        if src_ip:
            filters.append(f"src host {src_ip}")
        if dst_ip:
            filters.append(f"dst host {dst_ip}")

        self.filter_expression = " and ".join(filters)

    def _process_packet(self, packet: Packet) -> None:
        if not self.capturing:
            return

        try:
            self._raw_packets.append(packet)

            if IP in packet:
                ip_layer = packet[IP]
                src_ip = ip_layer.src
                dst_ip = ip_layer.dst

                protocol = "unknown"
                src_port = 0
                dst_port = 0
                payload = b""

                if TCP in packet:
                    protocol = "tcp"
                    tcp_layer = packet[TCP]
                    src_port = tcp_layer.sport
                    dst_port = tcp_layer.dport
                    if Raw in packet:
                        payload = bytes(packet[Raw].load)

                elif UDP in packet:
                    protocol = "udp"
                    udp_layer = packet[UDP]
                    src_port = udp_layer.sport
                    dst_port = udp_layer.dport
                    if Raw in packet:
                        payload = bytes(packet[Raw].load)

                if len(payload) > 0:
                    direction = "outbound"
                    try:
                        local_ips = [get_if_addr(self.interface)] if self.interface else []
                        if src_ip in local_ips:
                            direction = "outbound"
                        elif dst_ip in local_ips:
                            direction = "inbound"
                    except Exception:
                        pass

                    pkt_info = PacketInfo(
                        timestamp=float(packet.time),
                        src_ip=src_ip,
                        dst_ip=dst_ip,
                        src_port=src_port,
                        dst_port=dst_port,
                        protocol=protocol,
                        payload=payload,
                        packet_length=len(packet),
                        direction=direction
                    )
                    self.packets.append(pkt_info)

                    if self.packet_callback:
                        self.packet_callback(pkt_info)
        except Exception as e:
            print(f"Error processing packet: {e}")

    def start_capture(self, timeout: int = 60,
                      packet_count: int = 0,
                      callback: Optional[Callable] = None) -> None:
        if not SCAPY_AVAILABLE:
            raise RuntimeError("scapy is required for traffic capture")

        if self.capturing:
            return

        self.capturing = True
        self.packets = []
        self._raw_packets = []
        self.packet_callback = callback

        iface = self.interface if self.interface else conf.iface

        def capture_worker():
            try:
                sniff(
                    iface=iface,
                    filter=self.filter_expression if self.filter_expression else None,
                    prn=self._process_packet,
                    timeout=timeout if timeout > 0 else None,
                    count=packet_count,
                    store=False
                )
            except Exception as e:
                print(f"Capture error: {e}")
            finally:
                self.capturing = False

        self.capture_thread = threading.Thread(target=capture_worker, daemon=True)
        self.capture_thread.start()

    def stop_capture(self) -> None:
        self.capturing = False
        if self.capture_thread:
            self.capture_thread.join(timeout=5)

    def save_pcap(self, filename: str) -> None:
        if not filename.endswith('.pcap'):
            filename += '.pcap'

        if SCAPY_AVAILABLE and self._raw_packets:
            wrpcap(filename, self._raw_packets)
        else:
            self._save_pcap_custom(filename)

    def _save_pcap_custom(self, filename: str) -> None:
        import struct

        global_header = struct.pack(
            '=IHHIIII',
            0xa1b2c3d4,
            2, 4, 0, 0, 65535, 1
        )

        with open(filename, 'wb') as f:
            f.write(global_header)

            for pkt_info in self.packets:
                ts_sec = int(pkt_info.timestamp)
                ts_usec = int((pkt_info.timestamp - ts_sec) * 1_000_000)
                payload_len = len(pkt_info.payload)

                pseudo_header = struct.pack(
                    '=IIII', ts_sec, ts_usec, payload_len, payload_len
                )
                f.write(pseudo_header)
                f.write(pkt_info.payload)

    def load_pcap(self, filename: str) -> List[PacketInfo]:
        if not os.path.exists(filename):
            raise FileNotFoundError(f"PCAP file not found: {filename}")

        self.packets = []
        self._raw_packets = []
        self.capturing = True

        try:
            if SCAPY_AVAILABLE:
                try:
                    packets = rdpcap(filename)
                    for pkt in packets:
                        self._process_packet(pkt)
                    return self.packets
                except Exception:
                    pass

            return self._load_pcap_custom(filename)
        finally:
            self.capturing = False

    def _load_pcap_custom(self, filename: str) -> List[PacketInfo]:
        import struct

        self.packets = []

        with open(filename, 'rb') as f:
            data = f.read()

        if len(data) < 24:
            return self.packets

        magic = struct.unpack('=I', data[0:4])[0]
        if magic == 0xa1b2c3d4:
            endian = '='
            ts_multiplier = 1_000_000
        elif magic == 0xd4c3b2a1:
            endian = '<'
            ts_multiplier = 1_000_000
        elif magic == 0xa1b23c4d:
            endian = '='
            ts_multiplier = 1_000_000_000
        else:
            return self.packets

        offset = 24
        while offset + 16 < len(data):
            header = struct.unpack(endian + 'IIII', data[offset:offset + 16])
            ts_sec, ts_subsec, incl_len, orig_len = header
            offset += 16

            if offset + incl_len > len(data):
                break

            payload = data[offset:offset + incl_len]
            offset += incl_len

            timestamp = ts_sec + (ts_subsec / ts_multiplier)

            pkt_info = PacketInfo(
                timestamp=timestamp,
                src_ip="0.0.0.0",
                dst_ip="0.0.0.0",
                src_port=0,
                dst_port=0,
                protocol="unknown",
                payload=payload,
                packet_length=incl_len
            )
            self.packets.append(pkt_info)

        return self.packets

    def get_payloads(self) -> List[bytes]:
        return [pkt.payload for pkt in self.packets]

    def get_statistics(self) -> Dict:
        stats = {
            "total_packets": len(self.packets),
            "tcp_packets": 0,
            "udp_packets": 0,
            "total_bytes": 0,
            "unique_pairs": set(),
            "by_direction": {"inbound": 0, "outbound": 0},
            "duration": 0
        }

        for pkt in self.packets:
            stats["total_bytes"] += pkt.packet_length
            if pkt.protocol == "tcp":
                stats["tcp_packets"] += 1
            elif pkt.protocol == "udp":
                stats["udp_packets"] += 1

            pair = f"{pkt.src_ip}:{pkt.src_port}->{pkt.dst_ip}:{pkt.dst_port}"
            stats["unique_pairs"].add(pair)

            if pkt.direction in stats["by_direction"]:
                stats["by_direction"][pkt.direction] += 1

        stats["unique_pairs"] = len(stats["unique_pairs"])

        if self.packets:
            timestamps = [float(p.timestamp) for p in self.packets]
            stats["duration"] = float(max(timestamps) - min(timestamps))

        return stats

    def wait_for_completion(self) -> None:
        if self.capture_thread:
            self.capture_thread.join()
