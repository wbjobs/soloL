import json
import os
from typing import Dict, List, Optional, Any
from datetime import datetime
from app.utils.helpers import generate_id, format_time
from app.utils.logger import setup_logger

logger = setup_logger()

CASES_FILE = "data/cases_store.json"


class CaseRepository:
    def __init__(self):
        self._cases: Dict[str, Dict] = {}
        self._load()

    def _load(self):
        os.makedirs(os.path.dirname(CASES_FILE), exist_ok=True)
        if os.path.exists(CASES_FILE):
            with open(CASES_FILE, "r", encoding="utf-8") as f:
                self._cases = json.load(f)
        else:
            self._cases = {}

    def _save(self):
        os.makedirs(os.path.dirname(CASES_FILE), exist_ok=True)
        with open(CASES_FILE, "w", encoding="utf-8") as f:
            json.dump(self._cases, f, ensure_ascii=False, indent=2, default=str)

    def create(self, title: str, description: str, case_type: str) -> Dict:
        case_id = generate_id("case_")
        case = {
            "id": case_id,
            "title": title,
            "description": description,
            "case_type": case_type,
            "status": "processing",
            "elements": [],
            "text_content": "",
            "ocr_text": "",
            "audio_transcript": "",
            "created_at": format_time(datetime.now()),
            "updated_at": format_time(datetime.now())
        }
        self._cases[case_id] = case
        self._save()
        return case

    def get(self, case_id: str) -> Optional[Dict]:
        return self._cases.get(case_id)

    def list_cases(self, page: int = 1, page_size: int = 20, case_type: Optional[str] = None) -> Dict:
        cases = list(self._cases.values())
        if case_type:
            cases = [c for c in cases if c.get("case_type") == case_type]
        cases.sort(key=lambda x: x.get("created_at", ""), reverse=True)
        total = len(cases)
        start = (page - 1) * page_size
        items = cases[start:start + page_size]
        return {"items": items, "total": total, "page": page, "page_size": page_size}

    def update(self, case_id: str, updates: Dict[str, Any]) -> Optional[Dict]:
        if case_id not in self._cases:
            return None
        self._cases[case_id].update(updates)
        self._cases[case_id]["updated_at"] = format_time(datetime.now())
        self._save()
        return self._cases[case_id]

    def update_elements(self, case_id: str, elements: List[Dict]) -> Optional[Dict]:
        if case_id not in self._cases:
            return None
        existing = self._cases[case_id].get("elements", [])
        existing_ids = {e["id"] for e in existing}
        for elem in elements:
            if elem["id"] not in existing_ids:
                existing.append(elem)
                existing_ids.add(elem["id"])
        self._cases[case_id]["elements"] = existing
        self._cases[case_id]["updated_at"] = format_time(datetime.now())
        self._save()
        return self._cases[case_id]

    def set_text_content(self, case_id: str, content: str) -> Optional[Dict]:
        if case_id not in self._cases:
            return None
        self._cases[case_id]["text_content"] = content
        self._cases[case_id]["updated_at"] = format_time(datetime.now())
        self._save()
        return self._cases[case_id]

    def set_ocr_text(self, case_id: str, ocr_text: str) -> Optional[Dict]:
        if case_id not in self._cases:
            return None
        self._cases[case_id]["ocr_text"] = ocr_text
        self._cases[case_id]["updated_at"] = format_time(datetime.now())
        self._save()
        return self._cases[case_id]

    def set_audio_transcript(self, case_id: str, transcript: str) -> Optional[Dict]:
        if case_id not in self._cases:
            return None
        self._cases[case_id]["audio_transcript"] = transcript
        self._cases[case_id]["updated_at"] = format_time(datetime.now())
        self._save()
        return self._cases[case_id]

    def delete(self, case_id: str) -> bool:
        if case_id in self._cases:
            del self._cases[case_id]
            self._save()
            return True
        return False


case_repository = CaseRepository()
