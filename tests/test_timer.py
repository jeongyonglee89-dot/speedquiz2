"""서버 기준 5초 판정(S-04, S-05). 가짜 시계(숫자)로 시각을 넣는다."""
import random

import pytest

from quiz.engine import TIME_LIMIT_SEC, Game, judge_time, load_questions

BANK = load_questions()


def new_game(seed=1):
    return Game.new("테스터", BANK, random.Random(seed))


@pytest.mark.parametrize("elapsed, timed_out", [(0.0, False), (4.9, False), (5.0, False), (5.1, True), (30, True)])
def test_judge_time_boundary(elapsed, timed_out):
    out, recorded = judge_time(100.0, 100.0 + elapsed)
    assert out is timed_out
    assert recorded == min(elapsed, TIME_LIMIT_SEC)


def test_answer_within_limit_is_scored():
    game = new_game()
    item = game.current_item()
    game.mark_shown(item.id, 1000.0)
    ans = game.submit(item.id, item.correct_pos, 1004.9)
    assert ans.correct and not ans.timed_out and ans.elapsed == 4.9


def test_late_click_becomes_timeout_even_if_correct():
    """화면 타이머가 늦게 갱신돼 버튼이 남아 있어도, 서버 시각으로 5초를 넘기면 시간 초과."""
    game = new_game()
    item = game.current_item()
    game.mark_shown(item.id, 1000.0)
    ans = game.submit(item.id, item.correct_pos, 1005.1)
    assert ans.timed_out and not ans.correct
    assert ans.elapsed == TIME_LIMIT_SEC


def test_rerender_does_not_reset_shown_time():
    game = new_game()
    item = game.current_item()
    game.mark_shown(item.id, 1000.0)
    game.mark_shown(item.id, 1003.0)  # rerun으로 다시 그려짐
    assert game.remaining(1004.0) == pytest.approx(1.0)
    assert game.submit(item.id, item.correct_pos, 1005.5).timed_out


def test_timeout_then_late_click_is_ignored():
    game = new_game()
    item = game.current_item()
    game.mark_shown(item.id, 1000.0)
    assert game.submit(item.id, None, 1005.2).timed_out  # 타이머가 시간 초과 처리
    assert game.submit(item.id, item.correct_pos, 1005.3) is None  # 뒤늦게 도착한 클릭
    assert game.category_result("market").correct == 0


def test_mark_shown_ignores_other_items():
    game = new_game()
    first = game.current_item()
    second = game.rounds["market"][1]
    game.mark_shown(second.id, 1000.0)  # 아직 차례가 아닌 문제
    assert second.id not in game.shown_at
    assert game.remaining(1000.0) == TIME_LIMIT_SEC
    game.mark_shown(first.id, 1000.0)
    assert first.id in game.shown_at


def test_total_time_and_average():
    game = new_game()
    t = 0.0
    for _ in range(10):
        item = game.current_item()
        game.mark_shown(item.id, t)
        game.submit(item.id, item.correct_pos, t + 2.0)
        t += 10
    result = game.category_result("market")
    assert result.time_sec == pytest.approx(20.0)
    assert result.average_time == 2.0
    assert game.total_time() == 20.0
