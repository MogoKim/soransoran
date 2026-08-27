/**
 * VE-M3 계약을 코드로 (VE-M3-2)
 *
 * 정본: docs/operations/2026-08-27-voice-m3-llm-experiment-contract.md
 *
 * 🔴 이 파일에는 LLM 이 없다
 *    SDK import · 네트워크 호출이 **하나도 없다.** 계약을 값으로 옮겨 놓은 것뿐이다.
 *    실제 호출은 VE-M3-3 이고, 그전까지 비용은 0원이다.
 *
 * 🔴 여기 있는 상수가 흔들리면 돈이 샌다
 *    cacheKey 구성 · cap · 금지어는 문서와 코드 양쪽에 있어야 한다.
 *    문서는 읽히지 않을 수 있지만 fixture 는 읽힌다.
 */
import { createHash } from 'node:crypto'
import { SORANSORAN_REGISTER_TERMS, TARGET_DESCRIPTOR_TERMS } from './voice-style-signals.mjs'
// 🔴 임계값 20자는 VE-R3.1 에서 확립됐다. 여기서 새로 정하지 않고 가져다 쓴다 —
//    두 곳에 각각 적으면 한쪽만 바뀌는 날이 온다.
import { LEAK_RUN_MIN } from './voice-unao-readonly.mjs'

// ── 모델 단가 (계약 §E) ──────────────────────────────────

export type ModelPricing = {
  /** 입력 100만 토큰당 USD */
  inputPerMTok: number
  /** 출력 100만 토큰당 USD */
  outputPerMTok: number
  /** 🔴 어디서 언제 확인했는가. 없으면 이 단가를 쓰지 않는다 */
  source: string
  checkedAt: string
}

/**
 * 🔴 **내부 라벨과 provider API 모델 ID 는 다른 것이다** (2026-08-27).
 *
 * 초판은 둘을 구분하지 않고 내부 키(`M3_MODEL_CANDIDATES` 의 키)를 그대로
 * API 요청 `body.model` 에 넣었다. `gpt-5-nano` 는 우연히 OpenAI 의 실제 모델 ID 와
 * 같아서 통했고, **`claude-haiku-4.5` 는 Anthropic 에 없는 이름이라 5건 전부 HTTP_404** 였다.
 *
 * 우연히 맞는 것은 설계가 아니다. 그래서 **둘을 항상 명시적으로 분리**한다 —
 * 값이 같은 `gpt-5-nano` 도 예외로 두지 않는다. 예외를 두면 다음 모델에서 또 헷갈린다.
 *
 * | | 쓰이는 곳 |
 * |---|---|
 * | 내부 라벨 (키) | `cacheKey` · `VoiceM3Run.model` · 보고 · 사람이 읽는 모든 곳 |
 * | `apiModelId` | 🔴 **provider 요청 `body.model` 전용** |
 *
 * 🔴 `cacheKey` 는 내부 라벨을 유지한다. provider 가 모델 ID 를 개정해도
 *    (`-20251001` 같은 날짜 접미사가 바뀌어도) 실험 비교의 축은 흔들리면 안 된다.
 */
export type ModelCandidate = ModelPricing & {
  /** 🔴 provider API 의 `model` 필드에 들어갈 값. 내부 라벨과 다를 수 있다 */
  apiModelId: string
}

// ── 버전 상수 ─────────────────────────────────────────────

/** VE-M3 작업 정의 버전. 판단 대상 · 입력 구성이 바뀌면 올린다 */
export const M3_TASK_VERSION = 'voice-m3-task-v1'
/** 프롬프트 버전. 문구가 바뀌면 결과가 달라지므로 올린다 */
export const M3_PROMPT_VERSION = 'voice-m3-prompt-v1'
/** 출력 스키마 버전. 필드가 바뀌면 파싱 결과가 달라지므로 올린다 */
export const M3_OUTPUT_SCHEMA_VERSION = 'voice-m3-output-v1'

/**
 * 후보 모델의 공식 단가. 🔴 **출처와 확인일이 없으면 여기 넣지 않는다.**
 *
 * 계약 §E 가 요구한 형식이다. 확인되지 않은 단가로 만든 금액은
 * "확인된 비용" 처럼 읽힌다 — 이전에 실제로 그런 일이 있었다.
 *
 * ⚠️ 가격은 바뀐다. **실행 직전 한 번 더 대조한다.**
 *
 * 🔴 모델 선택은 이 표로 하지 않는다. 20건 실험 결과를 사람이 읽고 정한다
 *    (정본: docs/operations/2026-08-27-voice-m3-model-selection-criteria.md).
 *    입력 20배 · 출력 12.5배 차이지만, 20건 실험 총액은 $0.077 로 둘 다 사실상 공짜다.
 *    격차가 드러나는 곳은 전량 확대 시점이고 그때 차이는 약 34달러다.
 */
