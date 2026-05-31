from typing import Any
import numpy as np

from app.extensions import db
from app.models import PointCloud, LabelChunk


class PointCloudService:
    @staticmethod
    def get_labels_for_points(
        point_cloud_id: str,
        start_index: int,
        end_index: int,
    ) -> np.ndarray:
        num_points = end_index - start_index + 1
        labels = np.zeros(num_points, dtype=np.uint32)

        chunks = LabelChunk.query.filter(
            LabelChunk.point_cloud_id == point_cloud_id,
            LabelChunk.start_index <= end_index,
            LabelChunk.end_index >= start_index,
        ).order_by(LabelChunk.start_index).all()

        for chunk in chunks:
            chunk_start = max(chunk.start_index, start_index)
            chunk_end = min(chunk.end_index, end_index)

            if chunk_start > chunk_end:
                continue

            if chunk.label_data:
                chunk_labels = np.frombuffer(chunk.label_data, dtype=np.uint32)
                local_start = chunk_start - chunk.start_index
                local_end = chunk_end - chunk.start_index + 1
                dest_start = chunk_start - start_index
                dest_end = chunk_end - start_index + 1

                if local_end <= len(chunk_labels):
                    labels[dest_start:dest_end] = chunk_labels[local_start:local_end]
            elif chunk.label_id is not None:
                dest_start = chunk_start - start_index
                dest_end = chunk_end - start_index + 1
                labels[dest_start:dest_end] = chunk.label_id

        return labels

    @staticmethod
    def update_labels(
        point_cloud_id: str,
        updates: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        all_changes = []

        for update in updates:
            if "pointIndices" in update:
                point_indices = np.array(update["pointIndices"], dtype=np.int64)
                label_id = update["labelId"]

                if len(point_indices) == 0:
                    continue

                old_labels = PointCloudService.get_labels_for_points(
                    point_cloud_id,
                    int(np.min(point_indices)),
                    int(np.max(point_indices)),
                )

                for idx in point_indices:
                    local_idx = idx - int(np.min(point_indices))
                    if 0 <= local_idx < len(old_labels):
                        old_label = int(old_labels[local_idx])
                        if old_label != label_id:
                            all_changes.append({
                                "pointIndex": int(idx),
                                "oldLabel": old_label,
                                "newLabel": label_id,
                            })

                sorted_indices = np.sort(point_indices)
                runs = []
                current_start = sorted_indices[0]
                current_end = sorted_indices[0]

                for i in range(1, len(sorted_indices)):
                    if sorted_indices[i] == current_end + 1:
                        current_end = sorted_indices[i]
                    else:
                        runs.append((current_start, current_end))
                        current_start = sorted_indices[i]
                        current_end = sorted_indices[i]
                runs.append((current_start, current_end))

                for run_start, run_end in runs:
                    PointCloudService._create_or_update_chunk(
                        point_cloud_id,
                        int(run_start),
                        int(run_end),
                        label_id,
                    )

            elif "startIndex" in update and "endIndex" in update:
                start_idx = update["startIndex"]
                end_idx = update["endIndex"]
                label_id = update["labelId"]

                old_labels = PointCloudService.get_labels_for_points(
                    point_cloud_id, start_idx, end_idx
                )

                for i, old_label in enumerate(old_labels):
                    if int(old_label) != label_id:
                        all_changes.append({
                            "pointIndex": start_idx + i,
                            "oldLabel": int(old_label),
                            "newLabel": label_id,
                        })

                PointCloudService._create_or_update_chunk(
                    point_cloud_id, start_idx, end_idx, label_id
                )

        db.session.commit()
        return all_changes

    @staticmethod
    def _create_or_update_chunk(
        point_cloud_id: str,
        start_index: int,
        end_index: int,
        label_id: int,
    ) -> None:
        existing_chunks = LabelChunk.query.filter(
            LabelChunk.point_cloud_id == point_cloud_id,
            LabelChunk.start_index <= end_index,
            LabelChunk.end_index >= start_index,
        ).all()

        for chunk in existing_chunks:
            if chunk.start_index < start_index:
                if chunk.end_index > end_index:
                    new_chunk = LabelChunk(
                        point_cloud_id=point_cloud_id,
                        label_id=chunk.label_id,
                        start_index=end_index + 1,
                        end_index=chunk.end_index,
                        label_data=chunk.label_data,
                    )
                    db.session.add(new_chunk)
                chunk.end_index = start_index - 1
            elif chunk.end_index > end_index:
                chunk.start_index = end_index + 1
            else:
                db.session.delete(chunk)

        new_chunk = LabelChunk(
            point_cloud_id=point_cloud_id,
            label_id=label_id,
            start_index=start_index,
            end_index=end_index,
        )
        db.session.add(new_chunk)
