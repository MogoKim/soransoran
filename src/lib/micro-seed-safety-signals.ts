/**
 * 위기 신호 · 의료 판단 요청 · 건강 효능 주장 — 🔴 순수 판정. 발행하지 않는다
 *
 * 정본: `docs/operations/2026-08-30-persona-safety-originality-gate-design.md` §4 · §5
 *
 * 🔴 **왜 필요한가** (2026-09-16 실측).
 *
 *    정본 §4 는 자해·자살을 **생성 전 선행 차단**(`crisis_hold`)으로 못박아 두었다.
 *    그런데 코드에는 그 축이 **한 줄도 없었다** — `SafetyReasonCode` 8종에도,
 *    `SEMANTIC_RISKS` 9종에도 없다. 그래서 아래 초안이 `safetyVerdict=pass` ·
 *    `gateVerdict=PASS` 로 큐까지 올라왔다:
 *
 *      · *"아침부터 자꾸만 그런 생각이 …"* + *"우리 애들 좀 봐 줄 수 있어?"*
 *        → 위기 신호의 전형인데 사유 0건으로 통과
 *      · 의료기기 부작용 · 교체 주기 · **계속 써도 되는지**를 커뮤니티에 물음
 *        → `MEDICAL_CLAIM` 은 `처방|복용법|완치|시술 추천` 만 보므로 통과
 *      · *"무릎에 무리가 없다**고 하고**"* · *"운동 효과는 본다**고**"*
 *        → 전언형이라는 이유로 효능 주장이 그대로 통과
 *
 * 🔴 **소재를 막지 않는다.** 갱년기 · 병원 경험 · 영양제 습관은 타겟 핏이 높은
 *    생활 주제다(§4-J). 막는 것은 **판단을 대신 내려 달라는 요청**과
 *    **효능 단정**, 그리고 **위기 신호**다.
 *
 * 🔴 **단일 모호 표현 하나로 막지 않는다.** *"그런 생각이 들었다"* 한 줄,
 *    *"애들 좀 봐줘"* 한 줄은 일상에서 그대로 쓰는 말이다. 간접 신호는
 *    **서로 다른 갈래가 둘 이상 겹칠 때만** 센다. 명시 표현만 단독으로 센다.
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
export const SAFETY_SIGNAL_CODES = [
  'crisisSignal',
  'medicalDecisionRequest',
  'healthEfficacyClaim',
] as const
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

/**
 * 🔴 **의료 대상** — 치료 · 의료기기 · 약물. 생활 관리(스케일링 · 영양제 · 운동)는
 *    여기 넣지 않는다. 그것까지 넣으면 §4-J 가 열어 둔 생활 주제가 전부 닫힌다.
 */
const MEDICAL_SUBJECT =
  /미레나|자궁내 ?장치|호르몬 ?(제|치료|요법)|항생제|스테로이드|임플란트|보톡스|필러|스텐트|인공 ?관절|피임약|갑상선 ?약|혈압 ?약|당뇨 ?약|수면제|항우울제|신경 ?안정제|주사 ?제|링거|시술|수술|복용 ?중인 ?약|먹는 ?약|처방 ?받은 ?약/

/**
 * 🔴 **판단을 대신 내려 달라는 요청.** 부작용 · 교체 · 중단 · 계속 사용 · 안전 여부다.
 *    "겪은 이야기" 와 "결정해 달라" 는 다르다 — 후자만 본다.
 */
const MEDICAL_DECISION_REQUEST =
  /부작용|교체(해야|할까|하나|가)|바꿔야 ?(하나|할까|되나)|갈아야 ?(하나|할까)|계속 ?(써도|쓰면|먹어도|먹으면|맞아도|해도)|중단(해도|하면|해야)|끊어도|끊으면|안전한 ?(가|지)|괜찮은 ?(건|걸|가)|괜찮을까|해도 ?(되나|될까)|몇 ?년에 ?한 ?번|년이? ?차는|채워야|주기가|용량을? ?(늘|줄)/

/**
 * 🔴 **몸 · 건강 대상어.** 효능 주장은 이 대상어와 붙어 있을 때만 센다 —
 *    "날씨가 좋아진다" 를 건강 주장으로 읽지 않기 위해서다.
 */
const HEALTH_SUBJECT =
  /무릎|허리|관절|어깨|디스크|혈압|혈당|콜레스테롤|피부|소화|수면|잠이 ?(오|안)|잠을 ?(못|설)|갱년기|뼈|근육|체중|살이 ?(빠|찌)|면역|혈액 ?순환|붓기|통증/

