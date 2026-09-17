/**
 * 회차 실적 — **무엇이 실제로 일어났는가.**
 *
 * ─────────────────────────────────────────────────────────
 * 🔴 **왜 생겼나** (2026-09-17 실측).
 *
 *    9/17 01:00 로그의 마지막 줄은 이랬다.
 *
 *      [01:00:10] 자동 PR 이 없다 — 할 것이 없다
 *      [01:00:11] 종료 (코드 0)
 *      [01:00:11] **자동 병합 완료**
 *
 *    등록 0건 · PR 0건 · 병합 0건인 회차가 "자동 병합 완료" 로 끝났다.
 *    병합기는 정직하게 "할 것이 없다" 고 적었는데, 그것을 부른 쪽이
 *    **종료 코드 0 을 성공으로 옮겨 적었다.**
 *
 *    무인 운영에서 로그는 유일한 감시 수단이다. 거기서 "완료" 라는 낱말이
 *    보이면 사람은 공급이 돌아간다고 믿는다. 실제로는 사흘째 0건이어도.
 *
 * 🔴 **그래서 단계마다 숫자를 따로 적는다.**
 *    생성 · 등록 · PR · 병합 · 배포 · 공개는 서로 다른 사건이다.
 *    하나가 0 이면 그 뒤는 전부 0 이고, "완료" 라고 부를 수 있는 것은 없다.
 *
 * 🔴 **0 을 성공으로 세지 않는다.** "할 일이 없었다" 는 정상 종료지
 *    **공급 성공이 아니다.** 둘을 다른 낱말로 적는다.
 *
 * 🔴 판정만 한다. 파일도 네트워크도 만지지 않는다.
 */

/** 공급이 실제로 일어났다고 말할 수 있는 최소선 */
export const SUPPLY_STAGES = ['생성', '등록', 'PR', '병합', '배포', '공개']

/**
 * 회차 실적을 만든다.
 *
 * @param {object} p
 * @param {{done?:object[], blocked?:object[], eligible?:number, processed?:number}|null} p.register
 * @param {{pr?:object|null, merged?:boolean, deploy?:object|null, blockedBy?:object[]}|null} p.merge
 * @param {number} [p.produced]  이번 회차에 새로 만들어진 원고 수
 * @returns {{rows:{stage:string,count:number,note:string}[], supplied:boolean, headline:string}}
 */
export function composeLedger({ register = null, merge = null, produced = null } = {}) {
  const done = register?.done ?? []
  const blocked = register?.blocked ?? []
  const prMade = merge?.pr ? 1 : (register?.pr?.made ? 1 : 0)
  const merged = merge?.merged === true ? 1 : 0
  // 🔴 배포·공개는 **병합이 있었을 때만** 셀 수 있다. 병합이 0이면 물어볼 것도 없다.
  const deployed = merged === 1 && merge?.deploy?.outcome === 'SERVED' ? 1 : 0
  const scheduled = merged === 1 ? (merge?.registered?.length ?? done.length) : 0

  const rows = [
    {
      stage: '생성',
      count: produced ?? 0,
      note: produced === null ? '이 회차에서 세지 않는다 (producer 몫)' : `새 원고 ${produced}건`,
    },
    {
      stage: '등록',
      count: done.length,
      note: done.length > 0
        ? done.map((d) => `${d.slug}(${String(d.publishAt ?? '').slice(0, 10)})`).join(', ')
        : `0건 — 막힌 후보 ${blocked.length}건`,
    },
    {
      stage: 'PR',
      count: prMade,
      note: prMade > 0 ? (merge?.pr?.url ?? register?.pr?.url ?? '생성됨') : '만들지 않았다 — 등록된 건이 없다',
    },
    {
      stage: '병합',
      count: merged,
      note: merged > 0
        ? `${String(merge?.mergeCommit ?? '').slice(0, 7)}`
        : prMade > 0 ? '관문에 막혔다' : '대상이 없다 — 병합하지 않았다',
    },
    {
      stage: '배포',
      count: deployed,
      note: merged === 0 ? '대상이 없다' : deployed > 0 ? '운영 도메인 반영 확인' : `확인 실패 (${merge?.deploy?.outcome ?? '조회 못 함'})`,
    },
    {
      stage: '공개',
      count: 0,
      note: scheduled > 0 ? `예약 ${scheduled}건 — publishAt 이후 watch 가 확인한다` : '대상이 없다',
    },
  ]

  // 🔴 **공급 성공의 정의.** 등록·PR·병합·배포가 전부 1 이상일 때만이다.
  const supplied = done.length > 0 && prMade > 0 && merged > 0 && deployed > 0
  const headline = supplied
    ? `공급 성공 — 등록 ${done.length} · 병합 1 · 배포 확인`
    : done.length === 0
      ? `공급 0건 — 등록된 글이 없다 (막힌 후보 ${blocked.length}건)`
      : `공급 미완 — 등록 ${done.length}건이 ${merged === 0 ? '병합' : '배포 확인'}에서 멈췄다`

  return { rows, supplied, headline }
}

/** 로그에 찍을 여러 줄. 🔴 "완료" 라는 낱말은 실제로 공급됐을 때만 쓴다 */
export function formatLedger(ledger) {
  const out = [`실적: ${ledger.headline}`]
  for (const r of ledger.rows) {
    out.push(`  ${r.stage.padEnd(4, ' ')} ${String(r.count).padStart(2, ' ')}건  ${r.note}`)
  }
  return out
}
