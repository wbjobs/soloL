from typing import Dict, List, Optional, Any
from app.repositories.case_repository import case_repository
from app.utils.helpers import generate_id
from app.utils.logger import setup_logger

logger = setup_logger()


class CaseService:
    def __init__(self):
        self.repo = case_repository

    def create_case(self, title: str, description: str, case_type: str) -> Dict:
        return self.repo.create(title, description, case_type)

    def get_case(self, case_id: str) -> Optional[Dict]:
        return self.repo.get(case_id)

    def list_cases(self, page: int = 1, page_size: int = 20, case_type: Optional[str] = None) -> Dict:
        return self.repo.list_cases(page, page_size, case_type)

    def update_case(self, case_id: str, updates: Dict[str, Any]) -> Optional[Dict]:
        return self.repo.update(case_id, updates)

    def delete_case(self, case_id: str) -> bool:
        return self.repo.delete(case_id)

    def process_text(self, case_id: str, content: str) -> Dict:
        case = self.repo.get(case_id)
        if not case:
            return {"success": False, "message": "案件不存在"}

        self.repo.set_text_content(case_id, content)

        elements = self._extract_elements_from_text(content)
        self.repo.update_elements(case_id, elements)

        return {
            "success": True,
            "message": "文本处理完成",
            "elements": elements,
            "extracted_text": content
        }

    def process_ocr_result(self, case_id: str, ocr_text: str) -> Dict:
        case = self.repo.get(case_id)
        if not case:
            return {"success": False, "message": "案件不存在"}

        self.repo.set_ocr_text(case_id, ocr_text)

        elements = self._extract_elements_from_text(ocr_text)
        self.repo.update_elements(case_id, elements)

        return {
            "success": True,
            "message": "图片识别完成",
            "ocr_text": ocr_text,
            "elements": elements
        }

    def process_audio_transcript(self, case_id: str, transcript: str, segments: Optional[List] = None) -> Dict:
        case = self.repo.get(case_id)
        if not case:
            return {"success": False, "message": "案件不存在"}

        self.repo.set_audio_transcript(case_id, transcript)

        elements = self._extract_elements_from_text(transcript)
        self.repo.update_elements(case_id, elements)

        return {
            "success": True,
            "message": "音频转写完成",
            "transcript": transcript,
            "elements": elements,
            "segments": segments or []
        }

    def _extract_elements_from_text(self, text: str) -> List[Dict]:
        from app.utils.helpers import extract_keywords, extract_amount
        import re

        elements = []

        amounts = extract_amount(text)
        for i, amount in enumerate(amounts):
            elements.append({
                "id": generate_id("amt_"),
                "name": f"涉案金额{i + 1}",
                "type": "amount",
                "value": amount,
                "editable": True,
                "metadata": {"source": "text_extraction"}
            })

        person_pattern = r"被告人[：:]?\s*([^\s，。,\.]{2,10})"
        persons = re.findall(person_pattern, text)
        for i, person in enumerate(persons):
            elements.append({
                "id": generate_id("per_"),
                "name": f"当事人{i + 1}",
                "type": "person",
                "value": person,
                "editable": True,
                "metadata": {"role": "defendant", "source": "text_extraction"}
            })

        victim_pattern = r"被害人[：:]?\s*([^\s，。,\.]{2,10})"
        victims = re.findall(victim_pattern, text)
        for i, victim in enumerate(victims):
            elements.append({
                "id": generate_id("per_"),
                "name": f"被害人{i + 1}",
                "type": "person",
                "value": victim,
                "editable": True,
                "metadata": {"role": "victim", "source": "text_extraction"}
            })

        circumstance_keywords = {
            "自首": "surrender",
            "立功": "meritorious",
            "未遂": "attempted",
            "既遂": "completed",
            "累犯": "recidivist",
            "从犯": "accomplice",
            "主犯": "principal",
            "教唆": "instigation",
            "正当防卫": "self_defense",
            "紧急避险": "emergency",
            "故意": "intentional",
            "过失": "negligent",
            "坦白": "confession",
            "悔罪": "repentance",
            "赔偿": "compensation",
            "谅解": "forgiveness",
            "未成年": "minor",
            "精神疾病": "mental_illness",
            "醉酒": "intoxication",
            "共同犯罪": "joint_crime"
        }

        for keyword, code in circumstance_keywords.items():
            if keyword in text:
                elements.append({
                    "id": generate_id("cir_"),
                    "name": keyword,
                    "type": "circumstance",
                    "value": True,
                    "editable": True,
                    "metadata": {"code": code, "source": "text_extraction"}
                })

        action_patterns = [
            r"(盗窃|抢劫|诈骗|故意伤害|杀人|强奸|绑架|敲诈勒索|贪污|受贿|走私|贩卖毒品|放火|爆炸|投放危险物质|以危险方法危害公共安全|交通肇事|危险驾驶|侵占|挪用|职务侵占|非国家工作人员受贿)"
        ]
        for pattern in action_patterns:
            actions = re.findall(pattern, text)
            for i, action in enumerate(actions):
                existing = [e for e in elements if e.get("name") == action]
                if not existing:
                    elements.append({
                        "id": generate_id("act_"),
                        "name": action,
                        "type": "action",
                        "value": action,
                        "editable": True,
                        "metadata": {"source": "text_extraction"}
                    })

        return elements


case_service = CaseService()
