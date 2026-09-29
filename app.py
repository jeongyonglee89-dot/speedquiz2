"""온라인 철강 상식 스피드 퀴즈 대회 (PRD-speed-quiz.md).

메인 → 닉네임(+PIN) → 시장·기술·제품 30문제(문제당 5초, 즉시 피드백) → 카테고리 결과 → 최종 합계·순위 저장·AI 오답분석.
메뉴 2는 Google Sheets 기록으로 계산한 합계 순위.

실행: python -m streamlit run app.py
테스트 모드: 환경 변수 STORAGE=memory 이면 Google Sheets 대신 서버 메모리에 기록한다(재시작하면 사라짐).
"""
from __future__ import annotations

import hmac
import math
import time
from datetime import datetime

import streamlit as st

from quiz import settings
from quiz.analysis import analyze, load_config
from quiz.engine import (
    CATEGORY_NAMES,
    CATEGORY_ORDER,
    MAX_TOTAL,
    QUESTIONS_PER_CATEGORY,
    TIME_LIMIT_SEC,
    Game,
    load_questions,
    validate_nickname,
)
from quiz.storage import (
    MemoryStore,
    SheetStore,
    StorageError,
    hash_pin,
    is_valid_pin,
    parse_rows,
    pin_matches,
    rank,
    rank_of,
    registered_pin_hash,
)

APP_VERSION = "speed-0.2"
RANKING_TOP = 20
TIMER_TICK_SEC = 0.5

st.set_page_config(page_title="철강 상식 스피드 퀴즈", page_icon=":material/bolt:", layout="centered")

# 색·서체·모서리는 .streamlit/config.toml 테마로 정한다. 테마로 할 수 없는 두 가지만 CSS로 보탠다.
# - 한국어가 단어 중간에서 줄바꿈되지 않게(keep-all)
# - PRD 10장: 보기 버튼 높이 48px 이상, 긴 보기도 읽기 쉽게 왼쪽 정렬 (key가 answer-로 시작하는 버튼만)
st.html("""<style>
h1, h2, h3, h4, [data-testid="stMarkdownContainer"] p, [data-testid="stMetricValue"] {
  word-break: keep-all; overflow-wrap: anywhere;
}
[class*="st-key-answer-"] button { min-height: 3.25rem; }
[class*="st-key-answer-"] button > div { justify-content: flex-start; text-align: left; }
[class*="st-key-answer-"] button p { font-size: 1.05rem; }
</style>""")

# 문제마다 보여 줄 카테고리 배지. 색은 웹 버전 카테고리 색(시장 파랑, 기술 오렌지, 제품 청록)에 맞춘다.
CATEGORY_BADGES = {
    "market": (":material/trending_up:", "blue"),
    "tech": (":material/factory:", "orange"),
    "product": (":material/inventory_2:", "green"),
}


# ---------- 데이터·저장소 ----------

@st.cache_data
def question_bank() -> dict[str, list[dict]]:
    return load_questions()


@st.cache_resource
def memory_store(contest_id: str) -> MemoryStore:
    return MemoryStore(contest_id)


@st.cache_resource(show_spinner=False)
def sheet_store(sheet_url: str, contest_id: str) -> SheetStore:
    return SheetStore(sheet_url, contest_id, settings.get_section(settings.SERVICE_ACCOUNT_SECTION))


def get_store():
    """(저장소 또는 None, 안내 문구, 테스트 모드 여부)."""
    if settings.get("STORAGE") == "memory":
        return memory_store(settings.get("CONTEST_ID") or "memory-test"), "", True
    missing = settings.missing_storage_settings()
    if missing:
        return None, f"순위 저장소 설정이 빠져 있어 새 게임을 시작할 수 없습니다: {', '.join(missing)}", False
    try:
        return sheet_store(settings.get("SHEET_URL"), settings.get("CONTEST_ID")), "", False
    except StorageError as error:
        return None, str(error), False


