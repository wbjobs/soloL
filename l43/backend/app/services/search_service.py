from typing import Dict, List, Any
import numpy as np
from app.repositories.vector_repository import vector_repository
from app.utils.logger import setup_logger

logger = setup_logger()


class SearchService:
    def __init__(self):
        self.vector_repo = vector_repository
        self._embedding_model = None

    def _get_embedding(self, text: str) -> List[float]:
        try:
            if self._embedding_model is None:
                from sentence_transformers import SentenceTransformer
                self._embedding_model = SentenceTransformer("shibing624/text2vec-base-chinese")
            embedding = self._embedding_model.encode(text)
            return embedding.tolist()
        except ImportError:
            logger.warning("sentence-transformers 未安装，使用模拟向量")
            return self._mock_embedding(text)
        except Exception as e:
            logger.error(f"生成向量失败: {e}")
            return self._mock_embedding(text)

    def _mock_embedding(self, text: str) -> List[float]:
        np.random.seed(hash(text) % (2**31))
        vector = np.random.randn(768).astype(np.float32)
        vector = vector / np.linalg.norm(vector)
        return vector.tolist()

    async def search(self, query: str, search_type: str = "all", limit: int = 10) -> Dict:
        import time
        start_time = time.time()

        query_vector = self._get_embedding(query)
        results = []

        if search_type in ("all", "law"):
            try:
                law_results = self.vector_repo.search_similar(
                    query_vector, "law_vectors", limit=limit
                )
                for r in law_results:
                    r["type"] = "law"
                    results.append(r)
            except Exception as e:
                logger.warning(f"法条向量检索失败: {e}")

        if search_type in ("all", "case"):
            try:
                case_results = self.vector_repo.search_similar(
                    query_vector, "case_vectors", limit=limit
                )
                for r in case_results:
                    r["type"] = "case"
                    results.append(r)
            except Exception as e:
                logger.warning(f"判例向量检索失败: {e}")

        if search_type == "circumstance":
            results = self._keyword_search_circumstances(query, limit)
            for r in results:
                r["type"] = "circumstance"

        results.sort(key=lambda x: x.get("similarity", 0), reverse=True)
        results = results[:limit]

        execution_time = time.time() - start_time

        return {
            "success": True,
            "query": query,
            "results": results,
            "total": len(results),
            "execution_time": round(execution_time, 3)
        }

    def _keyword_search_circumstances(self, query: str, limit: int) -> List[Dict]:
        circumstance_db = [
            {"id": "circ_001", "name": "自首", "description": "犯罪以后自动投案，如实供述自己的罪行的，是自首。对于自首的犯罪分子，可以从轻或者减轻处罚。其中，犯罪较轻的，可以免除处罚。", "law_ref": "刑法第六十七条"},
            {"id": "circ_002", "name": "立功", "description": "犯罪分子有揭发他人犯罪行为，查证属实的，或者提供重要线索，从而得以侦破其他案件等立功表现的，可以从轻或者减轻处罚。", "law_ref": "刑法第六十八条"},
            {"id": "circ_003", "name": "未遂", "description": "已经着手实行犯罪，由于犯罪分子意志以外的原因而未得逞的，是犯罪未遂。对于未遂犯，可以比照既遂犯从轻或者减轻处罚。", "law_ref": "刑法第二十三条"},
            {"id": "circ_004", "name": "累犯", "description": "被判处有期徒刑以上刑罚的犯罪分子，刑罚执行完毕或者赦免以后，在五年以内再犯应当判处有期徒刑以上刑罚之罪的，是累犯，应当从重处罚。", "law_ref": "刑法第六十五条"},
            {"id": "circ_005", "name": "从犯", "description": "在共同犯罪中起次要或者辅助作用的，是从犯。对于从犯，应当从轻、减轻处罚或者免除处罚。", "law_ref": "刑法第二十七条"},
            {"id": "circ_006", "name": "正当防卫", "description": "为了使国家、公共利益、本人或者他人的人身、财产和其他权利免受正在进行的不法侵害，而采取的制止不法侵害的行为，对不法侵害人造成损害的，属于正当防卫，不负刑事责任。", "law_ref": "刑法第二十条"},
            {"id": "circ_007", "name": "未成年", "description": "已满十四周岁不满十八周岁的人犯罪，应当从轻或者减轻处罚。", "law_ref": "刑法第十七条"},
            {"id": "circ_008", "name": "坦白", "description": "犯罪嫌疑人虽不具有前两款规定的自首情节，但是如实供述自己罪行的，可以从轻处罚。", "law_ref": "刑法第六十七条第三款"},
        ]

        results = []
        for circ in circumstance_db:
            if query in circ["name"] or query in circ["description"]:
                results.append({
                    "entity_id": circ["id"],
                    "content": circ["description"],
                    "similarity": 1.0 if query in circ["name"] else 0.8,
                    "metadata": {"name": circ["name"], "law_ref": circ["law_ref"]}
                })

        return results[:limit]


search_service = SearchService()
