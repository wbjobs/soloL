#!/usr/bin/env python3
import os
import sys
import json
import argparse
import time
from typing import Dict, List, Optional

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from protocol_reverse_fuzzer import (
    TrafficCapture, PacketClustering, ProtocolInference,
    ProtocolDescription, Fuzzer, CrashAnalyzer
)
from protocol_reverse_fuzzer.fuzzer import MutationStrategy


class ProtocolReverseFuzzer:
    def __init__(self, output_dir: str = "output"):
        self.output_dir = output_dir
        self.traffic_capture: Optional[TrafficCapture] = None
        self.packet_clustering: Optional[PacketClustering] = None
        self.protocol_inference: Optional[ProtocolInference] = None
        self.protocol_description: Optional[ProtocolDescription] = None
        self.fuzzer: Optional[Fuzzer] = None
        self.crash_analyzer: Optional[CrashAnalyzer] = None

        self._ensure_output_dir()

    def _ensure_output_dir(self) -> None:
        for subdir in ["pcap", "xml", "crashes", "reports"]:
            path = os.path.join(self.output_dir, subdir)
            if not os.path.exists(path):
                os.makedirs(path)

    def capture_traffic(self, interface: Optional[str] = None,
                        protocol: str = "tcp",
                        dst_port: Optional[int] = None,
                        timeout: int = 60,
                        packet_count: int = 0,
                        pcap_file: Optional[str] = None) -> Dict:
        print("[*] Starting traffic capture...")

        self.traffic_capture = TrafficCapture(interface=interface)
        self.traffic_capture.set_filter(
            protocol=protocol,
            dst_port=dst_port
        )

        def packet_callback(pkt_info):
            print(f"  [+] Packet: {pkt_info.src_ip}:{pkt_info.src_port} -> "
                  f"{pkt_info.dst_ip}:{pkt_info.dst_port} "
                  f"({pkt_info.protocol}, {len(pkt_info.payload)} bytes)")

        self.traffic_capture.start_capture(
            timeout=timeout,
            packet_count=packet_count,
            callback=packet_callback
        )

        self.traffic_capture.wait_for_completion()

        stats = self.traffic_capture.get_statistics()
        print(f"[*] Capture complete: {stats['total_packets']} packets, "
              f"{stats['total_bytes']} bytes")

        if pcap_file:
            save_path = os.path.join(self.output_dir, "pcap", pcap_file)
            self.traffic_capture.save_pcap(save_path)
            print(f"[*] PCAP saved to: {save_path}")

        return stats

    def load_pcap(self, pcap_file: str) -> Dict:
        print(f"[*] Loading PCAP: {pcap_file}")

        self.traffic_capture = TrafficCapture()
        packets = self.traffic_capture.load_pcap(pcap_file)

        stats = self.traffic_capture.get_statistics()
        print(f"[*] Loaded {len(packets)} packets from PCAP")

        return stats

    def cluster_packets(self, eps: float = 0.3,
                        min_samples: int = 3,
                        use_sklearn: bool = True) -> Dict:
        if not self.traffic_capture:
            raise RuntimeError("No traffic loaded. Capture or load PCAP first.")

        print("[*] Clustering packets...")
        payloads = self.traffic_capture.get_payloads()

        if len(payloads) < 2:
            print("[!] Not enough packets for clustering")
            return {"clusters": 0, "packets": len(payloads)}

        self.packet_clustering = PacketClustering(
            eps=eps,
            min_samples=min_samples,
            metric="hamming",
            use_sklearn=use_sklearn
        )

        clusters = self.packet_clustering.cluster(payloads)
        summary = self.packet_clustering.get_cluster_summary()

        print(f"[*] Found {len([c for c in clusters if c != -1])} clusters, "
              f"{len(clusters.get(-1, []).packets) if -1 in clusters else 0} noise packets")

        for item in summary:
            noise_marker = "[NOISE] " if item["is_noise"] else ""
            print(f"  {noise_marker}Cluster {item['cluster_id']}: "
                  f"{item['packet_count']} packets, "
                  f"avg_len={item['average_length']}")

        return {
            "cluster_count": len([c for c in clusters if c != -1]),
            "noise_count": len(clusters.get(-1, []).packets) if -1 in clusters else 0,
            "total_packets": len(payloads),
            "clusters": summary
        }

    def infer_protocol(self, entropy_threshold: float = 0.5,
                       min_field_length: int = 1,
                       max_field_length: int = 64,
                       skip_encrypted: bool = True) -> Dict:
        if not self.packet_clustering:
            raise RuntimeError("No clustering results. Run clustering first.")

        print("[*] Inferring protocol fields...")

        self.protocol_inference = ProtocolInference(
            entropy_threshold=entropy_threshold,
            min_field_length=min_field_length,
            max_field_length=max_field_length,
            skip_encrypted=skip_encrypted
        )

        inference_results = {}
        all_fields = []
        encryption_warnings = []

        for cluster_id, cluster in self.packet_clustering.clusters.items():
            if cluster_id == -1:
                continue

            print(f"  [*] Analyzing cluster {cluster_id} ({len(cluster.packets)} packets)...")

            fields = self.protocol_inference.infer(cluster.packets, cluster_id=cluster_id)
            inference_results[cluster_id] = fields
            all_fields.extend(fields)

            warnings = self.protocol_inference.get_encryption_warnings()
            if warnings:
                encryption_warnings.extend(warnings)

            for field in fields:
                markers = []
                if field.is_fixed:
                    markers.append("FIXED")
                if field.is_length:
                    markers.append("LENGTH")
                if field.is_checksum:
                    markers.append("CHECKSUM")
                if field.field_type == "encrypted":
                    markers.append("ENCRYPTED")
                marker_str = f" [{', '.join(markers)}]" if markers else ""

                print(f"    [{field.offset:4d}:{field.length:3d}] "
                      f"{field.name:20s} {field.field_type:15s} "
                      f"entropy={field.entropy:.3f}{marker_str}")

            if cluster.packets and all(f.field_type != "encrypted" for f in fields):
                viz = self.protocol_inference.visualize_fields(cluster.representative)
                print(f"\n  Field visualization for cluster {cluster_id}:")
                print(viz)
                print()

        print(f"[*] Inferred {len(all_fields)} fields across "
              f"{len(inference_results)} clusters")

        if encryption_warnings:
            print(f"[!] Encryption warnings: {len(encryption_warnings)} cluster(s) skipped")

        return {
            "inference_results": {
                str(cid): [f.to_dict() for f in fields]
                for cid, fields in inference_results.items()
            },
            "total_fields": len(all_fields),
            "entropy_profile": self.protocol_inference.get_entropy_profile(),
            "encryption_warnings": encryption_warnings
        }

    def generate_protocol_description(self, protocol_name: str = "ReversedProtocol",
                                       xml_file: Optional[str] = None) -> Dict:
        if not self.packet_clustering or not self.protocol_inference:
            raise RuntimeError("Run clustering and inference first.")

        print("[*] Generating protocol description...")

        self.protocol_description = ProtocolDescription(protocol_name=protocol_name)

        inference_results = {}
        for cluster_id, cluster in self.packet_clustering.clusters.items():
            if cluster_id == -1:
                continue
            inference_results[cluster_id] = self.protocol_inference.infer(cluster.packets)

        self.protocol_description.build_from_clusters(
            self.packet_clustering.clusters,
            inference_results
        )

        capture_stats = self.traffic_capture.get_statistics() if self.traffic_capture else None
        self.protocol_description.set_metadata(
            capture_stats=capture_stats,
            clustering_params={
                "eps": self.packet_clustering.eps,
                "min_samples": self.packet_clustering.min_samples,
                "metric": self.packet_clustering.metric
            },
            inference_params={
                "entropy_threshold": self.protocol_inference.entropy_threshold,
                "min_field_length": self.protocol_inference.min_field_length,
                "max_field_length": self.protocol_inference.max_field_length
            }
        )

        if xml_file:
            save_path = os.path.join(self.output_dir, "xml", xml_file)
            xml_content = self.protocol_description.generate_xml(save_path)
            print(f"[*] Protocol description saved to: {save_path}")
        else:
            xml_content = self.protocol_description.generate_xml()

        summary = self.protocol_description.get_summary()
        print(f"[*] Generated protocol: {summary['protocol_name']}")
        print(f"    Message types: {summary['message_type_count']}")
        print(f"    Total fields: {summary['total_fields']}")

        return {
            "xml": xml_content,
            "summary": summary,
            "fuzzer_config": self.protocol_description.generate_fuzzer_config()
        }

    def load_protocol_xml(self, xml_file: str) -> Dict:
        print(f"[*] Loading protocol from: {xml_file}")

        self.protocol_description = ProtocolDescription()
        self.protocol_description.load_xml(xml_file)

        summary = self.protocol_description.get_summary()
        print(f"[*] Loaded protocol: {summary['protocol_name']}")
        print(f"    Message types: {summary['message_type_count']}")
        print(f"    Total fields: {summary['total_fields']}")

        return summary

    def start_fuzzing(self, target_host: str, target_port: int,
                      protocol: str = "tcp",
                      max_cases: int = 1000,
                      cases_per_message: int = 100,
                      delay: float = 0.1,
                      timeout: float = 5.0,
                      seed: Optional[int] = None,
                      coverage_guided: bool = False,
                      binary_path: Optional[str] = None,
                      feedback_file: Optional[str] = None) -> Dict:
        if not self.protocol_description:
            raise RuntimeError("No protocol description. Generate or load XML first.")

        print(f"[*] Starting fuzzing on {target_host}:{target_port} ({protocol})...")
        print(f"    Max cases: {max_cases}, Delay: {delay}s, Timeout: {timeout}s")
        if coverage_guided:
            print(f"    Coverage-guided: ENABLED")
            if binary_path:
                print(f"    Binary path: {binary_path}")
            if feedback_file:
                print(f"    Feedback file: {feedback_file}")

        self.fuzzer = Fuzzer(
            target_host=target_host,
            target_port=target_port,
            protocol=protocol,
            timeout=timeout,
            seed=seed,
            coverage_guided=coverage_guided,
            binary_path=binary_path,
            feedback_file=feedback_file
        )

        self.fuzzer.load_templates(self.protocol_description.message_types)

        self.crash_analyzer = CrashAnalyzer(
            output_dir=os.path.join(self.output_dir, "crashes")
        )

        def case_callback(case):
            status = "[CRASH]" if case.has_crashed else "[OK]"
            print(f"  {status} Case {case.case_id}: {case.message_type} "
                  f"({case.mutation_strategy.value}) "
                  f"time={case.response_time:.3f}s")

            if case.has_crashed:
                preceding = self.fuzzer.fuzz_cases[max(0, case.case_id - 5):case.case_id]
                self.crash_analyzer.analyze_crash(case, preceding)

        self.fuzzer.case_callback = case_callback

        strategy_weights = {
            MutationStrategy.BIT_FLIP: 1.0,
            MutationStrategy.BOUNDARY_VALUE: 1.5,
            MutationStrategy.RANDOM_BYTES: 1.0,
            MutationStrategy.ARITHMETIC: 0.8,
            MutationStrategy.INTERESTING_VALUES: 1.2,
            MutationStrategy.BLOCK_OPERATION: 0.5
        }
        self.fuzzer.set_strategy_weights(strategy_weights)

        self.fuzzer.start(
            max_cases=max_cases,
            cases_per_message=cases_per_message,
            delay=delay
        )

        return {"status": "started", "target": f"{target_host}:{target_port}"}

    def stop_fuzzing(self) -> Dict:
        if self.fuzzer:
            self.fuzzer.stop()
            return {"status": "stopped"}
        return {"status": "not_running"}

    def get_fuzzing_status(self) -> Dict:
        if not self.fuzzer:
            return {"status": "not_started"}

        stats = self.fuzzer.get_stats()
        crash_stats = self.crash_analyzer.get_crash_statistics() if self.crash_analyzer else {}

        return {
            "fuzzer": stats,
            "crashes": crash_stats,
            "crash_samples": self.crash_analyzer.get_crashes_by_category()[:10]
            if self.crash_analyzer else []
        }

    def wait_for_fuzzing(self) -> Dict:
        if self.fuzzer:
            self.fuzzer.wait_for_completion()
        return self.get_fuzzing_status()

    def get_crash_report(self, output_file: str = "crash_report.md") -> Dict:
        if not self.crash_analyzer:
            raise RuntimeError("No crash analyzer. Run fuzzing first.")

        save_path = os.path.join(self.output_dir, "reports", output_file)
        report = self.crash_analyzer.generate_crash_report(save_path)

        stats = self.crash_analyzer.get_crash_statistics()
        print(f"[*] Crash report saved to: {save_path}")
        print(f"    Total crashes: {stats['total_crashes']}")
        print(f"    Unique inputs: {stats['unique_crash_inputs']}")

        return {
            "report_path": save_path,
            "statistics": stats,
            "report": report
        }

    def run_full_analysis(self, pcap_file: Optional[str] = None,
                          interface: Optional[str] = None,
                          protocol: str = "tcp",
                          capture_timeout: int = 60,
                          target_host: Optional[str] = None,
                          target_port: Optional[int] = None,
                          fuzz_cases: int = 1000,
                          output_prefix: str = "analysis",
                          use_sklearn: bool = True) -> Dict:
        print("=" * 60)
        print("Protocol Reverse Engineering & Fuzzing Tool")
        print("=" * 60)

        if pcap_file:
            self.load_pcap(pcap_file)
        else:
            self.capture_traffic(
                interface=interface,
                protocol=protocol,
                timeout=capture_timeout,
                pcap_file=f"{output_prefix}.pcap"
            )

        self.cluster_packets(use_sklearn=use_sklearn)
        self.infer_protocol()
        self.generate_protocol_description(
            protocol_name=f"Protocol_{output_prefix}",
            xml_file=f"{output_prefix}.xml"
        )

        results = {
            "pcap": self.traffic_capture.get_statistics() if self.traffic_capture else None,
            "clustering": self.packet_clustering.get_cluster_summary() if self.packet_clustering else None,
            "inference": self.protocol_inference.get_fields_summary() if self.protocol_inference else None,
            "protocol": self.protocol_description.get_summary() if self.protocol_description else None
        }

        if target_host and target_port:
            print("\n" + "=" * 60)
            print("Starting Fuzzing Phase")
            print("=" * 60)

            self.start_fuzzing(
                target_host=target_host,
                target_port=target_port,
                protocol=protocol,
                max_cases=fuzz_cases
            )
            self.wait_for_fuzzing()

            results["fuzzing"] = self.get_fuzzing_status()
            results["crash_report"] = self.get_crash_report(
                f"{output_prefix}_crash_report.md"
            )

        return results