@st.cache_data(ttl=30, show_spinner=False)
def fetch_rows(contest_id: str, _store) -> tuple[list[dict], str]:
    """기록 전체와 읽은 시각. 30초 캐시(요청 한도 대응, PRD 7장). 저장 직후 fetch_rows.clear()."""
    return _store.fetch_rows(), datetime.now().strftime("%H:%M:%S")


@st.cache_data(ttl=30, show_spinner=False)
def contest_closed(contest_id: str, _store) -> bool:
    return _store.is_closed()


def load_records(store):
    """(Record 목록, 읽은 시각). 저장소 오류는 StorageError로 올린다."""
    rows, fetched_at = fetch_rows(store.contest_id, store)
    return parse_rows(rows), fetched_at


# ---------- 상태 (한 곳에서 초기화) ----------
st.session_state.setdefault("screen", "main")  # main | nickname | quiz | feedback | category_result | final | ranking
st.session_state.setdefault("game", None)
st.session_state.setdefault("nickname_error", "")
st.session_state.setdefault("saved", {})  # game_id → "ok" | "error"
st.session_state.setdefault("analyses", {})  # game_id → Analysis (판당 1회만 호출)
st.session_state.setdefault("my_nickname", None)


def go(screen: str) -> None:
    st.session_state.screen = screen


def back_to_main() -> None:
    st.session_state.game = None
    go("main")


# ---------- 콜백 ----------

def start_game() -> None:
    """닉네임·PIN 검사 후 게임 시작. 위젯 값은 브라우저에서 바뀔 수 있으므로 서버에서 다시 검사한다."""
    def fail(message: str) -> None:
        st.session_state.nickname_error = message

    ok, nickname = validate_nickname(st.session_state.get("nickname_input"))
    if not ok:
        return fail(nickname)
    store, problem, _ = get_store()
    if store is None:
        return fail(problem)
    try:
        if contest_closed(store.contest_id, store):
            return fail("대회가 마감되었습니다.")
        records, _ = load_records(store)
    except StorageError as error:
        return fail(str(error))

    owner_hash = registered_pin_hash(records, nickname)
    salt = settings.get("PIN_SALT")
    pin_hash = ""
    if salt:  # S-12: PIN으로 닉네임 주인 확인
        pin = st.session_state.get("pin_input", "")
        if not is_valid_pin(pin):
            return fail("PIN은 숫자 4자리로 입력해 주세요.")
        if owner_hash == "":
            return fail("이미 사용 중인 닉네임입니다. 다른 닉네임을 입력해 주세요.")
        if owner_hash is not None and not pin_matches(owner_hash, pin, salt):
            return fail("이 닉네임의 PIN이 맞지 않습니다. 처음 등록한 PIN을 입력하거나 다른 닉네임을 쓰세요.")
        pin_hash = hash_pin(pin, salt)
    elif owner_hash is not None:  # S-02: PIN 기능이 없으면 이미 있는 닉네임은 쓸 수 없다
        return fail("이미 순위에 있는 닉네임입니다. 다른 닉네임을 입력해 주세요.")

    st.session_state.nickname_error = ""
    st.session_state.my_nickname = nickname
    st.session_state.game = Game.new(nickname, question_bank(), pin_hash=pin_hash)
    go("quiz")


def answer(item_id: str, pos: int) -> None:
    game: Game = st.session_state.game
    # 서버 시각으로 판정: 5초가 지난 뒤 도착한 클릭은 시간 초과로 기록된다(S-05)
    if game.submit(item_id, pos, time.monotonic()) is not None:
        go("feedback")


def after_feedback() -> None:
    game: Game = st.session_state.game
    if not game.category_done:
        go("quiz")
    else:
        go("final" if game.finished else "category_result")


def next_category() -> None:
    if st.session_state.game.next_category():
        go("quiz")


def save_game(game: Game, store) -> None:
    """완주 기록을 한 번만 저장한다(S-14: 실패하면 결과를 세션에 두고 다시 저장할 수 있게)."""
    try:
        store.append(game.to_record(APP_VERSION))
        fetch_rows.clear()
        st.session_state.saved[game.game_id] = "ok"
    except StorageError:
        st.session_state.saved[game.game_id] = "error"


