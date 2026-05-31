import uuid
from datetime import datetime
from typing import Any, Dict, List
import re
import jieba


def generate_id(prefix: str = "") -> str:
    return f"{prefix}{uuid.uuid4().hex[:16]}"


def current_time() -> datetime:
    return datetime.now()


def format_time(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%d %H:%M:%S")


def clean_text(text: str) -> str:
    if not text:
        return ""
    text = re.sub(r"\s+", " ", text)
    text = text.strip()
    return text


def extract_keywords(text: str, top_k: int = 10) -> List[str]:
    words = jieba.cut(text)
    stopwords = {"的", "了", "是", "在", "我", "有", "和", "就", "不", "人", "都", "一", "一个", "上", "也", "很", "到", "说", "要", "去", "你", "会", "着", "没有", "看", "好", "自己", "这"}
    filtered = [w for w in words if w not in stopwords and len(w) > 1]
    
    freq: Dict[str, int] = {}
    for w in filtered:
        freq[w] = freq.get(w, 0) + 1
    
    sorted_words = sorted(freq.items(), key=lambda x: x[1], reverse=True)
    return [w[0] for w in sorted_words[:top_k]]


def extract_amount(text: str) -> List[float]:
    pattern = r"(\d+(?:\.\d+)?)\s*(?:元|万元|人民币|块)"
    matches = re.findall(pattern, text)
    amounts = []
    for m in matches:
        try:
            amounts.append(float(m))
        except:
            pass
    return amounts


def safe_get(d: Dict[str, Any], key: str, default: Any = None) -> Any:
    try:
        return d.get(key, default)
    except (AttributeError, TypeError):
        return default
