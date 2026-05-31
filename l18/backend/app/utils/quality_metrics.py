import numpy as np
from typing import Dict, List, Tuple, Optional, Any
from collections import Counter


def calculate_label_entropy(labels: List[int]) -> float:
    if len(labels) == 0:
        return 0.0
    
    label_counts = Counter(labels)
    total = len(labels)
    
    entropy = 0.0
    for count in label_counts.values():
        if count > 0:
            p = count / total
            entropy -= p * np.log2(p)
    
    return entropy


def calculate_label_distribution(labels: List[int]) -> Dict[int, int]:
    return dict(Counter(labels))


def krippendorff_alpha(
    reliability_data: List[List[Optional[int]]],
    num_labels: int = 10
) -> float:
    if not reliability_data:
        return 0.0
    
    n_units = len(reliability_data)
    if n_units == 0:
        return 0.0
    
    n_coders = max(len(unit) for unit in reliability_data)
    if n_coders < 2:
        return 0.0
    
    label_pairs = []
    
    for unit_labels in reliability_data:
        valid_labels = [l for l in unit_labels if l is not None]
        if len(valid_labels) >= 2:
            for i in range(len(valid_labels)):
                for j in range(i + 1, len(valid_labels)):
                    label_pairs.append((valid_labels[i], valid_labels[j]))
    
    if len(label_pairs) < 2:
        return 0.0
    
    n_pairs = len(label_pairs)
    
    observed_agreement = sum(1 for l1, l2 in label_pairs if l1 == l2) / n_pairs
    
    all_labels = [l for pair in label_pairs for l in pair]
    label_counts = Counter(all_labels)
    
    chance_agreement = 0.0
    for count in label_counts.values():
        p = count / (n_pairs * 2)
        chance_agreement += p * p
    
    if chance_agreement >= 1.0:
        return 1.0 if observed_agreement >= 1.0 else 0.0
    
    alpha = (observed_agreement - chance_agreement) / (1 - chance_agreement)
    
    return max(-1.0, min(1.0, alpha))


def krippendorff_alpha_nominal(
    annotations: Dict[int, Dict[str, int]],
    num_labels: int = 10
) -> float:
    if not annotations:
        return 0.0
    
    reliability_data = []
    
    for point_idx, user_labels in annotations.items():
        labels = list(user_labels.values())
        if len(labels) >= 2:
            reliability_data.append(labels)
    
    return krippendorff_alpha(reliability_data, num_labels)


def find_controversial_points(
    annotations: Dict[int, Dict[str, int]],
    entropy_threshold: float = 0.8,
    min_annotators: int = 2
) -> List[Dict[str, Any]]:
    controversial_points = []
    
    for point_idx, user_labels in annotations.items():
        labels = list(user_labels.values())
        
        if len(labels) < min_annotators:
            continue
        
        entropy = calculate_label_entropy(labels)
        distribution = calculate_label_distribution(labels)
        
        if entropy >= entropy_threshold:
            controversial_points.append({
                "point_index": point_idx,
                "entropy": entropy,
                "label_distribution": distribution,
                "annotator_count": len(labels),
            })
    
    return controversial_points


def calculate_overall_quality(
    annotations: Dict[int, Dict[str, int]],
    alpha_threshold: float = 0.6,
    entropy_threshold: float = 0.8
) -> Dict[str, Any]:
    alpha = krippendorff_alpha_nominal(annotations)
    controversial_points = find_controversial_points(annotations, entropy_threshold)
    
    all_labels = []
    for user_labels in annotations.values():
        all_labels.extend(list(user_labels.values()))
    
    overall_entropy = calculate_label_entropy(all_labels) if all_labels else 0.0
    
    return {
        "krippendorff_alpha": alpha,
        "overall_entropy": overall_entropy,
        "controversial_points": controversial_points,
        "controversial_point_count": len(controversial_points),
        "needs_review": alpha < alpha_threshold,
        "annotated_point_count": len(annotations),
        "total_annotations": len(all_labels),
        "quality_level": "excellent" if alpha >= 0.8 else "good" if alpha >= 0.6 else "poor",
    }


def resolve_label_conflict(
    labels: List[Tuple[int, int]],
    default_label: int = 0
) -> int:
    if not labels:
        return default_label
    
    max_priority = -1
    best_label = default_label
    latest_timestamp = 0
    
    from datetime import datetime
    
    for label, priority in labels:
        if priority > max_priority:
            max_priority = priority
            best_label = label
            latest_timestamp = datetime.utcnow().timestamp()
        elif priority == max_priority:
            return best_label
    
    return best_label


def resolve_label_conflict_with_users(
    user_labels: List[Tuple[str, int, int]],
    default_label: int = 0
) -> Tuple[int, str]:
    if not user_labels:
        return default_label, ""
    
    max_priority = -1
    best_label = default_label
    best_user_id = ""
    
    for user_id, label, priority in user_labels:
        if priority > max_priority:
            max_priority = priority
            best_label = label
            best_user_id = user_id
        elif priority == max_priority:
            return best_label, best_user_id
    
    return best_label, best_user_id


def merge_labels_with_priority(
    existing_labels: Dict[int, Tuple[int, int, str]],
    new_annotations: List[Dict[str, Any]],
    role_priority: Dict[str, int]
) -> Dict[int, Tuple[int, int, str]]:
    merged = dict(existing_labels)
    
    for ann in new_annotations:
        point_idx = ann["point_index"]
        label = ann["label_id"]
        role = ann["role"]
        user_id = ann["user_id"]
        priority = role_priority.get(role, 0)
        
        if point_idx not in merged:
            merged[point_idx] = (label, priority, user_id)
        else:
            existing_label, existing_priority, existing_user = merged[point_idx]
            if priority > existing_priority:
                merged[point_idx] = (label, priority, user_id)
            elif priority == existing_priority:
                pass
    
    return merged
