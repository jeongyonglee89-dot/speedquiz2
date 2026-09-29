# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project status

이 저장소에는 같은 철강 퀴즈 문제 은행(시장·기술·제품, 카테고리별 40문제)을 쓰는 두 제품이 있다.

| 제품 | 상태 | 기준 문서 |
| --- | --- | --- |
| 웹 퀴즈 게임 (HTML·CSS·JS 정적 사이트, 카테고리 1개 선택 → 10문제) | 구현 완료. 아래 Architecture는 이 제품 기준 | `PRD.md`(F-01~F-11), `PROMPTS.md`, `REVIEW.md` |
| 온라인 철강 상식 스피드 퀴즈 대회 (Streamlit, 3개 카테고리 × 10문제, 문제당 5초, 합계 순위, OpenAI 오답분석, Google Sheets 순위) | 4단계 검토까지 마치고 현재 수준으로 마무리(2026-09-29). 검토에서 나온 문제(`REVIEW-speed-quiz.md`: 높음 2(1건 조치 완료)·보통 1·낮음 4·정보 4)는 고치지 않은 상태. Google Sheets 실제 저장·OpenAI 오답분석(`.env`의 `OPENAI_MODEL=gpt-5.4-mini`) 확인 | `PRD-speed-quiz.md`(S-01~S-14), `PROMPTS-speed-quiz.md`, `SETUP-google-sheets.md` |

- **웹 퀴즈:** PROMPTS.md 4단계를 마친 뒤 한 판 문제 수를 40에서 10으로 줄였다(PRD 반영 완료, PROMPTS.md는 당시 기록이라 40 기준). 4단계 검토에서 나온 버그 9건(보통 2, 낮음 5, 정보 2)은 사용자 승인을 기다리는 중이라 아직 고치지 않았다. 목록과 수정 제안은 `REVIEW.md` 3·6장에 있다. 승인받으면 심각도 순으로 고치고, 고친 항목마다 해당 검사를 다시 돌린다. 버그 9(팝업이 열려 있는 동안 시간 정지 여부)는 정책 결정이 먼저다.
- **스피드 퀴즈:** 앱은 이 저장소 루트에 PRD 9장 구조(`app.py`, `quiz/`, `data/questions.json` …)로 만들고 웹 버전 파일은 건드리지 않는다. OpenAI 모델·옵션은 코드에 고정하지 않고 설정값(`OPENAI_MODEL` 등)을 따른다. Google Sheets 설정 진행 상황(프로젝트 `quiz-510106`, 서비스 계정, `SHEET_URL`)은 `SETUP-google-sheets.md`에 있다.
- 구현·검토할 때는 PRD의 기능 ID와 장 번호로 대조한다. 웹 퀴즈 PRD는 점수·순위 6장, 비기능 7장, 미결 사항 8장이다.

## Secrets

`.env`, `.streamlit/secrets.toml`, 서비스 계정 키 `quiz-510106-*.json`은 비밀값이다. 모두 `.gitignore` 대상이며 내용을 읽거나 출력하지 않는다. 키 파일에서 정보가 필요하면 `client_email`, `project_id` 같은 공개 필드만 꺼낸다.

**저장소 루트를 정적 서버로 열지 않는다**(`npx serve .`, `python -m http.server` 등). 비밀 파일이 루트에 있어 그대로 노출된다. 2026-09-29에 실제로 `npx serve .`가 `.env`·`secrets.toml`·키 파일을 모든 네트워크 주소에서 200으로 제공하던 것을 발견해 껐다(로그상 외부 접속 없음). 정적 서버가 필요하면 `data/`처럼 필요한 폴더만, `127.0.0.1`에만 연다.

## Commands

빌드·린트 도구와 npm 의존성은 없다(웹 퀴즈는 정적 사이트).

