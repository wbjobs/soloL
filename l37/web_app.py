#!/usr/bin/env python3
import os
import sys
import json
import base64
from datetime import datetime
from flask import Flask, render_template, request, jsonify, Response

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from main import ProtocolReverseFuzzer
from protocol_reverse_fuzzer.fuzzer import MutationStrategy

app = Flask(__name__)
app.config['SECRET_KEY'] = 'protocol-reverse-fuzzer-secret'

tool = ProtocolReverseFuzzer()


@app.route('/')
def index():
    return render_template('index.html')


@app.route('/api/interfaces', methods=['GET'])
def get_interfaces():
    from protocol_reverse_fuzzer.traffic_capture import TrafficCapture
    tc = TrafficCapture()
    interfaces = tc.get_interfaces()
    return jsonify({"interfaces": interfaces})


@app.route('/api/capture', methods=['POST'])
def start_capture():
    data = request.json
    interface = data.get('interface')
    protocol = data.get('protocol', 'tcp')
    dst_port = data.get('dst_port')
    timeout = data.get('timeout', 60)
    packet_count = data.get('packet_count', 0)
    output_file = data.get('output', 'capture.pcap')

    try:
        stats = tool.capture_traffic(
            interface=interface,
            protocol=protocol,
            dst_port=dst_port,
            timeout=timeout,
            packet_count=packet_count,
            pcap_file=output_file
        )
        return jsonify({"success": True, "stats": stats})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route('/api/capture/stop', methods=['POST'])
def stop_capture():
    if tool.traffic_capture:
        tool.traffic_capture.stop_capture()
        return jsonify({"success": True})
    return jsonify({"success": False, "error": "No capture running"})


@app.route('/api/pcap/load', methods=['POST'])
def load_pcap():
    if 'file' not in request.files:
        return jsonify({"success": False, "error": "No file provided"}), 400

    file = request.files['file']
    if file.filename == '':
        return jsonify({"success": False, "error": "No file selected"}), 400

    if file:
        filename = os.path.join(tool.output_dir, "pcap", file.filename)
        file.save(filename)

        try:
            stats = tool.load_pcap(filename)
            return jsonify({"success": True, "stats": stats})
        except Exception as e:
            return jsonify({"success": False, "error": str(e)}), 500


@app.route('/api/pcap/info', methods=['GET'])
def get_pcap_info():
    if tool.traffic_capture:
        stats = tool.traffic_capture.get_statistics()
        packets = tool.traffic_capture.packets[:100]
        packet_list = []
        for pkt in packets:
            packet_list.append({
                "timestamp": pkt.timestamp,
                "src": f"{pkt.src_ip}:{pkt.src_port}",
                "dst": f"{pkt.dst_ip}:{pkt.dst_port}",
                "protocol": pkt.protocol,
                "length": len(pkt.payload),
                "payload_hex": pkt.payload[:64].hex(),
                "direction": pkt.direction
            })
        return jsonify({
            "success": True,
            "stats": stats,
            "packets": packet_list
        })
    return jsonify({"success": False, "error": "No PCAP loaded"})


@app.route('/api/cluster', methods=['POST'])
def cluster_packets():
    data = request.json
    eps = data.get('eps', 0.3)
    min_samples = data.get('min_samples', 3)
    use_sklearn = data.get('use_sklearn', True)

    try:
        result = tool.cluster_packets(
            eps=eps,
            min_samples=min_samples,
            use_sklearn=use_sklearn
        )
        return jsonify({"success": True, "result": result})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route('/api/cluster/info', methods=['GET'])
def get_cluster_info():
    if tool.packet_clustering:
        clusters = {}
        for cid, cluster in tool.packet_clustering.clusters.items():
            clusters[str(cid)] = {
                "cluster_id": cid,
                "packet_count": len(cluster.packets),
                "representative_hex": cluster.representative.hex(),
                "packets": [p[:64].hex() for p in cluster.packets[:10]]
            }
        return jsonify({
            "success": True,
            "summary": tool.packet_clustering.get_cluster_summary(),
            "clusters": clusters
        })
    return jsonify({"success": False, "error": "No clustering performed"})


@app.route('/api/infer', methods=['POST'])
def infer_protocol():
    data = request.json
    entropy_threshold = data.get('entropy_threshold', 0.5)
    min_field_length = data.get('min_field_length', 1)
    max_field_length = data.get('max_field_length', 64)

    try:
        result = tool.infer_protocol(
            entropy_threshold=entropy_threshold,
            min_field_length=min_field_length,
            max_field_length=max_field_length
        )
        return jsonify({"success": True, "result": result})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route('/api/infer/info', methods=['GET'])
def get_infer_info():
    if tool.protocol_inference:
        return jsonify({
            "success": True,
            "fields": tool.protocol_inference.get_fields_summary(),
            "entropy_profile": tool.protocol_inference.get_entropy_profile()
        })
    return jsonify({"success": False, "error": "No inference performed"})


@app.route('/api/describe', methods=['POST'])
def generate_description():
    data = request.json
    protocol_name = data.get('name', 'ReversedProtocol')
    output_file = data.get('output', 'protocol.xml')

    try:
        result = tool.generate_protocol_description(
            protocol_name=protocol_name,
            xml_file=output_file
        )
        return jsonify({"success": True, "result": result})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route('/api/describe/info', methods=['GET'])
def get_description_info():
    if tool.protocol_description:
        return jsonify({
            "success": True,
            "summary": tool.protocol_description.get_summary(),
            "visualization": tool.protocol_description.visualize_protocol()
        })
    return jsonify({"success": False, "error": "No protocol description"})


