// 4단계 검토: 실제 마우스·키보드 입력과 엣지 케이스.
// Playwright MCP browser_run_code_unsafe의 filename으로 실행한다. 결과는 JSON으로 반환.
async (page) => {
  const BASE = 'http://localhost:5173/';
  const out = {};
  // 이 실행 환경에는 setTimeout이 없어(page.waitForTimeout도 실패) 대기는 브라우저 안에서 한다
  const sleep = (ms) => page.evaluate((m) => new Promise((r) => setTimeout(r, m)), ms);
  // 한 판 문제 수는 앱 상수에서 읽는다 (페이지가 열린 뒤 호출)
  const roundSize = () => page.evaluate(() => QUESTIONS_PER_ROUND);

  async function fresh(nickname = '검토자', viewport = { width: 1280, height: 900 }) {
    await page.setViewportSize(viewport);
    await page.goto(`${BASE}?r=${Date.now()}`);
    await page.evaluate((n) => {
      localStorage.clear();
      if (n) localStorage.setItem('steelQuiz.nickname', n);
    }, nickname);
    await page.reload();
    await page.waitForSelector('#screen-home:not([hidden])');
  }

  // 화면에 보이는 문제 문장으로 정답 보기의 위치를 찾는다
  const correctPos = () =>
    page.evaluate(() => {
      const text = document.getElementById('quiz-question').textContent;
      const all = [...window.QUIZ_DATA.market, ...window.QUIZ_DATA.tech, ...window.QUIZ_DATA.product];
      const q = all.find((x) => x.question === text);
      const choices = [...document.querySelectorAll('.choice-text')].map((e) => e.textContent);
      return choices.indexOf(q.choices[q.answerIndex]);
    });

  const snap = () =>
    page.evaluate(() => ({
      screen: currentScreen,
      index: state.session ? state.session.index : null,
      answered: state.session && state.session.items[state.session.index] ? state.session.items[state.session.index].pickedPos !== null : null,
      progress: document.getElementById('quiz-progress').textContent,
    }));

  // 일부만 다시 돌릴 때 검사 이름을 넣는다 (null이면 전체)
  const ONLY = null;

  const run = async (name, fn) => {
    if (ONLY && !ONLY.includes(name)) return;
    try {
      await page.waitForLoadState('load');
      out[name] = await fn();
    } catch (e) {
      out[name] = { error: String(e).slice(0, 300) };
    }
  };

  // 1. 키보드만으로 한 판 완주 (Tab → Enter → 숫자 → Enter)
  await run('keyboardOnly', async () => {
    await fresh();
    let tabs = 0;
    let focusRing = null;
    while (tabs < 15) {
      await page.keyboard.press('Tab');
      tabs += 1;
      const info = await page.evaluate(() => ({
        cat: document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.category : null,
        shadow: getComputedStyle(document.activeElement).boxShadow,
      }));
      if (info.cat === 'market') {
        focusRing = info.shadow;
        break;
      }
    }
    await page.keyboard.press('Enter');
    const N = await roundSize();
    for (let i = 0; i < N; i += 1) {
      const pos = await correctPos();
      if (i === N - 1) await page.evaluate(() => { state.session.startedAt -= 90000; });
      await page.keyboard.press(String(pos + 1));
      await page.keyboard.press('Enter');
    }
    const result = await page.evaluate(() => ({
      screen: currentScreen,
      score: document.getElementById('result-score').textContent,
      reviewDisabled: document.getElementById('btn-review').disabled,
      gaugeOffset: document.getElementById('result-gauge').style.strokeDashoffset,
    }));
    await sleep(100);
    const gaugeAfter = await page.evaluate(() => document.getElementById('result-gauge').style.strokeDashoffset);
    return { tabsToFirstCategory: tabs, focusRingVisible: focusRing && focusRing !== 'none', result, gaugeAfter };
  });

  // 2. 피드백 중 빠른 키 연타
  await run('rapidKeys', async () => {
    await fresh();
    await page.click('.category-btn[data-category="tech"]');
    await page.keyboard.press('1');
    await page.keyboard.press('2');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    const s = await snap();
    await page.keyboard.press('3');
    await page.keyboard.press('4');
    const picked = await page.evaluate(() => state.session.items[1].pickedPos);
    return { afterEnters: s, secondQuestionPicked: picked };
  });

  // 3. '다음 문제' 더블클릭: 다음 문제의 보기가 잘못 눌리는지
  await run('doubleClickNext', async () => {
    const results = {};
    for (const vp of [{ width: 1280, height: 900 }, { width: 360, height: 740 }]) {
      await fresh('검토자', vp);
      await page.click('.category-btn[data-category="product"]');
      let accidental = 0;
      let skipped = 0;
      const N = await roundSize();
      for (let i = 0; i < N - 1; i += 1) {
        const pos = await correctPos();
        await page.locator('.choice-btn').nth(pos).click();
        const before = await snap();
        const box = await page.locator('#btn-next').boundingBox();
        await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
        const after = await snap();
        if (after.index > before.index + 1) skipped += 1;
        if (after.answered) {
          accidental += 1;
          await page.click('#btn-next');
        }
      }
      results[`${vp.width}x${vp.height}`] = { transitions: N - 1, accidentalAnswers: accidental, skippedQuestions: skipped };
    }
    return results;
  });

  // 4. 모바일: 다음 문제로 넘어간 뒤 스크롤 위치
  await run('mobileScrollAfterNext', async () => {
    await fresh('검토자', { width: 360, height: 640 });
    await page.click('.category-btn[data-category="tech"]');
    const samples = [];
    for (let i = 0; i < 8; i += 1) {
      await page.locator('.choice-btn').first().click();
      await page.click('#btn-next');
      await sleep(50);
      samples.push(
        await page.evaluate(() => ({
          scrollY: Math.round(window.scrollY),
          questionTop: Math.round(document.getElementById('quiz-question').getBoundingClientRect().top),
          headerVisible: document.querySelector('.quiz-header').getBoundingClientRect().bottom > 0,
        }))
      );
    }
    return { hiddenQuestionCount: samples.filter((s) => s.questionTop < 0).length, samples };
  });

  // 5. 게임 중 브라우저 뒤로가기 / 새로고침
  await run('backAndRefresh', async () => {
    await page.goto('about:blank');
    await fresh();
    await page.click('.category-btn[data-category="market"]');
    for (let i = 0; i < 3; i += 1) {
      await page.locator('.choice-btn').first().click();
      await page.click('#btn-next');
    }
    await page.goBack();
    const urlAfterBack = page.url();
    await page.goForward();
    await page.waitForSelector('#app');
    const afterForward = await page.evaluate(() => ({ screen: currentScreen, hasSession: !!state.session }));

    await page.click('.category-btn[data-category="market"]');
    for (let i = 0; i < 5; i += 1) {
      await page.locator('.choice-btn').first().click();
      await page.click('#btn-next');
    }
    let dialogShown = false;
    page.once('dialog', (d) => { dialogShown = true; d.dismiss(); });
    await page.reload();
    const afterReload = await page.evaluate(() => ({ screen: currentScreen, hasSession: !!state.session, records: localStorage.getItem('steelQuiz.records') }));
    return { urlAfterBack, afterForward, unloadWarning: dialogShown, afterReload };
  });

  // 6. localStorage를 직접 고친 경우
  await run('tamperedStorage', async () => {
    await fresh(null);
    await page.evaluate(() => {
      localStorage.setItem('steelQuiz.nickname', '관리자' + 'A'.repeat(40));
      localStorage.setItem('steelQuiz.records', JSON.stringify([
        { nickname: '해커', category: 'market', score: 99999, correctCount: 9999, total: 10, durationSec: 1, recordedAt: Date.now() },
        { nickname: 42, category: 'market', score: 10, durationSec: 50, recordedAt: 1 },
        'garbage',
      ]));
    });
    await page.reload();
    const home = await page.evaluate(() => document.getElementById('home-nickname').textContent);
    await page.click('.category-btn[data-category="market"]');
    const startedWithBadNickname = await page.evaluate(() => currentScreen === 'quiz');
    await page.evaluate(() => { quitDialog.showModal(); });
    await page.click('#btn-quit-confirm');
    await page.click('#btn-home-ranking');
    const rows = await page.evaluate(() => [...document.querySelectorAll('#ranking-body tr')].map((tr) => tr.textContent));

    await page.evaluate(() => localStorage.setItem('steelQuiz.records', '{not json'));
    await page.reload();
    await page.click('#btn-home-ranking');
    const brokenJson = await page.evaluate(() => ({ empty: !document.getElementById('ranking-empty').hidden }));
    return { homeNickname: home, startedWithBadNickname, rankingRows: rows, brokenJson };
  });

  // 7. 0점 판과 만점 판 (정상 소요 시간)
  await run('zeroAndFull', async () => {
    const res = {};
    for (const [label, correct] of [['zero', false], ['full', true]]) {
      await fresh('검토자');
      await page.click('.category-btn[data-category="market"]');
      const N = await roundSize();
      for (let i = 0; i < N; i += 1) {
        const pos = await correctPos();
        if (i === N - 1) await page.evaluate(() => { state.session.startedAt -= 200000; });
        await page.locator('.choice-btn').nth(correct ? pos : (pos + 1) % 4).click();
        await page.click('#btn-next');
      }
      await sleep(900);
      res[label] = await page.evaluate(() => ({
        score: document.getElementById('result-score').textContent,
        accuracy: document.getElementById('result-accuracy').textContent,
        rank: document.getElementById('result-rank').textContent,
        reviewDisabled: document.getElementById('btn-review').disabled,
        gaugeOffset: Number(document.getElementById('result-gauge').style.strokeDashoffset).toFixed(1),
        saved: JSON.parse(localStorage.getItem('steelQuiz.records') || '[]').map((r) => r.score),
      }));
      if (label === 'zero') {
        await page.click('#btn-review');
        res.zero.reviewCount = await page.locator('.review-item').count();
      }
    }
    return res;
  });

  // 8. 긴 닉네임·특수문자 레이아웃 (360px)
  await run('longNicknameLayout', async () => {
    await fresh(null, { width: 360, height: 740 });
    await page.click('.category-btn[data-category="tech"]');
    await page.fill('#nickname-input', 'WWWWWWWWWWWW');
    await page.click('#btn-nickname-submit');
    await page.evaluate(() => { quitDialog.showModal(); });
    await page.click('#btn-quit-confirm');
    await page.evaluate(() => {
      localStorage.setItem('steelQuiz.records', JSON.stringify([
        { nickname: 'WWWWWWWWWWWW', category: 'tech', score: 100, correctCount: 10, total: 10, durationSec: 3725, recordedAt: Date.now() },
        { nickname: '<script>x</script>', category: 'tech', score: 90, correctCount: 9, total: 10, durationSec: 100, recordedAt: Date.now() },
      ]));
      renderHome();
    });
    const home = await page.evaluate(() => ({ docScroll: document.documentElement.scrollWidth, nickOverflow: document.getElementById('home-nickname').scrollWidth > document.getElementById('home-nickname').clientWidth }));
    await page.screenshot({ path: 'screenshots/edge-long-nickname-home-360.png', fullPage: true });
    await page.click('#btn-home-ranking');
    await page.click('.tab[data-category="tech"]');
    const ranking = await page.evaluate(() => ({
      docScroll: document.documentElement.scrollWidth,
      scripts: document.querySelectorAll('#ranking-body script').length,
      cells: [...document.querySelectorAll('#ranking-body tr')].map((tr) => [...tr.children].map((td) => td.textContent).join(' | ')),
    }));
    await page.screenshot({ path: 'screenshots/edge-long-nickname-ranking-360.png', fullPage: true });
    return { home, ranking };
  });

  // 9. 성능: 첫 화면 로딩, 피드백 반응 시간
  await run('performance', async () => {
    await fresh('검토자');
    const nav = await page.evaluate(() => {
      const n = performance.getEntriesByType('navigation')[0];
      const fcp = performance.getEntriesByName('first-contentful-paint')[0];
      return { domContentLoaded: Math.round(n.domContentLoadedEventEnd), load: Math.round(n.loadEventEnd), fcp: fcp ? Math.round(fcp.startTime) : null };
    });
    await page.click('.category-btn[data-category="market"]');
    const feedbackMs = await page.evaluate(() => {
      const t0 = performance.now();
      document.querySelector('.choice-btn').click();
      const visible = !document.getElementById('quiz-feedback').hidden;
      return { ms: +(performance.now() - t0).toFixed(2), visible };
    });
    return { nav, feedbackMs };
  });

  // 10. 폰트 CDN이 느리거나 막혔을 때
  await run('fontCdn', async () => {
    const measure = async () => {
      const t0 = Date.now();
      await page.goto(`${BASE}?f=${Date.now()}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
      const fcp = await page.evaluate(() => {
        const e = performance.getEntriesByName('first-contentful-paint')[0];
        return e ? Math.round(e.startTime) : null;
      });
      return { domContentLoadedMs: Date.now() - t0, fcp };
    };
    // 페이지가 이동 중이라 그 안에서 기다릴 수 없으므로, 빈 탭을 타이머로 쓴다
    const timer = await page.context().newPage();
    await page.bringToFront();
    try {
      await page.route('**/pretendard*', async (route) => {
        await timer.evaluate(() => new Promise((r) => setTimeout(r, 5000)));
        await route.continue();
      });
      const slow = await measure();
      await page.unrouteAll({ behavior: 'ignoreErrors' });
      await page.route('**/pretendard*', (route) => route.abort());
      const blocked = await measure();
      const fallbackFont = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
      return { slowCdn5s: slow, blockedCdn: blocked, fallbackFont };
    } finally {
      // 남은 가로채기는 이후 모든 페이지 이동을 망가뜨리므로 반드시 해제한다
      await page.unrouteAll({ behavior: 'ignoreErrors' });
      await timer.close();
    }
  });

  return out;
}