export const M3_MODEL_CANDIDATES = {
  'gpt-5-nano': {
    // 🔴 내부 라벨과 값이 같지만 **그래도 적는다.** 우연한 일치에 기대면
    //    다음 모델에서 같은 404 를 다시 만난다(2026-08-27 Haiku 사례).
    apiModelId: 'gpt-5-nano',
    inputPerMTok: 0.05,
    outputPerMTok: 0.40,
    source: 'https://platform.openai.com/pricing',
    checkedAt: '2026-08-27',
  },
  'gpt-5-mini': {
    // 🔴 중간 후보. 1차 30건 결과에서 haiku 가 경계 사례(뉴스 · 광고) 판별에서
    //    앞섰지만 비용이 nano 의 4.3배였다. 그 사이를 메울 후보로 추가한다.
    //    입력 5배 · 출력 5배(vs nano) / 입력 1/4 · 출력 2/5(vs haiku).
    apiModelId: 'gpt-5-mini',
    inputPerMTok: 0.25,
    outputPerMTok: 2.0,
    source: 'https://platform.openai.com/pricing',
    checkedAt: '2026-08-27',
  },
  'claude-haiku-4.5': {
    // 🔴 내부 라벨(`claude-haiku-4.5`)은 Anthropic 에 없는 이름이다.
    //    이것을 body.model 에 넣어 30건 실행이 HTTP_404 로 전멸했다(비용 0원).
    apiModelId: 'claude-haiku-4-5-20251001',
    inputPerMTok: 1.0,
    outputPerMTok: 5.0,
    source: 'https://claude.com/pricing',
    checkedAt: '2026-08-27',
  },
} as const satisfies Record<string, ModelCandidate>

export type M3ModelName = keyof typeof M3_MODEL_CANDIDATES

/**
 * provider 요청에 넣을 실제 모델 ID.
 *
 * 🔴 등록되지 않은 모델은 던진다 — `pricingFor` · `outputTokenPolicyFor` 와 같은 이유다.
 *    모르는 모델에 내부 라벨을 그대로 태우는 순간 404 가 재발한다.
 *
 * 🔴 이 값은 **provider 호출 전용**이다. `cacheKey` 에 넣지 않는다.
 */
export function apiModelIdFor(model: string): string {
  const found = (M3_MODEL_CANDIDATES as Record<string, ModelCandidate>)[model]
  if (!found) {
    throw new Error(
      `provider 모델 ID 가 등록되지 않은 모델이다: ${model}\n` +
        `  후보: ${Object.keys(M3_MODEL_CANDIDATES).join(' · ')}\n` +
        '  공식 API 모델 ID 를 확인해 M3_MODEL_CANDIDATES 의 apiModelId 에 넣은 뒤 쓴다.',
    )
  }
  // 🔴 `undefined.trim()` 으로 죽지 않는다. 죽으면 스택만 남고 **이유가 안 읽힌다** —
  //    가드는 막는 것만으로 부족하고 무엇이 잘못됐는지 말해야 한다.
  if (typeof found.apiModelId !== 'string' || found.apiModelId.trim() === '') {
    throw new Error(
      `${model} 의 apiModelId 가 비어 있다 — provider 가 404 로 답한다.\n` +
        '  M3_MODEL_CANDIDATES 의 모든 항목은 apiModelId 를 명시해야 한다.\n' +
        '  내부 라벨과 값이 같더라도 생략하지 않는다(2026-08-27 Haiku 404).',
    )
  }
  return found.apiModelId
}

/**
 * 🔴 모델 비교는 **단계형**이다. 한 번에 끝내지 않는다.
 *
 * 초판은 10건 1회 비교였다. 그것으로는 모델 품질을 가릴 수 없다 —
 * 같은 모델도 글에 따라 흔들리고, 10건이면 그 흔들림과 모델 차이가 섞인다.
 *
 * 🔴 단계마다 **멈출 수 있다.** 1차에서 한쪽이 명확히 탈락하면 거기서 끝난다.
 *    끝까지 가야 하는 계획은 계획이 아니라 예산 소진이다.
 *
 * 🔴 각 단계는 `itemLimit`(50) 안에서 **실행을 쪼개서** 돈다.
 *    2차 100건 = 50×2회 · 3차 300건 = 50×6회. tokenCap 이 한 실행 91건을 넘지 못하게 한다.
 *
 * 정본: docs/operations/2026-08-27-voice-m3-model-selection-criteria.md §2
 */
export const M3_EXPERIMENT_STAGES = {
  /** 1차 — 같은 30건 표본을 두 모델에 각각. 층화 샘플이며 무작위가 아니다 */
  stage1PerModel: 30,
  /** 2차 — 1차에서 차이가 애매할 때만. 100건씩 두 모델 */
  stage2PerModel: 100,
  /** 3차 — 우세한 한 모델만 300건 단일 검증 */
  stage3Single: 300,
} as const

/** 1차 실험 건수(모델당). 이전 이름 호환 겸 가장 자주 쓰이는 값 */
export const M3_EXPERIMENT_PER_MODEL = M3_EXPERIMENT_STAGES.stage1PerModel

