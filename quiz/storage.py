"""순위 저장소 (PRD-speed-quiz.md 7장). Streamlit에 의존하지 않는다(캐시는 app.py가 맡는다).

- SheetStore: Google Sheets. CONTEST_ID 이름의 탭에 완주할 때마다 1행을 추가만 한다(수정·삭제 없음).
- MemoryStore: 테스트 모드(STORAGE=memory) 전용. 서버 프로세스 안에서만 공유되고 재시작하면 사라진다.

순위 계산·PIN 해시·행 변환은 저장소와 무관한 순수 함수로 두어 pytest로 검사한다.
"""
from __future__ import annotations

import hashlib
import hmac
import threading
import time
from dataclasses import dataclass
from datetime import datetime

HEADERS = ["completed_at", "game_id", "nickname", "pin_hash", "market", "tech", "product",
           "total", "total_time_sec", "app_version"]
STATUS_SHEET = "status"  # 대회별 마감 여부: [contest_id, closed(TRUE/FALSE), updated_at]
RETRY_STATUS = {429, 500, 502, 503, 504}
MAX_ATTEMPTS = 3  # 첫 시도 + 재시도 2번 → PRD의 "최대 3번 시도"


class StorageError(RuntimeError):
    """저장소를 쓸 수 없을 때. 화면에는 이 메시지만 보여 준다(비밀값을 담지 않는다)."""


# ---------- 순수 함수 ----------

@dataclass(frozen=True)
class Record:
    completed_at: str
    game_id: str
    nickname: str
    pin_hash: str
    market: int
    tech: int
    product: int
    total: int
    total_time_sec: float
    app_version: str = ""

    @property
    def sort_key(self) -> tuple:
        # 합계 높은 순 → 총 응답 시간 짧은 순 → 먼저 완주한 순 (PRD 3장)
        return (-self.total, self.total_time_sec, self.completed_at)


def row_from_record(record: dict) -> list:
    return [record.get(h, "") for h in HEADERS]


def parse_rows(rows: list[dict]) -> list[Record]:
    """시트에서 읽은 행(머리글 → 값)을 Record로. 형식이 깨진 행은 건너뛴다(직접 편집된 시트 대비)."""
    records = []
    for row in rows:
        try:
            records.append(Record(
                completed_at=str(row["completed_at"]),
                game_id=str(row["game_id"]),
                nickname=str(row["nickname"]),
                pin_hash=str(row.get("pin_hash", "") or ""),
                market=int(float(row["market"])),
                tech=int(float(row["tech"])),
                product=int(float(row["product"])),
                total=int(float(row["total"])),
                total_time_sec=float(row["total_time_sec"]),
                app_version=str(row.get("app_version", "") or ""),
            ))
        except (KeyError, TypeError, ValueError):
            continue
    return [r for r in records if r.game_id and r.nickname]


def rank(records: list[Record]) -> list[Record]:
    """같은 game_id는 한 번만 세고, 닉네임별 최고 기록 1개를 골라 정렬한다."""
    unique = {}
    for r in records:
        unique.setdefault(r.game_id, r)
    best: dict[str, Record] = {}
    for r in unique.values():
        if r.nickname not in best or r.sort_key < best[r.nickname].sort_key:
            best[r.nickname] = r
    return sorted(best.values(), key=lambda r: r.sort_key)


def rank_of(ranking: list[Record], nickname: str) -> int | None:
    for i, r in enumerate(ranking, start=1):
        if r.nickname == nickname:
            return i
    return None


def hash_pin(pin: str, salt: str) -> str:
    return hashlib.sha256(f"{salt}:{pin}".encode()).hexdigest()


def is_valid_pin(pin: str | None) -> bool:
    return bool(pin) and len(pin) == 4 and pin.isdigit()


def registered_pin_hash(records: list[Record], nickname: str) -> str | None:
    """그 닉네임의 첫 기록에 저장된 PIN 해시. 닉네임을 처음 쓴 사람이 주인이다. 기록이 없으면 None."""
    mine = sorted((r for r in records if r.nickname == nickname), key=lambda r: r.completed_at)
    return mine[0].pin_hash if mine else None


def pin_matches(stored_hash: str, pin: str, salt: str) -> bool:
    # compare_digest는 ASCII가 아닌 str에서 TypeError를 내므로 바이트로 비교한다(시트를 직접 고친 경우 대비)
    return hmac.compare_digest(stored_hash.encode(), hash_pin(pin, salt).encode())


