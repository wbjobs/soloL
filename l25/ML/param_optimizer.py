#!/usr/bin/env python3
import sqlite3
import json
import numpy as np
from sklearn.ensemble import RandomForestRegressor
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler
import argparse
from datetime import datetime, timedelta
import sys

DB_PATH = "../Config/battle_metrics.db"
OUTPUT_PATH = "../Config/optimized_params.json"
CONFIG_PATH = "../Config/ai_params.json"

PARAM_NAMES = [
    "attack_army_threshold",
    "defense_army_threshold",
    "reserve_ratio",
    "worker_soldier_ratio",
    "build_priority",
    "gather_priority",
    "aggression",
    "expansion_rate",
    "retreat_threshold",
    "vision_multiplier"
]

def load_data(db_path, min_samples=50):
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    query = """
        SELECT victory, attack_army_threshold, defense_army_threshold, reserve_ratio,
               worker_soldier_ratio, build_priority, gather_priority, aggression,
               expansion_rate, retreat_threshold, vision_multiplier, duration,
               ai_final_units, enemy_final_units
        FROM battles
        ORDER BY timestamp DESC
        LIMIT 5000
    """
    cursor.execute(query)
    rows = cursor.fetchall()
    conn.close()
    if len(rows) < min_samples:
        print(f"[Warning] Only {len(rows)} samples, need {min_samples} for reliable training")
    return rows

def prepare_data(rows):
    X = []
    y = []
    sample_weights = []
    for i, row in enumerate(rows):
        victory = row[0]
        params = list(row[1:11])
        duration = row[11] if row[11] else 0
        ai_units = row[12] if row[12] else 0
        enemy_units = row[13] if row[13] else 0
        X.append(params)
        if victory:
            score = 1.0
            if ai_units > 0 and enemy_units > 0:
                score += min(0.5, ai_units / (enemy_units + 1))
        else:
            score = 0.0
            if ai_units > 0 and enemy_units > 0:
                score = max(0.0, 0.3 - enemy_units / (ai_units + 1) * 0.3)
        y.append(score)
        weight = 1.0 - (i / len(rows)) * 0.5
        sample_weights.append(weight)
    return np.array(X), np.array(y), np.array(sample_weights)

def train_model(X, y, weights):
    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(X)
    X_train, X_test, y_train, y_test, w_train, w_test = train_test_split(
        X_scaled, y, weights, test_size=0.2, random_state=42
    )
    model = RandomForestRegressor(
        n_estimators=100,
        max_depth=10,
        min_samples_split=5,
        random_state=42
    )
    model.fit(X_train, y_train, sample_weight=w_train)
    train_score = model.score(X_train, y_train)
    test_score = model.score(X_test, y_test)
    print(f"[Model] Train R²: {train_score:.4f}, Test R²: {test_score:.4f}")
    return model, scaler

def feature_importance(model, param_names):
    importances = model.feature_importances_
    indices = np.argsort(importances)[::-1]
    print("\n[Feature Importance]")
    for idx in indices:
        print(f"  {param_names[idx]:25s}: {importances[idx]:.4f}")
    return {param_names[i]: importances[i] for i in range(len(param_names))}

def optimize_params(model, scaler, param_ranges, num_iterations=1000):
    best_score = -1
    best_params = None
    np.random.seed(42)
    for _ in range(num_iterations):
        candidate = []
        for i, (p_min, p_max) in enumerate(param_ranges):
            val = np.random.uniform(p_min, p_max)
            candidate.append(val)
        X_candidate = scaler.transform([candidate])
        score = model.predict(X_candidate)[0]
        if score > best_score:
            best_score = score
            best_params = candidate.copy()
    return best_params, best_score

def gradient_optimize(model, scaler, initial_params, param_ranges, steps=50, lr=0.01):
    current = np.array(initial_params, dtype=np.float32).copy()
    for _ in range(steps):
        grad = np.zeros_like(current)
        eps = 0.01
        for i in range(len(current)):
            p_plus = current.copy()
            p_plus[i] += eps
            p_minus = current.copy()
            p_minus[i] -= eps
            s_plus = model.predict(scaler.transform([p_plus]))[0]
            s_minus = model.predict(scaler.transform([p_minus]))[0]
            grad[i] = (s_plus - s_minus) / (2 * eps)
        current += lr * grad
        for i, (p_min, p_max) in enumerate(param_ranges):
            current[i] = np.clip(current[i], p_min, p_max)
    final_score = model.predict(scaler.transform([current]))[0]
    return current.tolist(), final_score

