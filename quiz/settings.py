"""설정 읽기. 순서: Streamlit Secrets(st.secrets) → 환경 변수 → 로컬 .env (PRD-speed-quiz.md 6장).

같은 키가 여러 곳에 있으면 앞의 것을 쓴다. 없는 키는 None.
값은 화면·로그에 출력하지 않는다(비밀값이 섞여 있다).
"""
from __future__ import annotations

import os
from collections.abc import Mapping
from functools import lru_cache
from pathlib import Path
from typing import Any

ENV_PATH = Path(__file__).resolve().parent.parent / ".env"

# PRD 9장 설정 키 목록
REQUIRED_STORAGE_KEYS = ("SHEET_URL", "CONTEST_ID")  # + [gcp_service_account] 섹션
SERVICE_ACCOUNT_SECTION = "gcp_service_account"


def _secrets() -> Mapping[str, Any]:
    """st.secrets. secrets.toml이 없거나 Streamlit 밖(pytest 등)이면 빈 매핑."""
    try:
        import streamlit as st

        secrets = st.secrets
        # secrets.toml이 없으면 접근하는 순간 예외가 난다
        secrets.keys()
        return secrets
    except Exception:  # noqa: BLE001 - 설정 파일이 없을 때의 여러 예외를 모두 "없음"으로 본다
        return {}


@lru_cache(maxsize=1)
def _dotenv() -> dict[str, str]:
    if not ENV_PATH.exists():
        return {}
    from dotenv import dotenv_values

    return {k: v for k, v in dotenv_values(ENV_PATH).items() if v is not None}


def get(key: str, default: str | None = None) -> str | None:
    """단일 값 설정. 빈 문자열은 없는 것으로 본다."""
    for source in (_secrets(), os.environ, _dotenv()):
        value = source.get(key) if hasattr(source, "get") else None
        if isinstance(value, Mapping):
            continue  # 섹션은 get_section으로 읽는다
        if value not in (None, ""):
            return str(value)
    return default


def get_section(name: str) -> dict[str, Any] | None:
    """Secrets의 표(섹션) 설정. 예: [gcp_service_account]. 환경 변수·.env에는 섹션이 없다."""
    value = _secrets().get(name)
    return dict(value) if isinstance(value, Mapping) and value else None


def missing_storage_settings() -> list[str]:
    """순위 저장소(Google Sheets)에 필요한데 빠진 설정 이름 목록. 값은 돌려주지 않는다."""
    missing = [k for k in REQUIRED_STORAGE_KEYS if not get(k)]
    if not get_section(SERVICE_ACCOUNT_SECTION):
        missing.append(f"[{SERVICE_ACCOUNT_SECTION}]")
    return missing
