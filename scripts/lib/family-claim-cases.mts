/**
 * 🔴 **가족 주장 회귀 케이스 — quality-v13** (2026-10-20)
 *
 *   운영 D5 결함 하나(큐 cmvfr8glb0001xm4r2n7abt2z · 글 cmvfvauqy0001xmui1bz7u95n · artifact cbc406c2…)를 코드로 고정한다:
 *   Persona P16(50대 후반 · 자녀 2명 · `childrenAgeBands=[성인]`)이 `2살 아이 보험… 아이 거니까…` 를 자기 일로 썼는데
 *   v12 게이트(숫자 나이 미판독 · 소유 표지 미판독 · 묻는 어미가 1인칭을 지움)가 모두 지나갔다.
 *
 *   🔴 운영 원문을 옮기지 않았다 — 결함 문장의 **모양**(숫자 나이 + 소유 표지 + 물음)만 같은 말로 다시 썼다.
 *   🔴 이 모듈은 데이터와 판정 한 줄(`runFamilyCase`)뿐이다. 두 소비자가 **같은 목록**을 돈다:
 *      · `draft-life-gates-check.mts` — 지금 코드에 대해 전부 기대대로인가
 *      · `quality-v13-family-mutation.mts` — 소스를 일부러 되돌린 사본에서 이 목록이 **실패로 드러나는가**
 *   🔴 카드는 정본 문서를 파서로 읽은 값(`realCard`)이다. 정본 풀에 영유아 카드는 없다 — 어린 자녀를 허가하는 카드는 합성 카드(`YOUNG`)이며
 *      게이트 입력 모양(`DraftGateCard`)을 그대로 따른다. 실제 카드가 하지 못하는 일을 시키지 않는다(자녀 1명 · 영유아).
 */
import { judgeDraftLife, type DraftGateCard, type DraftGatePlan } from '../../src/lib/content-core/draft-life-gates'
import { realCard } from './life-gate-fixtures.mjs'
import { FIXTURE_NOW } from './draft-gate-fixtures.mjs'

export type FamilyCardKey = 'P16' | 'P13' | 'P02' | 'YOUNG'
export type FamilyPlanKey = 'null' | 'lifeFacts' | 'noLife'
export type FamilyCase = {
  id: string
  label: string
  card: FamilyCardKey
  title: string
  body: string
  /** 계획 변형 — 가족 축 판정은 계획과 무관해야 하므로 세 변형을 모두 돈다 */
  plans: readonly FamilyPlanKey[]
  /** hold = `childLifeStageConflict` 확정 차단 · pass = 그 차단이 없다 */
  want: 'hold' | 'pass'
}

const ALL: readonly FamilyPlanKey[] = ['null', 'lifeFacts', 'noLife']
const YOUNG: DraftGateCard = { childrenCount: 1, childrenAgeBands: ['영유아'], maritalStatus: '기혼' }
const PLANS: Readonly<Record<FamilyPlanKey, DraftGatePlan>> = {
  null: { selfBasis: null, warrants: [] },
  lifeFacts: { selfBasis: 'lifeFacts', warrants: [{ fact: 'children', evidenceText: '아이 보험' }] },
  noLife: { selfBasis: 'noLifeFactNeeded', warrants: [] },
}
const cardOf = (k: FamilyCardKey): DraftGateCard => (k === 'YOUNG' ? YOUNG : realCard(k))

