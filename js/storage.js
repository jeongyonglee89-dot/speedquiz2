// localStorage 저장/조회. quiz.js의 compareRecords와 점수·판 크기 상수를 쓴다.
// localStorage를 쓸 수 없으면(사생활 보호 모드, 차단 등) 메모리에만 저장해 게임은 계속 진행된다.
// 이름이 브라우저 내장 window.Storage와 겹치지 않도록 QuizStorage로 둔다.
const QuizStorage = (() => {
  const KEYS = {
    nickname: 'steelQuiz.nickname',
    records: 'steelQuiz.records',
  };
  const memory = {};

  function read(key) {
    try {
      return window.localStorage.getItem(key);
    } catch (e) {
      // 접근 불가일 때만 메모리 값을 쓴다 (사용자가 사이트 데이터를 지웠다면 지운 상태를 따른다)
      return key in memory ? memory[key] : null;
    }
  }

  function write(key, value) {
    memory[key] = value;
    try {
      window.localStorage.setItem(key, value);
    } catch (e) {
      // 저장 불가 → 메모리에만 남는다
    }
  }

  function isRecordShape(r) {
    return (
      r &&
      typeof r.nickname === 'string' &&
      typeof r.category === 'string' &&
      Number.isFinite(r.score) &&
      Number.isFinite(r.durationSec) &&
      Number.isFinite(r.recordedAt)
    );
  }

  // 판 크기(total)가 지금과 다른 기록(예: 예전 40문제 판)은 점수 척도가 달라 순위에서 뺀다.
  // 다음 저장 때 목록에서도 사라진다.
  function getRecords() {
    try {
      const parsed = JSON.parse(read(KEYS.records) || '[]');
      return Array.isArray(parsed) ? parsed.filter((r) => isRecordShape(r) && r.total === QUESTIONS_PER_ROUND) : [];
    } catch (e) {
      return [];
    }
  }

  function setRecords(records) {
    write(KEYS.records, JSON.stringify(records));
  }

  // 비정상 기록이면 사유 문자열, 정상이면 null (PRD 6·7장)
  function invalidReason(result) {
    if (result.correctCount < 0 || result.correctCount > result.total) return '정답 수가 올바르지 않습니다.';
    if (result.score !== result.correctCount * POINTS_PER_CORRECT) return '점수가 올바르지 않습니다.';
    if (result.score > result.maxScore) return '점수가 만점을 넘었습니다.';
    const minDuration = result.total * MIN_SECONDS_PER_QUESTION;
    if (result.durationSec < minDuration) return `소요 시간이 ${minDuration}초 미만입니다.`;
    return null;
  }

  function getRanking(category) {
    return getRecords()
      .filter((r) => r.category === category)
      .sort(compareRecords);
  }

  function getBest(category, nickname) {
    return getRecords().find((r) => r.category === category && r.nickname === nickname) || null;
  }

  function getMyRank(category, nickname) {
    const index = getRanking(category).findIndex((r) => r.nickname === nickname);
    return index === -1 ? null : index + 1;
  }

  // 끝까지 푼 판의 결과를 저장한다. 닉네임별 카테고리 최고 기록 1개만 유지한다.
  // 반환: { saved, reason?, isNewBest, rank } — rank는 이번 기록이 순위표에서 차지하는 자리
  function saveRecord(result, nickname) {
    const reason = invalidReason(result);
    if (reason) return { saved: false, reason, isNewBest: false, rank: null };

    const record = {
      nickname,
      category: result.category,
      score: result.score,
      correctCount: result.correctCount,
      total: result.total,
      durationSec: result.durationSec,
      recordedAt: Date.now(),
    };

    const records = getRecords();
    const existingIndex = records.findIndex((r) => r.category === record.category && r.nickname === nickname);
    const isNewBest = existingIndex === -1 || compareRecords(record, records[existingIndex]) < 0;
    if (isNewBest) {
      if (existingIndex === -1) records.push(record);
      else records[existingIndex] = record;
      setRecords(records);
    }

    const ahead = records.filter(
      (r) => r.category === record.category && r.nickname !== nickname && compareRecords(r, record) < 0
    ).length;
    return { saved: true, isNewBest, rank: ahead + 1 };
  }

  return {
    getNickname: () => read(KEYS.nickname),
    setNickname: (name) => write(KEYS.nickname, name),
    getRanking,
    getBest,
    getMyRank,
    saveRecord,
  };
})();
