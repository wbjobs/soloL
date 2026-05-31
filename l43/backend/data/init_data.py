import asyncio
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from app.repositories.graph_repository import graph_repository
from app.utils.logger import setup_logger

logger = setup_logger()


async def init_all_data():
    logger.info("开始初始化知识图谱数据...")

    try:
        await graph_repository.connect()
        logger.info("Neo4j 连接成功")
    except Exception as e:
        logger.error(f"Neo4j 连接失败: {e}")
        return

    from data.init.criminal_law import init_criminal_law_data
    from data.init.civil_code import init_civil_code_data
    from data.init.cases import init_case_precedent_data

    logger.info("正在初始化刑法数据...")
    try:
        await init_criminal_law_data(graph_repository)
        logger.info("刑法数据初始化完成")
    except Exception as e:
        logger.error(f"刑法数据初始化失败: {e}")

    logger.info("正在初始化民法典数据...")
    try:
        await init_civil_code_data(graph_repository)
        logger.info("民法典数据初始化完成")
    except Exception as e:
        logger.error(f"民法典数据初始化失败: {e}")

    logger.info("正在初始化判例数据...")
    try:
        await init_case_precedent_data(graph_repository)
        logger.info("判例数据初始化完成")
    except Exception as e:
        logger.error(f"判例数据初始化失败: {e}")

    try:
        stats = await graph_repository.get_stats()
        logger.info(f"知识图谱统计: {stats}")
    except Exception as e:
        logger.error(f"获取统计信息失败: {e}")

    await graph_repository.disconnect()
    logger.info("数据初始化全部完成")


if __name__ == "__main__":
    asyncio.run(init_all_data())
