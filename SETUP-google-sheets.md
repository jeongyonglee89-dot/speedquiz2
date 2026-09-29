# Google Sheets 순위 저장소 설정

스피드 퀴즈 대회(`PRD-speed-quiz.md` 7장)의 순위를 Google Sheets에 저장하기 위한 설정 기록이다. Google Cloud 화면의 메뉴 이름과 위치는 바뀔 수 있으니 비슷한 이름을 찾아 진행한다.

## 현재 진행 상황 (2026-09-29)

| 단계 | 상태 | 내용 |
| --- | --- | --- |
| 1. Google Cloud 프로젝트 | 완료 | 프로젝트 id `quiz-510106` |
| 2. API 켜기 (Sheets, Drive) | 완료 | 연결 시험 성공으로 확인 |
| 3. 서비스 계정·JSON 키 | 완료 | 서비스 계정 `<서비스계정>@<프로젝트ID>.iam.gserviceaccount.com`, 키 파일 `quiz-510106-cbbd85ddc9c1.json` (프로젝트 폴더) |
| 4. 스프레드시트 만들기 | 완료 | 아래 `SHEET_URL`, 제목 "철강 퀴즈 대회 순위" |
| 4. 서비스 계정에 편집자 공유 | 완료 | 연결·쓰기 성공으로 확인 |
| 5. 앱에 설정 넣기 | 완료 | `.streamlit/secrets.toml` 작성(키 파일에서 스크립트로 옮김). `CONTEST_ID = "dev-테스트"`, `PIN_SALT` 자동 생성. `ADMIN_PASSWORD` 설정됨. OpenAI 키·모델(`OPENAI_MODEL=gpt-5.4-mini`)은 `.env`에서 읽음 |
| 6. 연결 시험 | 완료 | 앱으로 한 판 완주 → `dev-테스트` 탭에 기록 1행 저장 확인, `status` 탭 생성 |

**남은 일:** `secrets.toml`의 `ADMIN_PASSWORD`(운영자 메뉴), `OPENAI_MODEL`(AI 오답분석)을 채운다. 실제 대회 때 `CONTEST_ID`를 대회 이름으로 바꾼다(새 탭에 기록된다). 키 파일은 프로젝트 폴더 밖 안전한 곳으로 옮겨 둔다(앱은 `secrets.toml`만 읽는다).

- **SHEET_URL:** `https://docs.google.com/spreadsheets/d/<시트ID>/edit`
- **보안 조치:** `.gitignore`를 만들어 `.env`, `.streamlit/secrets.toml`, 키 파일(`quiz-510106-*.json`)이 GitHub에 올라가지 않게 했다. GitHub에 올리기 전에 `git status`로 이 파일들이 목록에 없는지 한 번 더 확인한다.

## 1. Google Cloud 프로젝트 만들기