/**
 * 🔴 **VE-M3 분석 모델 확정** (2026-08-27). 1차 30건에서 멈췄다.
 *
 * 같은 30건 표본(md5 `d41aa57e…`)을 세 모델에 돌린 결과:
 *
 * | | nat σ | 경계 사례 판정 | 타겟 설명어 |
 * |---|---|---|---|
 * | `gpt-5-nano` | 6.4 | 뉴스를 65점으로 봄 | 🔴 "50대" 2건 |
 * | `gpt-5-mini` | **5.0** | 장르는 인식하되 **75~80점** | 없음 |
 * | **`claude-haiku-4.5`** | **13.3** | 뉴스를 **25~28점** | 없음 |
 *
 * `nat` 표준편차가 결정적이었다. nano · mini 는 거의 모든 글에 비슷한 점수를 줬고
 * (σ 5~6), 그 말은 **뉴스 복붙과 진짜 고백글을 같은 눈으로 봤다**는 뜻이다.
 * mini 는 notes 에 "뉴스형 보도문" 이라고 적고도 naturalness 78 을 줬다 —
 * **인식과 판정은 다르다.**
 *
 * 🔴 이 값은 **기록이지 기본값이 아니다.**
 *    `voice-m3-run` 은 여전히 `--model` 을 명시적으로 요구한다(유료 게이트 10중).
 *    여기를 폴백으로 쓰면 게이트 하나가 사라지고, 모델을 적지 않은 실행이
 *    조용히 돈을 쓴다. fixture 가 그 폴백이 생기지 않았는지 검사한다.
 *
 * 🔴 **분석 · 판정 전용이다.** 글을 생성하는 모델은 이 결정과 무관하며
 *    별도 실험으로 정한다(정본 §7-1).
 *
 * 정본: docs/operations/2026-08-27-voice-m3-model-selection-criteria.md §7-1
 */
export const M3_ANALYSIS_MODEL = 'claude-haiku-4.5'

/**
 * 🔴 **다시 불러도 답이 달라지지 않는 실패** (2026-08-27).
 *
 * 전량 3번째 batch 에서 `SOURCE_LEAK` 1건이 나왔다. 모델 출력에 원문이 20자 이상
 * 연속으로 들어 있어 저장 전 가드가 잡았고, 저장하지 않고 `skipped` 로 남겼다.
 * **가드는 설계대로 작동했다** — DB 저장 유출은 0건이다.
 *
 * 문제는 그다음이다. `skipped` 는 재시도 대상이므로 전량 모드가 **다음 실행에서
 * 같은 글을 다시 부른다.** 그런데 입력이 같고 프롬프트가 같으면 출력도 대체로 같다 —
 * 다시 걸리고, 다시 부르고, **189 batch 를 도는 내내 매번 돈만 쓴다.**
 *
 * 🔴 그래서 **원인이 우리 쪽에 없는 실패**는 종결로 본다.
 *
 * | 실패 | 원인 | 재시도 |
 * |---|---|---|
 * | `SOURCE_LEAK` | **모델이 원문을 옮겨 적었다.** 우리가 고칠 것이 없다 | ❌ 종결 |
 * | `FORBIDDEN_ADDRESS` | **모델이 금지 호칭을 만들어냈다.** 프롬프트는 이미 막고 있다 | ❌ 종결 |
 * | `JSON_PARSE` · `HTTP_*` · `TIMEOUT` · `NETWORK` · `NO_FINISH_REASON` | 설정 · 코드 · 일시 장애 — **고치면 달라진다** | ✅ 재시도 |
 *
 * 🔴 **가드를 완화해서 통과시키는 것이 아니다.** 20자 대조는 그대로이고,
 *    걸린 출력은 여전히 저장되지 않는다(`output = null`). 달라지는 것은
 *    **"다시 부를 것인가" 하나뿐**이다.
 *
 * ✅ `FORBIDDEN_ADDRESS` 도 종결이다 (2026-08-27 추가).
 *    초판에는 **일부러 넣지 않았다** — 성격은 같아 보였지만 한 건도 나오지 않았고,
 *    실측 없이 분류하면 고칠 수 있는 것을 버리게 되기 때문이다.
 *    전량 5번째 batch 에서 1건이 나왔다(`cmpy8jmka000csr2yq62ejr0j`).
 *
 *    모델이 **타겟 설명어를 스스로 만들어냈고** 저장 전 검사가 잡았다(output = null).
 *    `SOURCE_LEAK` 과 같은 성격이다 — 입력도 프롬프트도 그대로면 출력도 대체로 같다.
 *    🔴 우리가 고칠 것은 없다. 프롬프트는 이미 금지어를 명시하고 있고(§C),
 *    그것을 어긴 것은 모델이다. 다시 불러도 같은 답이 나온다.
 *
 * 정본: docs/operations/2026-08-27-voice-m3-full-scale-plan.md §4-1
 */
export const M3_TERMINAL_SKIP_CODES = ['SOURCE_LEAK', 'FORBIDDEN_ADDRESS'] as const

