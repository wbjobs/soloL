import numpy as np
from sklearn.cluster import KMeans
from sklearn.metrics.pairwise import euclidean_distances
from config import Config

class SampleSelector:
    def __init__(self, method='herding'):
        self.method = method
    
    def select_samples(self, features, n_samples):
        if len(features) <= n_samples:
            return list(range(len(features)))
        
        if self.method == 'herding':
            return self._herding_selection(features, n_samples)
        elif self.method == 'kmeans':
            return self._kmeans_selection(features, n_samples)
        elif self.method == 'random':
            return np.random.choice(len(features), n_samples, replace=False).tolist()
        else:
            raise ValueError(f"Unknown selection method: {self.method}")
    
    def _herding_selection(self, features, n_samples):
        features = np.array(features)
        n = len(features)
        selected = []
        remaining = list(range(n))
        
        mean = np.mean(features, axis=0)
        
        for _ in range(n_samples):
            best_idx = -1
            best_score = -np.inf
            
            for i in remaining:
                candidate_selected = selected + [i]
                candidate_mean = np.mean(features[candidate_selected], axis=0)
                score = -np.linalg.norm(candidate_mean - mean)
                
                if score > best_score:
                    best_score = score
                    best_idx = i
            
            selected.append(best_idx)
            remaining.remove(best_idx)
        
        return selected
    
    def _kmeans_selection(self, features, n_samples):
        features = np.array(features)
        
        kmeans = KMeans(n_clusters=n_samples, random_state=42, n_init=10)
        kmeans.fit(features)
        
        selected = []
        for cluster_center in kmeans.cluster_centers_:
            distances = euclidean_distances([cluster_center], features)[0]
            for idx in np.argsort(distances):
                if idx not in selected:
                    selected.append(idx)
                    break
        
        return selected
    
    def select_class_samples(self, features, labels, n_per_class):
        selected_indices = []
        unique_labels = np.unique(labels)
        
        for label in unique_labels:
            class_indices = [i for i, l in enumerate(labels) if l == label]
            class_features = [features[i] for i in class_indices]
            
            if len(class_features) <= n_per_class:
                selected_indices.extend(class_indices)
            else:
                selected_class_idx = self.select_samples(class_features, n_per_class)
                selected_indices.extend([class_indices[i] for i in selected_class_idx])
        
        return selected_indices
    
    def prune_memory_bank(self, memory_bank, n_per_class):
        pruned_indices = []
        
        for class_label in memory_bank.class_counts.keys():
            class_images, class_features = memory_bank.get_samples_by_class(class_label)
            
            if len(class_images) <= n_per_class:
                continue
            
            selected_idx = self.select_samples(class_features, n_per_class)
            
            all_indices = [i for i, l in enumerate(memory_bank.labels) if l == class_label]
            to_remove = [all_indices[i] for i in range(len(all_indices)) if i not in selected_idx]
            
            pruned_indices.extend(to_remove)
        
        if pruned_indices:
            memory_bank.remove_samples(pruned_indices)
        
        return len(pruned_indices)
