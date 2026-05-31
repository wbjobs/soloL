from pymilvus import MilvusClient, DataType, CollectionSchema, FieldSchema
from typing import List, Dict, Any, Optional
from app.config.settings import settings
from app.utils.logger import setup_logger

logger = setup_logger()


class VectorRepository:
    def __init__(self):
        self.client: Optional[MilvusClient] = None
        self.dimension = settings.VECTOR_DIMENSION

    def connect(self):
        self.client = MilvusClient(
            uri=settings.MILVUS_URI,
            token=settings.MILVUS_TOKEN
        )
        self._ensure_collections()

    def disconnect(self):
        if self.client:
            self.client.close()

    def _ensure_collections(self):
        existing = self.client.list_collections()

        if "law_vectors" not in existing:
            schema = CollectionSchema(fields=[
                FieldSchema(name="id", dtype=DataType.INT64, is_primary=True, auto_id=True),
                FieldSchema(name="entity_id", dtype=DataType.VARCHAR, max_length=64),
                FieldSchema(name="vector", dtype=DataType.FLOAT_VECTOR, dim=self.dimension),
                FieldSchema(name="category", dtype=DataType.VARCHAR, max_length=32),
                FieldSchema(name="content", dtype=DataType.VARCHAR, max_length=2048)
            ], description="法条向量索引")
            self.client.create_collection(
                collection_name="law_vectors",
                schema=schema
            )
            self._create_index("law_vectors", "vector")

        if "case_vectors" not in existing:
            schema = CollectionSchema(fields=[
                FieldSchema(name="id", dtype=DataType.INT64, is_primary=True, auto_id=True),
                FieldSchema(name="entity_id", dtype=DataType.VARCHAR, max_length=64),
                FieldSchema(name="vector", dtype=DataType.FLOAT_VECTOR, dim=self.dimension),
                FieldSchema(name="court", dtype=DataType.VARCHAR, max_length=64),
                FieldSchema(name="case_type", dtype=DataType.VARCHAR, max_length=32),
                FieldSchema(name="content", dtype=DataType.VARCHAR, max_length=2048)
            ], description="判例向量索引")
            self.client.create_collection(
                collection_name="case_vectors",
                schema=schema
            )
            self._create_index("case_vectors", "vector")

    def _create_index(self, collection_name: str, vector_field: str):
        self.client.create_index(
            collection_name=collection_name,
            field_name=vector_field,
            index_params={
                "index_type": "IVF_FLAT",
                "metric_type": "COSINE",
                "params": {"nlist": 128}
            }
        )

    def insert_law_vector(self, entity_id: str, vector: List[float],
                          category: str, content: str) -> None:
        data = [{
            "entity_id": entity_id,
            "vector": vector,
            "category": category,
            "content": content[:2048]
        }]
        self.client.insert(collection_name="law_vectors", data=data)

    def insert_case_vector(self, entity_id: str, vector: List[float],
                           court: str, case_type: str, content: str) -> None:
        data = [{
            "entity_id": entity_id,
            "vector": vector,
            "court": court,
            "case_type": case_type,
            "content": content[:2048]
        }]
        self.client.insert(collection_name="case_vectors", data=data)

    def search_similar(self, query_vector: List[float], collection_name: str,
                       limit: int = 10, filter_expr: Optional[str] = None) -> List[Dict]:
        self.client.load_collection(collection_name=collection_name)
        results = self.client.search(
            collection_name=collection_name,
            data=[query_vector],
            limit=limit,
            output_fields=["entity_id", "category", "content", "court", "case_type"],
            filter=filter_expr
        )
        formatted = []
        if results and len(results) > 0:
            for hit in results[0]:
                formatted.append({
                    "entity_id": hit["entity"].get("entity_id", ""),
                    "content": hit["entity"].get("content", ""),
                    "category": hit["entity"].get("category", ""),
                    "court": hit["entity"].get("court", ""),
                    "case_type": hit["entity"].get("case_type", ""),
                    "similarity": hit["distance"]
                })
        return formatted

    def batch_insert_law_vectors(self, items: List[Dict[str, Any]]) -> None:
        data = []
        for item in items:
            data.append({
                "entity_id": item["entity_id"],
                "vector": item["vector"],
                "category": item.get("category", ""),
                "content": item.get("content", "")[:2048]
            })
        if data:
            self.client.insert(collection_name="law_vectors", data=data)

    def batch_insert_case_vectors(self, items: List[Dict[str, Any]]) -> None:
        data = []
        for item in items:
            data.append({
                "entity_id": item["entity_id"],
                "vector": item["vector"],
                "court": item.get("court", ""),
                "case_type": item.get("case_type", ""),
                "content": item.get("content", "")[:2048]
            })
        if data:
            self.client.insert(collection_name="case_vectors", data=data)


vector_repository = VectorRepository()
