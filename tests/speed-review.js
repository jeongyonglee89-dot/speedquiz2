// 스피드 퀴즈 4단계 검토: 공정성·엣지 케이스·성능·비밀값 노출 (테스트 모드).
// 실행: browser_run_code_unsafe filename. 판이 많아 PART로 나눠 돌린다(1 또는 2).
// 전제: python -m streamlit run app.py --secrets.files tests/test-secrets.toml, npx serve data -l tcp://127.0.0.1:5173
async (page) => {
  const PART = 2;
  const APP = 'http://localhost:8501/';
  const bank = await (await page.request.get('http://127.0.0.1:5173/questions.json')).json();
  const byQ = new Map(Object.values(bank).flat().map((q) => [q.question, q]));
  const sleep = (ms) => page.evaluate((m) => new Promise((r) => setTimeout(r, m)), ms);
  const out = {};
  const SECRET_MARKERS = ['PRIVATE KEY', 'sk-', 'gserviceaccount', 'test-salt', 'admin-test', '127.0.0.1:9', 'OPENAI_API_KEY'];

  // ---------- 도우미 ----------
  // Streamlit은 새 화면을 그리는 동안 이전 문제의 질문·버튼을 잠시 남겨 둔다.
  // 질문과 보기 4개를 함께 다시 읽어 서로 맞을 때만 돌려준다.
  const freshQuestion = async (p = page) => {
    for (let t = 0; t < 80; t += 1) {
      const q = byQ.get(await p.locator('.st-key-question h3').first().innerText().catch(() => ''));
      const labels = (await p.locator('[class*="st-key-answer-"] button').allInnerTexts()).filter((l) => /^[1-4]\. /.test(l));
      if (q && labels.length === 4 && q.choices.every((c) => labels.map((l) => l.slice(3)).includes(c))) return { q, labels };
      await p.evaluate(() => new Promise((r) => setTimeout(r, 50)));
    }
    throw new Error('질문과 보기 버튼이 맞지 않음');
  };
  const on = (p) => ({
    caption: (text, timeout = 15000) => p.locator('[data-testid="stCaptionContainer"]', { hasText: text }).first().waitFor({ timeout }),
    question: async () => byQ.get(await p.locator('.st-key-question h3').first().innerText()),
    labels: async (q) => {
      for (let t = 0; t < 80; t += 1) {
        const labels = (await p.locator('[class*="st-key-answer-"] button').allInnerTexts()).filter((l) => /^[1-4]\. /.test(l));
        const texts = labels.map((l) => l.slice(3));
        if (labels.length === 4 && q.choices.every((c) => texts.includes(c))) return labels;
        await p.evaluate(() => new Promise((r) => setTimeout(r, 50)));
      }
      throw new Error(`보기 버튼 불일치 ${q.id}`);
    },
  });

  async function start(p, nick, pin = '1234') {
    await p.goto(APP);
    await p.getByRole('button', { name: '1. 새 게임' }).click();
    await p.getByLabel('순위표에 표시될 이름 (2~12자)').fill(nick);
    await p.getByRole('textbox', { name: 'PIN (숫자 4자리)' }).fill(pin);
    await p.getByRole('button', { name: '시작' }).click();
    await on(p).caption('전체 1 / 30');
  }

  // n번째 문제(1부터)를 푼다. correct=true/false. 피드백 뒤 다음 화면으로 넘긴다.
  async function answer(p, n, correct) {
    const o = on(p);
    await o.caption(`전체 ${n} / 30`);
    const { q, labels } = await freshQuestion(p);
    const ans = q.choices[q.answerIndex];
    const target = correct ? labels.find((l) => l.slice(3) === ans) : labels.find((l) => l.slice(3) !== ans);
    await p.getByRole('button', { name: target, exact: true }).click();
    return { q, target };
  }
  async function next(p, n) {
    const i = (n - 1) % 10;
    await p.getByRole('button', { name: i < 9 ? '다음 문제' : n === 30 ? '최종 결과 보기' : /결과 보기/ }).click();
    if (i === 9 && n < 30) await p.getByRole('button', { name: /다음 분야/ }).click();
  }
  async function playAll(p, isCorrect, from = 1, to = 30) {
    for (let n = from; n <= to; n += 1) { await answer(p, n, isCorrect(n)); await next(p, n); }
  }
  async function finalInfo(p) {
    await p.getByRole('heading', { name: '최종 결과' }).waitFor();
    await p.getByText(/모든 문제를 맞혔습니다|오답분석을 불러오지 못했습니다|오답분석이 설정되지 않았습니다|약한 분야/).first()
      .waitFor({ timeout: 30000 }).catch(() => {});
    const body = await p.locator('body').innerText();
    return {
      total: (await p.locator('[data-testid="stMetricValue"]').first().innerText()),
      rank: (body.match(/현재 순위 (\d+)위/) || [])[1] || null,
      review: (body.match(/오답 다시보기 \((\d+)문제\)/) || [])[1],
      analysis: (body.match(/(모든 문제를 맞혔습니다[^\n]*|오답분석을 불러오지 못했습니다|오답분석이 설정되지 않았습니다)/) || [])[1] || '(분석 문구 없음)',
    };
  }
  const leaks = async (p) => { const html = await p.content(); return SECRET_MARKERS.filter((m) => html.includes(m)); };

  await page.setViewportSize({ width: 390, height: 844 });

  if (PART === 1) {
    // R1 새로고침: 게임 도중 새로고침하면 새 세션(메인)으로, 같은 판을 이어 풀 수 없다
    await start(page, `새로고침${Date.now() % 1000}`);
    for (let n = 1; n <= 3; n += 1) { await answer(page, n, true); await next(page, n); }
    await page.reload();
    await page.getByText('온라인 철강 상식 스피드 퀴즈 대회').waitFor();
    out.R1_refresh = { backToMain: await page.getByRole('button', { name: '1. 새 게임' }).count() > 0,
      quizVisible: await page.locator('[data-testid="stCaptionContainer"]', { hasText: '전체' }).count() };

    // R2 뒤로가기: 게임 도중 뒤로가기하면 이전 페이지로 나가고, 앞으로가기로 돌아오면 메인
    await page.goto('about:blank');
    await start(page, `뒤로${Date.now() % 1000}`);
    await answer(page, 1, true); await next(page, 1);
    let dialog = false;
    page.once('dialog', (d) => { dialog = true; d.dismiss(); });
    await page.goBack();
    const urlAfterBack = page.url();
    await page.goForward();
    await page.getByText('온라인 철강 상식 스피드 퀴즈 대회').waitFor();
    out.R2_back = { urlAfterBack, leaveWarning: dialog, afterForward: await page.getByRole('button', { name: '1. 새 게임' }).count() > 0 ? '메인(판 사라짐)' : '?' };

    // R11 두 보기를 연달아 빠르게 누르면 첫 클릭만 채점
    await start(page, `연속${Date.now() % 1000}`);
    const o = on(page);
    const q = await o.question();
    const labels = await o.labels(q);
    const wrongs = labels.filter((l) => l.slice(3) !== q.choices[q.answerIndex]);
    await Promise.all([
      page.getByRole('button', { name: wrongs[0], exact: true }).click(),
      page.getByRole('button', { name: labels.find((l) => l.slice(3) === q.choices[q.answerIndex]), exact: true }).click({ delay: 20 }).catch(() => 'gone'),
    ]);
    await page.getByRole('button', { name: '다음 문제' }).waitFor();
    const fb = await page.locator('body').innerText();
    out.R11_twoClicks = { verdict: fb.includes('정답!') ? '정답' : fb.includes('오답') ? '오답' : '?', firstClicked: wrongs[0] };

    // R8 피드백 반응 시간(클릭 → 결과 표시), R10 비밀값 노출(문제·피드백 화면)
    const latency = [];
    out.R10_leaks = { quiz: await leaks(page) };
    await next(page, 1);
    for (let n = 2; n <= 11; n += 1) {
      const { target } = await answer(page, n, true).then(async (r) => r).catch((e) => ({ error: String(e) }));
      const t0 = Date.now();
      await page.locator('[data-testid^="stAlertContent"]', { hasText: /정답!|오답|시간 초과/ }).first().waitFor();
      latency.push(Date.now() - t0);
      if (n === 2) out.R10_leaks.feedback = await leaks(page);
      await next(page, n);
    }
    out.R8_feedbackLatencyMs = { avg: Math.round(latency.reduce((a, b) => a + b, 0) / latency.length), max: Math.max(...latency), samples: latency };

    // R9 타이머 갱신 간격: 초 숫자가 바뀌는 시점을 브라우저 안에서 기록
    await on(page).caption('전체 12 / 30');
    out.R9_timerTicks = await page.evaluate(() => new Promise((resolve) => {
      const changes = [];
      let last = '';
      const t0 = performance.now();
      const timer = setInterval(() => {
        const el = document.querySelector('.st-key-timer');
        const text = el ? el.innerText.replace(/\s+/g, ' ') : '(없음)';
        const bar = document.querySelector('.st-key-timer [role="progressbar"]');
        const value = bar ? bar.getAttribute('aria-valuenow') : null;
        const key = `${text}|${value}`;
        if (key !== last) { changes.push({ ms: Math.round(performance.now() - t0), text: text.slice(-9), value }); last = key; }
        if (performance.now() - t0 > 6500) { clearInterval(timer); resolve(changes); }
      }, 50);
    }));

    // R3 마지막 문제 시간 초과: 12번부터 29번까지 정답, 30번은 6초 방치
    await page.getByRole('button', { name: '다음 문제' }).click(); // 12번은 위에서 시간 초과됨
    await playAll(page, () => true, 13, 29);
    await on(page).caption('전체 30 / 30');
    await sleep(6500);
    const timedOut = await page.locator('[data-testid="stAlertContentWarning"]', { hasText: '시간 초과' }).count();
    await page.getByRole('button', { name: '최종 결과 보기' }).click();
    out.R3_lastTimeout = { timedOut: timedOut > 0, ...(await finalInfo(page)) };
    out.R10_leaks.final = await leaks(page);
  }

  if (PART === 2) {
    // R4 만점 → 오답분석 호출 없이 축하 문구
    await start(page, `만점${Date.now() % 1000}`);
    await playAll(page, () => true);
    out.R4_perfect = await finalInfo(page);

    // R5·R6 0점 + HTML 닉네임 → 순위표에 글자 그대로
    const htmlNick = '<b>x</b>';
    await start(page, htmlNick, '4321');
    await playAll(page, () => false);
    out.R5_zero = await finalInfo(page);
    await page.getByRole('button', { name: '순위표' }).click();
    await page.getByRole('heading', { name: '순위 확인' }).waitFor();
    out.R6_htmlNickname = {
      shownLiterally: await page.getByText(`${htmlNick} 님은 현재`).count() > 0,
      boldElements: await page.locator('[data-testid="stAlertContentSuccess"] b').count(),
    };

    // R7 두 탭(두 세션)이 동시에 완주 → 둘 다 순위에 기록
    const pA = page;
    const pB = await page.context().newPage();
    await pB.setViewportSize({ width: 390, height: 844 });
    const nickA = `동시A${Date.now() % 1000}`;
    const nickB = `동시B${Date.now() % 1000}`;
    await start(pA, nickA);
    await start(pB, nickB);
    for (let n = 1; n <= 30; n += 1) {
      await answer(pA, n, n % 2 === 0); await answer(pB, n, n % 3 === 0);
      await next(pA, n); await next(pB, n);
    }
    const [fA, fB] = [await finalInfo(pA), await finalInfo(pB)];
    await pB.getByRole('button', { name: '순위표' }).click();
    await pB.getByRole('heading', { name: '순위 확인' }).waitFor();
    await pB.getByRole('button', { name: '새로고침' }).click();
    out.R7_concurrent = { A: fA, B: fB, bothRanked: Boolean(fA.rank && fB.rank && fA.rank !== fB.rank) };
    await pB.close();

    // R12 긴 닉네임(12자) 360px 결과·순위 화면 가로 넘침
    await page.setViewportSize({ width: 360, height: 740 });
    await start(page, 'WWWWWWWWWWWW', '1111');
    await playAll(page, (n) => n % 2 === 0);
    await finalInfo(page);
    const overflowFinal = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    await page.getByRole('button', { name: '순위표' }).click();
    await page.getByRole('heading', { name: '순위 확인' }).waitFor();
    const overflowRanking = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    await page.screenshot({ path: 'screenshots-speed/edge-long-nickname-ranking-360.png', fullPage: true });
    out.R12_longNickname = { overflowFinal, overflowRanking };
  }
  return out;
}