/** 이 실패는 다시 불러도 답이 달라지지 않는가 */
export function isTerminalSkip(errorCode: string | null): boolean {
  return errorCode !== null && (M3_TERMINAL_SKIP_CODES as readonly string[]).includes(errorCode)
}

/**
 * 1차 30건 표본이 반드시 덮어야 할 축.
 *
 * 🔴 무작위로 뽑으면 안 된다. `other` 81% · 짧은 본문 45.7% 라는 분포 탓에
 *    무작위 30건은 "비슷한 글 30개" 가 된다 — 모델 차이가 드러날 자리가 없다.
 */
export const M3_STRATA_AXES = [
  'shortBody', 'longBody',
  'manyComments', 'fewComments',
  'strongEmotion', 'calmTone',
  'question', 'complaint', 'experience',
  'sourceSpecificAddress',
  'targetDescriptorRisk',
  'highOtherReaction',
  'referenced', 'notReferenced',
] as const

/** 단가를 꺼낸다. 🔴 등록되지 않은 모델은 던진다 — 금액을 지어내지 않는다 */
export function pricingFor(model: string): ModelPricing {
  const found = (M3_MODEL_CANDIDATES as Record<string, ModelPricing>)[model]
  if (!found) {
    throw new Error(
      `단가가 등록되지 않은 모델이다: ${model}
` +
        `  후보: ${Object.keys(M3_MODEL_CANDIDATES).join(' · ')}
` +
        '  공식 단가를 출처 · 확인일과 함께 M3_MODEL_CANDIDATES 에 넣은 뒤 쓴다(계약 §E).',
    )
  }
  return found
}

/**
 * 🔴 모델은 아직 확정되지 않았다 — **그런데도 빈 문자열이 아니라 placeholder 다.**
 *
 * `''` 이나 `null` 로 두면 안 되는 이유가 둘이다.
 *   ① Postgres 에서 NULL 은 서로 같지 않아 `cacheKey` UNIQUE 가 중복을 못 막는다
 *   ② 나중에 "이 캐시가 어느 모델 결과인가" 를 물었을 때 답이 없다.
 *      빈 문자열이면 "모델이 없다" 와 "모델을 아직 안 정했다" 가 구분되지 않는다
 *
 * 이 값이 그대로 캐시에 들어가면 **모델 미확정 상태에서 만든 결과**라는 뜻이고,
 * 실제 모델이 정해지면 키가 달라져 자연히 새 결과로 분리된다.
 *
 * 모델 확정은 **10건 실험 전 창업자 승인 사항**이다(계약 §F).
 */
export const M3_MODEL_UNDETERMINED = 'undetermined'

// ── cap (계약 §E) ────────────────────────────────────────

export const M3_CAPS = {
  /**
   * 한 실행이 처리할 수 있는 최대 건수.
   *
   * 🔴 10 에서 50 으로 올렸다(2026-08-27). 10건 1회 비교로는 모델 품질을 가릴 수 없다 —
   *    같은 모델도 글에 따라 흔들리는데, 10건이면 그 흔들림과 모델 차이가 구분되지 않는다.
   *
   * 🔴 50 인 이유는 **tokenCap 이 정한다.** 1건당 약 5,468 tok(실측)이라
   *    500K / 5,468 ≈ 91건이 한 실행의 물리적 상한이다. 그 아래에서 나누기 좋은 수가 50 이다.
   *    100건 · 300건 단계는 **실행을 쪼개서** 돈다(50×2 · 50×6).
   *
   *    ⚠️ 2026-08-27 재계산: 출력 상한을 4,000 으로 올려도(gpt-5-nano)
   *       1건 최악값이 입력 1,745 + 출력 4,000 = 5,745 tok 이라 500K / 5,745 ≈ 87건이다.
   *       **50 은 여전히 안전하다.** tokenCap · dollarCap 은 바꾸지 않았다.
   */
  itemLimit: 50,
  /** 🔴 건수 cap 만으로는 못 막는다. 3,000자 글이 몰리면 같은 건수에 토큰이 3배다 */
  tokenCap: 500_000,
  /** 사람이 감당 가능한 상한 */
  dollarCap: 5,
  softDaily: 200,
  hardDaily: 1_000,
  timeoutSec: 30,
  /** 🔴 retry 도 cap 에 포함한다. 밖에 두면 실패가 많을수록 비용이 커진다 */
  maxRetry: 3,
  /** 연속 실패가 이만큼이면 배치 전체를 멈춘다 */
  consecutiveFailureStop: 5,
} as const

/**
 * 한국어 토큰 환산 계수.
 * ⚠️ 실측이 아니라 **가정**이다. 실제 토큰 수는 모델 토크나이저에 달렸다.
 *    입력 글자 수(1건당 약 1,173자)는 실측이지만 이 계수는 아니다.
 */
export const TOKENS_PER_CHAR = 1.3
/** 출력 JSON 한 건의 대략 크기. 7종 스칼라 + 근거 메모 기준 */
export const ESTIMATED_OUTPUT_TOKENS_PER_ITEM = 450

