// 정답 위치(answerIndex) 분포 확인·재배치.
// 실행:
//   node scripts/answer-balance.js                 # 전체 카테고리 분포 확인
//   node scripts/answer-balance.js tech market     # 일부 카테고리만
//   node scripts/answer-balance.js --fix           # 치우쳐 있으면 정답 위치를 옮겨 파일 수정
//   node scripts/answer-balance.js --fix --dir <폴더>  # 다른 폴더의 data 파일로 시험 (원본 보호)
//
// 균형 기준: 카테고리 전체와 난이도(easy/normal/hard)별 묶음 각각에서, 네 위치(0~3)의 정답 수 차이(최대 - 최소)가 1 이하.
// 게임은 보기를 섞어서 보여 주므로 플레이에는 영향이 없다. 데이터를 읽는 사람에게 정답이 드러나지 않게 하고,
// 보기 섞기 로직이 망가졌을 때 정답이 한 위치에 몰리는 것을 막기 위한 정리다.
//
// 재배치 규칙
// - 난이도 묶음마다 위치별 목표 개수를 정한다. 묶음 목표를 합치면 카테고리 목표가 되도록 나머지를 나눠 준다.
// - 이미 목표보다 적은 위치에 정답이 있는 문항은 그대로 둔다(최소 수정). 넘치는 위치의 문항만 옮긴다.
// - 일반 문항은 정답 보기만 새 위치로 옮기고 나머지 보기의 순서는 유지한다.
// - 보기 4개가 모두 숫자를 포함하고 오름차순·내림차순인 문항(예: 약 30%/50%/70%/90%)은 순서가 의미 있으므로
//   순서를 뒤집는 것만 허용한다. 그러면 정답 위치는 i 또는 3-i 두 곳 중 하나가 된다.
// - 어느 문항을 어느 위치로 옮길지는 id로 정한 난수라 매번 같은 결과가 나온다.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const CATEGORIES = ['market', 'tech', 'product'];
const ALIASES = {
  시장: 'market', market: 'market', mkt: 'market',
  기술: 'tech', tech: 'tech', tec: 'tech',
  제품: 'product', product: 'product', prd: 'product',
  전체: 'all', all: 'all',
};
const POSITIONS = 4;

// ---------- 인자 ----------
const args = process.argv.slice(2);
const fix = args.includes('--fix');
const dirIndex = args.indexOf('--dir');
const dataDir = dirIndex !== -1 ? path.resolve(args[dirIndex + 1]) : path.join(__dirname, '..', 'data');
const names = args.filter((a, i) => !a.startsWith('--') && (dirIndex === -1 || i !== dirIndex + 1));
let targets = CATEGORIES;
if (names.length) {
  const mapped = names.map((n) => ALIASES[n.trim().toLowerCase()]);
  if (mapped.some((m) => !m)) {
    console.error(`알 수 없는 카테고리: ${names.join(', ')}\n쓸 수 있는 값: 시장|market, 기술|tech, 제품|product, 전체|all`);
    process.exit(2);
  }
  targets = mapped.includes('all') ? CATEGORIES : [...new Set(mapped)];
}

// ---------- 도구 ----------
function loadCategory(category) {
  const file = path.join(dataDir, `${category}.js`);
  const context = { window: {} };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: file });
  return { file, list: context.window.QUIZ_DATA[category] };
}