def retry_save() -> None:
    store, _, _ = get_store()
    if store is not None:
        save_game(st.session_state.game, store)


def refresh_ranking() -> None:
    fetch_rows.clear()


def set_closed(closed: bool) -> None:
    store, _, _ = get_store()
    if store is None:
        return
    try:
        store.set_closed(closed)
    except StorageError:
        st.session_state.admin_error = "마감 상태를 바꾸지 못했습니다."
    contest_closed.clear()


# ---------- 화면 부품 ----------

def category_badge(category: str) -> None:
    icon, color = CATEGORY_BADGES[category]
    st.badge(CATEGORY_NAMES[category], icon=icon, color=color)


@st.fragment(run_every=TIMER_TICK_SEC)
def countdown(item_id: str) -> None:
    """남은 시간 막대. 이 부분만 0.5초마다 다시 그리고, 0초가 되면 시간 초과로 처리해 앱 전체를 다시 그린다."""
    game: Game | None = st.session_state.get("game")
    if st.session_state.screen != "quiz" or game is None:
        return
    item = game.current_item()
    if item is None or item.id != item_id:
        return  # 이미 답한 문제의 늦은 갱신
    now = time.monotonic()
    remaining = game.remaining(now)
    if remaining <= 0:
        if game.submit(item_id, None, now) is not None:
            st.session_state.screen = "feedback"
        st.rerun(scope="app")
    # 화면에서 가장 눈에 띄는 요소: 큰 초 숫자 + 줄어드는 막대. 2초 이하면 쇳물 오렌지 → 빨강(숫자로도 알 수 있다)
    # 2초 이하면 글자색만이 아니라 배경색과 아이콘까지 바꿔 한눈에 구분되게 한다
    seconds = math.ceil(remaining)
    if remaining <= 2:
        label = f":red-background[:red[:material/alarm: 남은 시간 {seconds}초]]"
    else:
        label = f":orange[:material/timer: 남은 시간 {seconds}초]"
    with st.container(key="timer"):
        st.markdown(f"## {label}")
        st.progress(remaining / TIME_LIMIT_SEC)


# ---------- 화면 ----------

def render_main() -> None:
    st.title("온라인 철강 상식 스피드 퀴즈 대회", anchor=False)
    st.write(
        f"시장·기술·제품 세 분야를 {QUESTIONS_PER_CATEGORY}문제씩 풉니다. 문제마다 {TIME_LIMIT_SEC:.0f}초 안에 답해야 하고, "
        "세 분야 점수를 합친 총점으로 순위를 정합니다."
    )
    # 규칙 요약은 한 줄 배지로: 좁은 화면에서도 자연스럽게 줄바꿈된다
    with st.container(horizontal=True, gap="small"):
        st.badge(f"{QUESTIONS_PER_CATEGORY * len(CATEGORY_ORDER)}문제", icon=":material/quiz:", color="gray")
        st.badge(f"문제당 {TIME_LIMIT_SEC:.0f}초", icon=":material/timer:", color="orange")
        st.badge(f"{MAX_TOTAL}점 만점 · 합계 순위", icon=":material/emoji_events:", color="gray")
    store, problem, test_mode = get_store()
    closed = False
    if test_mode:
        st.warning("테스트 모드입니다. 기록이 서버 메모리에만 저장되고 재시작하면 사라집니다.", icon=":material/science:")
    if store is None:
        st.error(problem, icon=":material/error:")
    else:
        try:
            closed = contest_closed(store.contest_id, store)
        except StorageError as error:
            st.error(str(error), icon=":material/error:")
            store = None
    if closed:
        st.info("대회가 마감되었습니다. 순위만 확인할 수 있습니다.", icon=":material/flag:")
    st.button("1. 새 게임", icon=":material/play_arrow:", type="primary", width="stretch",
              disabled=store is None or closed, on_click=go, args=("nickname",))
    st.button("2. 순위 확인", icon=":material/leaderboard:", width="stretch", on_click=go, args=("ranking",))
    if settings.get("ADMIN_PASSWORD") and store is not None:
        render_admin(store, closed)


