// 화면 전환과 게임 진행 상태, 렌더링. 사용자 입력이 들어가는 텍스트는 항상 textContent로 넣는다.
const $ = (id) => document.getElementById(id);

const screens = {
  home: $('screen-home'),
  nickname: $('screen-nickname'),
  quiz: $('screen-quiz'),
  result: $('screen-result'),
  review: $('screen-review'),
  ranking: $('screen-ranking'),
};

const state = {
  session: null,
  nickname: QuizStorage.getNickname(),
  lastSave: null, // 마지막 판의 saveRecord 결과
  pendingCategory: null, // 닉네임 입력 후 시작할 카테고리
  nicknameReturn: 'home',
  rankingReturn: 'home',
  rankingCategory: 'market',
};

let currentScreen = 'home';

function showScreen(name) {
  currentScreen = name;
  Object.entries(screens).forEach(([key, el]) => {
    el.hidden = key !== name;
  });
  window.scrollTo(0, 0);
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// ---------- 홈 ----------

function renderHome() {
  $('home-nickname').textContent = state.nickname ? `${state.nickname} 님` : '닉네임을 정하고 시작하세요';
  $('btn-change-nickname').hidden = !state.nickname;

  document.querySelectorAll('.category-btn').forEach((btn) => {
    const category = btn.dataset.category;
    btn.querySelector('.category-count').textContent = `${Math.min(QUESTIONS_PER_ROUND, getQuestions(category).length)}문제`;
    const best = state.nickname ? QuizStorage.getBest(category, state.nickname) : null;
    btn.querySelector('.category-best').textContent = best ? `내 최고 ${best.score}점` : '기록 없음';
  });
  showScreen('home');
}

// ---------- 닉네임 ----------

function openNickname(returnTo, pendingCategory) {
  state.nicknameReturn = returnTo;
  state.pendingCategory = pendingCategory || null;
  $('nickname-input').value = state.nickname || '';
  $('nickname-error').textContent = '';
  $('btn-nickname-submit').textContent = pendingCategory ? '시작' : '저장';
  showScreen('nickname');
  $('nickname-input').focus();
}

function submitNickname(event) {
  event.preventDefault();
  const check = validateNickname($('nickname-input').value);
  if (!check.ok) {
    $('nickname-error').textContent = check.error;
    $('nickname-input').focus();
    return;
  }
  state.nickname = check.value;
  QuizStorage.setNickname(check.value);
  if (state.pendingCategory) {
    startGame(state.pendingCategory);
  } else {
    renderHome();
  }
}

// ---------- 문제 풀이 ----------

function startGame(category) {
  if (!state.nickname) {
    openNickname('home', category);
    return;
  }
  state.session = createSession(category);
  state.lastSave = null;
  showScreen('quiz');
  renderQuestion();
}

function renderQuestion() {
  const { session } = state;
  const item = currentItem(session);
  const total = session.items.length;

  $('quiz-category').textContent = CATEGORY_NAMES[session.category];
  $('quiz-progress').textContent = `${session.index + 1} / ${total}`;
  $('quiz-score').textContent = `${getScore(session)}점`;
  $('quiz-progressbar').setAttribute('aria-valuemax', String(total));
  $('quiz-progressbar').setAttribute('aria-valuenow', String(session.index));
  $('quiz-progressbar-fill').style.width = `${(session.index / total) * 100}%`;
  $('quiz-question').textContent = item.question.question;

  $('quiz-choices').replaceChildren(
    ...item.choices.map((choice, pos) => {
      const btn = el('button', 'choice-btn');
      btn.type = 'button';
      btn.dataset.pos = String(pos);
      btn.append(el('span', 'choice-num', String(pos + 1)), el('span', 'choice-text', choice), el('span', 'choice-mark'));
      btn.addEventListener('click', () => handleAnswer(pos));
      return btn;
    })
  );
  $('quiz-feedback').hidden = true;
}

function handleAnswer(pos) {
  const { session } = state;
  const outcome = submitAnswer(session, pos);
  if (!outcome) return; // 이미 답한 문제

  const item = currentItem(session);
  document.querySelectorAll('.choice-btn').forEach((btn) => {
    const btnPos = Number(btn.dataset.pos);
    btn.disabled = true;
    const mark = btn.querySelector('.choice-mark');
    if (btnPos === outcome.correctPos) {
      btn.classList.add('is-correct');
      mark.textContent = '✓ 정답';
    } else if (btnPos === pos) {
      btn.classList.add('is-wrong');
      mark.textContent = '✗ 선택';
    }
  });

  const verdict = $('feedback-verdict');
  verdict.textContent = outcome.isCorrect ? '✓ 정답!' : '✗ 오답';
  verdict.className = `feedback-verdict ${outcome.isCorrect ? 'is-correct' : 'is-wrong'}`;
  $('feedback-explanation').textContent = item.question.explanation;
  $('quiz-score').textContent = `${getScore(session)}점`;
  $('btn-next').textContent = isLastQuestion(session) ? '결과 보기' : '다음 문제';
  $('quiz-feedback').hidden = false;
  $('btn-next').focus();
}

function goNext() {
  const { session } = state;
  if (!session || !nextQuestion(session)) return;
  if (isFinished(session)) {
    finishGame();
  } else {
    renderQuestion();
  }
}

// ---------- 결과 ----------

function finishGame() {
  const result = getResult(state.session);
  state.lastSave = QuizStorage.saveRecord(result, state.nickname);
  renderResult(result);
}

function renderResult(result) {
  const save = state.lastSave;
  $('result-category').textContent = CATEGORY_NAMES[result.category];
  $('result-score').replaceChildren(el('span', 'score-number', String(result.score)), `점 / ${result.maxScore}점`);
  $('result-correct').textContent = `${result.correctCount} / ${result.total}`;
  $('result-accuracy').textContent = `${result.accuracy}%`;
  renderGauge(result.accuracy);
  $('result-time').textContent = formatDuration(result.durationSec);
  $('result-rank').textContent = save.saved ? `${save.rank}위` : '기록 안 됨';

  let note = '';
  if (!save.saved) note = `순위에 기록되지 않았습니다: ${save.reason}`;
  else if (save.isNewBest) note = '내 최고 기록을 갱신했습니다!';
  else note = '내 최고 기록보다 낮아 순위표에는 이전 최고 기록이 유지됩니다.';
  $('result-note').textContent = note;

  $('btn-review').disabled = getWrongItems(state.session).length === 0;
  showScreen('result');
}

// 정답률 원형 게이지. 빈 상태에서 목표치까지 차오르게 한 프레임 늦게 값을 넣는다.
function renderGauge(accuracy) {
  const gauge = $('result-gauge');
  const circumference = 2 * Math.PI * gauge.r.baseVal.value;
  gauge.style.strokeDasharray = String(circumference);
  gauge.style.strokeDashoffset = String(circumference);
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      gauge.style.strokeDashoffset = String(circumference * (1 - accuracy / 100));
    });
  });
}