def main():
    parser = argparse.ArgumentParser(
        description="Protocol Reverse Engineering & Fuzzing Tool",
        formatter_class=argparse.RawDescriptionHelpFormatter
    )

    subparsers = parser.add_subparsers(dest="command", help="Available commands")

    capture_parser = subparsers.add_parser("capture", help="Capture network traffic")
    capture_parser.add_argument("-i", "--interface", help="Network interface")
    capture_parser.add_argument("-p", "--protocol", default="tcp",
                                choices=["tcp", "udp", "both"], help="Protocol filter")
    capture_parser.add_argument("--dst-port", type=int, help="Destination port filter")
    capture_parser.add_argument("-t", "--timeout", type=int, default=60,
                                help="Capture timeout in seconds")
    capture_parser.add_argument("-c", "--count", type=int, default=0,
                                help="Number of packets to capture (0=unlimited)")
    capture_parser.add_argument("-o", "--output", default="capture.pcap",
                                help="Output PCAP file")

    load_parser = subparsers.add_parser("load", help="Load PCAP file")
    load_parser.add_argument("pcap_file", help="PCAP file path")

    cluster_parser = subparsers.add_parser("cluster", help="Cluster packets from PCAP")
    cluster_parser.add_argument("pcap_file", help="PCAP file path")
    cluster_parser.add_argument("--eps", type=float, default=0.3,
                                help="DBSCAN epsilon parameter")
    cluster_parser.add_argument("--min-samples", type=int, default=3,
                                help="DBSCAN min_samples parameter")
    cluster_parser.add_argument("--no-sklearn", action="store_true",
                                help="Use custom DBSCAN implementation")

    infer_parser = subparsers.add_parser("infer", help="Infer protocol fields")
    infer_parser.add_argument("pcap_file", help="PCAP file path")
    infer_parser.add_argument("--entropy-threshold", type=float, default=0.5,
                              help="Entropy threshold for boundary detection")
    infer_parser.add_argument("--min-field-len", type=int, default=1,
                              help="Minimum field length")
    infer_parser.add_argument("--max-field-len", type=int, default=64,
                              help="Maximum field length")
    infer_parser.add_argument("--no-sklearn", action="store_true",
                              help="Use custom DBSCAN implementation")
    infer_parser.add_argument("--no-skip-encrypted", action="store_true",
                              help="Do not skip encrypted traffic during inference")

    describe_parser = subparsers.add_parser("describe", help="Generate protocol description XML")
    describe_parser.add_argument("pcap_file", help="PCAP file path")
    describe_parser.add_argument("-n", "--name", default="ReversedProtocol",
                                 help="Protocol name")
    describe_parser.add_argument("-o", "--output", default="protocol.xml",
                                 help="Output XML file")
    describe_parser.add_argument("--no-sklearn", action="store_true",
                                 help="Use custom DBSCAN implementation")

    fuzz_parser = subparsers.add_parser("fuzz", help="Start fuzzing target")
    fuzz_parser.add_argument("xml_file", help="Protocol description XML file")
    fuzz_parser.add_argument("host", help="Target host")
    fuzz_parser.add_argument("port", type=int, help="Target port")
    fuzz_parser.add_argument("-p", "--protocol", default="tcp",
                             choices=["tcp", "udp"], help="Transport protocol")
    fuzz_parser.add_argument("-c", "--cases", type=int, default=1000,
                             help="Maximum fuzz cases")
    fuzz_parser.add_argument("--per-message", type=int, default=100,
                             help="Cases per message type")
    fuzz_parser.add_argument("-d", "--delay", type=float, default=0.1,
                             help="Delay between cases (seconds)")
    fuzz_parser.add_argument("--timeout", type=float, default=5.0,
                             help="Response timeout (seconds)")
    fuzz_parser.add_argument("--seed", type=int, help="Random seed")
    fuzz_parser.add_argument("--coverage-guided", action="store_true",
                             help="Enable coverage-guided fuzzing")
    fuzz_parser.add_argument("--binary", help="Target binary for QEMU instrumentation")
    fuzz_parser.add_argument("--feedback-file", help="External coverage feedback file")

    full_parser = subparsers.add_parser("full", help="Run full analysis pipeline")
    full_parser.add_argument("--pcap", help="PCAP file (skip capture)")
    full_parser.add_argument("-i", "--interface", help="Network interface for capture")
    full_parser.add_argument("-p", "--protocol", default="tcp",
                             choices=["tcp", "udp", "both"], help="Protocol")
    full_parser.add_argument("-t", "--capture-time", type=int, default=60,
                             help="Capture timeout")
    full_parser.add_argument("--target-host", help="Target host for fuzzing")
    full_parser.add_argument("--target-port", type=int, help="Target port for fuzzing")
    full_parser.add_argument("--fuzz-cases", type=int, default=1000,
                             help="Number of fuzz cases")
    full_parser.add_argument("--prefix", default="analysis",
                             help="Output file prefix")
    full_parser.add_argument("--no-sklearn", action="store_true",
                             help="Use custom DBSCAN implementation")

    report_parser = subparsers.add_parser("report", help="Generate crash analysis report")
    report_parser.add_argument("crash_dir", help="Crash samples directory")
    report_parser.add_argument("-o", "--output", default="crash_report.md",
                               help="Output report file")

    web_parser = subparsers.add_parser("web", help="Start web interface")
    web_parser.add_argument("--host", default="127.0.0.1", help="Web server host")
    web_parser.add_argument("--port", type=int, default=5000, help="Web server port")

    sm_parser = subparsers.add_parser("state-machine", aliases=["sm"],
                                       help="Infer protocol state machine")
    sm_parser.add_argument("pcap_file", help="PCAP file path")
    sm_parser.add_argument("-o", "--output", help="Output DOT file for Graphviz")
    sm_parser.add_argument("--render", action="store_true", help="Render to PNG")
    sm_parser.add_argument("--render-format", default="png",
                           choices=["png", "svg", "pdf"], help="Render format")
    sm_parser.add_argument("--min-support", type=int, default=2,
                           help="Minimum support for pattern mining")
    sm_parser.add_argument("--min-confidence", type=float, default=0.5,
                           help="Minimum confidence for patterns")

    dist_master_parser = subparsers.add_parser("dist-master",
                                                help="Start distributed fuzzer master")
    dist_master_parser.add_argument("--redis-host", default="localhost",
                                    help="Redis server host")
    dist_master_parser.add_argument("--redis-port", type=int, default=6379,
                                    help="Redis server port")
    dist_master_parser.add_argument("--namespace", default="dist_fuzzer",
                                    help="Redis namespace")
    dist_master_parser.add_argument("--target-host", default="127.0.0.1",
                                    help="Target host")
    dist_master_parser.add_argument("--target-port", type=int, default=8080,
                                    help="Target port")
    dist_master_parser.add_argument("--protocol", default="tcp",
                                    choices=["tcp", "udp"], help="Transport protocol")
    dist_master_parser.add_argument("--corpus-dir", help="Corpus directory to submit")

    dist_worker_parser = subparsers.add_parser("dist-worker",
                                                help="Start distributed fuzzer worker")
    dist_worker_parser.add_argument("--redis-host", default="localhost",
                                    help="Redis server host")
    dist_worker_parser.add_argument("--redis-port", type=int, default=6379,
                                    help="Redis server port")
    dist_worker_parser.add_argument("--namespace", default="dist_fuzzer",
                                    help="Redis namespace")
    dist_worker_parser.add_argument("--worker-id", help="Worker ID (auto-generated)")
    dist_worker_parser.add_argument("--target-host", default="127.0.0.1",
                                    help="Target host")
    dist_worker_parser.add_argument("--target-port", type=int, default=8080,
                                    help="Target port")
    dist_worker_parser.add_argument("--protocol", default="tcp",
                                    choices=["tcp", "udp"], help="Transport protocol")
    dist_worker_parser.add_argument("--coverage-guided", action="store_true",
                                    help="Enable coverage-guided fuzzing")

    replay_parser = subparsers.add_parser("replay", help="Replay crash to verify")
    replay_parser.add_argument("crash_file", help="Crash sample file (binary)")
    replay_parser.add_argument("host", help="Target host")
    replay_parser.add_argument("port", type=int, help="Target port")
    replay_parser.add_argument("-p", "--protocol", default="tcp",
                               choices=["tcp", "udp"], help="Transport protocol")
    replay_parser.add_argument("-n", "--attempts", type=int, default=5,
                               help="Number of verification attempts")
    replay_parser.add_argument("-d", "--delay", type=float, default=1.0,
                               help="Delay between attempts")
    replay_parser.add_argument("--minimize", action="store_true",
                               help="Try to minimize the payload")

    poc_parser = subparsers.add_parser("poc-gen", help="Generate exploit POC script")
    poc_parser.add_argument("crash_file", help="Crash sample file (binary)")
    poc_parser.add_argument("host", help="Target host")
    poc_parser.add_argument("port", type=int, help="Target port")
    poc_parser.add_argument("-p", "--protocol", default="tcp",
                           choices=["tcp", "udp"], help="Transport protocol")
    poc_parser.add_argument("-o", "--output", help="Output file")
    poc_parser.add_argument("-f", "--format", default="python",
                           choices=["python", "rust", "bash", "powershell"],
                           help="POC generation format")
    poc_parser.add_argument("-d", "--description", default="",
                           help="Description for the exploit")

    args = parser.parse_args()

    if not args.command:
        parser.print_help()
        return

    tool = ProtocolReverseFuzzer()

    try:
        if args.command == "capture":
            tool.capture_traffic(
                interface=args.interface,
                protocol=args.protocol,
                dst_port=args.dst_port,
                timeout=args.timeout,
                packet_count=args.count,
                pcap_file=args.output
            )

        elif args.command == "load":
            stats = tool.load_pcap(args.pcap_file)
            print(json.dumps(stats, indent=2))

        elif args.command == "cluster":
            tool.load_pcap(args.pcap_file)
            tool.cluster_packets(
                eps=args.eps,
                min_samples=args.min_samples,
                use_sklearn=not args.no_sklearn
            )

        elif args.command == "infer":
            tool.load_pcap(args.pcap_file)
            tool.cluster_packets(use_sklearn=not args.no_sklearn)
            result = tool.infer_protocol(
                entropy_threshold=args.entropy_threshold,
                min_field_length=args.min_field_len,
                max_field_length=args.max_field_len,
                skip_encrypted=not args.no_skip_encrypted
            )
            print(json.dumps(result, indent=2, default=str))

        elif args.command == "describe":
            tool.load_pcap(args.pcap_file)
            tool.cluster_packets(use_sklearn=not args.no_sklearn)
            tool.infer_protocol()
            result = tool.generate_protocol_description(
                protocol_name=args.name,
                xml_file=args.output
            )
            print(result["xml"])

        elif args.command == "fuzz":
            tool.load_protocol_xml(args.xml_file)
            tool.start_fuzzing(
                target_host=args.host,
                target_port=args.port,
                protocol=args.protocol,
                max_cases=args.cases,
                cases_per_message=args.per_message,
                delay=args.delay,
                timeout=args.timeout,
                seed=args.seed,
                coverage_guided=args.coverage_guided,
                binary_path=args.binary,
                feedback_file=args.feedback_file
            )
            tool.wait_for_fuzzing()
            tool.get_crash_report()

        elif args.command == "full":
            results = tool.run_full_analysis(
                pcap_file=args.pcap,
                interface=args.interface,
                protocol=args.protocol,
                capture_timeout=args.capture_time,
                target_host=args.target_host,
                target_port=args.target_port,
                fuzz_cases=args.fuzz_cases,
                output_prefix=args.prefix,
                use_sklearn=not args.no_sklearn
            )
            print("\n" + "=" * 60)
            print("Analysis Complete!")
            print("=" * 60)
            print(json.dumps(results, indent=2, default=str))

        elif args.command == "report":
            analyzer = CrashAnalyzer(output_dir=args.crash_dir)
            analyzer.load_crashes_from_dir()
            report = analyzer.generate_crash_report(args.output)
            print(f"[*] Report generated: {args.output}")

        elif args.command == "web":
            from web_app import app
            print(f"[*] Starting web server on http://{args.host}:{args.port}")
            app.run(host=args.host, port=args.port, debug=True)

        elif args.command in ["state-machine", "sm"]:
            stats = tool.load_pcap(args.pcap_file)
            packets = [p for p in tool.traffic_capture.packets if p.payload]
            payloads = [p.payload for p in packets]

            print(f"[*] Inferring state machine from {len(packets)} packets...")

            from protocol_reverse_fuzzer.state_machine import ProtocolStateMachineInference
            sm_infer = ProtocolStateMachineInference(
                min_support=args.min_support,
                min_confidence=args.min_confidence
            )

            result = sm_infer.infer_state_machine(payloads)
            print(f"[+] State machine inferred: {result['state_machine']['state_count']} states, "
                  f"{result['state_machine']['transition_count']} transitions")
            print(f"    Patterns found: {len(result['frequent_patterns'])}")

            dot_file = args.output or "state_machine.dot"
            dot_content = sm_infer.generate_dot_graph(result['state_machine'], dot_file)
            print(f"[*] DOT graph saved: {dot_file}")

            if args.render:
                output_file = os.path.splitext(dot_file)[0] + "." + args.render_format
                if sm_infer.render_graph(dot_content, output_file, format=args.render_format):
                    print(f"[+] Graph rendered: {output_file}")
                else:
                    print(f"[!] Graphviz not available, could not render")

            print("\n[*] Top 10 patterns:")
            for i, pattern in enumerate(result['frequent_patterns'][:10]):
                print(f"    {i + 1:2d}. {pattern['sequence']} "
                      f"(support={pattern['support']}, conf={pattern.get('confidence', 0):.3f})")

        elif args.command == "dist-master":
            from protocol_reverse_fuzzer.distributed_fuzzer import (
                DistributedFuzzerMaster, CorpusSynchronizer
            )

            master = DistributedFuzzerMaster(
                redis_host=args.redis_host,
                redis_port=args.redis_port,
                namespace=args.namespace,
                target_host=args.target_host,
                target_port=args.target_port,
                protocol=args.protocol
            )

            if not master.is_available():
                print("[!] Redis is not available. Please start Redis server first.")
                print(f"    Host: {args.redis_host}:{args.redis_port}")
                sys.exit(1)

            print(f"[*] Distributed Fuzzer Master started")
            print(f"    Redis: {args.redis_host}:{args.redis_port}")
            print(f"    Target: {args.target_host}:{args.target_port} ({args.protocol})")

            if args.corpus_dir and os.path.isdir(args.corpus_dir):
                sync = CorpusSynchronizer(master, args.corpus_dir)
                sync.sync_to_remote()
                print(f"[*] Submitted corpus from: {args.corpus_dir}")

            master.start(daemon=False)

        elif args.command == "dist-worker":
            from protocol_reverse_fuzzer.distributed_fuzzer import DistributedFuzzerWorker

            worker = DistributedFuzzerWorker(
                redis_host=args.redis_host,
                redis_port=args.redis_port,
                namespace=args.namespace,
                worker_id=args.worker_id,
                target_host=args.target_host,
                target_port=args.target_port,
                protocol=args.protocol,
                coverage_guided=args.coverage_guided
            )

            if not worker.is_available():
                print("[!] Redis is not available. Please start Redis server first.")
                print(f"    Host: {args.redis_host}:{args.redis_port}")
                sys.exit(1)

            print(f"[*] Distributed Fuzzer Worker started")
            print(f"    Worker ID: {worker.worker_id}")
            print(f"    Redis: {args.redis_host}:{args.redis_port}")
            print(f"    Target: {args.target_host}:{args.target_port}")
            if args.coverage_guided:
                print(f"    Coverage-guided: ENABLED")
            print(f"\n[*] Waiting for tasks... (Ctrl+C to stop)")

            worker.run_loop()

        elif args.command == "replay":
            from protocol_reverse_fuzzer.poc_generator import CrashReplayer

            with open(args.crash_file, 'rb') as f:
                payload = f.read()

            print(f"[*] Replaying crash: {args.crash_file}")
            print(f"    Payload size: {len(payload)} bytes")
            print(f"    Target: {args.host}:{args.port} ({args.protocol})")
            print(f"    Attempts: {args.attempts}\n")

            replayer = CrashReplayer(
                target_host=args.host,
                target_port=args.port,
                protocol=args.protocol,
                timeout=5.0
            )

            result = replayer.verify_crash(
                payload=payload,
                num_attempts=args.attempts,
                delay_between=args.delay
            )

            print(f"\n[*] Verification Result")
            print(f"    Status: {result.status.value}")
            print(f"    Confirmed crashes: {result.confirmed_crashes}/{result.total_attempts}")
            print(f"    Success rate: {result.success_rate:.1%}")
            print(f"    Description: {result.description}")

            if args.minimize and result.confirmed_crashes > 0:
                print(f"\n[*] Minimizing payload...")
                minimal = replayer.minimize_payload(payload, max_iterations=20)
                if minimal and len(minimal) < len(payload):
                    min_file = os.path.splitext(args.crash_file)[0] + "_min.bin"
                    with open(min_file, 'wb') as f:
                        f.write(minimal)
                    print(f"[+] Minimized payload: {len(minimal)} bytes")
                    print(f"    Saved to: {min_file}")
                else:
                    print(f"    Could not minimize further")

            replayer.close()

        elif args.command == "poc-gen":
            from protocol_reverse_fuzzer.poc_generator import POCGenerator, POCGenerationMode

            with open(args.crash_file, 'rb') as f:
                payload = f.read()

            mode_map = {
                "python": POCGenerationMode.PYTHON,
                "rust": POCGenerationMode.RUST,
                "bash": POCGenerationMode.BASH,
                "powershell": POCGenerationMode.POWERSHELL
            }

            generator = POCGenerator(
                target_host=args.host,
                target_port=args.port,
                protocol=args.protocol
            )

            ext_map = {
                "python": "py",
                "rust": "rs",
                "bash": "sh",
                "powershell": "ps1"
            }

            output_file = args.output or f"exploit.{ext_map[args.format]}"
            generator.save_poc(
                payload=payload,
                output_file=output_file,
                mode=mode_map[args.format],
                description=args.description
            )

            print(f"[+] POC generated: {output_file}")
            print(f"    Format: {args.format}")
            print(f"    Target: {args.host}:{args.port}")
            print(f"    Payload: {len(payload)} bytes")

    except KeyboardInterrupt:
        print("\n[!] Interrupted by user")
        if args.command == "fuzz":
            tool.stop_fuzzing()
            tool.get_crash_report()
    except Exception as e:
        print(f"[!] Error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    main()