// ── 출력 토큰 상한 (2026-08-27 1차 실험 실패에서 나왔다) ──

/**
 * 🔴 **1,000 은 틀린 값이었다.**
 *
 * 2026-08-27 gpt-5-nano 1차 실행에서 5건 전부 `JSON_PARSE` 로 실패했다.
 * 5건의 출력 토큰이 **정확히 1000** 이었다 — 우연이 아니라 상한에 걸려 잘린 것이다.
 *
 * 원인: gpt-5-nano 는 reasoning 계열이라 **reasoning 토큰이 `max_completion_tokens`
 * 에 포함된다.** 1,000 을 추론이 다 쓰고 JSON 본문이 나오기 전에 끊겼다.
 * 산출물(7종 스칼라 + notes)은 450 토큰 정도인데, 그 앞에 추론 예산이 필요했다.
 *
 * 🔴 그래서 값을 **모델별로** 둔다. 한 숫자로 두면 둘 중 하나는 항상 틀린다 —
 *    reasoning 모델은 추론 예산이 필요하고, 아닌 모델은 그만큼이 낭비다.
 *
 * 🔴 `estimatedOutputTokens` 를 따로 두는 이유
 *    reasoning 토큰도 **출력으로 과금된다.** 그러니 reasoning 모델의 비용 추정은
 *    "JSON 크기 450" 이 아니라 **상한 그대로**를 최악값으로 잡아야 정직하다.
 *    1차 실행에서 450 으로 추정한 비용이 실제 청구와 어긋난 지점이 정확히 여기다.
 */
export type OutputTokenPolicy = {
  /** provider 에 보낼 상한 (OpenAI `max_completion_tokens` · Anthropic `max_tokens`) */
  maxOutputTokens: number
  /** reasoning 토큰이 상한에 포함되는가 */
  reasoning: boolean
  /** 비용 추정에 쓸 1건당 출력 토큰. reasoning 모델은 최악값(=상한) */
  estimatedOutputTokens: number
  /** 왜 이 값인가 */
  rationale: string
}

export const M3_OUTPUT_TOKEN_POLICY = {
  'gpt-5-nano': {
    maxOutputTokens: 4000,
    reasoning: true,
    estimatedOutputTokens: 4000,
    rationale:
      '1000 에서 5/5 잘림(실측). 산출물 450 + 추론 예산 약 3,550. ' +
      '30건 최악값 120K tok = $0.048 로 dollarCap 대비 1% 미만이다',
  },
  'gpt-5-mini': {
    maxOutputTokens: 4000,
    reasoning: true,
    estimatedOutputTokens: 4000,
    rationale:
      '⚠️ **미실측이다.** 같은 reasoning 계열인 gpt-5-nano 의 실측(1000 에서 5/5 잘림 · ' +
      '추론 1,664~3,328 tok)을 준용해 우선 4,000 을 쓴다. ' +
      '실제 추론량은 실행 진단(finish · reasoning · out/상한)으로 확인한다',
  },
  'claude-haiku-4.5': {
    maxOutputTokens: 1500,
    reasoning: false,
    estimatedOutputTokens: 700,
    rationale:
      'extended thinking 을 켜지 않으므로 상한이 곧 JSON 크기다. ' +
      '450 산출물에 여유 3배. 출력 단가가 nano 의 12.5배라 상한을 넓게 두지 않는다. ' +
      '30건 실측 결과 실제 출력은 292~421 tok 로 상한의 28% 이하였다',
  },
} as const satisfies Record<string, OutputTokenPolicy>

/**
 * 모델의 출력 토큰 정책. 🔴 등록되지 않은 모델은 던진다 —
 * `pricingFor` 와 같은 이유다. 모르는 모델에 임의의 상한을 씌우면
 * 1,000 사고가 이름만 바꿔 되풀이된다.
 */
export function outputTokenPolicyFor(model: string): OutputTokenPolicy {
  const found = (M3_OUTPUT_TOKEN_POLICY as Record<string, OutputTokenPolicy>)[model]
  if (!found) {
    throw new Error(
      `출력 토큰 정책이 등록되지 않은 모델이다: ${model}\n` +
        `  후보: ${Object.keys(M3_OUTPUT_TOKEN_POLICY).join(' · ')}\n` +
        '  reasoning 포함 여부를 확인한 뒤 M3_OUTPUT_TOKEN_POLICY 에 넣고 쓴다.',
    )
  }
  return found
}

/** provider 에 보낼 상한 */
export function maxOutputTokensFor(model: string): number {
  return outputTokenPolicyFor(model).maxOutputTokens
}

/** 비용 추정에 쓸 1건당 출력 토큰 */
export function outputTokenEstimateFor(model: string): number {
  return outputTokenPolicyFor(model).estimatedOutputTokens
}

// ── 실패 진단 (2026-08-27) ───────────────────────────────

