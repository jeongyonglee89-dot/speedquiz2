"""출제·채점·진행·시간 판정. Streamlit에 의존하지 않아 pytest로 바로 검사할 수 있다.

한 게임 = 시장 → 기술 → 제품 순서로 카테고리마다 10문제(PRD-speed-quiz.md 3장).
보기는 문제마다 섞고, 화면·채점은 섞인 위치(correct_pos) 기준이다. 원본 answerIndex는 출제 때만 쓴다.

시간 판정(S-05)은 서버 시각 기준이다. 문제가 처음 화면에 그려진 시각(mark_shown)과 답을 받은 시각의 차이가
TIME_LIMIT_SEC를 넘으면, 화면 타이머가 어떻게 보였든 시간 초과로 처리한다. 시각은 인자로 받아 테스트에서
가짜 시계를 쓸 수 있다(앱에서는 time.monotonic()).
"""
from __future__ import annotations

import json
import random
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path

QUESTIONS_PATH = Path(__file__).resolve().parent.parent / "data" / "questions.json"

CATEGORY_ORDER = ("market", "tech", "product")
CATEGORY_NAMES = {"market": "시장", "tech": "기술", "product": "제품"}
DIFFICULTY_MIX = {"easy": 4, "normal": 4, "hard": 2}  # 카테고리당 10문제의 난이도 구성 (PRD 8장)
QUESTIONS_PER_CATEGORY = sum(DIFFICULTY_MIX.values())
POINTS_PER_CORRECT = 10
MAX_TOTAL = QUESTIONS_PER_CATEGORY * POINTS_PER_CORRECT * len(CATEGORY_ORDER)
TIME_LIMIT_SEC = 5.0

KST = timezone(timedelta(hours=9))  # 한국 표준시(일광절약시간 없음). Windows에 tzdata가 없어도 동작

NICKNAME_MIN = 2
NICKNAME_MAX = 12
# 웹 버전 js/quiz.js의 BANNED_WORDS와 같은 목록
BANNED_WORDS = ("시발", "씨발", "병신", "개새끼", "좆", "fuck", "shit", "운영자", "관리자", "admin")


def load_questions(path: Path = QUESTIONS_PATH) -> dict[str, list[dict]]:
    with path.open(encoding="utf-8") as f:
        return json.load(f)


def judge_time(shown_at: float, answered_at: float, limit: float = TIME_LIMIT_SEC) -> tuple[bool, float]:
    """(시간 초과 여부, 기록할 응답 시간). 응답 시간은 제한 시간을 넘지 않게 자르고 소수 둘째 자리로 반올림."""
    elapsed = max(0.0, answered_at - shown_at)
    return elapsed > limit, round(min(elapsed, limit), 2)


@dataclass
class Item:
    """화면에 낼 한 문제. choices는 섞인 순서, correct_pos는 그 안의 정답 위치."""

    id: str
    category: str
    difficulty: str
    question: str
    choices: list[str]
    correct_pos: int
    explanation: str

    @property
    def correct_choice(self) -> str:
        return self.choices[self.correct_pos]


@dataclass
class Answer:
    item: Item
    picked_pos: int | None  # None = 시간 초과(답하지 못함)
    elapsed: float | None = None  # 응답 시간(초)

    @property
    def timed_out(self) -> bool:
        return self.picked_pos is None

    @property
    def correct(self) -> bool:
        return self.picked_pos is not None and self.picked_pos == self.item.correct_pos

    @property
    def picked_choice(self) -> str | None:
        return None if self.picked_pos is None else self.item.choices[self.picked_pos]


def make_item(question: dict, rng: random.Random) -> Item:
    order = list(range(len(question["choices"])))
    rng.shuffle(order)
    return Item(
        id=question["id"],
        category=question["category"],
        difficulty=question["difficulty"],
        question=question["question"],
        choices=[question["choices"][i] for i in order],
        correct_pos=order.index(question["answerIndex"]),
        explanation=question["explanation"],
    )


def pick_category(pool: list[dict], rng: random.Random) -> list[Item]:
    """speed가 false가 아닌 문제 중 난이도 구성(DIFFICULTY_MIX)대로 뽑고 순서를 섞는다.

    어떤 난이도가 모자라면 남은 문제로 채워 항상 QUESTIONS_PER_CATEGORY개를 낸다.
    """
    usable = [q for q in pool if q.get("speed", True)]
    if len(usable) < QUESTIONS_PER_CATEGORY:
        raise ValueError(f"출제 가능한 문제가 {len(usable)}개뿐이다 (필요 {QUESTIONS_PER_CATEGORY}개)")
    picked: list[dict] = []
    for difficulty, count in DIFFICULTY_MIX.items():
        group = [q for q in usable if q["difficulty"] == difficulty]
        picked += rng.sample(group, min(count, len(group)))
    rest = [q for q in usable if q not in picked]
    picked += rng.sample(rest, QUESTIONS_PER_CATEGORY - len(picked))
    rng.shuffle(picked)
    return [make_item(q, rng) for q in picked]


@dataclass
class CategoryResult:
    category: str
    correct: int
    total: int
    time_sec: float

    @property
    def score(self) -> int:
        return self.correct * POINTS_PER_CORRECT

    @property
    def average_time(self) -> float:
        return round(self.time_sec / self.total, 1) if self.total else 0.0


