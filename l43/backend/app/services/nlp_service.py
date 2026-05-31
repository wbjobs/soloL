import re
from typing import Dict, List, Any
from app.utils.helpers import extract_keywords, extract_amount
from app.utils.logger import setup_logger

logger = setup_logger()


class NLPService:
    def __init__(self):
        self._jieba_initialized = False

    def _ensure_jieba(self):
        if not self._jieba_initialized:
            import jieba
            legal_words = [
                "自首", "立功", "未遂", "既遂", "累犯", "从犯", "主犯",
                "教唆犯", "正当防卫", "紧急避险", "故意", "过失",
                "坦白", "悔罪", "赔偿", "谅解", "未成年",
                "盗窃罪", "抢劫罪", "诈骗罪", "故意伤害罪", "故意杀人罪",
                "贪污罪", "受贿罪", "绑架罪", "敲诈勒索罪", "走私罪",
                "贩卖毒品罪", "放火罪", "交通肇事罪", "危险驾驶罪",
                "有期徒刑", "无期徒刑", "拘役", "管制", "罚金",
                "剥夺政治权利", "没收财产", "死刑",
                "数额较大", "数额巨大", "数额特别巨大",
                "从轻处罚", "减轻处罚", "从重处罚", "免除处罚"
            ]
            for word in legal_words:
                jieba.add_word(word)
            self._jieba_initialized = True

    def extract_elements(self, text: str) -> List[Dict[str, Any]]:
        self._ensure_jieba()
        elements = []

        amounts = extract_amount(text)
        for i, amount in enumerate(amounts):
            elements.append({
                "type": "amount",
                "name": f"涉案金额{i + 1}",
                "value": amount,
                "confidence": 0.9
            })

        person_pattern = r"(?:被告人|被害人|原告|被告|犯罪嫌疑人)[：:]?\s*([^\s，。,\.]{2,10})"
        persons = re.findall(person_pattern, text)
        for i, person in enumerate(persons):
            elements.append({
                "type": "person",
                "name": f"当事人{i + 1}",
                "value": person,
                "confidence": 0.85
            })

        crime_pattern = r"(盗窃|抢劫|诈骗|故意伤害|杀人|强奸|绑架|敲诈勒索|贪污|受贿|走私|贩卖毒品|放火|交通肇事|危险驾驶|侵占|职务侵占)罪?"
        crimes = re.findall(crime_pattern, text)
        for crime in crimes:
            elements.append({
                "type": "action",
                "name": f"{crime}罪",
                "value": crime,
                "confidence": 0.9
            })

        circumstance_keywords = [
            "自首", "立功", "未遂", "既遂", "累犯", "从犯", "主犯",
            "正当防卫", "紧急避险", "故意", "过失", "坦白", "悔罪",
            "赔偿", "谅解", "未成年", "共同犯罪"
        ]
        for keyword in circumstance_keywords:
            if keyword in text:
                elements.append({
                    "type": "circumstance",
                    "name": keyword,
                    "value": True,
                    "confidence": 0.8
                })

        return elements

    def segment_text(self, text: str) -> List[str]:
        self._ensure_jieba()
        import jieba
        words = jieba.cut(text)
        return list(words)

    def extract_keywords_from_text(self, text: str, top_k: int = 10) -> List[str]:
        return extract_keywords(text, top_k)

    def classify_case_type(self, text: str) -> str:
        criminal_keywords = ["犯罪", "被告", "判决", "刑罚", "有期徒刑", "盗窃", "抢劫", "诈骗", "故意伤害", "杀人"]
        civil_keywords = ["合同", "侵权", "债务", "赔偿", "违约", "物权", "债权", "继承", "婚姻", "知识产权"]
        admin_keywords = ["行政处罚", "行政复议", "行政诉讼", "行政行为", "行政许可", "行政强制"]

        criminal_score = sum(1 for kw in criminal_keywords if kw in text)
        civil_score = sum(1 for kw in civil_keywords if kw in text)
        admin_score = sum(1 for kw in admin_keywords if kw in text)

        scores = {"criminal": criminal_score, "civil": civil_score, "administrative": admin_score}
        return max(scores, key=scores.get) if max(scores.values()) > 0 else "civil"


nlp_service = NLPService()