// ---------- 오답 다시보기 ----------

function renderReview() {
  const wrong = getWrongItems(state.session);
  $('review-empty').hidden = wrong.length > 0;
  $('review-list').replaceChildren(
    ...wrong.map((item) => {
      const li = el('li', 'review-item');
      li.append(
        el('p', 'review-question', item.question.question),
        el('p', 'review-picked', `✗ 내 답: ${item.choices[item.pickedPos]}`),
        el('p', 'review-answer', `✓ 정답: ${item.choices[item.correctPos]}`),
        el('p', 'review-explanation', item.question.explanation)
      );
      return li;
    })
  );
  showScreen('review');
}

// ---------- 순위표 ----------

function openRanking(returnTo, category) {
  state.rankingReturn = returnTo;
  if (category) state.rankingCategory = category;
  renderRanking();
}

function rankingRow(record, rank) {
  const tr = el('tr');
  if (record.nickname === state.nickname) tr.className = 'is-me';
  const date = new Date(record.recordedAt);
  const dateText = `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')}`;
  // 1~3위는 메달 색 배지. 색만으로 구분하지 않도록 숫자는 그대로 둔다.
  const rankCell = el('td');
  rankCell.append(el('span', rank <= 3 ? `rank-badge rank-${rank}` : 'rank-badge', String(rank)));
  tr.append(rankCell);
  [record.nickname, `${record.score}점`, `${record.correctCount}/${record.total}`, formatDuration(record.durationSec), dateText]
    .forEach((text) => tr.append(el('td', '', text)));
  return tr;
}