```
# 웹 퀴즈 로컬 실행: index.html을 브라우저로 직접 연다(file://로 동작). 저장소 루트를 정적 서버로 열지 않는다(아래 경고)
npx serve data -l tcp://127.0.0.1:5173   # 브라우저 테스트용 문제 은행 제공: data/ 폴더만, 이 PC에서만 (http://127.0.0.1:5173/questions.json)
node scripts/validate-data.js  # 문제 데이터 구조 검증: 개수(카테고리당 최소 40)·id·보기·정답 범위·해설. 난이도 구성이 처음과 다르면 경고만
node scripts/answer-balance.js [카테고리…] [--fix]  # 정답 위치(1~4번) 분포 확인, --fix면 치우친 곳을 재배치 (종료 코드 0 균형, 3 치우침, 2 인자 오류, 1 수정 실패·원복)
```

스피드 퀴즈(Python 3.14 로컬, pip `--user` 설치라 스크립트 폴더가 PATH에 없다. 항상 `python -m …`으로 실행):

```
python -m streamlit run app.py              # 앱 실행 (http://localhost:8501)
STORAGE=memory CONTEST_ID=dev-테스트 PIN_SALT=test-salt ADMIN_PASSWORD=admin-test python -m streamlit run app.py   # 테스트 모드 (시트 없이 메모리 저장)
python -m pytest                            # 단위 테스트 전체 (pytest.ini: testpaths=tests, pythonpath=.)
python -m pytest tests/test_engine.py -k nickname   # 테스트 하나만
python scripts/convert_questions.py         # data/*.js → data/questions.json 재생성. 문제를 고치면 반드시 다시 실행
```

문제 은행 관리 명령(`.claude/commands/`):

| 명령 | 하는 일 |
| --- | --- |
| `/quiz-validate [시장\|기술\|제품]` | 교차 검증 가이드라인(맨 아래)으로 판정하고, 카테고리별 에이전트가 웹 출처 2개 이상으로 사실을 확인한 뒤 맞지 않는 문제를 고친다. 인자가 없으면 전체 |
| `/quiz-add <카테고리> <난이도> <개수 1~10>` | 초안을 만들고 별도 에이전트가 교차 검증한 뒤, 통과한 문제만 해당 난이도 구역 끝에 넣는다. 그래서 카테고리별 문제 수가 40개를 넘을 수 있다 |
| `/quiz-balance [카테고리…] [확인]` | 정답 위치가 카테고리 전체와 난이도 묶음 각각에서 위치별 차이 1 이하인지 확인하고, 치우쳤으면 `answer-balance.js --fix`로 고친다 |

정답 위치 수정은 반드시 스크립트로 하고 손으로 하지 않는다. 보기가 숫자 순서인 문항은 뒤집기만 허용되고, 스크립트가 정답 문장이 그대로인지 스스로 확인한 뒤 어긋나면 원래 파일로 되돌린다.

## Testing (웹 퀴즈, Playwright MCP, 로컬 서버가 켜져 있어야 함)

| 파일 | 실행 방법 | 내용 |
| --- | --- | --- |
| `tests/e2e-harness.js` | 게임 페이지를 연 뒤 `browser_evaluate`로 이 파일을 `<script>`로 추가하고, 로드되면 `window.runE2E()` 반환값 확인 | 기능 테스트 34개. 결과는 `{ total, passed, failed, report }`. 판 크기는 `QUESTIONS_PER_ROUND`에서 읽는다 |
| `tests/review-real-input.js` | `browser_run_code_unsafe`에 `filename`으로 전달 | 실제 마우스·키보드 입력, 엣지 케이스, 성능, 폰트 CDN 지연 검사. 파일 안의 `ONLY`에 검사 이름을 넣으면 일부만 실행 |
| `tests/review-screenshots.js` | 위와 같음 | 360/768/1280px × 7개 화면을 `screenshots/{폭}-{순서}-{화면}.png`로 저장하고 가로 넘침 검사 |

