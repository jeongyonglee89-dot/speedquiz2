"""quiz/engine.py 단위 테스트. 실행: python -m pytest"""
import random
from collections import Counter

import pytest

from quiz.engine import (
    CATEGORY_ORDER,
    DIFFICULTY_MIX,
    MAX_TOTAL,
    QUESTIONS_PER_CATEGORY,
    Game,
    load_questions,
    make_item,
    pick_category,
    validate_nickname,
)

BANK = load_questions()


def play(game: Game, correct_per_category: int) -> None:
    """카테고리마다 앞의 n문제만 맞히며 끝까지 푼다."""
    for _ in CATEGORY_ORDER:
        for i in range(QUESTIONS_PER_CATEGORY):
            item = game.current_item()
            pos = item.correct_pos if i < correct_per_category else (item.correct_pos + 1) % 4
            assert game.submit(item.id, pos) is not None
        game.next_category()


def test_question_bank_has_three_categories():
    assert set(BANK) == set(CATEGORY_ORDER)


@pytest.mark.parametrize("category", CATEGORY_ORDER)
def test_pick_category_mix(category):
    for seed in range(20):
        items = pick_category(BANK[category], random.Random(seed))
        assert len(items) == QUESTIONS_PER_CATEGORY
        assert len({i.id for i in items}) == QUESTIONS_PER_CATEGORY, "중복 출제"
        assert all(i.category == category for i in items)
        assert Counter(i.difficulty for i in items) == Counter(DIFFICULTY_MIX)


def test_speed_false_questions_are_never_picked():
    excluded = {q["id"] for c in CATEGORY_ORDER for q in BANK[c] if not q.get("speed", True)}
    assert excluded, "변환 결과에 speed=false 문제가 있어야 이 테스트가 의미 있다"
    for seed in range(50):
        game = Game.new("테스터", BANK, random.Random(seed))
        picked = {i.id for items in game.rounds.values() for i in items}
        assert not picked & excluded


def test_pick_category_fills_when_a_difficulty_is_short():
    pool = [{"id": f"X-{n}", "category": "market", "difficulty": "easy", "question": "q", "choices": list("abcd"),
             "answerIndex": 0, "explanation": "e"} for n in range(12)]
    assert len(pick_category(pool, random.Random(1))) == QUESTIONS_PER_CATEGORY


def test_shuffled_choices_keep_correct_answer():
    for category in CATEGORY_ORDER:
        for question in BANK[category]:
            for seed in range(5):
                item = make_item(question, random.Random(seed))
                assert item.correct_choice == question["choices"][question["answerIndex"]]
                assert sorted(item.choices) == sorted(question["choices"])


def test_choice_order_is_actually_shuffled():
    question = BANK["market"][0]
    orders = {tuple(make_item(question, random.Random(seed)).choices) for seed in range(30)}
    assert len(orders) > 1


def test_full_game_scores_and_flow():
    game = Game.new("테스터", BANK, random.Random(7))
    assert game.category == "market" and game.overall_total == 30
    play(game, correct_per_category=6)
    assert game.finished
    assert [game.category_result(c).score for c in CATEGORY_ORDER] == [60, 60, 60]
    assert game.total_score() == 180
    assert len(game.wrong_answers()) == 12


def test_perfect_and_zero_games():
    perfect = Game.new("만점", BANK, random.Random(1))
    play(perfect, QUESTIONS_PER_CATEGORY)
    assert perfect.total_score() == MAX_TOTAL == 300
    zero = Game.new("영점", BANK, random.Random(2))
    play(zero, 0)
    assert zero.total_score() == 0


def test_categories_run_in_order():
    game = Game.new("테스터", BANK, random.Random(3))
    seen = []
    for _ in CATEGORY_ORDER:
        seen.append(game.category)
        for _ in range(QUESTIONS_PER_CATEGORY):
            item = game.current_item()
            game.submit(item.id, 0)
        game.next_category()
    assert seen == list(CATEGORY_ORDER)


def test_submit_only_once_per_question():
    game = Game.new("테스터", BANK, random.Random(4))
    item = game.current_item()
    assert game.submit(item.id, item.correct_pos) is not None
    assert game.submit(item.id, item.correct_pos) is None, "같은 문제에 두 번 답할 수 없다"
    assert game.question_index == 1
    assert game.category_result("market").correct == 1


def test_cannot_skip_to_next_category_early():
    game = Game.new("테스터", BANK, random.Random(5))
    assert game.next_category() is False
    assert game.category == "market"


def test_submit_rejects_out_of_range_position():
    game = Game.new("테스터", BANK, random.Random(6))
    with pytest.raises(ValueError):
        game.submit(game.current_item().id, 4)


@pytest.mark.parametrize("raw, ok", [
    ("a", False),
    ("가나다라마바사아자차카타파", False),  # 13자
    ("   ", False),
    ("씨발놈", False),
    ("Ad Min", False),
    ("  테스터  ", True),
    ("가나다라마바사아자차카타", True),  # 12자
])
def test_validate_nickname(raw, ok):
    passed, value = validate_nickname(raw)
    assert passed is ok
    if ok:
        assert value == raw.strip()
