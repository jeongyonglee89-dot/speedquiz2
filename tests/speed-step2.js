// 스피드 퀴즈 2단계 기능 검사: 5초 타이머·즉시 피드백·순위·PIN·운영자 마감.
// 실행: Playwright MCP browser_run_code_unsafe의 filename으로 전달.
// 전제: 테스트 모드로 앱 실행
//   python -m streamlit run app.py --secrets.files tests/test-secrets.toml  (가짜 설정: 메모리 저장, 운영자 admin-test)
//   정답 확인용 정적 서버: npx serve data -l tcp://127.0.0.1:5173
async (page) => {
  const APP = 'http://localhost:8501/';
  const bank = await (await page.request.get('http://127.0.0.1:5173/questions.json')).json();
  const byQuestion = new Map(Object.values(bank).flat().map((q) => [q.question, q]));
  const NAMES = { market: '시장', tech: '기술', product: '제품' };
  const issues = [];
  const log = [];
  const sleep = (ms) => page.evaluate((m) => new Promise((r) => setTimeout(r, m)), ms);
  const check = (ok, message) => { if (!ok) issues.push(message); };
  const nick = `타이머${Date.now() % 10000}`;

  // Streamlit은 새 화면을 그리는 동안 이전 문제의 질문·버튼을 잠시 남겨 둔다.
  // 질문과 보기 4개를 함께 다시 읽어 서로 맞을 때만 돌려준다.
  const freshQuestion = async (p = page) => {
    for (let t = 0; t < 80; t += 1) {
      const q = byQuestion.get(await p.locator('.st-key-question h3').first().innerText().catch(() => ''));
      const labels = (await p.locator('[class*="st-key-answer-"] button').allInnerTexts()).filter((l) => /^[1-4]\. /.test(l));
      if (q && labels.length === 4 && q.choices.every((c) => labels.map((l) => l.slice(3)).includes(c))) return { q, labels };
      await p.evaluate(() => new Promise((r) => setTimeout(r, 50)));
    }
    throw new Error('질문과 보기 버튼이 맞지 않음');
  };
  const waitCaption = (text) => page.locator('[data-testid="stCaptionContainer"]', { hasText: text }).first().waitFor({ timeout: 10000 });
  const alert = (kind, text) => page.locator(`[data-testid="stAlertContent${kind}"]`, { hasText: text }).first();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(APP);
  await page.getByText('온라인 철강 상식 스피드 퀴즈 대회').waitFor();
  check(await page.getByText('테스트 모드입니다').waitFor({ timeout: 10000 }).then(() => true).catch(() => false), '메인: 테스트 모드 경고 없음');

  // 이전 실행이 중간에 멈춰 대회가 마감된 채 남아 있으면 먼저 다시 연다(테스트 모드 서버는 상태를 공유)
  if (await page.getByRole('button', { name: '1. 새 게임' }).isDisabled()) {
    await page.getByText('운영자', { exact: true }).click();
    await page.getByRole('textbox', { name: '운영자 비밀번호' }).fill('admin-test');
    await page.getByRole('textbox', { name: '운영자 비밀번호' }).press('Enter');
    await page.getByRole('button', { name: '대회 다시 열기' }).click();
    await page.getByRole('button', { name: '1. 새 게임' }).and(page.locator(':enabled')).waitFor();
    await page.goto(APP);
    log.push('준비: 마감 상태로 남아 있던 대회를 다시 열었음');
  }

  // ---------- 닉네임 + PIN ----------
  await page.getByRole('button', { name: '1. 새 게임' }).click();
  await page.getByLabel('순위표에 표시될 이름 (2~12자)').fill(nick);
  await page.getByRole('textbox', { name: 'PIN (숫자 4자리)' }).fill('12');
  await page.getByRole('button', { name: '시작' }).click();
  await alert('Error', 'PIN은 숫자 4자리').waitFor();
  await page.getByRole('textbox', { name: 'PIN (숫자 4자리)' }).fill('1234');
  await page.getByRole('button', { name: '시작' }).click();

  // ---------- 30문제 ----------
  let answered = 0;
  for (const category of ['market', 'tech', 'product']) {
    for (let i = 0; i < 10; i += 1) {
      answered += 1;
      await waitCaption(`전체 ${answered} / 30`);
      const { q, labels } = await freshQuestion();

      if (answered === 1) {
        // S-04: 타이머 표시 → 6초 기다리면 자동으로 시간 초과 피드백
        check(await page.locator('.st-key-timer', { hasText: /남은 시간 [1-5]초/ }).count() > 0, '타이머 표시 없음');
        await sleep(6000);
        const timedOut = await alert('Warning', '시간 초과').count();
        check(timedOut > 0, '6초가 지나도 시간 초과 처리가 안 됨');
        log.push(`1번 문제: 6초 대기 → ${timedOut ? '시간 초과 피드백' : '변화 없음'}`);
        // 피드백 화면에서는 타이머가 멈춘다: 6초 더 있어도 그대로
        await sleep(6000);
        check(await alert('Warning', '시간 초과').count() > 0 && await page.getByText('다음 문제').count() > 0,
          '피드백 화면에서 타이머가 계속 흐름');
      } else {
        const answer = q.choices[q.answerIndex];
        const correct = i < 6;
        const target = correct ? labels.find((l) => l.slice(3) === answer) : labels.find((l) => l.slice(3) !== answer);
        await page.getByRole('button', { name: target, exact: true }).dblclick(); // 연타는 한 번만 채점
        const verdict = correct ? alert('Success', '정답!') : alert('Error', '오답');
        await verdict.waitFor({ timeout: 5000 }).catch(() => issues.push(`${q.id}: ${correct ? '정답' : '오답'} 피드백 없음`));
        check(await page.getByText(q.explanation).count() > 0, `${q.id}: 해설 없음`);
        check(await page.getByText(/응답 시간 \d\.\d초/).count() > 0, `${q.id}: 응답 시간 표시 없음`);
      }
      const next = i < 9 ? '다음 문제' : category === 'product' ? '최종 결과 보기' : `${NAMES[category]} 결과 보기`;
      await page.getByRole('button', { name: next }).click();
    }
    if (category !== 'product') {
      await page.getByRole('heading', { name: `${NAMES[category]} 결과` }).waitFor();
      const metrics = await page.locator('[data-testid="stMetricValue"]').allInnerTexts();
      const expected = category === 'market' ? '50점' : '60점';
      check(metrics[0] === expected, `${NAMES[category]} 점수 ${metrics[0]} (기대 ${expected})`);
      log.push(`${NAMES[category]} 결과: ${metrics.join(' | ')}`);
      await page.getByRole('button', { name: /다음 분야/ }).click();
    }
  }

  // ---------- 최종 ----------
  await page.getByRole('heading', { name: '최종 결과' }).waitFor();
  const final = await page.locator('[data-testid="stMetricValue"]').allInnerTexts();
  log.push(`최종: ${final.join(' | ')}`);
  check(final[0] === '170점 / 300점', `합계 ${final[0]} (기대 170점 / 300점)`);
  await alert('Success', '현재 순위').waitFor().catch(() => issues.push('최종: 순위 표시 없음'));
  log.push(`순위: ${await alert('Success', '현재 순위').innerText().catch(() => '없음')}`);
  await page.getByText(/오답분석이 설정되지 않았습니다|오답분석을 불러오지 못했습니다/).first().waitFor({ timeout: 20000 })
    .catch(() => issues.push('최종: 오답분석 안내 없음'));
  // 정답 17개(시장 5 + 기술 6 + 제품 6) → 오답·시간 초과 13개
  check(await page.getByText('오답 다시보기 (13문제)').count() > 0, '오답 다시보기 개수(13) 불일치');
  await page.screenshot({ path: 'screenshots/speed-step2-final-390.png', fullPage: true });

  // ---------- 순위표 ----------
  await page.getByRole('button', { name: '순위표' }).click();
  await page.getByRole('heading', { name: '순위 확인' }).waitFor();
  const grid = await page.locator('[data-testid="stDataFrame"]').first().innerText().catch(() => '');
  check(await page.getByText(`${nick} 님은 현재`).count() > 0, '순위표: 내 순위 안내 없음');
  log.push(`순위표 표시: ${grid ? '있음' : '없음(캔버스 렌더링일 수 있음)'}`);

  // ---------- 같은 닉네임 재참가(새 세션) ----------
  const other = await page.context().newPage();
  await other.goto(APP);
  await other.getByRole('button', { name: '1. 새 게임' }).click();
  await other.getByLabel('순위표에 표시될 이름 (2~12자)').fill(nick);
  await other.getByRole('textbox', { name: 'PIN (숫자 4자리)' }).fill('9999');
  await other.getByRole('button', { name: '시작' }).click();
  const wrongPin = await other.locator('[data-testid="stAlertContentError"]', { hasText: 'PIN이 맞지 않습니다' }).first()
    .waitFor({ timeout: 8000 }).then(() => true).catch(() => false);
  check(wrongPin, '다른 PIN으로 같은 닉네임 사용이 막히지 않음');
  await other.getByRole('textbox', { name: 'PIN (숫자 4자리)' }).fill('1234');
  await other.getByRole('button', { name: '시작' }).click();
  const rightPin = await other.locator('[data-testid="stCaptionContainer"]', { hasText: '전체 1 / 30' }).first()
    .waitFor({ timeout: 8000 }).then(() => true).catch(() => false);
  check(rightPin, '맞는 PIN으로 재참가가 안 됨');
  log.push(`PIN: 틀린 PIN ${wrongPin ? '거부' : '통과(!)'}, 맞는 PIN ${rightPin ? '재참가' : '실패(!)'}`);
  await other.close();

  // ---------- 운영자 마감 ----------
  await page.getByRole('button', { name: '처음으로' }).click();
  await page.getByText('운영자', { exact: true }).click();
  await page.getByRole('textbox', { name: '운영자 비밀번호' }).fill('틀린비번');
  await page.getByRole('textbox', { name: '운영자 비밀번호' }).press('Enter');
  await page.getByText('비밀번호가 맞지 않습니다').waitFor();
  await page.getByRole('textbox', { name: '운영자 비밀번호' }).fill('admin-test');
  await page.getByRole('textbox', { name: '운영자 비밀번호' }).press('Enter');
  await page.getByRole('button', { name: '대회 마감' }).click();
  await page.getByText('대회가 마감되었습니다').first().waitFor();
  check(await page.getByRole('button', { name: '1. 새 게임' }).isDisabled(), '마감 후에도 새 게임 버튼이 켜져 있음');
  await page.getByRole('button', { name: '대회 다시 열기' }).click();
  await page.getByRole('button', { name: '대회 마감' }).waitFor();
  check(await page.getByRole('button', { name: '1. 새 게임' }).isEnabled(), '다시 연 뒤에도 새 게임 버튼이 꺼져 있음');
  log.push('운영자: 틀린 비밀번호 거부, 마감 → 새 게임 차단, 다시 열기 → 복구');

  return { issues, log };
}
