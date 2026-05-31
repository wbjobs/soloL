from typing import Dict, List, Any, Optional
from datetime import datetime
from app.repositories.case_repository import case_repository
from app.utils.helpers import format_time
from app.utils.logger import setup_logger

logger = setup_logger()


class JudgmentGeneratorService:
    def __init__(self):
        self.templates = self._load_templates()

    def _load_templates(self) -> Dict[str, str]:
        return {
            "criminal": self._get_criminal_template(),
            "civil": self._get_civil_template(),
            "simple": self._get_simple_template()
        }

    def _get_criminal_template(self) -> str:
        return """
中华人民共和国{{court}}
刑事判决书

({{year}}){{court_code}}刑初字第{{case_number}}号

公诉机关：{{prosecutor}}

被告人：{{defendant_name}}，男，{{defendant_age}}岁，{{defendant_nationality}}族，{{defendant_occupation}}，住{{defendant_address}}。{{detention_status}}

辩护人：{{defender_name}}，{{defender_firm}}律师。

{{prosecutor}}以{{prosecutor_case_number}}号起诉书指控被告人{{defendant_name}}犯{{crime_type}}，于{{prosecution_date}}向本院提起公诉。本院依法组成合议庭，公开（或不公开）开庭审理了本案。{{prosecutor}}指派检察员{{prosecutor_name}}出庭支持公诉，被害人{{victim_name}}及其诉讼代理人{{agent_name}}，被告人{{defendant_name}}及其辩护人{{defender_name}}，证人{{witness_name}}，鉴定人{{expert_name}}等到庭参加诉讼。现已审理终结。

{{prosecutor}}指控：{{facts_prosecution}}

公诉机关提供了相关证据，认为被告人{{defendant_name}}的行为已构成{{crime_type}}，提请本院依法判处。

被告人{{defendant_name}}对指控的犯罪事实{{defendant_plea}}。其辩护人的辩护意见是：{{defense_opinion}}

经审理查明：{{facts_finding}}

上述事实，有检察机关提交，并经法庭质证、认证的下列证据予以证明：
{{evidence_list}}

本院认为，{{legal_reasoning}}

依照{{law_articles}}之规定，判决如下：

一、被告人{{defendant_name}}犯{{crime_type}}，判处{{verdict}}。

（刑期从判决执行之日起计算。判决执行以前先行羁押的，羁押一日折抵刑期一日，即自{{start_date}}起至{{end_date}}止。）

二、{{additional_judgment}}

如不服本判决，可在接到判决书的第二日起十日内，通过本院或者直接向{{higher_court}}提出上诉。书面上诉的，应当提交上诉状正本一份，副本{{copy_count}}份。

审判长：{{chief_judge}}
审判员：{{judge_1}}
审判员：{{judge_2}}
{{year}}年{{month}}月{{day}}日
（院印）

本件与原本核对无异
书记员：{{clerk}}
"""

    def _get_civil_template(self) -> str:
        return """
中华人民共和国{{court}}
民事判决书

({{year}}){{court_code}}民初字第{{case_number}}号

原告：{{plaintiff_name}}，{{plaintiff_gender}}，{{plaintiff_age}}岁，住{{plaintiff_address}}。

委托诉讼代理人：{{plaintiff_agent}}，{{plaintiff_agent_firm}}。

被告：{{defendant_name}}，{{defendant_gender}}，{{defendant_age}}岁，住{{defendant_address}}。

委托诉讼代理人：{{defendant_agent}}，{{defendant_agent_firm}}。

原告{{plaintiff_name}}与被告{{defendant_name}}{{case_type}}一案，本院于{{filing_date}}立案后，依法适用普通程序，公开开庭进行了审理。原告{{plaintiff_name}}及其委托诉讼代理人{{plaintiff_agent}}、被告{{defendant_name}}及其委托诉讼代理人{{defendant_agent}}到庭参加诉讼。本案现已审理终结。

{{plaintiff_name}}向本院提出诉讼请求：1. {{claim_1}}；2. {{claim_2}}。事实和理由：{{plaintiff_facts}}

{{defendant_name}}辩称：{{defense_opinion}}

当事人围绕诉讼请求依法提交了证据，本院组织当事人进行了证据交换和质证。对当事人无异议的证据，本院予以确认并在卷佐证。对有争议的证据和事实，本院认定如下：
{{evidence_finding}}

本院认为，{{legal_reasoning}}

综上所述，依照{{law_articles}}之规定，判决如下：

一、{{judgment_1}}；
二、{{judgment_2}}；
三、驳回原告{{plaintiff_name}}的其他诉讼请求。

如果未按本判决指定的期间履行给付金钱义务，应当依照《中华人民共和国民事诉讼法》第二百六十条规定，加倍支付迟延履行期间的债务利息。

案件受理费{{court_fee}}元，由{{fee_bearer}}负担。

如不服本判决，可以在判决书送达之日起十五日内，向本院递交上诉状，并按照对方当事人的人数提出副本，上诉于{{higher_court}}。

审判长：{{chief_judge}}
审判员：{{judge_1}}
人民陪审员：{{juror}}
{{year}}年{{month}}月{{day}}日
（院印）

书记员：{{clerk}}
"""

    def _get_simple_template(self) -> str:
        return """
{{court}}
判决书

案号：{{case_number}}

当事人信息：
{{parties_info}}

案件基本情况：
{{case_summary}}

审理查明：
{{facts}}

本院认为：
{{reasoning}}

判决结果：
{{verdict}}

法律依据：{{law_articles}}

如不服本判决，可在判决书送达之日起{{appeal_days}}日内上诉。

审判员：{{judge}}
{{date}}
"""

    async def generate_judgment(
        self,
        case_id: str,
        template_type: str = "auto",
        custom_data: Optional[Dict] = None
    ) -> Dict:
        case = case_repository.get(case_id)
        if not case:
            return {"success": False, "error": "案件不存在"}

        elements = {e["id"]: e for e in case.get("elements", [])}

        case_type = case.get("case_type", "civil")
        if template_type == "auto":
            template_type = case_type

        template = self.templates.get(template_type, self.templates["simple"])

        fill_data = self._prepare_fill_data(case, elements, custom_data)
        judgment_text = self._fill_template(template, fill_data)

        return {
            "success": True,
            "case_id": case_id,
            "template_type": template_type,
            "judgment_text": judgment_text,
            "fill_data": fill_data
        }

    def _prepare_fill_data(
        self,
        case: Dict,
        elements: Dict[str, Dict],
        custom_data: Optional[Dict]
    ) -> Dict[str, Any]:
        now = datetime.now()
        persons = [e for e in elements.values() if e.get("type") == "person"]
        amounts = [e for e in elements.values() if e.get("type") == "amount"]
        actions = [e for e in elements.values() if e.get("type") == "action"]
        circs = [e for e in elements.values() if e.get("type") == "circumstance"]

        defendants = [e for e in persons if "被告" in str(e.get("name", ""))]
        victims = [e for e in persons if "被害" in str(e.get("name", ""))]
        crime_type = actions[0].get("value", "未知罪名") if actions else "待定"
        total_amount = sum(float(a.get("value", 0)) for a in amounts if isinstance(a.get("value"), (int, float))) if amounts else 0

        base_data = {
            "court": "××省××市中级人民法院",
            "court_code": "××01",
            "year": now.year,
            "month": now.month,
            "day": now.day,
            "date": format_time(now),
            "case_number": f"{now.year % 100:02d}{hash(case['id']) % 10000:04d}",
            "case_type": case.get("case_type", ""),
            "case_summary": case.get("description", ""),
            "facts": case.get("description", ""),
            "facts_prosecution": case.get("description", ""),
            "facts_finding": case.get("description", ""),

            "prosecutor": "××市人民检察院",
            "prosecutor_name": "×××",
            "prosecutor_case_number": f"×检刑诉〔{now.year}〕{hash(case['id']) % 1000}号",
            "prosecution_date": f"{now.year}年{now.month}月{now.day}日",

            "defendant_name": defendants[0].get("value", "×××") if defendants else "×××",
            "defendant_age": "35",
            "defendant_nationality": "汉",
            "defendant_occupation": "无固定职业",
            "defendant_address": "××市××区××路××号",
            "detention_status": "现羁押于××市看守所。",
            "defendant_plea": "供认不讳，自愿认罪认罚" if any(c.get("name") == "自首" for c in circs) else "对指控事实有异议",

            "defender_name": "×××",
            "defender_firm": "××律师事务所",
            "defense_opinion": "被告人具有自首情节，认罪态度较好，请求从轻处罚。" if any(c.get("name") == "自首" for c in circs) else "被告人主观恶性较小，系初犯，请求酌情从轻处罚。",

            "victim_name": victims[0].get("value", "×××") if victims else "×××",
            "agent_name": "×××",
            "witness_name": "×××",
            "expert_name": "×××",

            "crime_type": crime_type,
            "total_amount": total_amount,

            "evidence_list": self._generate_evidence_list(amounts, circs),

            "legal_reasoning": self._generate_legal_reasoning(crime_type, circs, total_amount),
            "law_articles": self._generate_law_references(crime_type, circs),

            "verdict": self._generate_verdict_text(crime_type, circs, total_amount),
            "start_date": f"{now.year - 1}年{now.month}月{now.day}日",
            "end_date": f"{now.year + 3}年{now.month}月{now.day}日",
            "additional_judgment": "赃款赃物继续追缴，发还被害人。",
            "appeal_days": "十",
            "higher_court": "××省高级人民法院",
            "copy_count": "二",

            "chief_judge": "×××",
            "judge_1": "×××",
            "judge_2": "×××",
            "juror": "×××",
            "clerk": "×××",

            "plaintiff_name": victims[0].get("value", "×××") if victims else "×××",
            "plaintiff_gender": "男",
            "plaintiff_age": "40",
            "plaintiff_address": "××市××区××路××号",
            "plaintiff_agent": "×××",
            "plaintiff_agent_firm": "××律师事务所",
            "plaintiff_facts": case.get("description", ""),
            "claim_1": "判令被告赔偿经济损失人民币××元",
            "claim_2": "判令被告承担本案诉讼费用",

            "defendant_name_civil": defendants[0].get("value", "×××") if defendants else "×××",
            "defendant_gender": "男",
            "defendant_age": "35",
            "defendant_address": "××市××区××路××号",
            "defendant_agent": "×××",
            "defendant_agent_firm": "××律师事务所",
            "defense_opinion_civil": "原告所诉与事实不符，请求驳回原告诉讼请求。",

            "filing_date": f"{now.year}年{now.month - 1}月{now.day}日",
            "evidence_finding": "1. 原告提交的证据××，本院予以采信；2. 被告提交的证据××，本院不予采信。",
            "judgment_1": "被告×××于本判决生效之日起十日内赔偿原告×××经济损失××元",
            "judgment_2": "原告×××的其他诉讼请求不予支持",
            "court_fee": "×××元",
            "fee_bearer": "原、被告各负担一半",

            "parties_info": f"原告：{victims[0].get('value', '×××') if victims else '×××'}\\n被告：{defendants[0].get('value', '×××') if defendants else '×××'}",
            "reasoning": self._generate_legal_reasoning(crime_type, circs, total_amount)
        }

        if custom_data:
            base_data.update(custom_data)

        return base_data

    def _generate_evidence_list(self, amounts: List[Dict], circs: List[Dict]) -> str:
        evidences = [
            "1. 报案材料及抓获经过，证明案件来源及被告人归案情况；",
            "2. 被害人陈述，证明案发经过；",
            "3. 证人证言，证明相关案件事实；",
            "4. 现场勘查笔录及照片，证明案发现场情况；",
            "5. 鉴定意见，证明相关专门性问题；",
            "6. 被告人供述及辩解，证明案件事实。"
        ]
        return "\n".join(evidences)

    def _generate_legal_reasoning(self, crime_type: str, circs: List[Dict], amount: float) -> str:
        circ_names = [c.get("name", "") for c in circs]
        has_surrender = "自首" in circ_names
        has_attempt = "未遂" in circ_names
        has_recidivist = "累犯" in circ_names

        parts = [
            f"被告人的行为已构成{crime_type}，依法应予惩处。"
        ]

        if has_surrender:
            parts.append("被告人具有自首情节，依法可以从轻或减轻处罚。")
        if has_attempt:
            parts.append("被告人系犯罪未遂，依法可以比照既遂犯从轻或减轻处罚。")
        if has_recidivist:
            parts.append("被告人系累犯，依法应当从重处罚。")

        parts.append("公诉机关指控的罪名成立，本院予以支持。")
        parts.append("辩护人相关辩护意见合理部分，本院予以采纳。")

        return "".join(parts)

    def _generate_law_references(self, crime_type: str, circs: List[Dict]) -> str:
        refs = []

        if "盗窃" in crime_type:
            refs.append("《中华人民共和国刑法》第二百六十四条")
        elif "抢劫" in crime_type:
            refs.append("《中华人民共和国刑法》第二百六十三条")
        elif "诈骗" in crime_type:
            refs.append("《中华人民共和国刑法》第二百六十六条")
        elif "故意伤害" in crime_type:
            refs.append("《中华人民共和国刑法》第二百三十四条")
        elif "杀人" in crime_type:
            refs.append("《中华人民共和国刑法》第二百三十二条")
        else:
            refs.append("《中华人民共和国刑法》相关条款")

        circ_names = [c.get("name", "") for c in circs]
        if "自首" in circ_names:
            refs.append("第六十七条")
        if "未遂" in circ_names:
            refs.append("第二十三条")
        if "累犯" in circ_names:
            refs.append("第六十五条")

        return "、".join(refs)

    def _generate_verdict_text(self, crime_type: str, circs: List[Dict], amount: float) -> str:
        circ_names = [c.get("name", "") for c in circs]
        base_years = 3
        if amount > 100000:
            base_years = 10
        elif amount > 30000:
            base_years = 7
        elif amount > 3000:
            base_years = 4

        if "自首" in circ_names:
            base_years = max(1, base_years - 2)
        if "未遂" in circ_names:
            base_years = max(1, int(base_years * 0.7))
        if "累犯" in circ_names:
            base_years = base_years + 2

        if base_years > 10:
            return f"有期徒刑{base_years}年"
        elif base_years > 3:
            return f"有期徒刑{base_years}年，并处罚金人民币{int(amount * 2)}元"
        else:
            return f"有期徒刑{base_years}年，缓刑{base_years + 1}年，并处罚金人民币{int(amount * 2)}元"

    def _fill_template(self, template: str, data: Dict) -> str:
        result = template
        for key, value in data.items():
            placeholder = "{{" + key + "}}"
            if placeholder in result:
                result = result.replace(placeholder, str(value))

        import re
        result = re.sub(r'\{\{[^}]+\}\}', '', result)
        result = re.sub(r'\n{3,}', '\n\n', result)

        return result.strip()

    async def generate_judgment_preview(self, case_id: str) -> Dict:
        case = case_repository.get(case_id)
        if not case:
            return {"success": False, "error": "案件不存在"}

        elements = case.get("elements", [])
        crime_type = "未知罪名"
        for e in elements:
            if e.get("type") == "action":
                crime_type = str(e.get("value", ""))
                break

        return {
            "success": True,
            "case_id": case_id,
            "available_templates": ["criminal", "civil", "simple"],
            "preview_info": {
                "case_title": case.get("title", ""),
                "case_type": case.get("case_type", ""),
                "element_count": len(elements),
                "inferred_crime_type": crime_type
            }
        }


judgment_generator_service = JudgmentGeneratorService()
