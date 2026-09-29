"""AI 오답분석 (PRD-speed-quiz.md 6장, S-09).

- 모델과 호출 옵션은 코드에 고정하지 않고 설정값을 따른다. OPENAI_MODEL이 없으면 기능을 끈다.
- 보내는 내용은 카테고리별 점수와 틀린·시간 초과 문제뿐이다. 닉네임 등 개인정보는 보내지 않는다.
- 어떤 실패도 예외로 올리지 않고 Analysis(ok=False, message=…)로 돌려준다. 게임·순위 저장에 영향을 주지 않기 위해서다.
"""
from __future__ import annotations

import json
from collections.abc import Callable
from dataclasses import dataclass

from quiz.engine import CATEGORY_NAMES, CATEGORY_ORDER, Game

DEFAULT_TIMEOUT_SEC = 15.0

SYSTEM_PROMPT = """너는 철강 산업 교육 담당자다. 철강 상식 퀴즈 참가자의 오답을 보고 한국어로 짧은 학습 피드백을 쓴다.
아래 네 부분을 이 순서로, 전체 500자 이내로 쓴다. 제목은 굵게 한 줄씩 붙인다.
1. 약한 분야와 개념 요약
2. 틀린 문제에서 드러난 오해 2~3가지
3. 다음에 공부할 주제 3가지
4. 짧은 격려 한 문장
주어진 문제와 해설에 있는 사실만 쓰고, 새로운 수치나 사실을 지어내지 않는다."""


@dataclass
class AnalysisConfig:
    api_key: str
    model: str
    base_url: str | None = None
    max_output_tokens: int | None = None
    temperature: float | None = None
    timeout_sec: float = DEFAULT_TIMEOUT_SEC


@dataclass
class Analysis:
    ok: bool
    text: str = ""
    message: str = ""  # ok=False일 때 화면에 보여 줄 안내 (비밀값·예외 내용을 담지 않는다)


def load_config(get: Callable[[str], str | None]) -> tuple[AnalysisConfig | None, str]:
    """설정에서 AnalysisConfig를 만든다. 쓸 수 없으면 (None, 안내 문구)."""
    api_key, model = get("OPENAI_API_KEY"), get("OPENAI_MODEL")
    if not api_key or not model:
        return None, "오답분석이 설정되지 않았습니다."
    try:
        max_tokens = int(get("OPENAI_MAX_OUTPUT_TOKENS")) if get("OPENAI_MAX_OUTPUT_TOKENS") else None
        temperature = float(get("OPENAI_TEMPERATURE")) if get("OPENAI_TEMPERATURE") else None
        timeout = float(get("OPENAI_TIMEOUT_SEC")) if get("OPENAI_TIMEOUT_SEC") else DEFAULT_TIMEOUT_SEC
    except ValueError:
        return None, "오답분석 설정값 형식이 올바르지 않습니다."
    return AnalysisConfig(api_key, model, get("OPENAI_BASE_URL"), max_tokens, temperature, timeout), ""


def build_payload(game: Game) -> dict:
    """모델에 보낼 내용. 닉네임·게임 id·PIN은 넣지 않는다."""
    return {
        "category_scores": {
            CATEGORY_NAMES[c]: f"{game.category_result(c).score}점 / {game.category_result(c).total * 10}점"
            for c in CATEGORY_ORDER
        },
        "wrong_answers": [
            {
                "category": CATEGORY_NAMES[a.item.category],
                "difficulty": a.item.difficulty,
                "question": a.item.question,
                "my_answer": "시간 초과" if a.timed_out else a.picked_choice,
                "correct_answer": a.item.correct_choice,
                "explanation": a.item.explanation,
            }
            for a in game.wrong_answers()
        ],
    }


def build_messages(game: Game) -> list[dict]:
    return [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": json.dumps(build_payload(game), ensure_ascii=False)},
    ]


def analyze(game: Game, config: AnalysisConfig | None, *, client_factory=None) -> Analysis:
    """오답분석을 요청한다. 만점이면 호출하지 않는다. client_factory는 테스트에서 가짜 클라이언트를 넣을 때 쓴다."""
    if not game.wrong_answers():
        return Analysis(ok=True, text="모든 문제를 맞혔습니다. 분석할 오답이 없습니다.")
    if config is None:
        return Analysis(ok=False, message="오답분석이 설정되지 않았습니다.")
    try:
        if client_factory is None:
            from openai import OpenAI

            client_factory = OpenAI
        client = client_factory(api_key=config.api_key, base_url=config.base_url,
                                timeout=config.timeout_sec, max_retries=1)
        options = {}
        if config.max_output_tokens is not None:
            options["max_completion_tokens"] = config.max_output_tokens
        if config.temperature is not None:
            options["temperature"] = config.temperature
        response = client.chat.completions.create(model=config.model, messages=build_messages(game), **options)
        text = (response.choices[0].message.content or "").strip()
        if not text:
            return Analysis(ok=False, message="오답분석 결과가 비어 있습니다.")
        return Analysis(ok=True, text=text)
    except Exception:  # noqa: BLE001 - 네트워크·인증·한도 등 모든 실패를 같은 안내로 처리
        return Analysis(ok=False, message="오답분석을 불러오지 못했습니다.")
