"""웹 버전 문제 은행(data/*.js)을 스피드 퀴즈용 data/questions.json으로 변환한다.

실행: python scripts/convert_questions.py

- JS 파일은 `window.QUIZ_DATA.<category> = [ {...}, ... ];` 형식이다. eval 없이 작은 파서로 읽는다.
  지원하는 문법: 작은따옴표/큰따옴표 문자열(\\' 등 이스케이프), 따옴표 없는 키, 숫자, 배열·객체,
  // 주석, 끝 쉼표. 데이터 파일이 이 범위를 벗어나면 오류를 낸다.
- 필드는 그대로 두고, 5초 안에 읽기 어려운 문제(질문 60자 초과 또는 보기 20자 초과)에 "speed": false를 붙인다
  (PRD-speed-quiz.md 8장).
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
OUTPUT = DATA_DIR / "questions.json"
CATEGORIES = ("market", "tech", "product")
MAX_QUESTION_CHARS = 60
MAX_CHOICE_CHARS = 20
REQUIRED_FIELDS = ("id", "category", "question", "choices", "answerIndex", "explanation", "difficulty")

ESCAPES = {"n": "\n", "t": "\t", "r": "\r", "\\": "\\", "'": "'", '"': '"', "/": "/"}


class ParseError(ValueError):
    pass


class _Parser:
    """JS 객체·배열 리터럴의 좁은 부분집합을 파이썬 값으로 읽는다."""

    def __init__(self, text: str, pos: int):
        self.text = text
        self.pos = pos

    def error(self, message: str) -> ParseError:
        line = self.text.count("\n", 0, self.pos) + 1
        return ParseError(f"{message} (줄 {line})")

    def skip(self) -> None:
        while self.pos < len(self.text):
            ch = self.text[self.pos]
            if ch.isspace():
                self.pos += 1
            elif self.text.startswith("//", self.pos):
                end = self.text.find("\n", self.pos)
                self.pos = len(self.text) if end == -1 else end
            else:
                break

    def peek(self) -> str:
        self.skip()
        if self.pos >= len(self.text):
            raise self.error("파일이 예상보다 일찍 끝남")
        return self.text[self.pos]

    def value(self):
        ch = self.peek()
        if ch == "[":
            return self.array()
        if ch == "{":
            return self.obj()
        if ch in "'\"":
            return self.string()
        if ch == "-" or ch.isdigit():
            return self.number()
        word = re.match(r"(true|false|null)\b", self.text[self.pos:])
        if word:
            self.pos += len(word.group(1))
            return {"true": True, "false": False, "null": None}[word.group(1)]
        raise self.error(f"알 수 없는 값 시작 문자 {ch!r}")

    def string(self) -> str:
        quote = self.text[self.pos]
        self.pos += 1
        out = []
        while True:
            if self.pos >= len(self.text):
                raise self.error("닫히지 않은 문자열")
            ch = self.text[self.pos]
            if ch == quote:
                self.pos += 1
                return "".join(out)
            if ch == "\\":
                nxt = self.text[self.pos + 1]
                if nxt not in ESCAPES:
                    raise self.error(f"지원하지 않는 이스케이프 \\{nxt}")
                out.append(ESCAPES[nxt])
                self.pos += 2
            elif ch == "\n":
                raise self.error("문자열 안에 줄바꿈")
            else:
                out.append(ch)
                self.pos += 1

    def number(self):
        match = re.match(r"-?\d+(\.\d+)?", self.text[self.pos:])
        self.pos += len(match.group(0))
        return float(match.group(0)) if match.group(1) else int(match.group(0))

    def array(self) -> list:
        self.pos += 1
        items = []
        while self.peek() != "]":
            items.append(self.value())
            if self.peek() == ",":
                self.pos += 1
            elif self.peek() != "]":
                raise self.error("배열 항목 사이에 쉼표가 없음")
        self.pos += 1
        return items

    def obj(self) -> dict:
        self.pos += 1
        result = {}
        while self.peek() != "}":
            if self.peek() in "'\"":
                key = self.string()
            else:
                match = re.match(r"[A-Za-z_$][\w$]*", self.text[self.pos:])
                if not match:
                    raise self.error("객체 키를 읽을 수 없음")
                key = match.group(0)
                self.pos += len(key)
            if self.peek() != ":":
                raise self.error(f"키 {key!r} 뒤에 ':'가 없음")
            self.pos += 1
            result[key] = self.value()
            if self.peek() == ",":
                self.pos += 1
            elif self.peek() != "}":
                raise self.error("객체 항목 사이에 쉼표가 없음")
        self.pos += 1
        return result


def parse_category_file(text: str, category: str) -> list[dict]:
    marker = re.search(rf"window\.QUIZ_DATA\.{category}\s*=\s*", text)
    if not marker:
        raise ParseError(f"window.QUIZ_DATA.{category} 대입문을 찾지 못함")
    parser = _Parser(text, marker.end())
    data = parser.value()
    if not isinstance(data, list):
        raise ParseError(f"{category}: 배열이 아님")
    return data


def is_speed_friendly(question: dict) -> bool:
    return len(question["question"]) <= MAX_QUESTION_CHARS and all(
        len(choice) <= MAX_CHOICE_CHARS for choice in question["choices"]
    )


def convert() -> dict[str, list[dict]]:
    bank: dict[str, list[dict]] = {}
    for category in CATEGORIES:
        text = (DATA_DIR / f"{category}.js").read_text(encoding="utf-8")
        questions = parse_category_file(text, category)
        for q in questions:
            missing = [f for f in REQUIRED_FIELDS if f not in q]
            if missing:
                raise ParseError(f"{q.get('id', '?')}: 필드 누락 {missing}")
            q["speed"] = is_speed_friendly(q)
        bank[category] = questions
    return bank


def main() -> int:
    # Windows 콘솔(cp949)에서도 한글이 깨지지 않게 출력 인코딩을 UTF-8로 고정한다
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    bank = convert()
    OUTPUT.write_text(json.dumps(bank, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"저장: {OUTPUT.relative_to(ROOT)}")
    for category, questions in bank.items():
        usable = [q for q in questions if q["speed"]]
        mix = {d: sum(1 for q in usable if q["difficulty"] == d) for d in ("easy", "normal", "hard")}
        print(f"{category:8} 전체 {len(questions):2}문제, 스피드 출제 가능 {len(usable):2}문제 "
              f"(쉬움 {mix['easy']} · 보통 {mix['normal']} · 어려움 {mix['hard']})")
        for q in questions:
            if not q["speed"]:
                long_choices = [c for c in q["choices"] if len(c) > MAX_CHOICE_CHARS]
                reason = []
                if len(q["question"]) > MAX_QUESTION_CHARS:
                    reason.append(f"질문 {len(q['question'])}자")
                if long_choices:
                    reason.append(f"보기 {max(len(c) for c in long_choices)}자")
                print(f"  speed=false {q['id']}: {', '.join(reason)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
