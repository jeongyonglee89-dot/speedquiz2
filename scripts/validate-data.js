// 문제 데이터 검증 (PRD 5장). 실행: node scripts/validate-data.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// count: 카테고리별 최소 문제 수 (PRD 5장 기본 40문제). /quiz-add로 문제를 추가하면 이보다 많아질 수 있다.
const EXPECTED = {
  market: { prefix: 'MKT', count: 40 },
  tech: { prefix: 'TEC', count: 40 },
  product: { prefix: 'PRD', count: 40 },
};
// 처음 40문제의 난이도 구성. 문제를 추가하면 달라지므로 경고만 낸다.
const DIFFICULTY_TARGET = { easy: 15, normal: 15, hard: 10 };
const BANNED_CHOICES = ['모두 정답', '정답 없음', '모두 맞다', '보기 없음'];

const context = { window: {} };
vm.createContext(context);
for (const category of Object.keys(EXPECTED)) {
  const file = path.join(__dirname, '..', 'data', `${category}.js`);
  vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: file });
}

const errors = [];
const warnings = [];
const allIds = new Set();
const allQuestions = new Set();
let total = 0;

for (const [category, { prefix, count }] of Object.entries(EXPECTED)) {
  const list = context.window.QUIZ_DATA && context.window.QUIZ_DATA[category];
  if (!Array.isArray(list)) {
    errors.push(`${category}: 데이터 배열이 없음`);
    continue;
  }
  total += list.length;
  if (list.length < count) errors.push(`${category}: 문제 수 ${list.length}개 (최소 ${count}개)`);

  const difficulty = { easy: 0, normal: 0, hard: 0 };
  list.forEach((q, i) => {
    const where = `${category}[${i}] ${q.id || '(id 없음)'}`;
    if (!new RegExp(`^${prefix}-\\d{3}$`).test(q.id)) errors.push(`${where}: id 형식 오류`);
    if (allIds.has(q.id)) errors.push(`${where}: id 중복`);
    allIds.add(q.id);
    if (q.category !== category) errors.push(`${where}: category 값 ${q.category}`);
    if (typeof q.question !== 'string' || !q.question.trim()) errors.push(`${where}: question 비어 있음`);
    if (allQuestions.has(q.question)) errors.push(`${where}: 같은 문제 문장 중복`);
    allQuestions.add(q.question);
    if (!Array.isArray(q.choices) || q.choices.length !== 4) {
      errors.push(`${where}: choices가 4개가 아님`);
    } else {
      if (q.choices.some((c) => typeof c !== 'string' || !c.trim())) errors.push(`${where}: 빈 보기`);
      if (new Set(q.choices).size !== 4) errors.push(`${where}: 보기 중복`);
      if (q.choices.some((c) => BANNED_CHOICES.some((b) => c.includes(b)))) errors.push(`${where}: 금지 보기 사용`);
    }
    if (!Number.isInteger(q.answerIndex) || q.answerIndex < 0 || q.answerIndex > 3) errors.push(`${where}: answerIndex 범위 오류`);
    if (typeof q.explanation !== 'string' || !q.explanation.trim()) errors.push(`${where}: explanation 비어 있음`);
    if (!(q.difficulty in difficulty)) errors.push(`${where}: difficulty 값 ${q.difficulty}`);
    else difficulty[q.difficulty] += 1;
  });

  const diffText = Object.entries(difficulty).map(([k, v]) => `${k} ${v}`).join(' · ');
  const diffOk = Object.entries(DIFFICULTY_TARGET).every(([k, v]) => difficulty[k] === v);
  if (!diffOk) warnings.push(`${category}: 난이도 구성 ${diffText} (처음 구성 easy 15 · normal 15 · hard 10과 다름. /quiz-add로 추가했다면 정상, 아니라면 확인 필요)`);
  console.log(`${category.padEnd(8)} ${String(list.length).padStart(2)}문제  ${diffText}`);
}

console.log(`총 ${total}문제`);
warnings.forEach((w) => console.log(`경고: ${w}`));
if (errors.length) {
  errors.forEach((e) => console.log(`오류: ${e}`));
  process.exit(1);
}
console.log('검증 통과');