1. [console.cloud.google.com](https://console.cloud.google.com)에 로그인한다.
2. 상단 프로젝트 선택 → **새 프로젝트** → 이름을 입력하고 만든다.

## 2. API 켜기

**API 및 서비스 → 라이브러리**에서 검색해 **사용**을 누른다.
- **Google Sheets API**: 시트 읽기·쓰기
- **Google Drive API**: gspread가 파일을 찾을 때 쓸 수 있어 함께 켜 둔다

## 3. 서비스 계정과 키 만들기

1. **IAM 및 관리자 → 서비스 계정 → 서비스 계정 만들기**에서 이름을 입력하고 만든다. 역할은 주지 않아도 된다(권한은 시트 공유로 준다).
2. 만든 서비스 계정 → **키** 탭 → **키 추가 → 새 키 만들기 → JSON**을 고르면 키 파일이 내려받아진다.
3. 키 파일은 비밀번호와 같다. 채팅·메일·GitHub에 올리지 않는다.
4. 서비스 계정 이메일(`…@….iam.gserviceaccount.com`)을 복사해 둔다.

> 회사 Google Workspace 계정은 보안 정책으로 서비스 계정 키 만들기가 막혀 있을 수 있다. 이 경우 IT 담당자에게 요청하거나 대회용 별도 계정을 쓴다.

## 4. 스프레드시트 만들고 공유하기

1. [sheets.google.com](https://sheets.google.com)에서 새 스프레드시트를 만든다.
2. **공유**를 누르고 서비스 계정 이메일을 **편집자**로 추가한다(알림 메일은 꺼도 된다).
3. "링크가 있는 모든 사용자" 공개는 하지 않는다. 운영자와 서비스 계정만 접근한다.
4. 주소창의 URL을 복사한다. 이것이 `SHEET_URL`이다(`?gid=…` 뒷부분은 없어도 된다).
5. 탭은 만들지 않아도 된다. 앱이 `CONTEST_ID` 이름으로 탭을 만든다.

## 5. 앱에 설정 넣기

**로컬 개발:** 프로젝트에 `.streamlit/secrets.toml`을 만들고, 키 파일(JSON)의 값을 그대로 옮겨 적는다.

```toml
SHEET_URL = "https://docs.google.com/spreadsheets/d/<시트ID>/edit"
CONTEST_ID = "2026-autumn"   # 대회 이름이자 탭 이름. 원하는 값으로

[gcp_service_account]
type = "service_account"
project_id = "<프로젝트ID>"
private_key_id = "키 파일의 값"
private_key = "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
client_email = "<서비스계정>@<프로젝트ID>.iam.gserviceaccount.com"
client_id = "키 파일의 값"
auth_uri = "https://accounts.google.com/o/oauth2/auth"
token_uri = "https://oauth2.googleapis.com/token"
auth_provider_x509_cert_url = "https://www.googleapis.com/oauth2/v1/certs"
client_x509_cert_url = "키 파일의 값"
universe_domain = "googleapis.com"
```

- `private_key`는 키 파일에 있는 문자열을 `\n`까지 그대로 한 줄로 붙여 넣는다.
- 이 파일은 `.gitignore`에 들어 있어 GitHub에 올라가지 않는다.
- 설정을 다 옮긴 뒤에는 폴더의 키 파일(JSON)을 프로젝트 밖 안전한 곳으로 옮겨 두는 것이 좋다.

**배포(Streamlit Community Cloud):** 앱 설정 → **Secrets** 칸에 위 내용을 그대로 붙여 넣는다.

## 6. 연결 시험

```bash
pip install streamlit gspread google-auth
```

`test_sheets.py`:

```python
import gspread
import streamlit as st

gc = gspread.service_account_from_dict(dict(st.secrets["gcp_service_account"]))
sh = gc.open_by_url(st.secrets["SHEET_URL"])

title = st.secrets["CONTEST_ID"]
try:
    ws = sh.worksheet(title)
except gspread.WorksheetNotFound:
    ws = sh.add_worksheet(title=title, rows=1000, cols=12)
    ws.append_row(["completed_at", "game_id", "nickname", "pin_hash",
                   "market", "tech", "product", "total", "total_time_sec", "app_version"])

ws.append_row(["2026-09-29T12:00:00+09:00", "test-1", "연결테스트", "",
               100, 90, 80, 270, 95.3, "test"])
st.write("연결 성공! 행 수:", len(ws.get_all_values()))
```

```bash
streamlit run test_sheets.py
```

시트에 `CONTEST_ID` 이름의 탭과 테스트 행이 생기면 성공이다. 확인 후 테스트 행은 지운다.

## 자주 나는 오류

| 오류 | 원인과 해결 |
| --- | --- |
| `PERMISSION_DENIED` / `403` | 시트를 서비스 계정 이메일에 편집자로 공유하지 않았거나, Sheets API가 꺼져 있음 |
| `SpreadsheetNotFound` | URL이 틀렸거나 공유가 안 됨 |
| `private key` 관련 오류 | `private_key`의 `\n`이 실제 줄바꿈으로 바뀌었거나 일부가 잘림. 키 파일 값을 다시 그대로 붙여 넣기 |
| `429 Too Many Requests` | 분당 요청 한도 초과. PRD 7장처럼 캐시와 재시도로 대응 |
| 키 만들기 버튼이 막혀 있음 | 회사 계정 보안 정책. IT 담당자 문의 또는 별도 계정 사용 |
