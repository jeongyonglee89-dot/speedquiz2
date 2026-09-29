"""순위 저장소의 순수 함수와 MemoryStore, 재시도 (PRD 7장)."""
import random

import pytest

from quiz.engine import CATEGORY_ORDER, QUESTIONS_PER_CATEGORY, Game, load_questions
from quiz.storage import (
    HEADERS,
    MemoryStore,
    StorageError,
    hash_pin,
    is_valid_pin,
    latest_closed_flag,
    parse_rows,
    pin_matches,
    rank,
    rank_of,
    registered_pin_hash,
    row_from_record,
    with_retry,
)

BANK = load_questions()


def record(nickname, total, time_sec, at, game_id=None, pin_hash=""):
    return {"completed_at": at, "game_id": game_id or f"{nickname}-{at}", "nickname": nickname, "pin_hash": pin_hash,
            "market": total // 3, "tech": total // 3, "product": total - 2 * (total // 3),
            "total": total, "total_time_sec": time_sec, "app_version": "t"}


def finished_game(nickname="테스터"):
    game = Game.new(nickname, BANK, random.Random(1))
    for _ in CATEGORY_ORDER:
        for _ in range(QUESTIONS_PER_CATEGORY):
            item = game.current_item()
            game.mark_shown(item.id, 0.0)
            game.submit(item.id, item.correct_pos, 1.5)
        game.next_category()
    return game


def test_rank_sorting_rules():
    rows = [
        record("느린동점", 250, 80.0, "2026-10-01T10:00:00+09:00"),
        record("빠른동점", 250, 60.0, "2026-10-01T11:00:00+09:00"),
        record("일등", 280, 90.0, "2026-10-01T12:00:00+09:00"),
        record("같은시간늦음", 250, 60.0, "2026-10-01T12:30:00+09:00"),
    ]
    names = [r.nickname for r in rank(parse_rows(rows))]
    assert names == ["일등", "빠른동점", "같은시간늦음", "느린동점"]


def test_rank_keeps_best_per_nickname():
    rows = [
        record("철강왕", 200, 50.0, "2026-10-01T10:00:00+09:00"),
        record("철강왕", 270, 70.0, "2026-10-01T11:00:00+09:00"),
        record("철강왕", 270, 65.0, "2026-10-01T12:00:00+09:00"),
    ]
    ranking = rank(parse_rows(rows))
    assert len(ranking) == 1 and ranking[0].total == 270 and ranking[0].total_time_sec == 65.0


def test_rank_counts_same_game_id_once():
    rows = [record("A", 100, 10.0, "2026-10-01T10:00:00+09:00", game_id="g1")] * 2
    rows.append(record("B", 90, 10.0, "2026-10-01T10:00:00+09:00", game_id="g2"))
    assert [r.nickname for r in rank(parse_rows(rows))] == ["A", "B"]


def test_parse_rows_skips_broken_rows_and_reads_sheet_strings():
    rows = [
        {h: v for h, v in zip(HEADERS, ["2026-10-01T10:00:00+09:00", "g1", "A", "", "90", "80", "70", "240", "55.3", "t"])},
        {"nickname": "망가진행"},
        {h: "" for h in HEADERS},
    ]
    parsed = parse_rows(rows)
    assert len(parsed) == 1 and parsed[0].total == 240 and parsed[0].total_time_sec == 55.3


def test_rank_of():
    ranking = rank(parse_rows([record("A", 100, 1, "t1"), record("B", 50, 1, "t2")]))
    assert rank_of(ranking, "B") == 2 and rank_of(ranking, "없음") is None


def test_to_record_matches_headers():
    game = finished_game()
    rec = game.to_record("v1")
    assert list(rec) == HEADERS
    assert rec["total"] == 300 and rec["total_time_sec"] == 45.0
    assert len(row_from_record(rec)) == len(HEADERS)


def test_unfinished_game_cannot_be_recorded():
    with pytest.raises(ValueError):
        Game.new("미완주", BANK, random.Random(1)).to_record("v1")


def test_memory_store_append_is_idempotent_per_game():
    store = MemoryStore("t")
    rec = finished_game().to_record("v1")
    store.append(rec)
    store.append(rec)
    assert len(store.fetch_rows()) == 1


def test_pin_rules():
    assert is_valid_pin("0123") and not is_valid_pin("123") and not is_valid_pin("12a4") and not is_valid_pin(None)
    stored = hash_pin("1234", "salt")
    assert stored != "1234" and pin_matches(stored, "1234", "salt") and not pin_matches(stored, "9999", "salt")
    # 시트에서 누가 pin_hash 칸을 한글로 고쳐도 예외 없이 불일치로 처리
    assert not pin_matches("한글값", "1234", "salt")


def test_registered_pin_hash_uses_first_record():
    rows = [record("주인", 100, 1, "2026-10-01T09:00:00+09:00", pin_hash="first"),
            record("주인", 200, 1, "2026-10-01T10:00:00+09:00", pin_hash="second")]
    records = parse_rows(rows)
    assert registered_pin_hash(records, "주인") == "first"
    assert registered_pin_hash(records, "처음") is None


def test_latest_closed_flag_uses_most_recent_row():
    rows = [["c1", "TRUE", "t1"], ["c2", "TRUE", "t2"], ["c1", "FALSE", "t3"]]
    assert latest_closed_flag(rows, "c1") is False
    assert latest_closed_flag(rows, "c2") is True
    assert latest_closed_flag(rows, "c3") is False


class _Response:
    def __init__(self, status):
        self.status_code = status


class _ApiError(Exception):
    def __init__(self, status):
        super().__init__(status)
        self.response = _Response(status)


def test_with_retry_retries_rate_limit_then_succeeds():
    calls, sleeps = [], []

    def action():
        calls.append(1)
        if len(calls) < 3:
            raise _ApiError(429)
        return "ok"

    assert with_retry(action, sleep=sleeps.append) == "ok"
    assert len(calls) == 3 and sleeps == [0.5, 1.0]


def test_with_retry_gives_up_and_does_not_retry_auth_errors():
    calls = []

    def forbidden():
        calls.append(1)
        raise _ApiError(403)

    with pytest.raises(StorageError):
        with_retry(forbidden, sleep=lambda s: None)
    assert len(calls) == 1