def render_admin(store, closed: bool) -> None:
    # 비밀번호를 입력한 뒤에는 마감·재개 버튼을 눌러도 접히지 않게 펼쳐 둔다
    with st.expander("운영자", icon=":material/admin_panel_settings:",
                     expanded=bool(st.session_state.get("admin_password"))):
        password = st.text_input("운영자 비밀번호", type="password", key="admin_password")
        if not password:
            return
        # compare_digest는 ASCII가 아닌 str을 받으면 TypeError를 내므로 바이트로 비교한다
        if not hmac.compare_digest(password.encode(), settings.get("ADMIN_PASSWORD").encode()):
            st.error("비밀번호가 맞지 않습니다.")
            return
        st.write(f"대회 이름(CONTEST_ID): **{store.contest_id}** · 상태: **{'마감' if closed else '진행 중'}**")
        if closed:
            st.button("대회 다시 열기", on_click=set_closed, args=(False,))
        else:
            st.button("대회 마감", type="primary", on_click=set_closed, args=(True,))
        if st.session_state.get("admin_error"):
            st.error(st.session_state.pop("admin_error"))
        st.caption("새 대회는 설정의 CONTEST_ID를 바꾸면 새 시트 탭에서 시작됩니다. 기록 확인·내려받기는 Google Sheets에서 합니다.")


def render_nickname() -> None:
    st.header("닉네임 입력", anchor=False)
    pin_enabled = bool(settings.get("PIN_SALT"))
    with st.form("nickname_form"):
        st.text_input("순위표에 표시될 이름 (2~12자)", key="nickname_input", max_chars=12)
        if pin_enabled:
            st.text_input("PIN (숫자 4자리)", key="pin_input", type="password", max_chars=4,
                          help="같은 닉네임으로 다시 참가할 때 본인 확인에 씁니다. 잊지 마세요.")
        st.form_submit_button("시작", type="primary", width="stretch", on_click=start_game)
    if st.session_state.nickname_error:
        st.error(st.session_state.nickname_error, icon=":material/error:")
    st.button("처음으로", on_click=back_to_main)


def render_quiz() -> None:
    game: Game = st.session_state.game
    item = game.current_item()
    if item is None:  # 화면 상태만 어긋난 경우
        after_feedback()
        st.rerun()
    game.mark_shown(item.id, time.monotonic())  # 처음 그린 시각만 기록된다

    with st.container(horizontal=True, vertical_alignment="center"):
        category_badge(item.category)
        st.caption(
            f"{CATEGORY_NAMES[game.category]} · {game.question_index + 1} / {QUESTIONS_PER_CATEGORY}"
            f"  |  전체 {game.overall_index + 1} / {game.overall_total}"
        )
    countdown(item.id)
    with st.container(key="question"):
        st.subheader(item.question, anchor=False)  # 제목 옆 링크 아이콘은 퀴즈에 필요 없다
    for pos, choice in enumerate(item.choices):
        st.button(f"{pos + 1}. {choice}", key=f"answer-{item.id}-{pos}", width="stretch",
                  on_click=answer, args=(item.id, pos))


def render_feedback() -> None:
    game: Game = st.session_state.game
    ans = game.last_answer
    if ans is None:
        go("quiz")
        st.rerun()
    item = ans.item
    if ans.correct:
        st.success("정답!", icon=":material/check_circle:")
    elif ans.timed_out:
        st.warning(f"시간 초과 ({TIME_LIMIT_SEC:.0f}초 안에 답하지 못했습니다)", icon=":material/timer_off:")
    else:
        st.error("오답", icon=":material/cancel:")
    category_badge(item.category)
    with st.container(key="question"):
        st.subheader(item.question, anchor=False)
    # 모든 줄에 아이콘을 둬 들여쓰기를 맞춘다. "3." 같은 줄은 번호 목록으로 바뀌지 않게 점을 이스케이프한다.
    with st.container(border=True, gap="small"):
        for pos, choice in enumerate(item.choices):
            label = f"{pos + 1}\\. {choice}"
            if pos == item.correct_pos:
                st.markdown(f":green[:material/check_circle: **{label}** · 정답]")
            elif pos == ans.picked_pos:
                st.markdown(f":red[:material/cancel: {label} · 내 답]")
            else:
                st.markdown(f":gray[:material/radio_button_unchecked:] {label}")
    st.info(item.explanation, icon=":material/lightbulb:")
    if ans.elapsed is not None:
        st.caption(f"응답 시간 {ans.elapsed:.1f}초")
    if not game.category_done:
        label = "다음 문제"
    elif game.finished:
        label = "최종 결과 보기"
    else:
        label = f"{CATEGORY_NAMES[game.category]} 결과 보기"
    st.button(label, icon=":material/arrow_forward:", type="primary", width="stretch", on_click=after_feedback)


