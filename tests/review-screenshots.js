// 4단계 검토: 360 / 768 / 1280px에서 화면 7개 스크린샷 + 가로 넘침 검사.
// Playwright MCP browser_run_code_unsafe의 filename으로 실행한다. 스크린샷은 screenshots/에 저장.
async (page) => {
  const BASE = 'http://localhost:5173/';
  const sleep = (ms) => page.evaluate((m) => new Promise((r) => setTimeout(r, m)), ms);
  const report = [];

  const shoot = async (width, order, name) => {
    await sleep(350); // 애니메이션이 끝난 뒤 찍는다
    const overflow = await page.evaluate(() => {
      const doc = document.documentElement;
      // 화면 밖으로 튀어나간 요소 찾기
      const offenders = [...document.querySelectorAll('body *')]
        .filter((e) => e.offsetParent !== null && e.getBoundingClientRect().right > doc.clientWidth + 1)
        .slice(0, 3)
        .map((e) => `${e.tagName.toLowerCase()}#${e.id}.${e.className}`);
      return { scrollWidth: doc.scrollWidth, clientWidth: doc.clientWidth, offenders };
    });
    const file = `screenshots/${width}-${order}-${name}.png`;
    await page.screenshot({ path: file, fullPage: true });
    report.push({ file, horizontalOverflow: overflow.scrollWidth > overflow.clientWidth, offenders: overflow.offenders });
  };

  const correctPos = () =>
    page.evaluate(() => {
      const text = document.getElementById('quiz-question').textContent;
      const q = window.QUIZ_DATA.tech.find((x) => x.question === text);
      return [...document.querySelectorAll('.choice-text')].map((e) => e.textContent).indexOf(q.choices[q.answerIndex]);
    });

  for (const width of [360, 768, 1280]) {
    await page.setViewportSize({ width, height: width === 360 ? 740 : 900 });
    await page.goto(`${BASE}?s=${Date.now()}`);
    await page.evaluate(() => {
      localStorage.clear();
      localStorage.setItem('steelQuiz.nickname', '검토자');
      const now = Date.now();
      const names = ['포항제철인', '광양후판', '당진고로', '압연마스터', '열연코일', '스테인리스', '전기로장인', 'H빔', '냉연강판러', '조선후판', '철근콘크리트'];
      localStorage.setItem('steelQuiz.records', JSON.stringify(names.map((n, i) => ({
        nickname: n, category: 'tech', score: 100 - Math.floor(i / 4) * 10, correctCount: 10 - Math.floor(i / 4), total: 10, durationSec: 300 + i * 13, recordedAt: now - i * 86400000,
      }))));
    });
    await page.reload();
    await page.waitForSelector('#screen-home:not([hidden])');
    await shoot(width, 1, 'home');

    await page.click('#btn-change-nickname');
    await page.fill('#nickname-input', 'a');
    await page.click('#btn-nickname-submit');
    await shoot(width, 2, 'nickname-error');
    await page.click('#btn-nickname-cancel');

    await page.click('.category-btn[data-category="tech"]');
    const N = await page.evaluate(() => QUESTIONS_PER_ROUND);
    const half = Math.floor(N / 2);
    for (let i = 0; i < half; i += 1) {
      const pos = await correctPos();
      await page.locator('.choice-btn').nth(i % 3 === 0 ? (pos + 1) % 4 : pos).click();
      await page.click('#btn-next');
    }
    const pos = await correctPos();
    await page.locator('.choice-btn').nth((pos + 1) % 4).click();
    await shoot(width, 3, 'quiz-feedback-wrong');

    await page.click('#btn-quit');
    await shoot(width, 4, 'quit-dialog');
    await page.click('#btn-quit-cancel');

    await page.click('#btn-next');
    for (let i = half + 1; i < N; i += 1) {
      const p = await correctPos();
      if (i === N - 1) await page.evaluate(() => { state.session.startedAt -= 400000; });
      await page.locator('.choice-btn').nth(i % 4 === 0 ? (p + 1) % 4 : p).click();
      await page.click('#btn-next');
    }
    await sleep(700);
    await shoot(width, 5, 'result');

    await page.click('#btn-review');
    await shoot(width, 6, 'review');
    await page.click('#btn-review-back');

    await page.click('#btn-result-ranking');
    await shoot(width, 7, 'ranking');
  }
  return report;
}
