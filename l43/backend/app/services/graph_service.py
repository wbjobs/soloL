from typing import Dict, List, Any, Optional
from app.repositories.graph_repository import graph_repository
from app.repositories.case_repository import case_repository
from app.utils.helpers import generate_id
from app.utils.logger import setup_logger

logger = setup_logger()


class GraphService:
    def __init__(self):
        self.graph_repo = graph_repository

    async def build_case_graph(self, case_id: str) -> Dict:
        case = case_repository.get(case_id)
        if not case:
            return {"nodes": [], "edges": [], "case_id": case_id, "stats": {}}

        try:
            await self.graph_repo.create_entity("CaseInstance", {
                "id": case_id,
                "title": case.get("title", ""),
                "description": case.get("description", ""),
                "status": case.get("status", "processing")
            })
        except Exception as e:
            logger.warning(f"创建案件节点: {e}")

        for element in case.get("elements", []):
            try:
                label = self._get_element_label(element["type"])
                props = {
                    "id": element["id"],
                    "name": element.get("name", ""),
                    "type": element.get("type", ""),
                    "value": str(element.get("value", ""))
                }
                await self.graph_repo.create_entity(label, props)

                rel_type = self._get_relation_type(element["type"])
                await self.graph_repo.create_relation(
                    source_id=case_id,
                    source_label="CaseInstance",
                    target_id=element["id"],
                    target_label=label,
                    rel_type=rel_type
                )
            except Exception as e:
                logger.warning(f"创建要素节点: {e}")

        return await self.get_case_graph(case_id)

    async def get_case_graph(self, case_id: str) -> Dict:
        try:
            result = await self.graph_repo.get_case_graph(case_id)
            nodes = []
            edges = []

            if result:
                for record in result:
                    if "n" in record:
                        node_data = record["n"]
                        if isinstance(node_data, dict):
                            node_type = self._infer_node_type(node_data)
                            nodes.append({
                                "id": node_data.get("id", generate_id()),
                                "label": node_data.get("name", node_data.get("title", "未知")),
                                "type": node_type,
                                "properties": node_data
                            })

            return {
                "nodes": nodes,
                "edges": edges,
                "case_id": case_id,
                "stats": {"node_count": len(nodes), "edge_count": len(edges)}
            }
        except Exception as e:
            logger.error(f"获取案件图谱失败: {e}")
            return {"nodes": [], "edges": [], "case_id": case_id, "stats": {}}

    async def get_full_graph(self, limit: int = 200) -> Dict:
        try:
            result = await self.graph_repo.get_all_graph(limit)
            nodes = []
            edges = []

            for node_data in result.get("nodes", []):
                if isinstance(node_data, dict) and "n" in node_data:
                    nd = node_data["n"]
                    node_type = self._infer_node_type(nd)
                    nodes.append({
                        "id": nd.get("id", generate_id()),
                        "label": nd.get("name", nd.get("title", "未知")),
                        "type": node_type,
                        "properties": nd
                    })

            for edge_data in result.get("edges", []):
                if isinstance(edge_data, dict):
                    edges.append({
                        "id": generate_id("rel_"),
                        "source": edge_data.get("source", ""),
                        "target": edge_data.get("target", ""),
                        "type": edge_data.get("rel_type", "RELATED"),
                        "properties": edge_data.get("props", {})
                    })

            return {
                "nodes": nodes,
                "edges": edges,
                "stats": {"node_count": len(nodes), "edge_count": len(edges)}
            }
        except Exception as e:
            logger.error(f"获取全图谱失败: {e}")
            return {"nodes": [], "edges": [], "stats": {}}

    async def get_entity_detail(self, entity_id: str) -> Optional[Dict]:
        try:
            entity = await self.graph_repo.get_entity(entity_id)
            if not entity:
                return None
            relations = await self.graph_repo.get_entity_relations(entity_id)
            return {"entity": entity, "relations": relations}
        except Exception as e:
            logger.error(f"获取实体详情失败: {e}")
            return None

    async def get_entities(self, entity_type: str, page: int = 1, page_size: int = 20) -> Dict:
        try:
            label_map = {
                "law": "LAW",
                "case": "CasePrecedent",
                "circumstance": "CIRCUMSTANCE",
                "person": "PERSON"
            }
            label = label_map.get(entity_type, entity_type)
            return await self.graph_repo.get_entities_by_type(label, page, page_size)
        except Exception as e:
            logger.error(f"获取实体列表失败: {e}")
            return {"items": [], "total": 0}

    async def find_path(self, start_id: str, end_id: str) -> List[Dict]:
        try:
            return await self.graph_repo.find_path(start_id, end_id)
        except Exception as e:
            logger.error(f"路径查找失败: {e}")
            return []

    async def get_stats(self) -> Dict:
        try:
            return await self.graph_repo.get_stats()
        except Exception as e:
            logger.error(f"获取统计信息失败: {e}")
            return {}

    def _get_element_label(self, element_type: str) -> str:
        mapping = {
            "person": "PERSON",
            "amount": "ELEMENT",
            "action": "ELEMENT",
            "circumstance": "CIRCUMSTANCE"
        }
        return mapping.get(element_type, "ELEMENT")

    def _get_relation_type(self, element_type: str) -> str:
        mapping = {
            "person": "INVOLVES",
            "amount": "HAS",
            "action": "HAS",
            "circumstance": "HAS"
        }
        return mapping.get(element_type, "HAS")

    def _infer_node_type(self, node_data: Dict) -> str:
        labels = node_data.get("labels", [])
        if isinstance(labels, list):
            if "LAW" in labels:
                return "law"
            if "CasePrecedent" in labels:
                return "case"
            if "CIRCUMSTANCE" in labels:
                return "circumstance"
            if "CaseInstance" in labels:
                return "element"
            if "PERSON" in labels:
                return "person"
        name = node_data.get("name", "")
        if "条" in name or "法" in name:
            return "law"
        if "案" in name:
            return "case"
        return "element"


graph_service = GraphService()
