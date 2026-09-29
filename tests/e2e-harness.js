// 브라우저 기능 테스트. 게임 페이지에 이 스크립트를 로드한 뒤 `await window.runE2E()`를 호출한다.
// Playwright MCP 예: browser_evaluate로 script 태그를 추가하고 onload 후 runE2E() 결과를 반환.
// 앱의 전역(state, renderHome, quitDialog, QUESTIONS_PER_ROUND 등)을 직접 사용하므로 앱 스크립트와 같은 페이지에서만 동작한다.
(() => {
  const $ = (id) => document.getElementById(id);
  const realNow = Date.now.bind(Date);
  // 테스트 동안 Date.now를 offsetMs만큼 앞당긴 시계로 바꾼다. 판 시작·끝 모두 같은 시계를 써야 소요 시간이 맞다.
  let offsetMs = 0;
  const N = QUESTIONS_PER_ROUND; // 한 판 문제 수
  const MAX = N * POINTS_PER_CORRECT; // 만점

  function findQuestion(category) {
    return window.QUIZ_DATA[category].find((q) => q.question === $('quiz-question').textContent);
  }

  function correctPosOnScreen(q) {
    const texts = [...document.querySelectorAll('.choice-btn .choice-text')].map((e) => e.textContent);
    return texts.indexOf(q.choices[q.answerIndex]);
  }

  function resetApp() {
    localStorage.clear();
    state.nickname = null;
    state.session = null;
    if (quitDialog.open) quitDialog.close();
    renderHome();
  }

  function setNickname(name) {
    state.nickname = name;
    QuizStorage.setNickname(name);
  }

  function startCategory(category) {
    document.querySelector(`.category-btn[data-category="${category}"]`).click();
  }

  // 현재 판을 끝까지 푼다. 앞의 nCorrect문제만 정답. 전체 소요 시간을 elapsedSec로 만든다.
  // sameOrder: 화면의 보기 순서가 원본과 똑같았던 문제 수 (보기 섞기 검사용)
  function playRound(category, nCorrect, elapsedSec) {
    const issues = [];
    const ids = [];
    let running = 0;
    let sameOrder = 0;
    for (let i = 0; i < N; i += 1) {
      const q = findQuestion(category);
      if (!q) {
        issues.push(`문제 찾기 실패 ${i}: ${$('quiz-question').textContent}`);
        break;
      }
      ids.push(q.id);
      if ($('quiz-progress').textContent !== `${i + 1} / ${N}`) issues.push(`진행 표시 ${i}: ${$('quiz-progress').textContent}`);
      if ($('quiz-score').textContent !== `${running * 10}점`) issues.push(`현재 점수 ${i}: ${$('quiz-score').textContent}`);
      const fill = parseFloat($('quiz-progressbar-fill').style.width);
      if (Math.abs(fill - (i / N) * 100) > 0.01) issues.push(`진행 바 ${i}: ${fill}`);
      if (!$('quiz-feedback').hidden) issues.push(`답하기 전 피드백 노출 ${i}`);

      const btns = [...document.querySelectorAll('.choice-btn')];
      const texts = btns.map((b) => b.querySelector('.choice-text').textContent);
      if ([...texts].sort().join('|') !== [...q.choices].sort().join('|')) issues.push(`보기 불일치 ${q.id}`);
      if (texts.join('|') === q.choices.join('|')) sameOrder += 1;
      const correctPos = correctPosOnScreen(q);
      const wantCorrect = i < nCorrect;
      const pick = wantCorrect ? correctPos : (correctPos + 1) % 4;
      if (i === N - 1) offsetMs += elapsedSec * 1000;

      btns[pick].click();
      btns[pick].click(); // 연타
      btns[(pick + 2) % 4].click(); // 다른 보기 추가 클릭
      if (wantCorrect) running += 1;

      if (!btns.every((b) => b.disabled)) issues.push(`답한 뒤 보기 비활성화 안 됨 ${i}`);
      const verdict = $('feedback-verdict').textContent;
      if (wantCorrect && verdict !== '✓ 정답!') issues.push(`정답 피드백 ${i}: ${verdict}`);
      if (!wantCorrect) {
        if (verdict !== '✗ 오답') issues.push(`오답 피드백 ${i}: ${verdict}`);
        if (!btns[correctPos].classList.contains('is-correct')) issues.push(`오답 시 정답 강조 없음 ${i}`);
        if (!btns[pick].classList.contains('is-wrong')) issues.push(`선택한 오답 표시 없음 ${i}`);
      }
      if (btns[(pick + 2) % 4].classList.contains('is-wrong')) issues.push(`추가 클릭한 보기가 선택됨 ${i}`);
      if ($('quiz-score').textContent !== `${running * 10}점`) issues.push(`중복 채점 ${i}: ${$('quiz-score').textContent}`);
      if ($('feedback-explanation').textContent !== q.explanation) issues.push(`해설 불일치 ${i}`);
      if (document.activeElement !== $('btn-next')) issues.push(`다음 버튼 포커스 없음 ${i}`);
      const label = $('btn-next').textContent;
      if (label !== (i === N - 1 ? '결과 보기' : '다음 문제')) issues.push(`다음 버튼 문구 ${i}: ${label}`);
      $('btn-next').click();
    }
    return { issues, ids, sameOrder };
  }

  function readResult() {
    return {
      visible: !$('screen-result').hidden,
      score: $('result-score').textContent,
      correct: $('result-correct').textContent,
      accuracy: $('result-accuracy').textContent,
      time: $('result-time').textContent,
      rank: $('result-rank').textContent,
      note: $('result-note').textContent,
    };
  }

  function records() {
    return JSON.parse(localStorage.getItem('steelQuiz.records') || '[]');
  }

  function keydown(key, target = document.body) {
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  }

  window.runE2E = () => {
    const originalNow = Date.now;
    offsetMs = 0;
    Date.now = () => realNow() + offsetMs;
    try {
      return runAll();
    } finally {
      Date.now = originalNow;
    }
  };

  function runAll() {
    const report = [];
    const check = (name, ok, detail) => report.push({ name, ok: Boolean(ok), detail });

    // ---------- F-01, F-02 ----------
    resetApp();
    check(`홈: 카테고리 3개에 한 판 문제 수(${N}문제) 표시`, [...document.querySelectorAll('.category-count')].every((e) => e.textContent === `${N}문제`));
    startCategory('market');
    check('F-02 닉네임 없으면 입력 화면으로', !$('screen-nickname').hidden);
    const badNames = ['a', '가나다라마바사아자차카타파', '   ', '씨발놈', 'Ad Min'];
    const accepted = badNames.filter((v) => {
      $('nickname-input').value = v;
      $('nickname-form').requestSubmit();
      return $('screen-nickname').hidden;
    });
    check('F-02 잘못된 닉네임 거부', accepted.length === 0, accepted);
    $('nickname-input').value = '  테스터  ';
    $('nickname-form').requestSubmit();
    check('F-02 올바른 닉네임 저장(공백 제거) 후 바로 시작', !$('screen-quiz').hidden && localStorage.getItem('steelQuiz.nickname') === '테스터');

    // ---------- F-03 ~ F-07 한 판: 6문제 정답, 125초 ----------
    const run1 = playRound('market', 6, 125);
    check('F-03~F-05 한 판 진행 중 이상 없음', run1.issues.length === 0, run1.issues);
    check('F-01 시장 문제만 출제', run1.ids.every((id) => id.startsWith('MKT')));
    check(`F-03 ${N}문제를 중복 없이 출제`, run1.ids.length === N && new Set(run1.ids).size === N, run1.ids);
    const r1 = readResult();
    check(
      'F-06 결과 값(6문제 정답, 125초)',
      r1.visible && r1.score === `60점 / ${MAX}점` && r1.correct === `6 / ${N}` && r1.accuracy === '60%' && r1.time === '2:05' && r1.rank === '1위',
      r1
    );
    check('F-07 기록 저장', records().length === 1 && records()[0].score === 60 && records()[0].total === N && records()[0].durationSec === 125, records());

    // ---------- F-09 ----------
    $('btn-review').click();
    const reviewItems = [...document.querySelectorAll('.review-item')];
    const reviewOk = reviewItems.every((li) => {
      const [qEl, pickedEl, answerEl] = li.children;
      const q = window.QUIZ_DATA.market.find((x) => x.question === qEl.textContent);
      const picked = pickedEl.textContent.replace('✗ 내 답: ', '');
      const answer = answerEl.textContent.replace('✓ 정답: ', '');
      return q && answer === q.choices[q.answerIndex] && picked !== answer && q.choices.includes(picked);
    });
    check(`F-09 오답 다시보기: 틀린 ${N - 6}문제, 내 답·정답 정확`, reviewItems.length === N - 6 && reviewOk, reviewItems.length);
    $('btn-review-back').click();

    // ---------- F-11 + 최고 기록 유지 ----------
    $('btn-retry').click();
    const run2 = playRound('market', 3, 90);
    check('F-11 다시하기: 같은 카테고리, 다른 문제 조합', run2.issues.length === 0 && run2.ids.every((id) => id.startsWith('MKT')) && run2.ids.join() !== run1.ids.join(), run2.issues);
    const r2 = readResult();
    check('F-07 낮은 점수는 최고 기록을 덮지 않음', records().length === 1 && records()[0].score === 60 && r2.note.includes('이전 최고 기록'), { note: r2.note, records: records() });

    // ---------- 비정상 기록: 만점이지만 5초 (기준: 문제당 1초 = 10초) ----------
    $('btn-retry').click();
    const run3 = playRound('market', N, 5);
    const r3 = readResult();
    check(`7장 ${N * MIN_SECONDS_PER_QUESTION}초 미만 기록은 저장 안 함`, run3.issues.length === 0 && records()[0].score === 60 && r3.rank === '기록 안 됨', r3);

    // ---------- 무작위 추출·보기 섞기 (세 판, 30문제 기준) ----------
    const allIds = [...run1.ids, ...run2.ids, ...run3.ids];
    check('F-03 판마다 40문제 풀에서 다른 조합이 뽑힘', new Set(allIds).size > N, new Set(allIds).size);
    const sameOrder = run1.sameOrder + run2.sameOrder + run3.sameOrder;
    // 보기 4개가 원래 순서 그대로일 확률은 1/24. 30문제 중 8개 이상이면 섞기가 망가진 것으로 본다.
    check('F-03 보기 순서 섞임', sameOrder < 8, `원래 순서 그대로 ${sameOrder} / ${allIds.length}`);

    // ---------- 홈 최고 점수 ----------
    $('btn-result-home').click();
    check('홈: 카테고리별 내 최고 점수 표시', document.querySelector('.category-btn[data-category="market"] .category-best').textContent === '내 최고 60점');

    // ---------- F-10 중도 포기 ----------
    startCategory('tech');
    for (let i = 0; i < 3; i += 1) {
      document.querySelectorAll('.choice-btn')[0].click();
      $('btn-next').click();
    }
    $('btn-quit').click();
    check('F-10 나가기 → 확인 팝업', quitDialog.open);
    $('btn-quit-cancel').click();
    check('F-10 취소하면 이어서 진행', !quitDialog.open && !$('screen-quiz').hidden && $('quiz-progress').textContent === `4 / ${N}`);
    $('btn-quit').click();
    $('btn-quit-confirm').click();
    check('F-10 확인하면 홈으로, 기록 없음', !$('screen-home').hidden && !records().some((r) => r.category === 'tech'));

    // ---------- 키보드 ----------
    startCategory('product');
    keydown('5');
    check('키보드: 5는 무시', !isAnswered(state.session));
    keydown('2');
    check('키보드: 2로 두 번째 보기 선택', state.session.items[0].pickedPos === 1);
    keydown('3');
    check('키보드: 답한 뒤 다른 숫자 무시', state.session.items[0].pickedPos === 1);
    keydown('Enter', $('btn-next'));
    check('키보드: 버튼 포커스 상태의 Enter는 기본 동작에 맡김(두 번 넘어가지 않음)', state.session.index === 0);
    keydown('Enter');
    check('키보드: Enter로 다음 문제', state.session.index === 1 && $('quiz-progress').textContent === `2 / ${N}`);
    $('btn-quit').click();
    keydown('1');
    check('키보드: 팝업이 열려 있으면 무시', !isAnswered(state.session));
    $('btn-quit-confirm').click();

    // ---------- F-08 순위표 ----------
    const base = realNow() - 100000;
    const seeded = records();
    // 100·100·100·90·90·90·80… 점. 테스터(60점)보다 모두 높다.
    for (let i = 0; i < 12; i += 1) {
      const score = MAX - Math.floor(i / 3) * 10;
      seeded.push({ nickname: `유저${i}`, category: 'market', score, correctCount: score / 10, total: N, durationSec: 100 + i, recordedAt: base + i });
    }
    // 동점 처리: 같은 점수면 시간 짧은 순, 같으면 먼저 기록한 순
    seeded.push({ nickname: '빠른동점', category: 'market', score: MAX, correctCount: N, total: N, durationSec: 90, recordedAt: base + 50 });
    seeded.push({ nickname: '늦은동점', category: 'market', score: MAX, correctCount: N, total: N, durationSec: 100, recordedAt: base + 60 });
    // 예전 40문제 판 기록: 점수 척도가 달라 순위에서 빠져야 한다
    seeded.push({ nickname: '옛기록', category: 'market', score: 400, correctCount: 40, total: 40, durationSec: 500, recordedAt: base });
    localStorage.setItem('steelQuiz.records', JSON.stringify(seeded));
    $('btn-home-ranking').click();
    document.querySelector('.tab[data-category="market"]').click();
    const rows = [...document.querySelectorAll('#ranking-body tr')].map((tr) => [...tr.children].map((td) => td.textContent));
    const names = rows.map((r) => r[1]);
    check('F-08 상위 10명 + 구분선 + 10위 밖 내 기록', rows.length === 12 && rows[10][0] === '⋯' && rows[11][1] === '테스터' && rows[11][0] === '15', rows.slice(9));
    check('F-08 정렬: 점수 → 소요 시간 → 기록 일시', names.slice(0, 4).join() === '빠른동점,유저0,늦은동점,유저1', names.slice(0, 4));
    check('F-08 판 크기가 다른 예전 기록은 순위에서 제외', !names.includes('옛기록'));
    check('F-08 내 기록 행 강조', document.querySelector('#ranking-body tr.is-me td:nth-child(2)').textContent === '테스터');
    document.querySelector('.tab[data-category="tech"]').click();
    check('F-08 기록 없는 탭은 빈 상태 안내', !$('ranking-empty').hidden && $('ranking-table').hidden);
    $('btn-ranking-back').click();
    check('순위표 돌아가기 → 홈', !$('screen-home').hidden);

    // ---------- XSS ----------
    setNickname('<b>x</b>');
    localStorage.setItem('steelQuiz.records', JSON.stringify([{ nickname: '<b>x</b>', category: 'product', score: 50, correctCount: 5, total: N, durationSec: 100, recordedAt: realNow() }]));
    renderHome();
    $('btn-home-ranking').click();
    document.querySelector('.tab[data-category="product"]').click();
    check('XSS: 닉네임의 HTML이 태그로 해석되지 않음', !document.querySelector('#ranking-body b') && !document.querySelector('#home-nickname b') && document.querySelector('#ranking-body tr td:nth-child(2)').textContent === '<b>x</b>');
    $('btn-ranking-back').click();

    // ---------- localStorage 사용 불가 ----------
    resetApp();
    setNickname('테스터');
    const proto = Object.getPrototypeOf(window.localStorage);
    const origGet = proto.getItem;
    const origSet = proto.setItem;
    proto.getItem = () => { throw new Error('blocked'); };
    proto.setItem = () => { throw new Error('blocked'); };
    try {
      startCategory('tech');
      const run4 = playRound('tech', 5, 100);
      const r4 = readResult();
      $('btn-result-ranking').click();
      const rankRows = document.querySelectorAll('#ranking-body tr').length;
      check('7장 localStorage 차단돼도 게임 진행·메모리 순위 유지', run4.issues.length === 0 && r4.score === `50점 / ${MAX}점` && r4.rank === '1위' && rankRows === 1, { issues: run4.issues, r4, rankRows });
      $('btn-ranking-back').click();
      check('결과 화면의 순위표 → 돌아가기는 결과로', !$('screen-result').hidden);
    } catch (e) {
      check('7장 localStorage 차단돼도 게임 진행', false, String(e));
    } finally {
      proto.getItem = origGet;
      proto.setItem = origSet;
    }

    resetApp();
    const failed = report.filter((r) => !r.ok);
    return { total: report.length, passed: report.length - failed.length, failed, report: report.map((r) => `${r.ok ? 'PASS' : 'FAIL'} ${r.name}`) };
  }
})();
