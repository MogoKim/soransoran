/**
 * 실패를 **세 종류**로 가른다 — 대응이 완전히 다르기 때문이다.
 *
 * 🔴 **왜 필요한가** (2026-09-28 회차).
 *    그날 6건이 막혔는데 그중 4건은 `[attach] upload_timeout`, 1건은
 *    `[await-response] response_timeout`(전송 1건) 이었다. **원고는 멀쩡했다.**
 *    그런데 이 실패들이 콘텐츠 실패와 **같은 `attempts` 에 섞여** 5~7일 격리를 만들었다.
 *    브라우저가 파일을 못 올린 것을 두고 "이 글은 내용이 틀렸다" 고 적은 셈이다.
 *
 *    그 결과 공급이 스스로 말라붙는다 — 인프라를 고쳐도 격리가 풀리지 않는다.
 *
 * 🔴 **세 종류**
 *    CONTENT             원고가 실제로 규칙을 어겼다 → 재생성 횟수에 포함 · 긴 격리
 *    INFRA               브라우저·연결·업로드가 실패했다 → 횟수에 넣지 않음 · 짧은 backoff
 *    DELIVERY_UNCERTAIN  **보냈는데 응답을 못 받았다** → 다시 보내지 않는다 · 짧은 backoff
 *
 * 🔴 `DELIVERY_UNCERTAIN` 을 INFRA 와 나누는 이유는 **중복 전송** 때문이다.
 *    `sent=1` 뒤 timeout 은 "실패" 가 아니라 **모름** 이다. 같은 brief 를 다시 보내면
 *    같은 대화에 두 번 요청이 쌓이고, 계정에도 우리에게도 손해다.
 */

/**
 * 🔴 **`sent` 는 세 값이다** — 보냈다(`true`) / 안 보냈다(`false`) / **모른다**(`null`).
 *
 *    `Boolean(sent)` 는 모름을 **"안 보냈다" 로 바꿔 버린다.** 그러면 이미 ChatGPT 에
 *    올라간 brief 를 다시 보낸다 — 같은 대화에 요청이 두 번 쌓인다.
 *    그래서 파일·장부·분류기 어디에서도 `Boolean()` 으로 굳히지 않는다.
 *
 * 🔴 다만 **필드가 아예 없는 것**(`undefined`)은 모름이 아니라 **말하지 않은 것**이다.
 *    그것까지 `null` 로 올리면 옛 장부 행 전부가 DELIVERY_UNCERTAIN 이 되어
 *    **재시도 상한이 사라진다.** 말하지 않은 경로는 안 보낸 것으로 세고 상한 안에 둔다.
 */
export function sentOf(src) {
  if (src && typeof src === 'object' && Object.prototype.hasOwnProperty.call(src, 'sent')) return src.sent
  return false
}

/** 값 하나를 세 값으로 굳힌다 — `undefined` 만 `false` 로 내린다 */
export function normalizeSent(v) {
  if (v === true) return true
  if (v === null) return null
  if (v === undefined) return false
  return Boolean(v) === true ? true : false
}

/** 브라우저·연결·업로드 — 원고와 무관하다 */
const INFRA_CODES = new Set([
  'connect_failed',
  'no_context',
  'chrome_not_running',
  'browser_missing',
  'permission_blocked',
  'cloudflare_blocked',
  'login_required',
  /**
   * 🔴 아래 넷은 **더 이상 새로 생기지 않는다** — brief 첨부 경로를 없앴기 때문이다.
   *    그래도 지우지 않는다. 2026-09-28 회차가 남긴 **장부 행에 이 사유가 들어 있고**,
   *    지우면 그 행들이 내용 실패로 재분류되어 멀쩡한 원고가 긴 격리에 들어간다.
   *    과거를 읽기 위한 칸이다.
   */
  'attach_failed',
  'attach_rejected',
  'attach_no_document_input',
  'upload_timeout',
  /**
   * 🔴 본문이 안 들어갔다 — **원고가 틀린 것이 아니다.**
   *    이 실패들은 전부 `sent=false` 다 (보내기 전에 멈춘다).
   *    내용 실패로 세면 멀쩡한 글이 격리된다.
   */
  'composer_empty',
  'composer_no_begin',
  'composer_truncated',
  'composer_markers_missing',
  'composer_short',
  'composer_dirty',
  'send_button_missing',
  /**
   * 🔴 **응답을 못 받은 것은 원고 탓이 아니다.** `sent=true` 면 위에서 이미
   *    DELIVERY_UNCERTAIN 으로 갈린다. 여기 남는 것은 `sent=false`·모름 아닌 경우인데,
   *    그것도 내용 실패로 세면 멀쩡한 글이 재시도 상한을 까먹는다.
   */
  'response_timeout',
  'CHROME_NOT_RUNNING',
  // 🔴 프로필 신원 불일치 — 원고와 무관하다. 사람이 고칠 설정 문제다.
  'AUTOMATION_PROFILE_MISMATCH',
])

