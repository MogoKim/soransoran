/**
 * 위기 신호(자해 · 자살) — 🔴 순수 판정. 발행하지 않는다
 *
 * 정본: `docs/operations/2026-08-30-persona-safety-originality-gate-design.md` §4
 *
 * 🔴 **왜 필요한가** (2026-09-16 실측). 정본 §4 는 자해·자살을 **생성 전 선행 차단**(`crisis_hold`)으로 못박아 두었는데
 *    코드에는 그 축이 없었다. *"아침부터 자꾸만 그런 생각이 …"* + *"우리 애들 좀 봐 줄 수 있어?"* 가 사유 0건으로 큐까지 올라왔다.
 *
 * 🔴 **단일 모호 표현 하나로 막지 않는다.** *"그런 생각이 들었다"* 한 줄, *"애들 좀 봐줘"* 한 줄은 일상에서 그대로 쓰는 말이다.
 *    간접 신호는 **서로 다른 갈래가 둘 이상 겹칠 때만** 센다. 명시 표현만 단독으로 센다.
 *
 * 🔴 **의료 낱말은 여기서 보지 않는다.** 의료 판단 요청 · 건강 효능 주장을 낱말로 잡던 판정은 지웠다 —
 *    갱년기 · 병원 · 약 이야기는 우리 고객의 핵심 소재이고, 위험한 의료 지시는 모델 판정이 본다.
 *
 * 🔴 **여기서 특정 글 · Persona · 제목을 박지 않는다.** 규칙만 둔다.
 */

/**
 * 🔴 **판정 계약의 판.** 규칙이 바뀌면 올린다 —
 *    품질 캐시 key 가 이 값을 담아, 옛 판정이 조용히 재사용되지 않는다.
 */
export const SAFETY_SIGNAL_VERSION = 'safety-signals-v1'

/**
 * 🔴 사유 코드 — **deterministic 판정과 semantic 판정이 같은 이름을 쓴다.**
 *    두 단계가 다른 이름을 쓰면 언젠가 한쪽만 고쳐진다(실제로 갈라진 적이 있다).
 */
export const SAFETY_SIGNAL_CODES = ['crisisSignal'] as const
export type SafetySignalCode = (typeof SAFETY_SIGNAL_CODES)[number]

export type SafetySignal = {
  code: SafetySignalCode
  /** 🔴 사람이 읽는 한 줄. 원문을 담지 않는다 — 어느 갈래가 걸렸는지만 */
  note: string
}

/**
 * 🔴 **명시 위기 표현.** 하나만 있어도 센다 — 에둘러 읽을 여지가 없다.
 */
const CRISIS_EXPLICIT =
  /자살|자해|극단적? ?선택|죽고 ?싶|죽어 ?버리|목숨을? ?끊|세상을 ?등지|살고 ?싶지 ?않|살기 ?싫/

/**
 * 🔴 **간접 신호는 갈래로 나눠 센다.** 서로 **다른 갈래가 둘 이상** 겹칠 때만 위기로 본다.
 *    한 갈래만 걸린 글은 그대로 통과시킨다 — 그러지 않으면 평범한 하소연이 전부 막힌다.
 */
const CRISIS_INDIRECT: readonly { group: string; re: RegExp }[] = [
  // ① 막연한 '그 생각' — 🔴 단독으로는 아무것도 아니다
  { group: '막연한 생각', re: /그런 ?생각이|그 ?생각이 ?(들|나)|이상한 ?생각|안 ?좋은 ?생각/ },
  // ② 뒷일을 맡김 — 유언에 가까운 부탁
  { group: '뒷일 부탁', re: /(애들|아이들|아이|자식)\s*(좀)?\s*(봐|맡아|부탁)|뒷일을? ?부탁|내가 ?없으면/ },
  // ③ 소멸 욕구
  { group: '사라지고 싶음', re: /사라지고 ?싶|없어지고 ?싶|증발하고 ?싶|그만 ?살/ },
  // ④ 무가치·짐
  { group: '짐이라는 느낌', re: /짐만 ?되|짐이 ?되는|쓸모 ?없는 ?사람|없는 ?게 ?나[은을]/ },
  // ⑤ 작별·정리
  { group: '정리·작별', re: /마지막으로 ?인사|정리해 ?두[었고]|유서|남기고 ?싶은 ?말/ },
]

const joined = (input: SafetyInputText): string =>
  [input.title, input.body ?? '', ...(input.comments ?? [])].join('\n')

export type SafetyInputText = {
  title: string
  body?: string
  comments?: readonly string[]
}

/**
 * 🔴 **자해 · 자살 위기 신호.** 명시 표현 하나, 또는 **서로 다른 간접 갈래 둘 이상**.
 *
 *    감지되면 자동 채택 · Queue 적재 · 재생성 어느 것도 하지 않는다 —
 *    `crisis_hold` 로 남기고 사람이 본다(§4). 봇이 위로하려다 상황을
 *    악화시키는 것이 최악이다.
 */
export function judgeCrisisSignal(input: SafetyInputText): SafetySignal | null {
  const text = joined(input)
  if (CRISIS_EXPLICIT.test(text)) {
    return { code: 'crisisSignal', note: '위기 신호(명시 표현)' }
  }
  const hits = CRISIS_INDIRECT.filter((g) => g.re.test(text)).map((g) => g.group)
  // 🔴 하나만으로는 세지 않는다 — 평범한 하소연이 전부 막힌다
  if (hits.length >= 2) {
    return { code: 'crisisSignal', note: `위기 신호(간접 ${hits.length}갈래: ${hits.join('·')})` }
  }
  return null
}