/**
 * 🔴 **효능 주장.** *"~라고 한다"* 는 전언형이어도 통과시키지 않는다 —
 *    읽는 사람에게 닿는 것은 인용 부호가 아니라 **주장 그 자체**다(2026-09-16 실측).
 */
const HEALTH_EFFICACY =
  /무리가 ?없|부담이 ?없|효과(를|가|는)? ?(본|봤|보|있|좋)|좋아진다|좋아져|낫는다|나아진다|도움이 ?(된|됐|되)|줄어든다|빠진다|개선(된|돼|해)/

/**
 * 🔴 **판단을 묻는 말.** 경험담과 요청을 가르는 것이 이것이다 (2026-09-16 정정).
 *    *"미레나 부작용 때문에 병원에 갔어요"* 는 겪은 이야기다 —
 *    같은 낱말이 들어 있어도 **묻고 있지 않으면** 판단 요청이 아니다.
 */
const ASKING =
  /\?|까요|나요|가요|어떻게 ?(하|해|했)|어떤가요|어떠세요|아닐까|되나요|될까요|해야 ?하나|하는 ?게 ?맞|여쭤|궁금|조언|알려 ?주/

const joined = (input: SafetyInputText): string =>
  [input.title, input.body ?? '', ...(input.comments ?? [])].join('\n')

/**
 * 🔴 **문장 단위로 자른다** (2026-09-16 정정).
 *
 *    옛 판은 글 전체에서 낱말 존재 여부만 봤다. 그래서
 *    *"무릎이 시큰거려요. 그런데 **날씨는 좋아져서** 창문을 열었어요"* 가
 *    `무릎` + `좋아져` 로 묶여 건강 효능 주장이 됐다 — 두 문장은 관계가 없다.
 *    대상과 주장이 **같은 문장**에 있을 때만 센다.
 */
const sentences = (text: string): string[] =>
  text.split(/(?<=[.!?。…])\s+|\n+/).map((x) => x.trim()).filter((x) => x !== '')

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

/**
 * 🔴 **의료 판단 요청.** 치료 · 의료기기 · 약물을 두고 **부작용 · 교체 · 중단 ·
 *    계속 사용 · 안전 여부**를 커뮤니티에 묻는 글이다. 둘 다 있어야 센다.
 *
 *    🔴 소재를 막는 것이 아니다 — 제품명만 나오고 판단을 묻지 않으면 통과다.
 */
export function judgeMedicalDecisionRequest(input: SafetyInputText): SafetySignal | null {
  const text = joined(input)
  // 🔴 대상은 글 전체에서 본다 — 앞 문장에서 소개하고 뒤에서 묻는 글이 흔하다
  const subject = MEDICAL_SUBJECT.exec(text)
  if (subject === null) return null
  /**
   * 🔴 **판단 낱말과 묻는 말이 같은 문장에 있어야 한다.**
   *    그러지 않으면 *"부작용 때문에 병원에 갔어요"* 같은 **경험담**까지 막힌다.
   *    막는 것은 "결정해 달라" 이지 "겪었다" 가 아니다.
   */
  const askSentence = sentences(text)
    .find((sent) => MEDICAL_DECISION_REQUEST.test(sent) && ASKING.test(sent))
  if (askSentence === undefined) return null
  return { code: 'medicalDecisionRequest', note: `의료 판단 요청(${subject[0]})` }
}

/**
 * 🔴 **건강 효능 주장.** 몸 · 건강 대상어와 효능 표현이 붙어 있으면 센다.
 *    전언형(*"~라고 한다"*)을 면제하지 않는다.
 */
export function judgeHealthEfficacyClaim(input: SafetyInputText): SafetySignal | null {
  // 🔴 대상과 주장이 **같은 문장**에 있을 때만 센다 (2026-09-16 정정)
  for (const sent of sentences(joined(input))) {
    if (!HEALTH_SUBJECT.test(sent)) continue
    const claim = HEALTH_EFFICACY.exec(sent)
    if (claim !== null) return { code: 'healthEfficacyClaim', note: `건강 효능 주장(${claim[0]})` }
  }
  return null
}

/** 🔴 세 축을 한 번에. 빈 배열이면 이 축에서는 걸린 것이 없다는 뜻이다 */
export function judgeSafetySignals(input: SafetyInputText): SafetySignal[] {
  const out: SafetySignal[] = []
  for (const j of [judgeCrisisSignal, judgeMedicalDecisionRequest, judgeHealthEfficacyClaim]) {
    const v = j(input)
    if (v !== null) out.push(v)
  }
  return out
}
