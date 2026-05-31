from neo4j import AsyncGraphDatabase, AsyncDriver, AsyncSession
from typing import List, Dict, Any, Optional
from app.config.settings import settings
from app.utils.logger import setup_logger

logger = setup_logger()


class GraphRepository:
    def __init__(self):
        self.driver: Optional[AsyncDriver] = None

    async def connect(self):
        self.driver = AsyncGraphDatabase.driver(
            settings.NEO4J_URI,
            auth=(settings.NEO4J_USER, settings.NEO4J_PASSWORD)
        )
        await self.driver.verify_connectivity()

    async def disconnect(self):
        if self.driver:
            await self.driver.close()

    async def execute_query(self, query: str, parameters: Optional[Dict] = None) -> List[Dict]:
        if not self.driver:
            raise RuntimeError("Neo4j 未连接")
        async with self.driver.session(database=settings.NEO4J_DATABASE) as session:
            result = await session.run(query, parameters or {})
            records = await result.data()
            return records

    async def create_entity(self, label: str, properties: Dict[str, Any]) -> Dict:
        props_str = ", ".join([f"{k}: ${k}" for k in properties.keys()])
        query = f"CREATE (n:{label} {{{props_str}}}) RETURN n"
        result = await self.execute_query(query, properties)
        return result[0] if result else {}

    async def create_relation(self, source_id: str, source_label: str,
                              target_id: str, target_label: str,
                              rel_type: str, properties: Optional[Dict] = None) -> Dict:
        query = f"""
        MATCH (s:{source_label} {{id: $source_id}})
        MATCH (t:{target_label} {{id: $target_id}})
        CREATE (s)-[r:{rel_type}]->(t)
        SET r += $props
        RETURN s, r, t
        """
        result = await self.execute_query(query, {
            "source_id": source_id,
            "target_id": target_id,
            "props": properties or {}
        })
        return result[0] if result else {}

    async def get_entity(self, entity_id: str) -> Optional[Dict]:
        query = "MATCH (n {id: $id}) RETURN n"
        result = await self.execute_query(query, {"id": entity_id})
        return result[0] if result else None

    async def get_entities_by_type(self, label: str, page: int = 1, page_size: int = 20) -> Dict:
        skip = (page - 1) * page_size
        count_query = f"MATCH (n:{label}) RETURN count(n) as total"
        count_result = await self.execute_query(count_query)
        total = count_result[0]["total"] if count_result else 0

        query = f"MATCH (n:{label}) RETURN n SKIP $skip LIMIT $limit"
        items = await self.execute_query(query, {"skip": skip, "limit": page_size})
        return {"items": items, "total": total}

    async def get_case_graph(self, case_id: str) -> Dict:
        query = """
        MATCH (c:CaseInstance {id: $case_id})-[r]-(n)
        RETURN c, r, n
        """
        result = await self.execute_query(query, {"case_id": case_id})
        return result

    async def get_all_graph(self, limit: int = 200) -> Dict:
        nodes_query = f"MATCH (n) RETURN n LIMIT {limit}"
        nodes = await self.execute_query(nodes_query)

        edges_query = f"MATCH (s)-[r]->(t) RETURN s.id as source, t.id as target, type(r) as rel_type, properties(r) as props LIMIT {limit * 2}"
        edges = await self.execute_query(edges_query)

        return {"nodes": nodes, "edges": edges}

    async def find_path(self, start_id: str, end_id: str, max_depth: int = 5) -> List[Dict]:
        query = """
        MATCH path = shortestPath((s {id: $start_id})-[*..5]-(t {id: $end_id}))
        RETURN path
        """
        result = await self.execute_query(query, {
            "start_id": start_id,
            "end_id": end_id
        })
        return result

    async def get_entity_relations(self, entity_id: str) -> List[Dict]:
        query = """
        MATCH (n {id: $id})-[r]-(m)
        RETURN n, type(r) as rel_type, m, properties(r) as rel_props
        """
        result = await self.execute_query(query, {"id": entity_id})
        return result

    async def delete_entity(self, entity_id: str) -> bool:
        query = "MATCH (n {id: $id}) DETACH DELETE n"
        await self.execute_query(query, {"id": entity_id})
        return True

    async def get_stats(self) -> Dict:
        stats = {}
        for label in ["LAW", "CasePrecedent", "CIRCUMSTANCE", "CaseInstance", "PERSON"]:
            query = f"MATCH (n:{label}) RETURN count(n) as count"
            result = await self.execute_query(query)
            stats[label] = result[0]["count"] if result else 0

        rel_query = "MATCH ()-[r]->() RETURN type(r) as type, count(r) as count"
        rel_result = await self.execute_query(rel_query)
        stats["relations"] = {r["type"]: r["count"] for r in rel_result}
        return stats


graph_repository = GraphRepository()