/**
 * 🔴 **"JSON 파싱 실패" 만 남긴 것이 이번 사고의 두 번째 결함이다.**
 *
 * 1차 실행은 5건 전부 실패했는데, 저장된 사유가 `'JSON 파싱 실패'` 한 줄뿐이라
 * **왜 실패했는지 확정할 수 없었다.** 출력 토큰이 1000 이라는 정황만으로
 * 원인을 추정해야 했다. 유료 호출을 한 번 더 태우기 전에 알았어야 할 것을
 * 코드가 버린 것이다.
 *
 * 🔴 그래서 남기되, **수치와 분류값만** 남긴다.
 *    응답 전문 · 원문 · 댓글 · 닉네임은 여기 들어오지 않는다(계약 §H).
 */
export type JsonFailureKind = 'empty' | 'fenced' | 'not_json' | 'truncated' | 'invalid'

/**
 * 파싱에 실패한 응답이 **어떤 모양이었는가**. 🔴 내용이 아니라 모양만 본다.
 *
 * - `empty`      → 빈 응답. reasoning 이 상한을 다 쓴 전형적 모습이다
 * - `truncated`  → `{` 로 시작했는데 `}` 로 끝나지 않았다. **상한에 잘린 것**
 * - `fenced`     → 코드 울타리를 붙였다. 프롬프트로 고칠 문제다
 * - `not_json`   → JSON 이 아닌 문장으로 답했다
 * - `invalid`    → 모양은 맞는데 문법이 깨졌다
 */
export function classifyJsonFailure(text: string): JsonFailureKind {
  const t = text.trim()
  if (t.length === 0) return 'empty'
  if (t.startsWith('```')) return 'fenced'
  if (!t.startsWith('{') && !t.startsWith('[')) return 'not_json'
  const closer = t.startsWith('{') ? '}' : ']'
  if (!t.endsWith(closer)) return 'truncated'
  return 'invalid'
}

/**
 * 상한에 닿았는가.
 *
 * 🔴 종료 사유만 믿지 않는다. provider 마다 이름이 다르고(`length` · `max_tokens`),
 *    앞으로 또 다른 이름이 나올 수 있다. **토큰 수 대조를 함께 본다** —
 *    1차 실행에서 실제로 결정적 단서였던 것이 그쪽이다.
 */
export function isMaxTokensReached(
  finishReason: string, outputTokens: number, maxOutputTokens: number,
): boolean {
  const f = finishReason.trim().toLowerCase()
  if (f === 'length' || f === 'max_tokens') return true
  return maxOutputTokens > 0 && outputTokens >= maxOutputTokens
}

/** 저장 · 로그에 남길 진단. 🔴 전부 수치 아니면 분류값이다 */
export type M3Diagnostics = {
  /** provider 종료 사유. OpenAI `finish_reason` · Anthropic `stop_reason` */
  finishReason: string
  outputTokens: number
  maxOutputTokens: number
  /** reasoning 모델만. 없으면 null */
  reasoningTokens: number | null
  /** 🔴 응답 **길이**만. 응답 자체는 담지 않는다 */
  responseChars: number
  jsonFailure: JsonFailureKind | null
  maxTokensReached: boolean
}

/**
 * 진단을 한 줄로.
 *
 * 🔴 이 함수가 만드는 문자열에는 **응답 본문이 들어갈 자리가 없다.**
 *    입력 타입 자체가 수치와 열거값뿐이라 실수로도 원문을 넣을 수 없다 —
 *    문자열을 조립하다 `rawText` 를 끼워 넣는 사고를 타입으로 막은 것이다.
 */
export function formatDiagnostics(d: M3Diagnostics): string {
  return [
    d.jsonFailure ? `json=${d.jsonFailure}` : null,
    `finish=${d.finishReason.trim() === '' ? '(없음)' : d.finishReason.trim()}`,
    `out=${d.outputTokens}/${d.maxOutputTokens}`,
    d.reasoningTokens === null ? null : `reasoning=${d.reasoningTokens}`,
    `chars=${d.responseChars}`,
    d.maxTokensReached ? '🔴maxTokens 도달' : null,
  ].filter((x): x is string => x !== null).join(' · ')
}

// ── 출력 스키마 (계약 §B) ────────────────────────────────

/**
 * 🔴 VE-M3 가 LLM 에게 요구할 JSON. **이번 단계에서 계산하지 않는다.**
 *    여기 있는 것은 "나중에 이런 모양으로 받겠다" 는 약속뿐이다.
 *
 * 🔴 **7종 전부 자동 발행 조건으로 쓰지 않는다** (계약 §B · §I).
 *    점수가 좋아서 발행하는 구조를 만드는 순간 사람이 건너뛰어진다.
 *    이 값들은 **사람이 무엇을 먼저 볼지 정하는 순서**에만 쓴다.
 */
export const M3_SIGNAL_KEYS = [
  // 🟢 높을수록 좋다
  'naturalnessScore',
  'voiceRetention',
  'originalityDelta',
  // 🔴 높을수록 위험 — overSanitized 와 overMimicry 는 서로 반대 방향이라 함께 읽는다
  'overSanitizedRisk',
  'overMimicryRisk',
  'expressionRisk',
  'sequenceSimilarityRisk',
] as const

