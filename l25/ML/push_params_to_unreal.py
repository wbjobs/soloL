#!/usr/bin/env python3
import requests
import json
import argparse
import sys

DEFAULT_URL = "http://localhost:8080"

def get_current_params(host, port):
    url = f"http://{host}:{port}/api/params"
    try:
        resp = requests.get(url, timeout=5)
        resp.raise_for_status()
        return resp.json()
    except Exception as e:
        print(f"[Error] Failed to get params: {e}")
        return None

def push_params(host, port, params):
    url = f"http://{host}:{port}/api/params"
    try:
        resp = requests.post(url, json=params, timeout=5)
        resp.raise_for_status()
        return resp.json()
    except Exception as e:
        print(f"[Error] Failed to push params: {e}")
        return None

def reload_params(host, port):
    url = f"http://{host}:{port}/api/reload"
    try:
        resp = requests.post(url, json={}, timeout=5)
        resp.raise_for_status()
        return resp.json()
    except Exception as e:
        print(f"[Error] Failed to reload: {e}")
        return None

def get_metrics(host, port):
    url = f"http://{host}:{port}/api/metrics"
    try:
        resp = requests.get(url, timeout=5)
        resp.raise_for_status()
        return resp.json()
    except Exception as e:
        print(f"[Error] Failed to get metrics: {e}")
        return None

def load_params_file(path):
    with open(path, 'r') as f:
        data = json.load(f)
    if "params" in data:
        return data["params"]
    return data

def convert_param_names(ml_params):
    mapping = {
        "attack_army_threshold": "AttackArmyThreshold",
        "defense_army_threshold": "DefenseArmyThreshold",
        "reserve_ratio": "ResourceReserveRatio",
        "worker_soldier_ratio": "WorkerToSoldierRatio",
        "build_priority": "BuildPriorityWeight",
        "gather_priority": "GatherPriorityWeight",
        "aggression": "AggressionLevel",
        "expansion_rate": "ExpansionRate",
        "retreat_threshold": "RetreatHealthThreshold",
        "vision_multiplier": "VisionRadiusMultiplier",
    }
    result = {}
    for k, v in ml_params.items():
        if k in mapping:
            result[mapping[k]] = v
        else:
            result[k] = v
    return result

def main():
    parser = argparse.ArgumentParser(description="Push AI params to Unreal Engine")
    parser.add_argument("--host", default="localhost", help="Server host")
    parser.add_argument("--port", type=int, default=8080, help="Server port")
    parser.add_argument("--file", default="../Config/optimized_params.json", help="Params JSON file")
    parser.add_argument("--get", action="store_true", help="Get current params")
    parser.add_argument("--metrics", action="store_true", help="Get battle metrics")
    parser.add_argument("--reload", action="store_true", help="Trigger hot-reload")
    parser.add_argument("--param", nargs=2, action="append", metavar=("KEY", "VALUE"), help="Set single param")
    args = parser.parse_args()
    print(f"=== RTS AI Param Client ===")
    print(f"[Server] {args.host}:{args.port}")
    if args.get:
        params = get_current_params(args.host, args.port)
        if params:
            print("\n[Current Params]")
            for k, v in sorted(params.items()):
                print(f"  {k:30s}: {v}")
        return 0
    if args.metrics:
        metrics = get_metrics(args.host, args.port)
        if metrics:
            print("\n[Battle Metrics]")
            for k, v in sorted(metrics.items()):
                print(f"  {k:20s}: {v}")
        return 0
    if args.reload:
        result = reload_params(args.host, args.port)
        if result:
            print(f"[Reload] {result}")
        return 0
    params_to_push = {}
    if args.param:
        for k, v in args.param:
            try:
                if "." in v:
                    params_to_push[k] = float(v)
                elif v.lower() in ("true", "false"):
                    params_to_push[k] = v.lower() == "true"
                else:
                    params_to_push[k] = int(v)
            except ValueError:
                params_to_push[k] = v
    else:
        try:
            ml_params = load_params_file(args.file)
            params_to_push = convert_param_names(ml_params)
        except FileNotFoundError:
            print(f"[Error] File not found: {args.file}")
            return 1
    print(f"\n[Pushing {len(params_to_push)} params]")
    for k, v in sorted(params_to_push.items()):
        print(f"  {k:30s}: {v}")
    result = push_params(args.host, args.port, params_to_push)
    if result:
        print(f"\n[Success] {result}")
        return 0
    return 1

if __name__ == "__main__":
    sys.exit(main())