- 하네스는 앱 전역(`state`, `renderHome`, `quitDialog`, `currentScreen` 등)과 요소 id·클래스(`choice-btn`, `is-correct`, `is-wrong`, `review-item`, `is-me`, `ranking-gap` 등)에 의존한다. 이 이름을 바꾸면 테스트 파일도 함께 고친다. 실행 전후로 localStorage를 지운다.
- MCP 브라우저는 호출 사이에 `about:blank`로 초기화되는 일이 있다. 여러 호출에 걸친 시나리오 대신 한 번의 호출 안에서 끝나는 검사를 쓴다. 파일을 고친 뒤에는 `?v=N` 쿼리를 붙여 다시 열어 캐시를 피한다.
- `browser_run_code_unsafe` 실행 환경에는 `setTimeout`이 없어 `page.waitForTimeout`도 실패한다. 대기는 `page.evaluate(() => new Promise(r => setTimeout(r, ms)))`처럼 브라우저 안에서 한다.
- `page.route`로 건 가로채기는 반드시 `finally`에서 `page.unrouteAll({ behavior: 'ignoreErrors' })`로 해제한다. 남아 있으면 이후 모든 MCP 도구의 페이지 이동이 실패한다.
- `browser_take_screenshot`의 `filename`은 프로젝트 폴더 안에만 저장할 수 있다. 도구가 만드는 `.playwright-mcp/` 폴더는 작업 후 지운다.

## Architecture (스피드 퀴즈)

