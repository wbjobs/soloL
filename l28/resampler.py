import numpy as np
from config import Config

class DynamicResampler:
    def __init__(self, target_ratio=Config.RESAMPLER_TARGET_RATIO,
                 max_oversample_factor=Config.RESAMPLER_MAX_OVERSAMPLE,
                 undersample_min=Config.RESAMPLER_UNDERSAMPLE_MIN):
        self.target_ratio = target_ratio
        self.max_oversample_factor = max_oversample_factor
        self.undersample_min = undersample_min

    def compute_class_counts(self, labels):
        unique, counts = np.unique(labels, return_counts=True)
        return dict(zip(unique, counts))

    def compute_target_count(self, class_counts):
        if not class_counts:
            return 0
        counts = list(class_counts.values())
        median_count = int(np.median(counts))
        max_count = max(counts)
        target = int(median_count * (1 + self.target_ratio))
        target = min(target, max_count)
        return max(target, 1)

    def oversample_class(self, images, labels, features, target_count):
        n = len(images)
        if n == 0 or n >= target_count:
            return images, labels, features

        indices = np.random.choice(n, target_count - n, replace=True)
        oversampled_images = list(images) + [images[i] for i in indices]
        oversampled_labels = list(labels) + [labels[i] for i in indices]
        oversampled_features = None
        if features is not None and len(features) > 0:
            oversampled_features = list(features) + [features[i] for i in indices]

        return oversampled_images, oversampled_labels, oversampled_features

    def undersample_class(self, images, labels, features, target_count):
        n = len(images)
        if n == 0 or n <= target_count:
            return images, labels, features

        min_keep = max(int(n * self.undersample_min), 1)
        actual_target = max(target_count, min_keep)

        indices = np.random.choice(n, actual_target, replace=False)
        indices = sorted(indices)

        undersampled_images = [images[i] for i in indices]
        undersampled_labels = [labels[i] for i in indices]
        undersampled_features = None
        if features is not None and len(features) > 0:
            undersampled_features = [features[i] for i in indices]

        return undersampled_images, undersampled_labels, undersampled_features

    def resample(self, images, labels, features=None):
        images = np.array(images)
        labels = np.array(labels)

        class_counts = self.compute_class_counts(labels)
        if not class_counts:
            return images, labels, features

        target_count = self.compute_target_count(class_counts)

        max_factor = self.max_oversample_factor
        min_count = min(class_counts.values())
        for cls, cnt in class_counts.items():
            factor = target_count / max(cnt, 1)
            if factor > max_factor:
                target_count = int(cnt * max_factor)

        resampled_images = []
        resampled_labels = []
        resampled_features = [] if features is not None else None

        unique_classes = sorted(class_counts.keys())
        for cls in unique_classes:
            cls_indices = np.where(labels == cls)[0]
            cls_images = [images[i] for i in cls_indices]
            cls_labels = [labels[i] for i in cls_indices]
            cls_features = [features[i] for i in cls_indices] if features is not None else None

            cnt = class_counts[cls]

            if cnt < target_count:
                cls_images, cls_labels, cls_features = self.oversample_class(
                    cls_images, cls_labels, cls_features, target_count
                )
            elif cnt > target_count:
                cls_images, cls_labels, cls_features = self.undersample_class(
                    cls_images, cls_labels, cls_features, target_count
                )

            resampled_images.extend(cls_images)
            resampled_labels.extend(cls_labels)
            if resampled_features is not None:
                resampled_features.extend(cls_features)

        if resampled_features is not None:
            return np.array(resampled_images), np.array(resampled_labels), resampled_features
        return np.array(resampled_images), np.array(resampled_labels), None

    def compute_class_weights(self, labels, num_classes):
        class_counts = self.compute_class_counts(labels)
        total = len(labels)

        weights = np.ones(num_classes, dtype=np.float32)
        for cls in range(num_classes):
            cnt = class_counts.get(cls, 0)
            if cnt > 0:
                weights[cls] = total / (num_classes * cnt)
            else:
                weights[cls] = 1.0

        max_weight = np.max(weights)
        if max_weight > 0:
            weights = weights / max_weight

        return weights

    def compute_sample_weights(self, labels, class_weights):
        return np.array([class_weights[int(l)] for l in labels], dtype=np.float32)
