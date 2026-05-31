import numpy as np
from collections import defaultdict
import logging

logger = logging.getLogger(__name__)

class FedAvgAggregator:
    def __init__(self):
        self.client_updates = {}
        self.global_weights = None
        self.round_number = 0
        self.min_clients = 2

    def register_update(self, device_id, weights, num_samples):
        self.client_updates[device_id] = {
            'weights': weights,
            'num_samples': num_samples
        }
        logger.info(f"Registered update from {device_id}, samples={num_samples}, "
                     f"total clients this round={len(self.client_updates)}")

    def can_aggregate(self):
        return len(self.client_updates) >= self.min_clients

    def aggregate(self):
        if not self.can_aggregate():
            logger.warning(f"Not enough clients for aggregation: "
                           f"{len(self.client_updates)}/{self.min_clients}")
            return None

        total_samples = sum(u['num_samples'] for u in self.client_updates.values())
        if total_samples == 0:
            return None

        aggregated_weights = []
        first_update = next(iter(self.client_updates.values()))
        num_layers = len(first_update['weights'])

        for layer_idx in range(num_layers):
            weighted_sum = None
            for device_id, update in self.client_updates.items():
                weight_ratio = update['num_samples'] / total_samples
                layer_weight = update['weights'][layer_idx].astype(np.float64)
                
                if weighted_sum is None:
                    weighted_sum = weight_ratio * layer_weight
                else:
                    weighted_sum += weight_ratio * layer_weight
            
            aggregated_weights.append(weighted_sum.astype(np.float32))

        self.global_weights = aggregated_weights
        self.round_number += 1
        
        num_clients = len(self.client_updates)
        self.client_updates.clear()
        
        logger.info(f"FedAvg aggregation complete: round={self.round_number}, "
                     f"clients={num_clients}, total_samples={total_samples}")
        
        return self.global_weights

    def get_global_weights(self):
        return self.global_weights

    def get_round_number(self):
        return self.round_number

    def get_client_count(self):
        return len(self.client_updates)

    def reset_round(self):
        self.client_updates.clear()