- `data/questions.json`은 `scripts/convert_questions.py`가 웹 버전 `data/*.js`에서 만드는 생성물이다. 직접 고치지 말고 원본 JS를 고친 뒤 다시 변환한다. 변환기는 eval 없이 JS 데이터 리터럴만 읽는 작은 파서를 쓰고, 질문 60자·보기 20자를 넘는 문제에 `"speed": false`를 붙인다(출제 제외).
- `quiz/engine.py` — Streamlit에 의존하지 않는 순수 로직. `pick_category`가 speed 문제 중 난이도 쉬움 4·보통 4·어려움 2로 10문제를 뽑고 보기를 섞는다(`Item.correct_pos`가 섞인 위치의 정답). `Game`이 시장 → 기술 → 제품 진행과 채점을 맡고, `submit(item_id, pos)`는 현재 문제 id가 아니면 무시해 연타·오래된 화면 클릭을 막는다. 닉네임 규칙은 웹 버전 `js/quiz.js`와 같게 유지한다.
- `quiz/settings.py` — `get(key)`는 `st.secrets` → 환경 변수 → `.env` 순서로 읽고, `get_section`은 Secrets의 표(`[gcp_service_account]`)를 읽는다. 값은 출력하지 않는다.
- 5초 판정(S-05)은 서버 시각 기준이다. `Game.mark_shown(item_id, time.monotonic())`이 문제를 처음 그린 시각을 한 번만 기록하고(rerun으로 덮어쓰지 않음), `submit(item_id, pos, now)`가 제한 시간을 넘긴 답을 고른 보기와 관계없이 시간 초과로 기록한다. `judge_time`은 시각을 인자로 받아 pytest에서 가짜 시계로 검사한다.
- `quiz/storage.py` — `SheetStore`(Google Sheets, 행 추가만, `value_input_option="RAW"`로 수식 해석 방지)와 `MemoryStore`(테스트 모드) 둘 다 `fetch_rows / append / is_closed / set_closed`를 가진다. 순위 계산(`rank`: game_id 중복 제거 → 닉네임별 최고 기록 → 합계·시간·완주 일시 정렬), PIN 해시, 마감 상태(`status` 탭의 대회별 마지막 행)는 순수 함수다. 429·5xx는 `with_retry`가 0.5초·1초 간격으로 다시 시도한다. `hmac.compare_digest`는 ASCII가 아닌 str에서 TypeError를 내므로 항상 바이트로 비교한다.
- `quiz/analysis.py` — 모델·옵션은 설정값만 따르고(`OPENAI_MODEL` 없으면 끔), 닉네임·PIN·게임 id는 보내지 않는다. 모든 실패를 예외 대신 `Analysis(ok=False, message=…)`로 돌려준다.
- `app.py` — `st.session_state.screen`(main / nickname / quiz / feedback / category_result / final / ranking)으로 화면을 고르는 단일 페이지. 상태 변경은 버튼 `on_click` 콜백에서만 한다. 남은 시간 막대는 `@st.fragment(run_every=0.5)`인 `countdown`만 다시 그리고, 0초가 되면 시간 초과를 기록한 뒤 `st.rerun(scope="app")`. 순위 조회·마감 상태는 `st.cache_data(ttl=30)`, 기록 저장 직후 `fetch_rows.clear()`. 최종 화면은 합계를 먼저 그리고 오답분석을 맨 마지막에 채운다(판당 1회, `session_state.analyses`).
- 테스트 모드: 환경 변수 `STORAGE=memory`면 Google Sheets 대신 서버 메모리에 기록하고 화면에 경고를 띄운다. 이 값이 없고 저장소 설정도 없으면 빠진 설정 이름만 보여 주고 새 게임을 막는다. `.streamlit/config.toml`의 `showErrorDetails = "none"`으로 예외 내용은 화면에 보이지 않는다(서버 콘솔에만).
- 브라우저 테스트는 테스트용 설정으로 띄운 앱에서 돌린다: `python -m streamlit run app.py --secrets.files tests/test-secrets.toml`. 이 파일(가짜 값만, 커밋 가능)은 실제 `secrets.toml` 대신 읽혀 메모리 저장·운영자 `admin-test`·PIN_SALT `test-salt`를 쓰고, `OPENAI_BASE_URL`을 빈 로컬 포트로 돌려 AI 호출 비용 없이 실패 안내 경로를 탄다. 설정은 `st.secrets`가 환경 변수보다 앞서므로, 실제 `secrets.toml`이 있을 때 환경 변수만으로는 테스트 값이 먹히지 않는다.
  - `tests/speed-step2.js`: 실제 클릭으로 30문제. 첫 문제는 6초를 기다려 시간 초과와 피드백 화면의 타이머 정지를 확인하고, 점수, 순위, 오답 다시보기, PIN 재참가, 운영자 마감을 확인한다.
  - `tests/speed-screenshots.js`: 화면별 스크린샷(360·768·1280px, `screenshots-speed/`)과 가로 넘침 검사.
  - `tests/speed-review.js`(`PART` 1·2): 4단계 검토용 엣지 케이스(새로고침·뒤로가기·연속 클릭·반응 시간·타이머 간격·비밀값·만점/0점·HTML 닉네임·동시 완주·긴 닉네임). 판이 많아 한 번에 2분을 넘길 수 있다.
  - `tests/speed-review-real.js`(`PHASE` A·B1·B2): 실제 시트 모드 검토. 실제 `secrets.toml` 위에 `tests/review-override.toml`로 대회 이름만 덮어써 검토 전용 탭에 기록한다. `--secrets.files`는 `--secrets.files .streamlit/secrets.toml --secrets.files tests/review-override.toml`처럼 플래그를 반복해야 한다(공백으로 이어 쓰면 두 번째 파일이 무시되어 기존 탭에 기록된다).
  - 정답은 서버에만 있으므로 `npx serve data -l tcp://127.0.0.1:5173`이 주는 `questions.json`으로 화면의 문제 문장에서 정답을 찾는다.
  - Streamlit 요소는 `data-testid`와 key 클래스(`.st-key-question h3` 질문, `.st-key-timer` 타이머, `[class*="st-key-answer-"] button` 보기)로 찾는다. Streamlit은 새 화면을 그리는 동안 이전 요소를 잠시 남겨 두므로, 기대 문구가 나타나거나 보기 글자가 현재 문제와 일치할 때까지 기다린 뒤 읽는다.
