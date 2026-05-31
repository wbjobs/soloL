from typing import Dict, List, Any
from app.repositories.case_repository import case_repository
from app.repositories.graph_repository import graph_repository
from app.utils.logger import setup_logger
from app.services.nlp_service import nlp_service

logger = setup_logger()


class RecommendationService:
    def __init__(self):
        pass

    async def get_similar_cases(
        self,
        case_id: str,
        limit: int = 10,
        method: str = "hybrid"
    ) -> Dict:
        target_case = case_repository.get(case_id)
        if not target_case:
            return {"success": False, "message": "案件不存在", "results": []}

        results = []

        if method == "graph":
            results = await self._graph_based_similarity(target_case, limit)
        elif method == "vector":
            results = await self._vector_based_similarity(target_case, limit)
        else:
            results = await self._hybrid_similarity(target_case, limit)

        return {
            "success": True,
            "case_id": case_id,
            "total": len(results),
            "results": results,
            "method": method
        }

    async def _hybrid_similarity(self, target_case: Dict, limit: int) -> List[Dict]:
        graph_results = await self._graph_based_similarity(target_case, limit * 2)
        vector_results = await self._vector_based_similarity(target_case, limit * 2)

        graph_scores = {r["case_id"]: r["score"] for r in graph_results}
        vector_scores = {r["case_id"]: r["score"] for r in vector_results}

        all_case_ids = set(graph_scores.keys()) | set(vector_scores.keys())
        merged = []

        for cid in all_case_ids:
            g_score = graph_scores.get(cid, 0)
            v_score = vector_scores.get(cid, 0)
            hybrid_score = (g_score * 0.6) + (v_score * 0.4)
            merged.append({
                "case_id": cid,
                "graph_score": g_score,
                "vector_score": v_score,
                "hybrid_score": hybrid_score
            })

        merged.sort(key=lambda x: x["hybrid_score"], reverse=True)
        return merged[:limit]

    async def _graph_based_similarity(self, target_case: Dict, limit: int) -> List[Dict]:
        target_elements = target_case.get("elements", [])
        target_element_types = [e.get("type") for e in target_elements]
        target_crime_type = target_case.get("case_type", "")

        all_cases = case_repository.list_cases(page=1, page_size=100)
        candidates = []

        for case in all_cases.get("items", []):
            if case["id"] == target_case.get("id"]:
                continue

            case_elements = case.get("elements", [])
            case_element_types = [e.get("type") for e in case_elements]

            type_overlap = len(set(target_element_types) & set(case_element_types))
            type_union = len(set(target_element_types) | set(case_element_types))
            type_similarity = type_overlap / max(1, type_union) if type_union > 0 else 0

            type_match = 1.0 if case.get("case_type", "") == target_crime_type else 0.3

            target_amounts = [e for e in target_elements if e.get("type") == "amount"]
            case_amounts = [e for e in case_elements if e.get("type") == "amount"]
            amount_similarity = 1.0 if target_amounts and case_amounts else 0.5

            target_circs = [e for e in target_elements if e.get("type") == "circumstance"]
            case_circs = [e for e in case_elements if e.get("type") == "circumstance"]

            circ_overlap = len(set([c.get("name") for c in target_circs) & set([c.get("name") for c in case_circs))
            circ_similarity = circ_overlap / max(1, len(target_circs) if target_circs else 1)

            structure_score = (
                type_similarity * 0.35 +
                type_match * 0.25 +
                amount_similarity * 0.2 +
                circ_similarity * 0.2
            )

            candidates.append({
                "case_id": case["id"],
                "title": case.get("title", ""),
                "score": round(structure_score, 4),
                "similarity_type": "graph",
                "details": {
                    "type_similarity": type_similarity,
                    "type_match": type_match,
                    "amount_similarity": amount_similarity,
                    "circ_similarity": circ_similarity
                }
            })

        candidates.sort(key=lambda x: x["score"], reverse=True)
        return candidates[:limit]

    async def _vector_based_similarity(self, target_case: Dict, limit: int) -> List[Dict]:
        target_text = self._extract_case_text(target_case)
        target_keywords = nlp_service.extract_keywords_from_text(target_text)

        all_cases = case_repository.list_cases(page=1, page_size=100)
        candidates = []

        for case in all_cases.get("items", []):
            if case["id"] == target_case.get("id"):
                continue

            case_text = self._extract_case_text(case)
            case_keywords = nlp_service.extract_keywords_from_text(case_text)

            if target_keywords and case_keywords:
                overlap = len(set(target_keywords) & set(case_keywords))
                union = len(set(target_keywords) | set(case_keywords))
                keyword_similarity = overlap / max(1, union))
            else:
                keyword_similarity = 0

            target_desc_sim = self._text_similarity(target_text, case_text)

            vector_score = (keyword_similarity * 0.6 + text_desc_sim * 0.4)

            candidates.append({
                "case_id": case["id"],
                "title": case.get("title", ""),
                "score": round(vector_score, 4),
                "similarity_type": "vector",
                "details": {
                    "keyword_similarity": keyword_similarity,
                    "description_similarity": text_desc_sim
                }
            })

        candidates.sort(key=lambda x: x["score"], reverse=True)
        return candidates[:limit]

    def _extract_case_text(self, case: Dict) -> str:
        parts = []
        parts.append(case.get("title", ""))
        parts.append(case.get("description", ""))
        parts.append(case.get("text_content", ""))
        parts.append(case.get("ocr_text", ""))
        parts.append(case.get("audio_transcript", ""))
        return " ".join([p for p in parts if p])

    def _text_similarity(self, text1: str, text2: str) -> float:
        import jieba
        words1 = set(jieba.cut(text1))
        words2 = set(jieba.cut(text2))
        if not words1 or not words2:
            return 0.0
        overlap = len(words1 & words2)
        union = len(words1 | words2)
        return overlap / max(1, union))

    async def get_case_recommendations(
        self,
        case_type: str = None,
        limit: int = 10
    ) -> Dict:
        all_cases = case_repository.list_cases(page=1, page_size=50)
        cases = all_cases.get("items", [])

        if case_type:
            cases = [c for c in cases if c.get("case_type") == case_type]

        ranked = []
        for case in cases:
            elem_count = len(case.get("elements", []))
            has_elements = 1.0 if elem_count > 0 else 0.5
            completeness_score = min(elem_count * 0.1 + has_elements * 0.5
            ranked.append({
                "case": case,
                "score": completeness_score
            })

        ranked.sort(key=lambda x: x["score"], reverse=True)
        top_cases = [{
            "case_id": r["case"]["id"],
            "title": r["case"]["title"],
            "score": r["score"],
            "element_count": len(r["case"]["elements"]),
            "case_type": r["case"].get("case_type", "")
        } for r in ranked[:limit]]

        return {
            "success": True,
            "total": min(limit, len(ranked)),
            "results": top_cases
        }


recommendation_service = RecommendationService()