export const FAMILY_CASES: readonly FamilyCase[] = [
  // ── 🔴 결함 그 자체와 같은 모양 — P16(성인 자녀만)이 숫자 나이 어린 자녀를 자기 일로 말한다 ──
  { id: 'p16-exact', card: 'P16', plans: ALL, want: 'hold',
    label: '🔴 운영 결함 모양 — P16 · "2살 아이 보험을 알아보고 있는데 아이 거니까 …" (소유 + 숫자 나이 + 물음)',
    title: '아이 보험', body: '2살 아이 보험을 알아보고 있는데 아이 거니까 제대로 들고 싶어요. 어떤 걸 보면 좋을까요?' },
  { id: 'p16-question-ending', card: 'P16', plans: ALL, want: 'hold',
    label: '🔴 물음으로 끝나도 소유가 지워지지 않는다 — 나이 절과 묻는 어미가 한 문장 "2살 아이 보험 들려는데 아이 거니까 어떤 걸 보면 좋을까요?"',
    title: '아이 보험 고민', body: '2살 아이 보험 들려는데 아이 거니까 어떤 걸 보면 좋을까요?' },
  { id: 'p16-ellipsis-body', card: 'P16', plans: ALL, want: 'hold',
    label: '🔴 말줄임으로 끊긴 토막 — "2살 아이 보험... 아이 거니까 …"',
    title: '아이 보험 고민', body: '2살 아이 보험... 아이 거니까 꼼꼼하게 보고 싶은데 뭐가 좋을까요?' },
  { id: 'p16-ellipsis-title', card: 'P16', plans: ALL, want: 'hold',
    label: '🔴 제목이 토막("2살 아이 보험...")이고 소유는 본문에 있다',
    title: '2살 아이 보험...', body: '아이 거니까 제대로 알아보고 싶어요. 어떤 걸 보면 좋을까요?' },
  { id: 'p16-explicit-question', card: 'P16', plans: ALL, want: 'hold',
    label: '🔴 명시적 1인칭 + 물음 — "우리 아이가 2살인데 보험은 뭐가 좋을까요?"',
    title: '보험', body: '우리 아이가 2살인데 보험은 뭐가 좋을까요?' },
  { id: 'p16-predicative-question', card: 'P16', plans: ALL, want: 'hold',
    label: '🔴 한 아이를 서술한 물음 — "아이가 2살인데 보험은 뭐가 좋을까요?"',
    title: '보험', body: '아이가 2살인데 보험은 뭐가 좋을까요?' },
  { id: 'p16-declarative', card: 'P16', plans: ALL, want: 'hold',
    label: '🔴 물음 없이 서술 — "아이가 2살이라서 보험을 알아보고 있어요."',
    title: '보험', body: '아이가 2살이라서 보험을 알아보고 있어요.' },
  { id: 'p16-months', card: 'P16', plans: ALL, want: 'hold',
    label: '🔴 개월 수 — "우리 아기 18개월인데 …"',
    title: '보험', body: '우리 아기 18개월인데 보험 때문에 고민이에요. 어떻게 하셨나요?' },
  { id: 'p16-native-number', card: 'P16', plans: ALL, want: 'hold',
    label: '🔴 한글 수 나이 — "두 살 된 우리 아이 보험을 알아보고 있어요."',
    title: '보험', body: '두 살 된 우리 아이 보험을 알아보고 있어요.' },
  { id: 'p02-numeric-teen', card: 'P02', plans: ALL, want: 'hold',
    label: '🔴 P16 만의 규칙이 아니다 — P02(초등) · "우리 아이가 14살인데 …"(중고등)',
    title: '보험', body: '우리 아이가 14살인데 보험은 뭐가 좋을까요?' },
  { id: 'p02-question-clause-money', card: 'P02', plans: ALL, want: 'hold',
    label: '🔴 묻는 어미 절의 명시적 자기 자녀 행동 — P02(초등) · "우리 애가 용돈 봉투를 넣어 주는 게 정상인가요"(물음표 없는 묻는 어미 · 성별 낱말 없이 이 경로만)',
    title: '요즘', body: '우리 애가 용돈 봉투를 넣어 주는 게 정상인가요' },
  { id: 'p02-question-clause-money-other', card: 'P02', plans: ALL, want: 'pass',
    label: '🟢 같은 문장이어도 남의 자녀면 통과 — P02 · "친구 애가 용돈 봉투를 넣어 주는 게 정상인가요"',
    title: '요즘', body: '친구 애가 용돈 봉투를 넣어 주는 게 정상인가요' },

  // ── 🟢 막으면 안 되는 글 ──
  { id: 'young-card-owned', card: 'YOUNG', plans: ALL, want: 'pass',
    label: '🟢 어린 자녀를 카드가 허가하는 Persona — 같은 문장이어도 통과(영유아 카드 · "2살 아이 … 아이 거니까")',
    title: '아이 보험', body: '2살 아이 보험을 알아보고 있는데 아이 거니까 제대로 들고 싶어요. 어떤 걸 보면 좋을까요?' },
  { id: 'young-card-explicit', card: 'YOUNG', plans: ALL, want: 'pass',
    label: '🟢 영유아 카드 · "우리 아이가 2살인데 보험은 뭐가 좋을까요?"',
    title: '보험', body: '우리 아이가 2살인데 보험은 뭐가 좋을까요?' },
  { id: 'p02-boundary-7', card: 'P02', plans: ALL, want: 'pass',
    label: '🟢 경계 나이는 이웃 나이대를 둘 다 허용 — P02(초등) · "우리 아이가 7살인데"(영유아|초등)',
    title: '보험', body: '우리 아이가 7살인데 보험은 뭐가 좋을까요?' },
  { id: 'third-person-reported', card: 'P16', plans: ALL, want: 'pass',
    label: '🟢 제3자 — "친구 아이가 2살인데 보험을 알아본대요. 어떻게 해야 할까요?"',
    title: '요즘 보험', body: '친구 아이가 2살인데 보험을 알아본대요. 어떻게 해야 할까요?' },
  { id: 'third-person-beside-own', card: 'P16', plans: ALL, want: 'pass',
    label: '🟢 제3자 — 자기 가족 증거("우리 아이")가 글에 있어도 앞에 남이 선 "친구 아이가 2살인데"(전언 아님)는 자기 일이 아니다',
    title: '요즘 보험', body: '우리 아이는 벌써 다 커서 결혼했어요. 친구 아이가 2살인데 보험은 어떤 게 좋을까요?' },
  { id: 'general-question', card: 'P16', plans: ALL, want: 'pass',
    label: '🟢 일반 질문 — "2살 아이 보험은 어떻게 들어주셨나요?"(자기 가족 증거 없음)',
    title: '보험', body: '2살 아이 보험은 어떻게 들어주셨나요?' },
  { id: 'general-question-group', card: 'P16', plans: ALL, want: 'pass',
    label: '🟢 일반 질문 — "요즘 2살 아이 키우는 분들은 보험을 어떻게 하시나요?"',
    title: '보험', body: '요즘 2살 아이 키우는 분들은 보험을 어떻게 하시나요?' },
  { id: 'recall-adult-child', card: 'P16', plans: ALL, want: 'pass',
    label: '🟢 성인 자녀의 회상 — "아이 2살 때 보험 들어준 기억이 나요."(지금 나이의 주장이 아니다)',
    title: '옛날 생각', body: '아이 2살 때 보험 들어준 기억이 나요. 요즘 부모들은 어떻게 하나요?' },
  { id: 'grandchild-attributive', card: 'P13', plans: ALL, want: 'pass',
    label: '🟢 손주·남의 아이 수식형 — P13(성인 자녀) · "처가에 와서는 2살 아이를 거실에 그냥 두고 …"(주어 없음 · 자기 가족 증거 없음)',
    title: '처가 와서', body: '처가에 와서는 2살 아이를 거실에 그냥 두고 방에 들어가 누워만 있었어요. 원래 사위들은 다 그런가요?' },
]

export type FamilyCaseResult = { id: string; plan: FamilyPlanKey; want: 'hold' | 'pass'; got: 'hold' | 'pass'; codes: string[] }

/** 🔴 한 케이스를 계획 변형마다 판정한다 — 가족 축(`childLifeStageConflict`) 확정 차단 여부만 견준다 */
export function runFamilyCase(c: FamilyCase): FamilyCaseResult[] {
  const card = cardOf(c.card)
  return c.plans.map((p) => {
    const r = judgeDraftLife({
      title: c.title, body: c.body, card, plan: PLANS[p],
      context: { at: FIXTURE_NOW, source: null },
    })
    const codes = r.failures.map((f) => f.code as string)
    return { id: c.id, plan: p, want: c.want, got: codes.includes('childLifeStageConflict') ? 'hold' : 'pass', codes }
  })
}

export const failingFamilyResults = (): FamilyCaseResult[] =>
  FAMILY_CASES.flatMap((c) => runFamilyCase(c)).filter((r) => r.got !== r.want)