- UI(3단계): 색·서체(Pretendard)·모서리는 `.streamlit/config.toml` 테마로 정하고, CSS는 `app.py` 맨 위 `st.html` 한 곳에 두 가지만 둔다(한국어 `word-break: keep-all`, 보기 버튼 높이 48px 이상·왼쪽 정렬). 타이머는 큰 초 숫자 + 막대이고, 2초 이하면 빨간 배경·알람 아이콘으로 바뀐다. 카테고리별 수치는 metric 카드 대신 배지 한 줄로 둬 좁은 화면에서 카드가 갈라지지 않게 했다.

## Architecture (웹 퀴즈)

- `index.html` 하나에 화면 `<section id="screen-*">`(home / nickname / quiz / result / review / ranking)과 중도 포기 `<dialog id="quit-dialog">`를 두고, `app.js`의 `showScreen()`이 `hidden` 속성으로 전환하는 SPA.
- ES 모듈이 아닌 일반 `<script>`를 순서대로 로드하고 전역으로 연결한다(`file://`로 열어도 동작). 로드 순서가 의존 순서다: `data/*.js` → `js/quiz.js` → `js/storage.js` → `js/app.js`.
  - `data/market.js`, `tech.js`, `product.js` — 각각 `window.QUIZ_DATA.<category>`에 문제 배열을 등록한다. 카테고리 키는 `market` / `tech` / `product`. 파일 안은 `// ---------- 쉬움/보통/어려움 ----------` 주석으로 난이도 구역이 나뉜다. 스피드 퀴즈도 이 파일들을 원본으로 삼아 JSON으로 변환해 쓸 예정이다.
  - `js/quiz.js` — DOM에 의존하지 않는 순수 로직: 세션 생성·채점(`createSession`, `submitAnswer`, `nextQuestion`, `getResult`, `getWrongItems`), 닉네임 검사(`validateNickname`), 순위 비교(`compareRecords`), 상수(`POINTS_PER_CORRECT`, `QUESTIONS_PER_ROUND`, `MIN_SECONDS_PER_QUESTION`, `BANNED_WORDS`). 한 판 문제 수는 `QUESTIONS_PER_ROUND` 하나만 바꾸면 화면·채점·검증·테스트가 따라간다(빈 순위표 안내 문구 `#ranking-empty`만 직접 고친다).
  - `js/storage.js` — 전역 `QuizStorage`(내장 `window.Storage`와 이름 충돌을 피한 이름). `quiz.js`의 `compareRecords`와 상수를 쓴다. 기록 검증(비정상 기록 거부)과 닉네임별 최고 기록 유지도 여기서 한다. localStorage 접근이 예외를 던질 때만 메모리 저장소로 대체한다.
  - `js/app.js` — 전역 `state` 객체(session, nickname, 화면 복귀 대상 등)와 화면별 `render*` 함수, 이벤트·키보드 처리.
- 세션 모델: `createSession`이 카테고리 문제를 섞어 앞에서 `QUESTIONS_PER_ROUND`개를 뽑고(난이도 구분 없이 무작위), 문제마다 보기 순서도 섞어 `items[]`를 만든다. 각 item은 `{ question, choices(섞인 보기), correctPos, pickedPos }`이며 화면·채점·오답 다시보기는 모두 섞인 위치(`correctPos`/`pickedPos`) 기준이다. 원본 `answerIndex`는 세션 생성 때만 쓴다.
- 진행 흐름: `submitAnswer`(한 문제에 한 번만 채점, 마지막 문제면 `finishedAt` 기록) → 피드백 표시 → `nextQuestion` → `isFinished`면 `finishGame`에서 `QuizStorage.saveRecord` 호출. 소요 시간은 `startedAt`부터 마지막 답까지다.
- 스타일: `css/style.css` 맨 위 `:root`의 색 토큰(강판 톤 배경 + 쇳물 오렌지 `--molten` 하나만 강조)과 Pretendard(CDN, 실패 시 시스템 한글 서체)를 쓴다. 글자에 쓰는 색 조합은 WCAG AA(4.5:1) 이상으로 맞춰 두었으니 색을 바꿀 때 대비를 다시 계산한다. `--molten-hot`은 장식 전용(글자 금지). 카테고리 아이콘은 `index.html` 상단 SVG `<symbol>`을 `<use>`로 재사용한다. 결과 화면 정답률 게이지는 `app.js`의 `renderGauge`가 `stroke-dashoffset`으로 채운다.
- 화면 디자인을 바꿀 때 `quiz.js`·`storage.js`의 동작을 바꾸지 않고, 마크업 변경은 `index.html`과 `app.js` 렌더링 부분에서만 한다.
- 순위는 `localStorage`(`steelQuiz.nickname`, `steelQuiz.records`)에 저장한다. PRD 8장 미결 사항에서 MVP 기본값으로 고른 방식이라, 같은 기기·브라우저 안에서만 공유된다.