export type M3SignalKey = (typeof M3_SIGNAL_KEYS)[number]

/** LLM 이 반환해야 할 JSON schema. 값은 전부 0~100 정수다 */
export const M3_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [...M3_SIGNAL_KEYS, 'notes'],
  properties: {
    ...Object.fromEntries(
      M3_SIGNAL_KEYS.map((k) => [k, { type: 'integer', minimum: 0, maximum: 100 }]),
    ),
    /**
     * 판단 근거 메모.
     * 🔴 **원문을 인용하지 않는다.** 20자 이상 연속 일치는 저장 전에 걸러진다(§H).
     */
    notes: { type: 'string', maxLength: 500 },
  },
} as const

// ── cacheKey (계약 §D) ───────────────────────────────────

/**
 * cacheKey 를 이루는 8요소. 🔴 하나라도 빠지면 캐시가 틀린다.
 * fixture 가 이 배열의 길이와 내용을 검사한다.
 */
export const CACHE_KEY_PARTS = [
  'origin',
  'sourceRef',
  'contentHash',
  'ruleVersion',
  'taskVersion',
  'model',
  'promptVersion',
  'outputSchemaVersion',
] as const

export type CacheKeyInput = {
  origin: string
  sourceRef: string
  /** 원문이 없으면 null 일 수 있다 — 그때는 빈 문자열로 접힌다 */
  contentHash: string | null
  ruleVersion: string
  taskVersion: string
  model: string
  promptVersion: string
  outputSchemaVersion: string
}

/**
 * 🔴 같은 원문 · 같은 모델 · 같은 프롬프트 · 같은 스키마면 **다시 부르지 않는다.**
 *    캐시 미스 하나가 돈이다.
 *
 * 🔴 `model` · `promptVersion` · `outputSchemaVersion` 이 비면 **던진다.**
 *    빈 값을 허용하면 서로 다른 실행이 같은 키를 갖게 되고, 그러면
 *    "어느 모델 결과인가" 를 알 수 없어 캐시가 무의미해진다.
 */
export function buildCacheKey(input: CacheKeyInput): string {
  const required: Array<[string, string]> = [
    ['origin', input.origin],
    ['sourceRef', input.sourceRef],
    ['ruleVersion', input.ruleVersion],
    ['taskVersion', input.taskVersion],
    ['model', input.model],
    ['promptVersion', input.promptVersion],
    ['outputSchemaVersion', input.outputSchemaVersion],
  ]
  for (const [name, value] of required) {
    if (typeof value !== 'string' || value.trim() === '') {
      throw new Error(
        `cacheKey: ${name} 이 비어 있다.\n` +
          '  빈 값을 허용하면 서로 다른 실행이 같은 키를 갖는다 —\n' +
          '  모델이 미확정이면 M3_MODEL_UNDETERMINED 같은 placeholder 를 쓴다.',
      )
    }
  }
  // 🔴 구분자를 넣는다. 없으면 ('ab','c') 와 ('a','bc') 가 같은 키가 된다
  const material = [
    input.origin, input.sourceRef, input.contentHash ?? '',
    input.ruleVersion, input.taskVersion, input.model,
    input.promptVersion, input.outputSchemaVersion,
  ].join(' | ')
  return `sha256:${createHash('sha256').update(material, 'utf8').digest('hex')}`
}

// ── 비용 추정 (계약 §E) ──────────────────────────────────

export type CostEstimate = {
  estimatedInputTokens: number
  estimatedOutputTokens: number
  estimatedTotalTokens: number
  /**
   * 🔴 **공식 단가 없이는 금액을 만들지 않는다.**
   *    확인되지 않은 단가로 계산한 숫자는 "확인된 비용" 처럼 읽힌다 —
   *    이전 문서에서 실제로 그런 일이 있었고(추정치를 확정처럼 적었다), 정정했다.
   */
  estimatedCostUsd: number | null
  /** 금액이 null 인 이유 */
  costStatus: 'unavailable_no_official_price' | 'estimated'
  /** 단가를 확인했다면 출처와 날짜 */
  priceSource: string | null
}

/**
 * 토큰을 세고, **단가가 있을 때만** 금액을 만든다.
 *
 * 🔴 `pricing` 이 없으면 `estimatedCostUsd = null` 이다. 0 이 아니다 —
 *    0 은 "공짜" 로 읽히고 null 은 "모른다" 로 읽힌다. 둘은 다르다.
 *
 * 🔴 `outputTokensPerItem` 은 **모델이 정한다**(2026-08-27).
 *    기본값 450 은 "JSON 산출물 크기" 인데, reasoning 모델은 추론 토큰도
 *    출력으로 과금돼 실제 청구가 그보다 훨씬 크다. 1차 실행에서 450 으로
 *    추정한 값이 실제와 어긋난 지점이 여기다 — 호출부가
 *    `outputTokenEstimateFor(model)` 을 넘겨 최악값으로 잡는다.
 */
