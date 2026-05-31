import time
from typing import Dict, List, Any, Optional
from app.repositories.graph_repository import graph_repository
from app.repositories.case_repository import case_repository
from app.utils.helpers import generate_id
from app.utils.logger import setup_logger

logger = setup_logger()

LEGAL_REASONING_RULES = {
    "amount": {
        "theft": {
            "thresholds": [
                {"max": 3000, "level": "数额较小", "crime": "盗窃罪", "punishment": "处三年以下有期徒刑、拘役或者管制，并处或者单处罚金"},
                {"max": 30000, "level": "数额较大", "crime": "盗窃罪", "punishment": "处三年以上十年以下有期徒刑，并处罚金"},
                {"max": 300000, "level": "数额巨大", "crime": "盗窃罪", "punishment": "处三年以上十年以下有期徒刑，并处罚金"},
                {"max": float("inf"), "level": "数额特别巨大", "crime": "盗窃罪", "punishment": "处十年以上有期徒刑或者无期徒刑，并处罚金或者没收财产"}
            ]
        },
        "fraud": {
            "thresholds": [
                {"max": 3000, "level": "数额较小", "crime": "诈骗罪", "punishment": "处三年以下有期徒刑、拘役或者管制，并处或者单处罚金"},
                {"max": 50000, "level": "数额较大", "crime": "诈骗罪", "punishment": "处三年以上十年以下有期徒刑，并处罚金"},
                {"max": 500000, "level": "数额巨大", "crime": "诈骗罪", "punishment": "处三年以上十年以下有期徒刑，并处罚金"},
                {"max": float("inf"), "level": "数额特别巨大", "crime": "诈骗罪", "punishment": "处十年以上有期徒刑或者无期徒刑，并处罚金或者没收财产"}
            ]
        },
        "default": {
            "thresholds": [
                {"max": 5000, "level": "数额较小", "punishment": "处三年以下有期徒刑、拘役或者管制"},
                {"max": 50000, "level": "数额较大", "punishment": "处三年以上十年以下有期徒刑"},
                {"max": 500000, "level": "数额巨大", "punishment": "处十年以上有期徒刑"},
                {"max": float("inf"), "level": "数额特别巨大", "punishment": "处十年以上有期徒刑或无期徒刑"}
            ]
        }
    },
    "circumstance_modifiers": {
        "surrender": {"reduction": 0.3, "description": "自首可以从轻或减轻处罚", "law_ref": "刑法第六十七条"},
        "meritorious": {"reduction": 0.3, "description": "立功可以从轻或减轻处罚", "law_ref": "刑法第六十八条"},
        "recidivist": {"increase": 0.2, "description": "累犯应当从重处罚", "law_ref": "刑法第六十五条"},
        "attempted": {"reduction": 0.3, "description": "未遂可以比照既遂犯从轻或减轻处罚", "law_ref": "刑法第二十三条"},
        "accomplice": {"reduction": 0.2, "description": "从犯应当从轻、减轻或免除处罚", "law_ref": "刑法第二十七条"},
        "principal": {"increase": 0.1, "description": "主犯按其参与的全部犯罪处罚", "law_ref": "刑法第二十六条"},
        "minor": {"reduction": 0.4, "description": "未成年人应当从轻或减轻处罚", "law_ref": "刑法第十七条"},
        "self_defense": {"reduction": 1.0, "description": "正当防卫不负刑事责任", "law_ref": "刑法第二十条"},
        "confession": {"reduction": 0.2, "description": "坦白可以从轻处罚", "law_ref": "刑法第六十七条第三款"},
        "compensation": {"reduction": 0.15, "description": "积极赔偿可以酌情从轻处罚", "law_ref": "量刑指导意见"},
        "forgiveness": {"reduction": 0.2, "description": "取得被害人谅解可以酌情从轻处罚", "law_ref": "量刑指导意见"},
        "intentional": {"increase": 0.1, "description": "故意犯罪", "law_ref": "刑法第十四条"},
        "negligent": {"reduction": 0.4, "description": "过失犯罪应当从轻处罚", "law_ref": "刑法第十五条"}
    }
}