@dataclass
class Game:
    """한 게임의 진행 상태. 한 문제에 답은 한 번만 받는다."""

    nickname: str
    rounds: dict[str, list[Item]]
    answers: dict[str, list[Answer]] = field(default_factory=dict)
    category_index: int = 0
    shown_at: dict[str, float] = field(default_factory=dict)  # item.id → 처음 화면에 그려진 서버 시각
    game_id: str = field(default_factory=lambda: uuid.uuid4().hex)
    pin_hash: str = ""
    completed_at: str | None = None

    @classmethod
    def new(cls, nickname: str, bank: dict[str, list[dict]], rng: random.Random | None = None,
            pin_hash: str = "") -> "Game":
        rng = rng or random.Random()
        rounds = {c: pick_category(bank[c], rng) for c in CATEGORY_ORDER}
        return cls(nickname=nickname, rounds=rounds, answers={c: [] for c in CATEGORY_ORDER}, pin_hash=pin_hash)

    # ---- 위치 ----
    @property
    def category(self) -> str:
        return CATEGORY_ORDER[self.category_index]

    @property
    def question_index(self) -> int:
        """현재 카테고리에서 다음에 답할 문제 번호(0부터)."""
        return len(self.answers[self.category])

    @property
    def category_done(self) -> bool:
        return self.question_index >= len(self.rounds[self.category])

    @property
    def is_last_category(self) -> bool:
        return self.category_index == len(CATEGORY_ORDER) - 1

    @property
    def finished(self) -> bool:
        return self.is_last_category and self.category_done

    @property
    def overall_index(self) -> int:
        """30문제 중 지금까지 답한 수."""
        return sum(len(self.answers[c]) for c in CATEGORY_ORDER)

    @property
    def overall_total(self) -> int:
        return sum(len(items) for items in self.rounds.values())

    def current_item(self) -> Item | None:
        if self.category_done:
            return None
        return self.rounds[self.category][self.question_index]

    @property
    def last_answer(self) -> Answer | None:
        answers = self.answers[self.category]
        return answers[-1] if answers else None

    # ---- 시간 ----
    def mark_shown(self, item_id: str, now: float) -> None:
        """현재 문제가 화면에 처음 그려진 시각을 기록한다. 다시 그려져도(rerun) 덮어쓰지 않는다."""
        item = self.current_item()
        if item is not None and item.id == item_id:
            self.shown_at.setdefault(item_id, now)

    def remaining(self, now: float) -> float:
        item = self.current_item()
        if item is None or item.id not in self.shown_at:
            return TIME_LIMIT_SEC
        return max(0.0, TIME_LIMIT_SEC - (now - self.shown_at[item.id]))

    # ---- 진행 ----
    def submit(self, item_id: str, picked_pos: int | None, now: float | None = None) -> Answer | None:
        """현재 문제에 답한다. picked_pos=None이면 시간 초과.

        - item_id가 현재 문제가 아니면(연타, 시간 초과 뒤 늦게 도착한 클릭, 오래된 화면) 무시하고 None.
        - now가 있으면 서버 기준으로 판정해, 제한 시간을 넘긴 답은 고른 보기와 관계없이 시간 초과로 기록한다.
        """
        item = self.current_item()
        if item is None or item.id != item_id:
            return None
        if picked_pos is not None and not 0 <= picked_pos < len(item.choices):
            raise ValueError(f"보기 위치가 범위를 벗어남: {picked_pos}")
        elapsed = None
        if now is not None:
            timed_out, elapsed = judge_time(self.shown_at.get(item_id, now), now)
            if timed_out:
                picked_pos = None
        answer = Answer(item=item, picked_pos=picked_pos, elapsed=elapsed)
        self.answers[self.category].append(answer)
        if self.finished:
            self.completed_at = datetime.now(KST).isoformat(timespec="seconds")
        return answer

    def next_category(self) -> bool:
        """카테고리를 다 풀었을 때 다음 카테고리로. 마지막이면 False."""
        if not self.category_done or self.is_last_category:
            return False
        self.category_index += 1
        return True

    # ---- 결과 ----
    def category_result(self, category: str) -> CategoryResult:
        answers = self.answers[category]
        return CategoryResult(
            category,
            correct=sum(a.correct for a in answers),
            total=len(self.rounds[category]),
            time_sec=sum(a.elapsed or 0.0 for a in answers),
        )

    def total_score(self) -> int:
        return sum(self.category_result(c).score for c in CATEGORY_ORDER)

    def total_time(self) -> float:
        """30문제 총 응답 시간(초, 소수 첫째 자리). 순위 동점 처리에 쓴다."""
        return round(sum(a.elapsed or 0.0 for c in CATEGORY_ORDER for a in self.answers[c]), 1)

    def wrong_answers(self) -> list[Answer]:
        return [a for c in CATEGORY_ORDER for a in self.answers[c] if not a.correct]

    def to_record(self, app_version: str) -> dict:
        """순위 저장소(PRD 7장)에 넣을 한 행."""
        if not self.finished:
            raise ValueError("끝까지 푼 게임만 기록한다")
        scores = {c: self.category_result(c).score for c in CATEGORY_ORDER}
        return {
            "completed_at": self.completed_at,
            "game_id": self.game_id,
            "nickname": self.nickname,
            "pin_hash": self.pin_hash,
            **scores,
            "total": self.total_score(),
            "total_time_sec": self.total_time(),
            "app_version": app_version,
        }


def validate_nickname(raw: str | None) -> tuple[bool, str]:
    """웹 버전 validateNickname과 같은 규칙. (통과 여부, 정리된 닉네임 또는 오류 문구)."""
    value = (raw or "").strip()
    if not NICKNAME_MIN <= len(value) <= NICKNAME_MAX:
        return False, f"닉네임은 {NICKNAME_MIN}~{NICKNAME_MAX}자로 입력해 주세요."
    compact = "".join(value.lower().split())
    if any(word in compact for word in BANNED_WORDS):
        return False, "사용할 수 없는 단어가 포함되어 있습니다."
    return True, value