export function estimateCost(
  inputChars: number, itemCount: number, pricing?: ModelPricing,
  outputTokensPerItem: number = ESTIMATED_OUTPUT_TOKENS_PER_ITEM,
): CostEstimate {
  const estimatedInputTokens = Math.round(inputChars * TOKENS_PER_CHAR)
  const estimatedOutputTokens = itemCount * outputTokensPerItem
  const estimatedTotalTokens = estimatedInputTokens + estimatedOutputTokens
  if (!pricing) {
    return {
      estimatedInputTokens, estimatedOutputTokens, estimatedTotalTokens,
      estimatedCostUsd: null,
      costStatus: 'unavailable_no_official_price',
      priceSource: null,
    }
  }
  const usd =
    (estimatedInputTokens / 1_000_000) * pricing.inputPerMTok +
    (estimatedOutputTokens / 1_000_000) * pricing.outputPerMTok
  return {
    estimatedInputTokens, estimatedOutputTokens, estimatedTotalTokens,
    estimatedCostUsd: Math.round(usd * 10_000) / 10_000,
    costStatus: 'estimated',
    priceSource: `${pricing.source} (${pricing.checkedAt})`,
  }
}

/** cap 을 넘었는가. 🔴 하나라도 넘으면 실행하지 않는다 */
export function checkCaps(e: CostEstimate, itemCount: number): {
  ok: boolean
  violations: string[]
} {
  const violations: string[] = []
  if (itemCount > M3_CAPS.itemLimit) {
    violations.push(`itemLimit 초과: ${itemCount} > ${M3_CAPS.itemLimit}`)
  }
  if (e.estimatedTotalTokens > M3_CAPS.tokenCap) {
    violations.push(`tokenCap 초과: ${e.estimatedTotalTokens} > ${M3_CAPS.tokenCap}`)
  }
  // 🔴 금액을 모르면 "넘지 않았다" 고 말하지 않는다. 모른다고 말한다
  if (e.estimatedCostUsd === null) {
    violations.push('dollarCap 판정 불가 — 공식 단가 미확정 (계약 §E)')
  } else if (e.estimatedCostUsd > M3_CAPS.dollarCap) {
    violations.push(`dollarCap 초과: $${e.estimatedCostUsd} > $${M3_CAPS.dollarCap}`)
  }
  return { ok: violations.length === 0, violations }
}

// ── 호칭 (계약 §H) ──────────────────────────────────────

/** ✅ 소란소란 글에서 쓸 수 있는 호칭. 이 목록 밖은 생성 후보가 아니다 */
export const M3_ALLOWED_ADDRESS_TERMS = [...SORANSORAN_REGISTER_TERMS] as const
/** 🔴 생성 금지어. 원문에 있어도 **우리가 만들어내지 않는다** */
export const M3_FORBIDDEN_ADDRESS_TERMS = [...TARGET_DESCRIPTOR_TERMS] as const

/**
 * 생성 후보 호칭이 계약을 지키는가.
 *
 * 🔴 이 함수의 존재 이유: "우리 또래분들" 이 한 번 좋은 치환어로 문서에 적혔다가
 *    폐기됐다(PR #100). 사람은 같은 실수를 반복한다.
 */
export function validateAddressCandidates(terms: readonly string[]): {
  ok: boolean
  forbidden: string[]
  unknown: string[]
} {
  const forbidden = terms.filter((t) => (M3_FORBIDDEN_ADDRESS_TERMS as readonly string[]).includes(t))
  const unknown = terms.filter(
    (t) => !(M3_ALLOWED_ADDRESS_TERMS as readonly string[]).includes(t) && !forbidden.includes(t),
  )
  return { ok: forbidden.length === 0 && unknown.length === 0, forbidden, unknown }
}

// ── 원문 유출 대조 (계약 §H) ────────────────────────────

/** 임계값은 VE-R3.1 에서 확립됐다. 한국어 20자면 한 문장에 가깝다 */
export const M3_LEAK_RUN_MIN = LEAK_RUN_MIN

/**
 * 🔴 **저장 전 마지막 관문.** LLM 출력에 원문이 묻어 있으면 저장하지 않는다.
 *
 * 이번 단계에서는 호출이 없어 통과시킬 출력도 없지만,
 * **함수가 먼저 있어야 VE-M3-3 에서 빠뜨리지 않는다.**
 * fixture 가 이 함수의 존재와 동작을 검사한다.
 */
export function assertNoSourceLeak(
  outputText: string, sourceTexts: readonly string[], minRun = M3_LEAK_RUN_MIN,
): { ok: boolean; leaked: boolean } {
  const norm = (s: string): string => s.replace(/\s+/g, '')
  const out = norm(outputText)
  const hay = norm(sourceTexts.join('\n'))
  if (out.length < minRun || hay.length < minRun) return { ok: true, leaked: false }
  for (let i = 0; i + minRun <= out.length; i += 1) {
    if (hay.includes(out.slice(i, i + minRun))) return { ok: false, leaked: true }
  }
  return { ok: true, leaked: false }
}