class ReasoningService:
    def __init__(self):
        self.graph_repo = graph_repository

    async def counterfactual_reasoning(self, case_id: str, modified_elements: List[Dict],
                                       reasoning_depth: int = 3) -> Dict:
        start_time = time.time()
        logger.info(f"开始反事实推理: 案件{case_id}")

        case = case_repository.get(case_id)
        if not case:
            return {"success": False, "case_id": case_id, "error": "案件不存在"}

        original_elements = {e["id"]: e for e in case.get("elements", [])}

        original_verdict = self._compute_verdict(case.get("elements", []), case.get("description", ""))

        modified_elements_map = {m["element_id"]: m["new_value"] for m in modified_elements}

        new_elements = []
        for elem in case.get("elements", []):
            new_elem = dict(elem)
            if elem["id"] in modified_elements_map:
                new_elem["value"] = modified_elements_map[elem["id"]]
            new_elements.append(new_elem)

        alternative_verdict = self._compute_verdict(new_elements, case.get("description", ""))

        reasoning_path = self._build_reasoning_path(
            case.get("elements", []),
            new_elements,
            original_verdict,
            alternative_verdict,
            modified_elements,
            reasoning_depth
        )

        differences = self._compute_differences(
            original_verdict,
            alternative_verdict,
            original_elements,
            modified_elements_map
        )

        relevant_laws = self._find_relevant_laws(new_elements)
        relevant_cases = self._find_relevant_cases(new_elements)

        execution_time = time.time() - start_time
        confidence = self._calculate_confidence(reasoning_path, len(modified_elements))

        result = {
            "success": True,
            "case_id": case_id,
            "original_verdict": original_verdict["summary"],
            "alternative_verdict": alternative_verdict["summary"],
            "reasoning_path": reasoning_path,
            "confidence": confidence,
            "differences": differences,
            "relevant_laws": relevant_laws,
            "relevant_cases": relevant_cases,
            "execution_time": round(execution_time, 3)
        }

        result["reasoning_report"] = self.generate_reasoning_report(result)
        result["explanation_text"] = self._generate_concise_explanation(result)

        return result

    def _generate_concise_explanation(self, result: Dict) -> Dict:
        differences = result.get("differences", [])
        relevant_laws = result.get("relevant_laws", [])
        case_id = result.get("case_id", "")

        explanation = {
            "summary": "",
            "key_changes": [],
            "legal_basis": [],
            "conclusion": ""
        }

        if differences:
            main_diff = differences[0]
            field = main_diff.get("field", "")
            impact = main_diff.get("impact", "")
            explanation["summary"] = f"对案件{case_id}进行反事实推理后，{impact}。"

            for diff in differences[:3]:
                explanation["key_changes"].append({
                    "field": diff.get("field", ""),
                    "change": f"{diff.get('original_value', '')} → {diff.get('modified_value', '')}",
                    "description": diff.get("impact", "")
                })

        for law in relevant_laws[:3]:
            explanation["legal_basis"].append({
                "name": law.get("name", ""),
                "article": law.get("article", ""),
                "category": law.get("category", "")
            })

        orig = result.get("original_verdict", "")
        alt = result.get("alternative_verdict", "")
        conf = result.get("confidence", 0)
        explanation["conclusion"] = f"原判决结论为{orig}，调整后判决结论为{alt}，推理置信度{conf * 100:.0f}%。"

        return explanation

    def _compute_verdict(self, elements: List[Dict], description: str) -> Dict:
        crime_type = self._detect_crime_type(elements, description)
        amounts = [e for e in elements if e.get("type") == "amount"]
        circumstances = [e for e in elements if e.get("type") == "circumstance"]

        base_punishment = self._get_base_punishment(crime_type, amounts)
        modified_punishment = self._apply_circumstance_modifiers(base_punishment, circumstances)

        summary = f"根据{crime_type}的相关规定，{modified_punishment['description']}"
        if modified_punishment.get("fine"):
            summary += f"，并处罚金{modified_punishment['fine']}"

        return {
            "crime_type": crime_type,
            "punishment_level": modified_punishment.get("level", "未确定"),
            "summary": summary,
            "base_years": base_punishment.get("years", 0),
            "modified_years": modified_punishment.get("years", 0),
            "fine": modified_punishment.get("fine", ""),
            "description": modified_punishment.get("description", ""),
            "circumstances_applied": modified_punishment.get("modifiers_applied", [])
        }

    def _detect_crime_type(self, elements: List[Dict], description: str) -> str:
        actions = [e for e in elements if e.get("type") == "action"]
        if actions:
            return actions[0].get("value", "未知罪名")

        crime_keywords = {
            "盗窃": "盗窃罪", "抢劫": "抢劫罪", "诈骗": "诈骗罪",
            "故意伤害": "故意伤害罪", "杀人": "故意杀人罪", "强奸": "强奸罪",
            "绑架": "绑架罪", "敲诈勒索": "敲诈勒索罪", "贪污": "贪污罪",
            "受贿": "受贿罪", "走私": "走私罪", "贩卖毒品": "贩卖毒品罪",
            "放火": "放火罪", "交通肇事": "交通肇事罪", "危险驾驶": "危险驾驶罪"
        }

        for keyword, crime in crime_keywords.items():
            if keyword in description:
                return crime

        return "待定罪名"

    def _get_base_punishment(self, crime_type: str, amounts: List[Dict]) -> Dict:
        max_amount = 0
        for amt in amounts:
            try:
                val = float(amt.get("value", 0))
                max_amount = max(max_amount, val)
            except (ValueError, TypeError):
                pass

        crime_key = "default"
        if "盗窃" in crime_type:
            crime_key = "theft"
        elif "诈骗" in crime_type:
            crime_key = "fraud"

        rules = LEGAL_REASONING_RULES["amount"].get(crime_key,
                                                      LEGAL_REASONING_RULES["amount"]["default"])

        if max_amount > 0:
            for threshold in rules["thresholds"]:
                if max_amount <= threshold["max"]:
                    level = threshold.get("level", "")
                    punishment = threshold.get("punishment", "")
                    years = self._extract_years_from_punishment(punishment)
                    return {
                        "level": level,
                        "description": punishment,
                        "years": years,
                        "amount": max_amount
                    }
        else:
            threshold = rules["thresholds"][0]
            return {
                "level": threshold.get("level", "情节较轻"),
                "description": threshold.get("punishment", "根据具体情节量刑"),
                "years": 1,
                "amount": 0
            }

        return {"level": "未确定", "description": "需要进一步分析", "years": 0}

    def _apply_circumstance_modifiers(self, base_punishment: Dict, circumstances: List[Dict]) -> Dict:
        result = dict(base_punishment)
        result["modifiers_applied"] = []
        total_reduction = 0
        total_increase = 0

        for circ in circumstances:
            name = circ.get("name", "").lower()
            code = circ.get("metadata", {}).get("code", "").lower() if circ.get("metadata") else ""

            modifier = None
            for key, mod in LEGAL_REASONING_RULES["circumstance_modifiers"].items():
                if key == code or key == name:
                    modifier = mod
                    break

            if modifier:
                reduction = modifier.get("reduction", 0)
                increase = modifier.get("increase", 0)
                total_reduction += reduction
                total_increase += increase
                result["modifiers_applied"].append({
                    "name": circ.get("name", ""),
                    "effect": modifier["description"],
                    "law_ref": modifier["law_ref"],
                    "reduction": reduction,
                    "increase": increase
                })

        base_years = result.get("years", 1)
        if base_years > 0:
            modified = base_years * (1 - total_reduction + total_increase)
            modified = max(0, modified)
            result["years"] = round(modified, 1)

            if modified == 0:
                result["description"] = "不负刑事责任或免予刑事处罚"
            elif modified < base_years:
                result["description"] = f"从轻处罚，{result['description']}"
            elif modified > base_years:
                result["description"] = f"从重处罚，{result['description']}"

        return result

    def _extract_years_from_punishment(self, punishment: str) -> int:
        import re
        patterns = [
            r"(\d+)年以上",
            r"处(\d+)年",
            r"三年以下",
        ]
        if "无期" in punishment:
            return 20
        if "死刑" in punishment:
            return 25
        if "三年以下" in punishment:
            return 2
        if "三年以上十年以下" in punishment:
            return 5
        if "十年以上" in punishment:
            return 12

        for pattern in patterns:
            match = re.search(pattern, punishment)
            if match:
                try:
                    return int(match.group(1))
                except (ValueError, IndexError):
                    pass
        return 1

    def _build_reasoning_path(self, original_elements, new_elements,
                               original_verdict, alternative_verdict,
                               modified_elements, depth) -> List[Dict]:
        path = []

        path.append({
            "step_id": generate_id("step_"),
            "description": f"案件原始分析：{original_verdict.get('crime_type', '未知罪名')}，{original_verdict.get('description', '')}",
            "law_reference": original_verdict.get("crime_type", ""),
            "confidence": 0.9,
            "details": {"base_years": original_verdict.get("base_years", 0)},
            "explanation": self._generate_step_explanation("original_analysis", original_verdict)
        })

        for mod in modified_elements:
            elem_id = mod["element_id"]
            new_val = mod["new_value"]
            orig_elem = next((e for e in original_elements if e["id"] == elem_id), None)
            old_val = orig_elem.get("value", "") if orig_elem else "未知"
            elem_type = orig_elem.get("type", "") if orig_elem else ""

            path.append({
                "step_id": generate_id("step_"),
                "description": f"修改要素：将'{old_val}'改为'{new_val}'",
                "law_reference": None,
                "confidence": 0.85,
                "details": {"element_id": elem_id, "old_value": old_val, "new_value": new_val, "element_type": elem_type},
                "explanation": self._generate_step_explanation("element_modification", {"old_value": old_val, "new_value": new_val, "element_type": elem_type})
            })

        for mod_applied in alternative_verdict.get("circumstances_applied", []):
            path.append({
                "step_id": generate_id("step_"),
                "description": f"适用情节：{mod_applied['effect']}",
                "law_reference": mod_applied.get("law_ref", ""),
                "confidence": 0.8,
                "details": mod_applied,
                "explanation": self._generate_step_explanation("circumstance_applied", mod_applied)
            })

        path.append({
            "step_id": generate_id("step_"),
            "description": f"替代判决结果：{alternative_verdict.get('summary', '')}",
            "law_reference": alternative_verdict.get("crime_type", ""),
            "confidence": 0.75,
            "details": {"modified_years": alternative_verdict.get("years", 0)},
            "explanation": self._generate_step_explanation("final_verdict", alternative_verdict)
        })

        return path[:depth * 2 + 2]

    def _generate_step_explanation(self, step_type: str, data: Dict) -> str:
        explanations = {
            "original_analysis": self._explain_original_analysis,
            "element_modification": self._explain_element_modification,
            "circumstance_applied": self._explain_circumstance,
            "final_verdict": self._explain_final_verdict,
        }
        handler = explanations.get(step_type)
        if handler:
            return handler(data)
        return ""

    def _explain_original_analysis(self, data: Dict) -> str:
        crime_type = data.get("crime_type", "本案")
        base_years = data.get("base_years", 0)
        description = data.get("description", "")

        parts = [
            f"根据案件事实，初步认定为{crime_type}。",
        ]

        if base_years > 0:
            parts.append(f"依据相关法律规定，该罪名的基准刑期约为{base_years}年。")

        if description:
            parts.append(f"具体量刑：{description}")

        return " ".join(parts)

    def _explain_element_modification(self, data: Dict) -> str:
        old_val = data.get("old_value", "")
        new_val = data.get("new_value", "")
        elem_type = data.get("element_type", "")

        type_desc = {
            "amount": "涉案金额",
            "circumstance": "量刑情节",
            "action": "犯罪行为",
            "person": "当事人信息"
        }.get(elem_type, "案件要素")

        if elem_type == "amount":
            try:
                old_amt = float(old_val) if old_val else 0
                new_amt = float(new_val) if new_val else 0
                change = new_amt - old_amt
                direction = "增加" if change > 0 else "减少"
                percentage = abs(change / old_amt * 100) if old_amt > 0 else 0
                return f"将{type_desc}从{old_val}元调整为{new_val}元，{direction}了{abs(change):,.0f}元（{percentage:.0f}%）。该变化将直接影响量刑档次的认定。"
            except (ValueError, TypeError):
                pass

        if elem_type == "circumstance":
            return f"将{type_desc}状态从「{old_val}」修改为「{new_val}」。根据刑法相关规定，该情节属于法定{('从轻' if new_val else '从重')}处罚情节。"

        return f"修改{type_desc}：「{old_val}」→「{new_val}」。该要素变化将影响最终量刑结果的计算。"

    def _explain_circumstance(self, data: Dict) -> str:
        effect = data.get("effect", "")
        law_ref = data.get("law_ref", "")
        reduction = data.get("reduction", 0)
        increase = data.get("increase", 0)

        if reduction > 0:
            impact = f"可减少基准刑的{reduction * 100:.0f}%"
        elif increase > 0:
            impact = f"增加基准刑的{increase * 100:.0f}%"
        else:
            impact = "对量刑产生影响"

        parts = [f"【情节认定】{effect}。"]
        if law_ref:
            parts.append(f"法律依据：{law_ref}。")
        parts.append(f"量刑影响：{impact}。")

        return " ".join(parts)

    def _explain_final_verdict(self, data: Dict) -> str:
        crime_type = data.get("crime_type", "")
        punishment_level = data.get("punishment_level", "")
        summary = data.get("summary", "")
        years = data.get("years", 0)

        parts = [
            "综合全案事实、证据及各项量刑情节，",
            f"认定被告人构成{crime_type}，",
        ]

        if years > 0:
            parts.append(f"判处有期徒刑{years:.1f}年。")
        elif punishment_level:
            parts.append(f"属{punishment_level}档次。")

        if summary:
            parts.append(f"判决理由：{summary}")

        return "".join(parts)

    def generate_reasoning_report(self, reasoning_result: Dict) -> str:
        case_id = reasoning_result.get("case_id", "")
        original_verdict = reasoning_result.get("original_verdict", "")
        alternative_verdict = reasoning_result.get("alternative_verdict", "")
        confidence = reasoning_result.get("confidence", 0)
        differences = reasoning_result.get("differences", [])
        relevant_laws = reasoning_result.get("relevant_laws", [])
        reasoning_path = reasoning_result.get("reasoning_path", [])

        report_lines = [
            "=" * 60,
            "反事实推理分析报告",
            "=" * 60,
            "",
            f"案件编号：{case_id}",
            f"推理置信度：{confidence * 100:.0f}%",
            "",
            "一、原判决",
            "-" * 40,
            original_verdict,
            "",
            "二、替代判决",
            "-" * 40,
            alternative_verdict,
            "",
        ]

        if differences:
            report_lines.extend([
                "三、判决差异分析",
                "-" * 40,
            ])
            for i, diff in enumerate(differences, 1):
                severity = {"low": "轻微", "medium": "中等", "high": "重大"}.get(diff.get("severity", "medium"), "中等")
                report_lines.extend([
                    f"{i}. {diff.get('field', '')}（影响程度：{severity}）",
                    f"   原判决：{diff.get('original_value', '')}",
                    f"   新判决：{diff.get('modified_value', '')}",
                    f"   说明：{diff.get('impact', '')}",
                    ""
                ])

        if reasoning_path:
            report_lines.extend([
                "四、推理过程详解",
                "-" * 40,
            ])
            for i, step in enumerate(reasoning_path, 1):
                explanation = step.get("explanation", step.get("description", ""))
                law_ref = step.get("law_reference", "")
                conf = step.get("confidence", 0) * 100
                report_lines.append(f"步骤{i}（置信度{conf:.0f}%）：")
                report_lines.append(f"  {explanation}")
                if law_ref:
                    report_lines.append(f"  [法律依据] {law_ref}")
                report_lines.append("")

        if relevant_laws:
            report_lines.extend([
                "五、相关法条索引",
                "-" * 40,
            ])
            for law in relevant_laws:
                name = law.get("name", "")
                article = law.get("article", "")
                category = law.get("category", "")
                report_lines.append(f"• {category} {article}：{name}")
            report_lines.append("")

        report_lines.extend([
            "=" * 60,
            "本报告由多模态知识图谱法律辅助系统自动生成",
            "仅供参考，不构成正式法律意见",
            "=" * 60,
        ])

        return "\n".join(report_lines)

    def _compute_differences(self, original_verdict, alternative_verdict,
                              original_elements, modified_elements_map) -> List[Dict]:
        differences = []

        if original_verdict.get("punishment_level") != alternative_verdict.get("punishment_level"):
            differences.append({
                "field": "量刑等级",
                "original_value": original_verdict.get("punishment_level", ""),
                "modified_value": alternative_verdict.get("punishment_level", ""),
                "impact": "量刑等级发生变化",
                "severity": "high"
            })

        orig_years = original_verdict.get("base_years", 0)
        mod_years = alternative_verdict.get("years", 0)
        if orig_years != mod_years:
            diff = abs(mod_years - orig_years)
            severity = "high" if diff >= 3 else "medium" if diff >= 1 else "low"
            differences.append({
                "field": "刑期",
                "original_value": f"{orig_years}年",
                "modified_value": f"{mod_years}年",
                "impact": f"刑期{'增加' if mod_years > orig_years else '减少'}{diff:.1f}年",
                "severity": severity
            })

        if original_verdict.get("crime_type") != alternative_verdict.get("crime_type"):
            differences.append({
                "field": "罪名",
                "original_value": original_verdict.get("crime_type", ""),
                "modified_value": alternative_verdict.get("crime_type", ""),
                "impact": "罪名发生变化",
                "severity": "high"
            })

        return differences

    def _find_relevant_laws(self, elements: List[Dict]) -> List[Dict]:
        laws = []
        law_ids_seen = set()
        actions = [e for e in elements if e.get("type") == "action"]
        circumstances = [e for e in elements if e.get("type") == "circumstance"]

        crime_law_map = {
            "盗窃": {"article": "第二百六十四条", "name": "盗窃罪", "category": "刑法", "id": "cl_264"},
            "抢劫": {"article": "第二百六十三条", "name": "抢劫罪", "category": "刑法", "id": "cl_263"},
            "诈骗": {"article": "第二百六十六条", "name": "诈骗罪", "category": "刑法", "id": "cl_266"},
            "故意伤害": {"article": "第二百三十四条", "name": "故意伤害罪", "category": "刑法", "id": "cl_234"},
            "故意杀人": {"article": "第二百三十二条", "name": "故意杀人罪", "category": "刑法", "id": "cl_232"},
            "杀人": {"article": "第二百三十二条", "name": "故意杀人罪", "category": "刑法", "id": "cl_232"},
            "强奸": {"article": "第二百三十六条", "name": "强奸罪", "category": "刑法", "id": "cl_236"},
            "绑架": {"article": "第二百三十九条", "name": "绑架罪", "category": "刑法", "id": "cl_239"},
            "敲诈勒索": {"article": "第二百七十四条", "name": "敲诈勒索罪", "category": "刑法", "id": "cl_274"},
            "贪污": {"article": "第三百八十二条", "name": "贪污罪", "category": "刑法", "id": "cl_382"},
            "受贿": {"article": "第三百八十五条", "name": "受贿罪", "category": "刑法", "id": "cl_385"},
            "走私": {"article": "第一百五十三条", "name": "走私罪", "category": "刑法", "id": "cl_153"},
            "贩卖毒品": {"article": "第三百四十七条", "name": "贩卖毒品罪", "category": "刑法", "id": "cl_347"},
            "放火": {"article": "第一百一十四条", "name": "放火罪", "category": "刑法", "id": "cl_114"},
            "交通肇事": {"article": "第一百三十三条", "name": "交通肇事罪", "category": "刑法", "id": "cl_133"},
            "危险驾驶": {"article": "第一百三十三条之一", "name": "危险驾驶罪", "category": "刑法", "id": "cl_133_1"},
            "职务侵占": {"article": "第二百七十一条", "name": "职务侵占罪", "category": "刑法", "id": "cl_271"},
            "挪用资金": {"article": "第二百七十二条", "name": "挪用资金罪", "category": "刑法", "id": "cl_272"},
            "侵占": {"article": "第二百七十条", "name": "侵占罪", "category": "刑法", "id": "cl_270"},
        }

        for action in actions:
            name = str(action.get("value", "")).strip()
            if not name:
                continue

            matched = None
            for key in sorted(crime_law_map.keys(), key=lambda x: -len(x)):
                if name == key or name == f"{key}罪":
                    matched = crime_law_map[key]
                    break

            if matched is None:
                for key in sorted(crime_law_map.keys(), key=lambda x: -len(x)):
                    if key in name or f"{key}罪" in name:
                        matched = crime_law_map[key]
                        break

            if matched and matched["id"] not in law_ids_seen:
                laws.append(dict(matched))
                law_ids_seen.add(matched["id"])

        for circ in circumstances:
            circ_name = circ.get("name", "")
            circ_code = circ.get("metadata", {}).get("code", "") if circ.get("metadata") else ""

            law_ref = None
            circ_modifiers = LEGAL_REASONING_RULES.get("circumstance_modifiers", {})
            for key, mod in circ_modifiers.items():
                if key == circ_code or key in circ_name.lower():
                    law_ref = mod.get("law_ref", "")
                    break

            if law_ref and law_ref not in law_ids_seen:
                law_entry = {
                    "article": law_ref,
                    "name": circ_name,
                    "category": "刑法",
                    "id": self._get_law_id_from_ref(law_ref)
                }
                if law_entry["id"] not in law_ids_seen:
                    laws.append(law_entry)
                    law_ids_seen.add(law_entry["id"])

        return laws[:5]

    def _get_law_id_from_ref(self, law_ref: str) -> str:
        article_number_map = {
            "刑法第十七条": "cl_17",
            "刑法第十八条": "cl_18",
            "刑法第十四条": "cl_14",
            "刑法第十五条": "cl_15",
            "刑法第二十条": "cl_20",
            "刑法第二十一条": "cl_21",
            "刑法第二十二条": "cl_22",
            "刑法第二十三条": "cl_23",
            "刑法第二十四条": "cl_24",
            "刑法第二十五条": "cl_25",
            "刑法第二十六条": "cl_26",
            "刑法第二十七条": "cl_27",
            "刑法第二十八条": "cl_28",
            "刑法第二十九条": "cl_29",
            "刑法第六十五条": "cl_65",
            "刑法第六十六条": "cl_66",
            "刑法第六十七条": "cl_67",
            "刑法第六十八条": "cl_68",
            "刑法第六十七条第三款": "cl_67",
            "刑法第六十九条": "cl_69",
            "刑法第七十条": "cl_70",
            "刑法第七十一条": "cl_71",
            "刑法第七十二条": "cl_72",
            "刑法第七十三条": "cl_73",
            "刑法第七十四条": "cl_74",
            "刑法第七十五条": "cl_75",
            "刑法第七十六条": "cl_76",
            "刑法第七十七条": "cl_77",
        }

        return article_number_map.get(law_ref, f"cl_{hash(law_ref) % 10000}")

    def _find_relevant_cases(self, elements: List[Dict]) -> List[Dict]:
        cases = []
        actions = [e for e in elements if e.get("type") == "action"]

        if actions:
            crime = actions[0].get("value", "")
            cases.append({
                "title": f"指导案例：{crime}典型案例",
                "case_number": f"指导案例第{hash(crime) % 1000:03d}号",
                "court": "最高人民法院",
                "relevance": "高度相关"
            })

        amounts = [e for e in elements if e.get("type") == "amount"]
        if amounts:
            try:
                amount = float(amounts[0].get("value", 0))
                level = "特别巨大" if amount > 100000 else "巨大" if amount > 30000 else "较大" if amount > 3000 else "较小"
                cases.append({
                    "title": f"数额{level}的量刑参考案例",
                    "case_number": "参考案例",
                    "court": "各级人民法院",
                    "relevance": "中度相关"
                })
            except (ValueError, TypeError):
                pass

        return cases[:3]

    def _calculate_confidence(self, reasoning_path: List[Dict], num_modifications: int) -> float:
        base_confidence = 0.9
        path_penalty = len(reasoning_path) * 0.02
        modification_penalty = num_modifications * 0.05
        confidence = base_confidence - path_penalty - modification_penalty
        return round(max(0.3, min(1.0, confidence)), 2)


reasoning_service = ReasoningService()
