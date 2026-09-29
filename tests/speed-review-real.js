// 스피드 퀴즈 4단계 검토: 실제 Google Sheets 모드 (검토 전용 탭 review-2026-09-29).
// 실행: browser_run_code_unsafe filename. PHASE를 바꿔 가며 돌린다.
//   A  : 수식처럼 보이는 닉네임(=1+1) 만점 1판 + 두 탭 동시 완주(만점, AI 호출 없음)
//   B1 : 29문제 정답 후 30번째를 시간 초과로 둔 채 멈춤 → (bash에서 검토 탭 삭제)
//   B2 : '최종 결과 보기' → 저장 실패 안내·다시 저장 확인 (S-14)
// 전제: python -m streamlit run app.py --server.port 8502 --secrets.files .streamlit/secrets.toml tests/review-override.toml
async (page) => {
  const PHASE = 'B2';
  const APP = 'http://localhost:8502/';
  const bank = await (await page.request.get('http://127.0.0.1:5173/questions.json')).json();
  const byQ = new Map(Object.values(bank).flat().map((q) => [q.question, q]));
  const sleep = (ms) => page.evaluate((m) => new Promise((r) => setTimeout(r, m)), ms);

  const caption = (p, text) => p.locator('[data-testid="stCaptionContainer"]', { hasText: text }).first().waitFor({ timeout: 20000 });
  async function labelsFor(p, q) {
    for (let t = 0; t < 80; t += 1) {
      const labels = (await p.locator('[class*="st-key-answer-"] button').allInnerTexts()).filter((l) => /^[1-4]\. /.test(l));
      if (labels.length === 4 && q.choices.every((c) => labels.map((l) => l.slice(3)).includes(c))) return labels;
      await p.evaluate(() => new Promise((r) => setTimeout(r, 50)));
    }
    throw new Error('보기 버튼 불일치');
  }
  async function start(p, nick, pin) {
    await p.goto(APP);
    await p.getByRole('button', { name: '1. 새 게임' }).click();
    await p.getByLabel('순위표에 표시될 이름 (2~12자)').fill(nick);
    await p.getByRole('textbox', { name: 'PIN (숫자 4자리)' }).fill(pin);
    await p.getByRole('button', { name: '시작' }).click();
    await caption(p, '전체 1 / 30');
  }
  async function answerCorrect(p, n) {
    await caption(p, `전체 ${n} / 30`);
    // 질문과 보기가 모두 새 문제로 바뀔 때까지 둘 다 다시 읽는다(이전 화면 요소가 잠시 남는다)
    for (let t = 0; t < 80; t += 1) {
      const q = byQ.get(await p.locator('.st-key-question h3').first().innerText());
      const labels = (await p.locator('[class*="st-key-answer-"] button').allInnerTexts()).filter((l) => /^[1-4]\. /.test(l));
      if (q && labels.length === 4 && q.choices.every((c) => labels.map((l) => l.slice(3)).includes(c))) {
        await p.getByRole('button', { name: labels.find((l) => l.slice(3) === q.choices[q.answerIndex]), exact: true }).click();
        return;
      }
      await p.evaluate(() => new Promise((r) => setTimeout(r, 50)));
    }
    throw new Error(`문제 ${n}: 질문과 보기가 맞지 않음`);
  }
  async function next(p, n) {
    const i = (n - 1) % 10;
    await p.getByRole('button', { name: i < 9 ? '다음 문제' : n === 30 ? '최종 결과 보기' : /결과 보기/ }).click();
    if (i === 9 && n < 30) await p.getByRole('button', { name: /다음 분야/ }).click();
  }
  const finalText = async (p) => {
    await p.getByRole('heading', { name: '최종 결과' }).waitFor({ timeout: 30000 });
    await p.getByText(/현재 순위|순위 저장에 실패|순위를 불러오지 못했습니다/).first().waitFor({ timeout: 30000 }).catch(() => {});
    return (await p.locator('body').innerText()).slice(0, 700);
  };

  await page.setViewportSize({ width: 390, height: 844 });

  if (PHASE === 'A') {
    const stamp = Date.now() % 1000;
    await start(page, '=1+1', '1234');
    for (let n = 1; n <= 30; n += 1) { await answerCorrect(page, n); await next(page, n); }
    const formula = await finalText(page);

    const pB = await page.context().newPage();
    await pB.setViewportSize({ width: 390, height: 844 });
    await start(page, `동시A${stamp}`, '1111');
    await start(pB, `동시B${stamp}`, '2222');
    for (let n = 1; n <= 30; n += 1) {
      await answerCorrect(page, n); await answerCorrect(pB, n);
      await next(page, n); await next(pB, n);
    }
    const [a, b] = [await finalText(page), await finalText(pB)];
    await pB.close();
    const rank = (t) => (t.match(/현재 순위 (\d+)위/) || [])[1] || '없음';
    return { formulaRank: rank(formula), A: { nick: `동시A${stamp}`, rank: rank(a) }, B: { nick: `동시B${stamp}`, rank: rank(b) } };
  }

  if (PHASE === 'B1') {
    await start(page, `저장실패${Date.now() % 100}`, '3333');
    for (let n = 1; n <= 29; n += 1) { await answerCorrect(page, n); await next(page, n); }
    await caption(page, '전체 30 / 30');
    await sleep(6000); // 30번째는 시간 초과로 둔다(오답 1개 → 실제 오답분석 1회 호출)
    return { waitingOnFeedback: await page.getByRole('button', { name: '최종 결과 보기' }).count() > 0 };
  }

  if (PHASE === 'B2') {
    await page.getByRole('button', { name: '최종 결과 보기' }).click();
    const first = await finalText(page);
    const retryButton = await page.getByRole('button', { name: '다시 저장' }).count();
    let afterRetry = '';
    if (retryButton) {
      await page.getByRole('button', { name: '다시 저장' }).click();
      await sleep(4000);
      afterRetry = (await page.locator('body').innerText()).slice(0, 400);
    }
    await page.getByText(/약한 분야|오답분석을 불러오지 못했습니다/).first().waitFor({ timeout: 40000 }).catch(() => {});
    const body = await page.locator('body').innerText();
    const ai = body.slice(body.indexOf('AI 오답분석'), body.indexOf('AI 오답분석') + 250);
    return { first: first.slice(0, 350), retryButton, afterRetry, ai };
  }
}
