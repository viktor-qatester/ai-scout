from __future__ import annotations

import html
import re
from urllib.parse import urlsplit

_TAG = re.compile(r"<[^>]+>")
_WS = re.compile(r"\s+")
_KEY = re.compile(r"[^0-9a-zа-я]+")


def normalize(text: str) -> str:
    text = html.unescape(text or "")
    text = text.replace("ё", "е").replace("Ё", "Е")
    text = text.lower()
    text = _WS.sub(" ", text)
    return text.strip()


def strip_html(text: str) -> str:
    text = _TAG.sub(" ", text or "")
    return _WS.sub(" ", html.unescape(text)).strip()


def norm_key(value: str) -> str:
    value = normalize(value)
    value = _KEY.sub(" ", value)
    return _WS.sub(" ", value).strip()


def norm_url(url: str) -> str:
    parts = urlsplit((url or "").strip())
    if not parts.netloc:
        return norm_key(url)
    path = parts.path.rstrip("/")
    return f"{parts.scheme.lower()}://{parts.netloc.lower()}{path}"


def vacancy_id_from_url(url: str) -> str:
    match = re.search(r"/vacanc(?:y|ies)/(\d+)", url or "")
    return match.group(1) if match else ""