def get_param_ranges():
    return [
        (1.0, 20.0),
        (1.0, 15.0),
        (0.0, 0.8),
        (0.5, 5.0),
        (0.1, 3.0),
        (0.1, 3.0),
        (0.0, 1.0),
        (0.0, 1.0),
        (0.1, 0.7),
        (0.5, 2.0),
    ]

def save_optimized_params(params, param_names, score, output_path):
    result = {
        "optimization_timestamp": datetime.now().isoformat(),
        "predicted_performance": float(score),
        "params": {}
    }
    for i, name in enumerate(param_names):
        result["params"][name] = float(params[i])
    with open(output_path, 'w') as f:
        json.dump(result, f, indent=2)
    print(f"\n[Output] Saved to {output_path}")
    print(f"[Predicted] Performance score: {score:.4f}")
    print("\n[Optimized Parameters]")
    for i, name in enumerate(param_names):
        print(f"  {name:25s}: {params[i]:.4f}")

def apply_to_config(params, param_names, config_path):
    param_map = {}
    for i, name in enumerate(param_names):
        param_map[name] = params[i]
    config = {}
    try:
        with open(config_path, 'r') as f:
            config = json.load(f)
    except FileNotFoundError:
        pass
    config.update({
        "AttackArmyThreshold": param_map["attack_army_threshold"],
        "DefenseArmyThreshold": param_map["defense_army_threshold"],
        "ResourceReserveRatio": param_map["reserve_ratio"],
        "WorkerToSoldierRatio": param_map["worker_soldier_ratio"],
        "BuildPriorityWeight": param_map["build_priority"],
        "GatherPriorityWeight": param_map["gather_priority"],
        "AggressionLevel": param_map["aggression"],
        "ExpansionRate": param_map["expansion_rate"],
        "RetreatHealthThreshold": param_map["retreat_threshold"],
        "VisionRadiusMultiplier": param_map["vision_multiplier"],
    })
    with open(config_path, 'w') as f:
        json.dump(config, f, indent=2)
    print(f"[Config] Updated {config_path}")

def main():
    parser = argparse.ArgumentParser(description="RTS AI Parameter Optimizer")
    parser.add_argument("--db", default=DB_PATH, help="SQLite DB path")
    parser.add_argument("--output", default=OUTPUT_PATH, help="Output JSON path")
    parser.add_argument("--config", default=CONFIG_PATH, help="Config JSON path")
    parser.add_argument("--apply", action="store_true", help="Apply to config file")
    parser.add_argument("--iters", type=int, default=1000, help="Optimization iterations")
    parser.add_argument("--min-samples", type=int, default=10, help="Min samples for training")
    args = parser.parse_args()
    print("=== RTS AI Parameter Optimizer ===")
    print(f"[DB] {args.db}")
    rows = load_data(args.db, args.min_samples)
    if not rows:
        print("[Error] No data found. Need battle data first.")
        return 1
    print(f"[Data] Loaded {len(rows)} battle records")
    X, y, weights = prepare_data(rows)
    print(f"[Labels] Mean score: {np.mean(y):.4f}")
    model, scaler = train_model(X, y, weights)
    feature_importance(model, PARAM_NAMES)
    param_ranges = get_param_ranges()
    print(f"\n[Optimization] Running {args.iters} iterations...")
    rand_params, rand_score = optimize_params(model, scaler, param_ranges, args.iters)
    initial_idx = np.argmax(y)
    initial_params = X[initial_idx].tolist()
    grad_params, grad_score = gradient_optimize(model, scaler, initial_params, param_ranges)
    if grad_score > rand_score:
        best_params, best_score = grad_params, grad_score
        print(f"[Gradient] Found better params: {grad_score:.4f} vs {rand_score:.4f}")
    else:
        best_params, best_score = rand_params, rand_score
        print(f"[Random] Found better params: {rand_score:.4f} vs {grad_score:.4f}")
    save_optimized_params(best_params, PARAM_NAMES, best_score, args.output)
    if args.apply:
        apply_to_config(best_params, PARAM_NAMES, args.config)
    print("\n=== Optimization Complete ===")
    return 0

if __name__ == "__main__":
    sys.exit(main())
