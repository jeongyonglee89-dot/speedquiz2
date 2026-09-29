// 출제와 채점. 화면(DOM)에는 의존하지 않는다.
const POINTS_PER_CORRECT = 10;
const QUESTIONS_PER_ROUND = 10; // 카테고리 문제(40개) 중 한 판에 무작위로 뽑는 수
const MIN_SECONDS_PER_QUESTION = 1; // 문제당 평균 1초 미만으로 끝난 판은 비정상 기록으로 본다 (PRD 7장)
const NICKNAME_MIN = 2;
const NICKNAME_MAX = 12;
const BANNED_WORDS = ['시발', '씨발', '병신', '개새끼', '좆', 'fuck', 'shit', '운영자', '관리자', 'admin'];

const CATEGORY_NAMES = {
  market: '시장',
  tech: '기술',
  product: '제품',
};

function getQuestions(category) {
  const data = window.QUIZ_DATA && window.QUIZ_DATA[category];
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error(`문제 데이터가 없습니다: ${category}`);
  }
  return data;
}

// Fisher-Yates. 원본을 바꾸지 않고 섞인 새 배열을 반환한다.
function shuffle(items) {
  const arr = items.slice();
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// 카테고리 문제를 섞어 앞에서 QUESTIONS_PER_ROUND개를 뽑고, 각 문제의 보기 순서도 섞는다.
// order[k] = 화면 k번째 보기가 원래 choices의 몇 번째인지. 정답 위치는 order에서 answerIndex를 찾는다.
function createSession(category) {
  const picked = shuffle(getQuestions(category)).slice(0, QUESTIONS_PER_ROUND);
  const items = picked.map((question) => {
    const order = shuffle(question.choices.map((_, i) => i));
    return {
      question,
      choices: order.map((i) => question.choices[i]),
      correctPos: order.indexOf(question.answerIndex),
      pickedPos: null,
    };
  });
  return {
    category,
    items,
    index: 0,
    correctCount: 0,
    startedAt: Date.now(),
    finishedAt: null,
  };
}

function currentItem(session) {
  return session.items[session.index];
}

function isAnswered(session) {
  return currentItem(session).pickedPos !== null;
}

function isLastQuestion(session) {
  return session.index === session.items.length - 1;
}

// 현재 문제를 채점한다. 이미 답한 문제면 null을 반환해 중복 선택을 막는다.
function submitAnswer(session, pos) {
  const item = currentItem(session);
  if (!item || item.pickedPos !== null) return null;
  item.pickedPos = pos;
  const isCorrect = pos === item.correctPos;
  if (isCorrect) session.correctCount += 1;
  if (isLastQuestion(session)) session.finishedAt = Date.now();
  return { isCorrect, correctPos: item.correctPos };
}

// 답한 뒤에만 다음 문제로 넘어간다. 마지막 문제 뒤에는 index가 문제 수와 같아진다.
function nextQuestion(session) {
  if (!isAnswered(session)) return false;
  session.index += 1;
  return true;
}

function isFinished(session) {
  return session.finishedAt !== null && session.index >= session.items.length;
}

function getScore(session) {
  return session.correctCount * POINTS_PER_CORRECT;
}

function getResult(session) {
  const total = session.items.length;
  const end = session.finishedAt || Date.now();
  return {
    category: session.category,
    total,
    correctCount: session.correctCount,
    score: getScore(session),
    maxScore: total * POINTS_PER_CORRECT,
    accuracy: Math.round((session.correctCount / total) * 100),
    durationSec: Math.round((end - session.startedAt) / 1000),
  };
}

function getWrongItems(session) {
  return session.items.filter((item) => item.pickedPos !== null && item.pickedPos !== item.correctPos);
}

// 닉네임 검사. 통과하면 { ok: true, value }, 아니면 { ok: false, error }.
function validateNickname(raw) {
  const value = String(raw || '').trim();
  const length = [...value].length;
  if (length < NICKNAME_MIN || length > NICKNAME_MAX) {
    return { ok: false, error: `닉네임은 ${NICKNAME_MIN}~${NICKNAME_MAX}자로 입력해 주세요.` };
  }
  const lower = value.toLowerCase().replace(/\s/g, '');
  if (BANNED_WORDS.some((word) => lower.includes(word))) {
    return { ok: false, error: '사용할 수 없는 단어가 포함되어 있습니다.' };
  }
  return { ok: true, value };
}

// 순위 정렬: 점수 내림차순 → 소요 시간 오름차순 → 기록 일시 오름차순 (PRD 6장)
function compareRecords(a, b) {
  return b.score - a.score || a.durationSec - b.durationSec || a.recordedAt - b.recordedAt;
}

function formatDuration(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