## Rules that span multiple files

- 문제 객체 형식: `id, category, question, choices(4개), answerIndex(0~3), explanation, difficulty(easy|normal|hard)`. id는 `MKT-001` / `TEC-001` / `PRD-001`. 코드는 문제 수를 하드코딩하지 말고 데이터 길이를 기준으로 동작한다. 문제를 고치면 `node scripts/validate-data.js`와 `node scripts/answer-balance.js`를 돌린다.
- 정답 위치는 `/quiz-balance`로 카테고리·난이도별 1~4번에 고르게 나눠 두었다(2026-09-29, 카테고리마다 10·10·10·10). 이는 데이터 정리이고, 게임 실행 중 보기가 섞이는지는 별개로 하네스의 "F-03 보기 순서 섞임" 검사가 확인한다.
- 점수: 정답당 10점, 감점 없음, 만점 100(10문제). 순위 정렬: 점수 내림차순 → 소요 시간 오름차순 → 기록 일시 오름차순. 닉네임별 카테고리 최고 기록 1개만 유지. 끝까지 푼 판만 저장하고, 중도 포기한 판과 비정상 기록(점수 불일치, 만점 초과, 소요 시간이 문제당 1초 미만 = 10초 미만)은 저장하지 않는다.
- 기록에는 판 크기(`total`)가 저장되며, `QuizStorage.getRecords`는 `total !== QUESTIONS_PER_ROUND`인 기록(예: 예전 40문제 판)을 버린다. 판 크기를 바꾸면 기존 순위가 초기화되는 셈이다.
- 닉네임은 2~12자(앞뒤 공백 제거), 금칙어 필터. 사용자 입력은 `innerHTML`이 아니라 `textContent`로만 출력한다(XSS 검사 대상).
- 정답/오답은 색상만이 아니라 ✓/✗ 아이콘과 문구로도 표시한다. 키보드 1~4로 보기 선택, Enter로 다음 문제. 포커스가 버튼에 있을 때의 Enter는 브라우저 기본 클릭에 맡겨 두 번 넘어가지 않게 한다.
- 문제 내용: 정답은 하나만 명확하게, '모두 정답/정답 없음' 보기 금지, 모든 문제에 해설 1~2문장, 난이도는 처음 40문제 기준 카테고리당 쉬움 15 · 보통 15 · 어려움 10(이후 `/quiz-add`로 추가한 만큼 늘어남), 변하는 수치는 기준 연도를 명시한다. 사실이 불확실한 문제는 만들지 않는다.

### 퀴즈 문제 교차 검증 가이드라인

1. 정답이 하나뿐인가? - 다른 해석 가능시 조건 명시  (기준 등)
2. 시간과 범위가 명확한가? - 변할 수 있는 정보는 시점 명시, 기준 분류 범위 한정
3. 최상급 표현 기준 있는가? - 가장 큰, 최초의 등 표현에 기준 명시
4. 교차 검증 했는가? - 의심스러운 정보는 2개 이상 출처 확인, 논란이 있는 경우 정부 공식 기관 발표 내용 기준