@app.route('/api/describe/xml', methods=['GET'])
def get_protocol_xml():
    if tool.protocol_description:
        xml = tool.protocol_description.generate_xml()
        return Response(xml, mimetype='application/xml')
    return jsonify({"success": False, "error": "No protocol description"}), 404


@app.route('/api/fuzz/start', methods=['POST'])
def start_fuzzing():
    data = request.json
    target_host = data.get('host')
    target_port = data.get('port')
    protocol = data.get('protocol', 'tcp')
    max_cases = data.get('max_cases', 1000)
    cases_per_message = data.get('cases_per_message', 100)
    delay = data.get('delay', 0.1)
    timeout = data.get('timeout', 5.0)
    seed = data.get('seed')

    try:
        result = tool.start_fuzzing(
            target_host=target_host,
            target_port=target_port,
            protocol=protocol,
            max_cases=max_cases,
            cases_per_message=cases_per_message,
            delay=delay,
            timeout=timeout,
            seed=seed
        )
        return jsonify({"success": True, "result": result})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route('/api/fuzz/stop', methods=['POST'])
def stop_fuzzing():
    result = tool.stop_fuzzing()
    return jsonify(result)


@app.route('/api/fuzz/status', methods=['GET'])
def get_fuzzing_status():
    status = tool.get_fuzzing_status()
    return jsonify(status)


@app.route('/api/fuzz/wait', methods=['POST'])
def wait_for_fuzzing():
    tool.wait_for_fuzzing()
    return get_fuzzing_status()


@app.route('/api/crashes', methods=['GET'])
def get_crashes():
    if tool.crash_analyzer:
        category = request.args.get('category')
        limit = int(request.args.get('limit', 20))

        crashes = tool.crash_analyzer.get_crashes_by_category(category)
        crash_list = [c.to_dict() for c in crashes[:limit]]

        return jsonify({
            "success": True,
            "statistics": tool.crash_analyzer.get_crash_statistics(),
            "crashes": crash_list
        })
    return jsonify({"success": False, "error": "No crash analyzer"})


@app.route('/api/crashes/<crash_id>', methods=['GET'])
def get_crash_details(crash_id):
    if tool.crash_analyzer and crash_id in tool.crash_analyzer.crashes:
        crash = tool.crash_analyzer.crashes[crash_id]
        return jsonify({
            "success": True,
            "crash": crash.to_dict(),
            "readable": crash.to_readable_format(),
            "diff": tool.crash_analyzer.visualize_packet_difference(crash_id),
            "sequence": tool.crash_analyzer.get_crash_sequence(crash_id)
        })
    return jsonify({"success": False, "error": "Crash not found"})


@app.route('/api/crashes/report', methods=['POST'])
def generate_crash_report():
    data = request.json
    output_file = data.get('output', 'crash_report.md')

    try:
        result = tool.get_crash_report(output_file)
        return jsonify({"success": True, "result": result})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route('/api/pipeline/full', methods=['POST'])
def run_full_pipeline():
    data = request.json
    pcap_file = data.get('pcap')
    interface = data.get('interface')
    protocol = data.get('protocol', 'tcp')
    capture_time = data.get('capture_time', 60)
    target_host = data.get('target_host')
    target_port = data.get('target_port')
    fuzz_cases = data.get('fuzz_cases', 1000)
    prefix = data.get('prefix', 'analysis')

    try:
        results = tool.run_full_analysis(
            pcap_file=pcap_file,
            interface=interface,
            protocol=protocol,
            capture_timeout=capture_time,
            target_host=target_host,
            target_port=target_port,
            fuzz_cases=fuzz_cases,
            output_prefix=prefix
        )
        return jsonify({"success": True, "results": results})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route('/api/strategies', methods=['GET'])
def get_mutation_strategies():
    strategies = []
    for s in MutationStrategy:
        strategies.append({
            "name": s.name,
            "value": s.value,
            "description": {
                "bit_flip": "Flip individual bits in the packet",
                "boundary_value": "Use boundary values (0, max, min+1, etc.)",
                "random_bytes": "Insert random bytes at random positions",
                "arithmetic": "Perform arithmetic operations on numeric fields",
                "interesting_values": "Use known interesting values",
                "block_operation": "Duplicate, delete, or overwrite blocks of data"
            }.get(s.value, "")
        })
    return jsonify({"strategies": strategies})


@app.route('/api/output/files', methods=['GET'])
def list_output_files():
    files = []
    for root, dirs, filenames in os.walk(tool.output_dir):
        for filename in filenames:
            filepath = os.path.join(root, filename)
            rel_path = os.path.relpath(filepath, tool.output_dir)
            size = os.path.getsize(filepath)
            mtime = datetime.fromtimestamp(os.path.getmtime(filepath)).isoformat()
            files.append({
                "path": rel_path,
                "size": size,
                "modified": mtime
            })
    return jsonify({"files": files})


@app.route('/api/output/download/<path:filepath>', methods=['GET'])
def download_file(filepath):
    full_path = os.path.join(tool.output_dir, filepath)
    if os.path.exists(full_path):
        with open(full_path, 'rb') as f:
            content = f.read()
        return Response(
            content,
            mimetype='application/octet-stream',
            headers={'Content-Disposition': f'attachment; filename="{os.path.basename(filepath)}"'}
        )
    return jsonify({"success": False, "error": "File not found"}), 404


@app.route('/api/health', methods=['GET'])
def health_check():
    return jsonify({
        "status": "ok",
        "timestamp": datetime.now().isoformat(),
        "output_dir": tool.output_dir
    })


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)