// id 문자열로 정한 0 이상 1 미만의 수 (FNV-1a 해시)
function seeded(text) {
  let h = 2166136261;
  for (const ch of text) {
    h ^= ch.codePointAt(0);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}

function isOrdered(choices) {
  const nums = choices.map((c) => {
    const m = String(c).match(/-?\d+(?:[.,]\d+)?/);
    return m ? parseFloat(m[0].replace(',', '')) : null;
  });
  if (nums.some((n) => n === null)) return false;
  const asc = nums.every((n, i) => i === 0 || n > nums[i - 1]);
  const desc = nums.every((n, i) => i === 0 || n < nums[i - 1]);
  return asc || desc;
}

function counts(list) {
  const c = Array(POSITIONS).fill(0);
  list.forEach((q) => { c[q.answerIndex] += 1; });
  return c;
}

const isBalanced = (c) => Math.max(...c) - Math.min(...c) <= 1;
const DIFFICULTIES = ['easy', 'normal', 'hard'];
const range = [...Array(POSITIONS).keys()];

// 카테고리 목표와, 그 합이 되도록 나눈 난이도 묶음별 목표를 만든다.
// 나머지(n % 4)는 지금 정답이 많은 위치에 먼저 줘서 옮길 문항 수를 줄인다.
function groupQuotas(list) {
  const current = counts(list);
  const catQ = Array(POSITIONS).fill(Math.floor(list.length / POSITIONS));
  [...range].sort((a, b) => current[b] - current[a] || a - b)
    .slice(0, list.length % POSITIONS)
    .forEach((p) => { catQ[p] += 1; });

  const groups = DIFFICULTIES.map((d) => list.filter((q) => q.difficulty === d)).filter((g) => g.length);
  const need = [...catQ];
  const quotas = groups.map((g) => {
    const q = Array(POSITIONS).fill(Math.floor(g.length / POSITIONS));
    q.forEach((v, p) => { need[p] -= v; });
    return q;
  });
  groups.forEach((g, gi) => {
    const gc = counts(g);
    [...range]
      .sort((a, b) => need[b] - need[a] || gc[b] - gc[a] || a - b)
      .slice(0, g.length % POSITIONS)
      .forEach((p) => { quotas[gi][p] += 1; need[p] -= 1; });
  });
  return groups.map((g, gi) => ({ items: g, quota: quotas[gi] }));
}

// 한 묶음 안에서 옮길 문항과 새 위치를 정한다. moves에 id → newIndex를 채운다.
function planGroup({ items, quota }, moves) {
  const kept = Array(POSITIONS).fill(0);
  const movable = [];
  // 순서 고정 문항은 선택지가 둘뿐이라 먼저 자리를 잡는다
  items.filter((q) => isOrdered(q.choices)).forEach((q) => {
    const i = q.answerIndex;
    const flipped = POSITIONS - 1 - i;
    if (kept[i] < quota[i]) kept[i] += 1;
    else if (kept[flipped] < quota[flipped]) { kept[flipped] += 1; moves.set(q.id, flipped); }
    else kept[i] += 1; // 둘 다 찼으면 그대로 둔다(묶음 균형이 1 넘게 어긋날 수 있음)
  });
  items.filter((q) => !isOrdered(q.choices)).forEach((q) => {
    if (kept[q.answerIndex] < quota[q.answerIndex]) kept[q.answerIndex] += 1;
    else movable.push(q);
  });
  movable
    .sort((a, b) => seeded(a.id) - seeded(b.id))
    .forEach((q) => {
      const open = range.filter((p) => kept[p] < quota[p]);
      if (!open.length) return;
      const target = open[Math.floor(seeded(`${q.id}:pos`) * open.length)];
      kept[target] += 1;
      moves.set(q.id, target);
    });
}

function plan(list) {
  const moves = new Map();
  groupQuotas(list).forEach((g) => planGroup(g, moves));
  return moves;
}

// 정답을 target 위치로 옮긴 새 보기 배열. 순서 고정 문항은 뒤집기만 한다.
function moveAnswer(item, target) {
  if (isOrdered(item.choices)) return [...item.choices].reverse();
  const answer = item.choices[item.answerIndex];
  const others = item.choices.filter((_, i) => i !== item.answerIndex);
  others.splice(target, 0, answer);
  return others;
}

// 카테고리와 난이도 묶음이 모두 균형인가
function fullyBalanced(list) {
  return isBalanced(counts(list)) &&
    DIFFICULTIES.every((d) => {
      const sub = list.filter((q) => q.difficulty === d);
      return !sub.length || isBalanced(counts(sub));
    });
}

const quote = (s) => `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

// 파일에서 해당 id 블록의 choices 줄과 answerIndex 줄만 바꾼다. 나머지 글자는 그대로 둔다.
function rewrite(source, id, choices, answerIndex) {
  const start = source.indexOf(`id: '${id}'`);
  if (start === -1) throw new Error(`${id}: 파일에서 찾지 못함`);
  const end = source.indexOf('difficulty:', start);
  const block = source.slice(start, end);
  const next = block
    .replace(/choices: \[.*\],/, `choices: [${choices.map(quote).join(', ')}],`)
    .replace(/answerIndex: \d+,/, `answerIndex: ${answerIndex},`);
  if (next === block) throw new Error(`${id}: choices/answerIndex 줄 형식을 찾지 못함`);
  return source.slice(0, start) + next + source.slice(end);
}

const fmt = (c) => c.map((v, i) => `${i + 1}번 ${String(v).padStart(2)}`).join(' · ');
const mark = (c) => (isBalanced(c) ? '균형' : '치우침');

function report(title, list) {
  const c = counts(list);
  console.log(`${title} ${list.length}문제  ${fmt(c)}  → ${mark(c)}`);
  DIFFICULTIES.forEach((d) => {
    const sub = list.filter((q) => q.difficulty === d);
    if (sub.length) console.log(`  ${d.padEnd(6)} ${String(sub.length).padStart(2)}문제  ${fmt(counts(sub))}  → ${mark(counts(sub))}`);
  });
}

// ---------- 실행 ----------
let anyUnbalanced = false;
let failed = false;
for (const category of targets) {
  const { file, list } = loadCategory(category);
  console.log('');
  report(`[${category}]`, list);
  const locked = list.filter((q) => isOrdered(q.choices)).map((q) => q.id);
  if (locked.length) console.log(`  순서 고정(숫자 보기, 뒤집기만 허용) ${locked.length}개: ${locked.join(', ')}`);

  if (fullyBalanced(list)) continue;
  anyUnbalanced = true;
  if (!fix) continue;

  const moves = plan(list);
  const original = fs.readFileSync(file, 'utf8');
  let source = original;
  const changes = [];
  for (const item of list) {
    if (!moves.has(item.id) || moves.get(item.id) === item.answerIndex) continue;
    const target = moves.get(item.id);
    source = rewrite(source, item.id, moveAnswer(item, target), target);
    changes.push(`${item.id} ${item.answerIndex + 1}번→${target + 1}번${isOrdered(item.choices) ? '(뒤집기)' : ''}`);
  }
  fs.writeFileSync(file, source);

  // 자체 검증: 다시 읽어서 정답 문장·보기 집합·질문·해설이 그대로인지 확인. 하나라도 어긋나면 원래 파일로 되돌린다.
  const { list: after } = loadCategory(category);
  const byId = new Map(list.map((q) => [q.id, q]));
  const problems = after.filter((q) => {
    const old = byId.get(q.id);
    return (
      !old ||
      q.choices[q.answerIndex] !== old.choices[old.answerIndex] ||
      [...q.choices].sort().join('|') !== [...old.choices].sort().join('|') ||
      q.question !== old.question || q.explanation !== old.explanation || q.difficulty !== old.difficulty
    );
  });
  if (problems.length || after.length !== list.length) {
    fs.writeFileSync(file, original);
    failed = true;
    console.log(`  오류: 정답이나 보기가 바뀐 문항 ${problems.map((q) => q.id).join(', ')} → 원래 파일로 되돌렸습니다`);
    continue;
  }
  console.log(`  수정 ${changes.length}개: ${changes.join(', ') || '없음'}`);
  report('  수정 후', after);
  if (!fullyBalanced(after)) console.log('  일부 묶음이 아직 치우쳤습니다. 순서 고정 문항이 한 위치에 몰린 경우입니다.');
}

if (failed) process.exit(1);
if (anyUnbalanced && !fix) {
  console.log('\n치우친 카테고리가 있습니다. 고치려면 --fix를 붙여 다시 실행하세요.');
  process.exit(3);
}
console.log(fix ? '\n완료' : '\n모든 대상 카테고리가 균형입니다.');