def parse_time(value: str) -> datetime | None:
    try:
        return datetime.fromisoformat(value)
    except (TypeError, ValueError):
        return None


# ---------- 저장소 ----------

def with_retry(action, *, sleep=time.sleep):
    """429·5xx는 0.5초, 1초 간격으로 다시 시도한다. 그래도 실패하면 StorageError."""
    for attempt in range(MAX_ATTEMPTS):
        try:
            return action()
        except Exception as error:  # noqa: BLE001 - gspread·네트워크 예외를 한곳에서 판정
            status = getattr(getattr(error, "response", None), "status_code", None)
            retryable = status in RETRY_STATUS or isinstance(error, (ConnectionError, TimeoutError))
            if not retryable or attempt == MAX_ATTEMPTS - 1:
                raise StorageError("순위 저장소에 연결하지 못했습니다.") from error
            sleep(0.5 * 2 ** attempt)


class MemoryStore:
    """테스트 모드 전용. 같은 서버 프로세스의 모든 세션이 공유한다."""

    def __init__(self, contest_id: str):
        self.contest_id = contest_id
        self._rows: list[dict] = []
        self._closed = False
        self._lock = threading.Lock()

    def fetch_rows(self) -> list[dict]:
        with self._lock:
            return [dict(r) for r in self._rows]

    def append(self, record: dict) -> None:
        with self._lock:
            if any(r["game_id"] == record["game_id"] for r in self._rows):
                return
            self._rows.append(dict(zip(HEADERS, row_from_record(record))))

    def is_closed(self) -> bool:
        return self._closed

    def set_closed(self, closed: bool) -> None:
        self._closed = closed


class SheetStore:
    """Google Sheets 저장소. 서비스 계정 정보로 연결하고, 탭이 없으면 머리글 행과 함께 만든다."""

    def __init__(self, sheet_url: str, contest_id: str, service_account: dict):
        import gspread  # 테스트 모드만 쓸 때는 gspread가 없어도 되게 늦게 import

        self._gspread = gspread
        self.contest_id = contest_id
        client = with_retry(lambda: gspread.service_account_from_dict(service_account))
        self._book = with_retry(lambda: client.open_by_url(sheet_url))
        self._sheet = self._worksheet(contest_id, HEADERS)

    def _worksheet(self, title: str, headers: list[str]):
        def open_or_create():
            try:
                return self._book.worksheet(title)
            except self._gspread.WorksheetNotFound:
                sheet = self._book.add_worksheet(title=title, rows=1000, cols=len(headers))
                sheet.append_row(headers, value_input_option="RAW")
                return sheet

        return with_retry(open_or_create)

    def fetch_rows(self) -> list[dict]:
        values = with_retry(self._sheet.get_all_values)
        if not values:
            return []
        header, *body = values
        return [dict(zip(header, row)) for row in body]

    def append(self, record: dict) -> None:
        # RAW: 닉네임이 '='로 시작해도 수식으로 해석되지 않게 값 그대로 저장한다
        with_retry(lambda: self._sheet.append_row(row_from_record(record), value_input_option="RAW"))

    def _status_sheet(self):
        return self._worksheet(STATUS_SHEET, ["contest_id", "closed", "updated_at"])

    def is_closed(self) -> bool:
        rows = with_retry(self._status_sheet().get_all_values)
        return latest_closed_flag(rows[1:], self.contest_id)

    def set_closed(self, closed: bool) -> None:
        # 상태도 추가만 한다. 이 대회의 가장 최근 행이 현재 상태다(latest_closed_flag).
        now = datetime.now().astimezone().isoformat(timespec="seconds")
        with_retry(lambda: self._status_sheet().append_row(
            [self.contest_id, "TRUE" if closed else "FALSE", now], value_input_option="RAW"))


def latest_closed_flag(status_rows: list[list[str]], contest_id: str) -> bool:
    """status 탭의 행들 중 이 대회의 가장 최근(아래쪽) 행으로 마감 여부를 정한다. 행이 없으면 열림."""
    mine = [r for r in status_rows if r and r[0] == contest_id]
    return bool(mine) and len(mine[-1]) > 1 and mine[-1][1] == "TRUE"