function renderRanking() {
  const category = state.rankingCategory;
  document.querySelectorAll('.tab').forEach((tab) => {
    const selected = tab.dataset.category === category;
    tab.classList.toggle('is-active', selected);
    tab.setAttribute('aria-selected', String(selected));
  });

  const ranking = QuizStorage.getRanking(category);
  const rows = ranking.slice(0, 10).map((r, i) => rankingRow(r, i + 1));

  // 내 기록이 10위 밖이면 구분선 뒤에 따로 보여준다
  const myIndex = state.nickname ? ranking.findIndex((r) => r.nickname === state.nickname) : -1;
  if (myIndex >= 10) {
    const gap = el('tr', 'ranking-gap');
    const td = el('td', '', '⋯');
    td.colSpan = 6;
    gap.append(td);
    rows.push(gap, rankingRow(ranking[myIndex], myIndex + 1));
  }

  $('ranking-body').replaceChildren(...rows);
  $('ranking-empty').hidden = ranking.length > 0;
  $('ranking-table').hidden = ranking.length === 0;
  showScreen('ranking');
}

function closeRanking() {
  if (state.rankingReturn === 'result' && state.session) showScreen('result');
  else renderHome();
}

// ---------- 중도 포기 ----------

const quitDialog = $('quit-dialog');

function confirmQuit() {
  quitDialog.close();
  state.session = null; // 기록하지 않고 버린다
  renderHome();
}

// ---------- 키보드 ----------

function handleKeydown(event) {
  if (currentScreen !== 'quiz' || !state.session || quitDialog.open) return;
  if (event.altKey || event.ctrlKey || event.metaKey) return;

  if (['1', '2', '3', '4'].includes(event.key) && !isAnswered(state.session)) {
    const pos = Number(event.key) - 1;
    if (pos < currentItem(state.session).choices.length) {
      event.preventDefault();
      handleAnswer(pos);
    }
  } else if (event.key === 'Enter' && isAnswered(state.session)) {
    // 버튼에 포커스가 있으면 브라우저 기본 동작(클릭)에 맡겨 두 번 넘어가지 않게 한다
    if (event.target instanceof HTMLButtonElement) return;
    event.preventDefault();
    goNext();
  }
}

// ---------- 이벤트 연결 ----------

document.querySelectorAll('.category-btn').forEach((btn) => {
  btn.addEventListener('click', () => startGame(btn.dataset.category));
});
$('btn-change-nickname').addEventListener('click', () => openNickname('home'));
$('btn-home-ranking').addEventListener('click', () => openRanking('home'));

$('nickname-form').addEventListener('submit', submitNickname);
$('btn-nickname-cancel').addEventListener('click', renderHome);

$('btn-next').addEventListener('click', goNext);
$('btn-quit').addEventListener('click', () => quitDialog.showModal());
$('btn-quit-cancel').addEventListener('click', () => quitDialog.close());
$('btn-quit-confirm').addEventListener('click', confirmQuit);

$('btn-review').addEventListener('click', renderReview);
$('btn-review-back').addEventListener('click', () => showScreen('result'));
$('btn-retry').addEventListener('click', () => startGame(state.session.category));
$('btn-result-ranking').addEventListener('click', () => openRanking('result', state.session.category));
$('btn-result-home').addEventListener('click', renderHome);

document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    state.rankingCategory = tab.dataset.category;
    renderRanking();
  });
});
$('btn-ranking-back').addEventListener('click', closeRanking);

document.addEventListener('keydown', handleKeydown);

renderHome();