def render_category_result() -> None:
    game: Game = st.session_state.game
    result = game.category_result(game.category)
    category_badge(game.category)
    st.header(f"{CATEGORY_NAMES[game.category]} 결과", anchor=False)
    st.caption(f"{len(CATEGORY_ORDER)}개 분야 중 {game.category_index + 1}개 완료")
    st.metric("점수", f"{result.score}점", border=True)
    with st.container(horizontal=True, gap="small"):
        st.badge(f"정답 {result.correct} / {result.total}", icon=":material/check_circle:", color="green")
        st.badge(f"평균 응답 {result.average_time:.1f}초", icon=":material/timer:", color="gray")
    next_name = CATEGORY_NAMES[CATEGORY_ORDER[game.category_index + 1]]
    st.button(f"다음 분야: {next_name}", icon=":material/arrow_forward:", type="primary", width="stretch",
              on_click=next_category)


def render_final() -> None:
    game: Game = st.session_state.game
    store, problem, test_mode = get_store()
    if store is not None and game.game_id not in st.session_state.saved:
        save_game(game, store)
    save_state = st.session_state.saved.get(game.game_id)

    st.header("최종 결과", anchor=False)
    st.metric("합계", f"{game.total_score()}점 / {MAX_TOTAL}점", border=True)
    # 카테고리별 점수는 카테고리 색 배지 한 줄로 (좁은 화면에서 카드가 2+1로 갈라지지 않게)
    with st.container(horizontal=True, gap="small"):
        for category in CATEGORY_ORDER:
            icon, color = CATEGORY_BADGES[category]
            st.badge(f"{CATEGORY_NAMES[category]} {game.category_result(category).score}점", icon=icon, color=color)
        st.badge(f"총 응답 {game.total_time():.1f}초", icon=":material/timer:", color="gray")

    if save_state == "ok":
        try:
            records, _ = load_records(store)
            position = rank_of(rank(records), game.nickname)
            if position:
                st.success(f"현재 순위 {position}위", icon=":material/emoji_events:")
        except StorageError:
            st.info("기록은 저장했지만 순위를 불러오지 못했습니다. 순위표에서 확인해 주세요.")
    else:
        st.error("순위 저장에 실패했습니다. 결과는 그대로 남아 있으니 다시 저장해 주세요."
                 if store is not None else problem, icon=":material/error:")
        if store is not None:
            st.button("다시 저장", icon=":material/refresh:", on_click=retry_save)
    if test_mode:
        st.caption("테스트 모드라 기록이 서버 메모리에만 저장되었습니다.")

    st.subheader("AI 오답분석", anchor=False)
    analysis_box = st.container(border=True)  # 합계를 먼저 보여 주고, 분석은 맨 마지막에 채운다

    wrong = game.wrong_answers()
    with st.expander(f"오답 다시보기 ({len(wrong)}문제)", icon=":material/fact_check:"):
        if not wrong:
            st.write("틀린 문제가 없습니다.")
        for ans in wrong:
            st.markdown(f"**[{CATEGORY_NAMES[ans.item.category]}] {ans.item.question}**")
            mine = "시간 초과" if ans.timed_out else ans.picked_choice
            st.markdown(f":red[:material/cancel: 내 답: {mine}]  \n:green[:material/check_circle: 정답: {ans.item.correct_choice}]")
            st.caption(ans.item.explanation)
    with st.container(horizontal=True):
        st.button("순위표", icon=":material/leaderboard:", type="primary", width="stretch",
                  on_click=go, args=("ranking",))
        st.button("처음으로", icon=":material/home:", width="stretch", on_click=back_to_main)

    with analysis_box:
        if game.game_id not in st.session_state.analyses:
            with st.spinner("오답을 분석하고 있습니다…"):
                config, _ = load_config(settings.get)
                st.session_state.analyses[game.game_id] = analyze(game, config)
        result = st.session_state.analyses[game.game_id]
        if result.ok:
            st.markdown(result.text)
        else:
            st.caption(result.message)


