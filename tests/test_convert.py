"""scripts/convert_questions.py의 JS 파서와 길이 기준 테스트."""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
from convert_questions import ParseError, convert, is_speed_friendly, parse_category_file  # noqa: E402

SAMPLE = r"""// 주석
window.QUIZ_DATA = window.QUIZ_DATA || {};
window.QUIZ_DATA.market = [
  // ---------- 쉬움 ----------
  {
    id: 'MKT-001',
    category: 'market',
    question: '철강이 \'산업의 쌀\'인 이유는?',
    choices: ['a', "b", 'c', 'd'],
    answerIndex: 2,
    explanation: '해설',
    difficulty: 'easy',
  },
];
"""


def test_parses_escapes_comments_and_trailing_commas():
    data = parse_category_file(SAMPLE, "market")
    assert data == [{
        "id": "MKT-001", "category": "market", "question": "철강이 '산업의 쌀'인 이유는?",
        "choices": ["a", "b", "c", "d"], "answerIndex": 2, "explanation": "해설", "difficulty": "easy",
    }]


def test_rejects_code_instead_of_data():
    with pytest.raises(ParseError):
        parse_category_file("window.QUIZ_DATA.market = [alert(1)];", "market")


def test_speed_friendly_length_limits():
    base = {"question": "가" * 60, "choices": ["나" * 20] * 4}
    assert is_speed_friendly(base)
    assert not is_speed_friendly({**base, "question": "가" * 61})
    assert not is_speed_friendly({**base, "choices": ["나" * 21] + ["다"] * 3})


def test_real_data_files_convert():
    bank = convert()
    assert {c: len(v) for c, v in bank.items()} == {"market": 40, "tech": 40, "product": 40}
    assert all("speed" in q for v in bank.values() for q in v)
