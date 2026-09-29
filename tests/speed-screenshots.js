// 스피드 퀴즈 화면별 스크린샷(360·768·1280px, screenshots-speed/)과 가로 넘침 검사.
// 실행: Playwright MCP browser_run_code_unsafe의 filename으로 전달.
// 전제: python -m streamlit run app.py --secrets.files tests/test-secrets.toml, 정답 확인용 npx serve data -l tcp://127.0.0.1:5173
async (page) => {
  const APP = 'http://localhost:8501/';
  const bank = await (await page.request.get('http://127.0.0.1:5173/questions.json')).json();
  const byQ = new Map(Object.values(bank).flat().map((q) => [q.question, q]));
  const sleep = (ms) => page.evaluate((m) => new Promise((r) => setTimeout(r, m)), ms);
  const report = [];

  const shoot = async (width, name) => {
    await sleep(400);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    const file = `screenshots-speed/${width}-${name}.png`;
    await page.screenshot({ path: file, fullPage: true });
    report.push({ file, horizontalOverflow: overflow });
  };
  const caption = (text) => page.locator('[data-testid="stCaptionContainer"]', { hasText: text }).first().waitFor({ timeout: 15000 });
  const question = async () => byQ.get(await page.locator('.st-key-question h3').first().innerText());
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
  const choose = async (correct) => {
    const { q, labels } = await freshQuestion();
    const answer = q.choices[q.answerIndex];
    const target = correct ? labels.find((l) => l.slice(3) === answer) : labels.find((l) => l.slice(3) !== answer);
    await page.getByRole('button', { name: target, exact: true }).click();
  };

  for (const width of [360, 768, 1280]) {
    await page.setViewportSize({ width, height: width === 360 ? 740 : 900 });
    await page.goto(APP);
    await page.getByText('테스트 모드입니다').waitFor();
    await shoot(width, '1-main');

    await page.getByRole('button', { name: '1. 새 게임' }).click();
    await page.getByLabel('순위표에 표시될 이름 (2~12자)').fill(`화면${width}`);
    await page.getByRole('textbox', { name: 'PIN (숫자 4자리)' }).fill('1234');
    await shoot(width, '2-nickname');
    await page.getByRole('button', { name: '시작' }).click();

    // 문제 화면: 막 시작(5초)과 2초 이하(빨강) 두 장
    await caption('전체 1 / 30');
    await shoot(width, '3-quiz');
    await page.locator('.st-key-timer', { hasText: /남은 시간 [12]초/ }).waitFor({ timeout: 8000 });
    await shoot(width, '3b-quiz-hurry');
    await choose(false);
    await page.getByRole('button', { name: '다음 문제' }).waitFor();
    await shoot(width, '4-feedback-wrong');
    await page.getByRole('button', { name: '다음 문제' }).click();

    for (let n = 2; n <= 30; n += 1) {
      await caption(`전체 ${n} / 30`);
      await choose(n % 3 !== 0);
      const i = (n - 1) % 10;
      if (n === 2) await shoot(width, '5-feedback-correct');
      await page.getByRole('button', { name: i < 9 ? '다음 문제' : n === 30 ? '최종 결과 보기' : /결과 보기/ }).click();
      if (n === 10) {
        await page.getByRole('heading', { name: '시장 결과' }).waitFor();
        await shoot(width, '6-category-result');
      }
      if (i === 9 && n < 30) await page.getByRole('button', { name: /다음 분야/ }).click();
    }
    await page.getByRole('heading', { name: '최종 결과' }).waitFor();
    await page.getByText(/오답분석을 불러오지 못했습니다|오답분석이 설정되지 않았습니다/).first().waitFor({ timeout: 20000 });
    await shoot(width, '7-final');
    await page.getByRole('button', { name: '순위표' }).click();
    await page.getByRole('heading', { name: '순위 확인' }).waitFor();
    await sleep(800);
    await shoot(width, '8-ranking');
  }
  return report;
}