/**
 * 🔴 **포장 코드는 판정 근거가 아니다.**
 *    `REGEN_RUNNER_FAILED` · `FETCH_FAILED` · `HERO_FAILED` 는 "어느 단계가 실패했다" 만
 *    말할 뿐 **왜** 인지는 안에 든 사유가 말한다. 이것들을 인프라로 세면
 *    내용 실패까지 인프라가 되어 **재시도 상한이 사라진다.**
 *    안쪽 사유를 보고 정하고, 근거가 없으면 보수적으로 내용으로 센다.
 */
const WRAPPER_CODES = new Set(['REGEN_RUNNER_FAILED', 'FETCH_FAILED', 'HERO_FAILED', 'CONVERT_FAILED'])

/** 원고가 실제로 규칙을 어겼다 */
const CONTENT_PREFIXES = [
  'QA_FAIL', 'FORBIDDEN_PATTERN', 'MED_', 'FIN_', 'SEN_', 'AGE_WORDING', 'BRAND_LEAK',
  'DUPLICATE_SENTENCE', 'UNSUPPORTED_NUMERIC_CLAIM', 'RISK_SENTENCE', 'markers_missing',
  'invalid_manuscript', 'REGEN_NO_CHANGE',
]

/**
 * 🔴 **문자열 안에 섞여 온 신호도 본다.** 호출부는 자주 `"QA_FAIL: … — ⛔ [attach]
 *    upload_timeout · 전송 0건"` 같은 **합쳐진 문장**을 넘긴다. 바깥 코드만 보면
 *    인프라 실패가 콘텐츠 실패로 둔갑한다 — 2026-09-28 에 실제로 그랬다.
 */
export function classifyFailure({ code = null, message = '', stage = null, sent = false } = {}) {
  const text = `${code ?? ''} ${stage ?? ''} ${message ?? ''}`

  /**
   * ① 🔴 **`sent` 는 세 값이다** — 보냈다 / 안 보냈다 / **모른다**.
   *    자식이 결과를 적기 전에 죽으면 `null` 이 올라온다. 모름을 `false` 로 낮추면
   *    같은 brief 를 다시 보내고, `true` 로 올리면 멀쩡한 재시도를 영영 막는다.
   *    모름은 **모름대로** 다룬다 — 다시 보내지 않고, 내용 실패로도 세지 않는다.
   */
  if (sent === null || sent === undefined) {
    return { kind: 'DELIVERY_UNCERTAIN', why: '보냈는지 확인할 수 없다 — 다시 보내지 않는다' }
  }

  // 보냈는데 응답을 못 받았다 — 가장 먼저 가른다. 다시 보내면 안 되기 때문이다.
  if (sent && /response_timeout/.test(text)) {
    return { kind: 'DELIVERY_UNCERTAIN', why: '보냈지만 응답을 확인하지 못했다 — 다시 보내지 않는다' }
  }
  if (/DELIVERY_UNCERTAIN/.test(text)) {
    return { kind: 'DELIVERY_UNCERTAIN', why: '이미 전송된 회차다' }
  }

  // ② 인프라 신호가 **하나라도** 있으면 인프라다. 원고를 탓하지 않는다.
  const infraHit = [...INFRA_CODES].find((c) => text.includes(c))
  if (infraHit) return { kind: 'INFRA', why: `브라우저·연결 실패 (${infraHit})` }
  // 🔴 포장 코드만 있고 안쪽 사유가 없으면 인프라로 보지 않는다
  void WRAPPER_CODES
  if (/\[(attach|connect|open-tab|composer|send|tab|chrome)\]/.test(text)) {
    return { kind: 'INFRA', why: '인프라 단계에서 끝났다' }
  }

  // ③ 콘텐츠 신호
  const contentHit = CONTENT_PREFIXES.find((c) => text.includes(c))
  if (contentHit) return { kind: 'CONTENT', why: `원고 규칙 위반 (${contentHit})` }

  // ④ 🔴 모르면 **인프라로 보지 않는다.** 모르는 것을 인프라로 넘기면 상한이 없어진다.
  return { kind: 'CONTENT', why: '분류 불가 — 보수적으로 내용 실패로 센다' }
}

/** 내용 실패만 재생성·격리 횟수를 소비한다 */
export function consumesAttempt(kind) {
  return kind === 'CONTENT'
}

/**
 * 🔴 인프라·전송불명은 **짧은 backoff** 다. 원고가 틀린 것이 아니므로 다음 자연 회차에
 *    다시 본다. 콘텐츠 실패만 긴 격리를 쓴다.
 */
export const INFRA_BACKOFF_MS = 30 * 60 * 1000

export function cooldownFor(kind, contentCooldownMs) {
  return kind === 'CONTENT' ? contentCooldownMs : INFRA_BACKOFF_MS
}