MEDALS = {1: "🥇", 2: "🥈", 3: "🥉"}  # 메달 옆에 숫자를 함께 써서 색·모양만으로 구분하지 않는다
RANKING_COLUMNS = {
    "순위": st.column_config.TextColumn(width="small", pinned=True),
    "닉네임": st.column_config.TextColumn(pinned=True),
    "합계": st.column_config.NumberColumn(format="%d점", width="small"),
    "시장": st.column_config.NumberColumn(width="small"),
    "기술": st.column_config.NumberColumn(width="small"),
    "제품": st.column_config.NumberColumn(width="small"),
    "시간": st.column_config.NumberColumn(format="%.1f초", width="small", help="30문제 총 응답 시간(동점일 때 짧은 쪽이 앞)"),
    "완주": st.column_config.TextColumn(width="small"),
}


def render_ranking() -> None:
    st.header("순위 확인", anchor=False)
    store, problem, test_mode = get_store()
    if store is None:
        st.error(problem, icon=":material/error:")
        st.button("처음으로", on_click=back_to_main)
        return
    try:
        records, fetched_at = load_records(store)
    except StorageError as error:
        st.error(str(error), icon=":material/error:")
        st.button("처음으로", on_click=back_to_main)
        return
    ranking = rank(records)
    with st.container(horizontal=True, vertical_alignment="center"):
        st.caption(f"마지막 갱신 {fetched_at} · 최대 30초 늦게 반영될 수 있습니다")
        st.button("새로고침", icon=":material/refresh:", on_click=refresh_ranking)
    if test_mode:
        st.caption("테스트 모드 순위입니다.")
    if not ranking:
        st.info("아직 완주한 참가자가 없습니다.", icon=":material/hourglass_empty:")
    else:
        def row(position, r):
            return {"순위": f"{MEDALS.get(position, '')} {position}".strip(), "닉네임": r.nickname, "합계": r.total,
                    "시장": r.market, "기술": r.tech, "제품": r.product, "시간": r.total_time_sec,
                    "완주": r.completed_at[5:16].replace("T", " ")}

        me = st.session_state.my_nickname
        position = rank_of(ranking, me) if me else None
        if position:
            st.success(f"{me} 님은 현재 {position}위입니다.", icon=":material/person:")
        rows = [row(i, r) for i, r in enumerate(ranking[:RANKING_TOP], start=1)]
        st.dataframe(rows, hide_index=True, column_config=RANKING_COLUMNS)
        if position and position > RANKING_TOP:
            st.caption("내 기록")
            st.dataframe([row(position, ranking[position - 1])], hide_index=True, column_config=RANKING_COLUMNS)
    st.button("처음으로", icon=":material/home:", width="stretch", on_click=back_to_main)


SCREENS = {
    "main": render_main,
    "nickname": render_nickname,
    "quiz": render_quiz,
    "feedback": render_feedback,
    "category_result": render_category_result,
    "final": render_final,
    "ranking": render_ranking,
}

# 게임이 필요한 화면인데 게임이 없으면(세션 초기화 등) 메인으로
if st.session_state.screen in ("quiz", "feedback", "category_result", "final") and st.session_state.game is None:
    st.session_state.screen = "main"

SCREENS[st.session_state.screen]()
