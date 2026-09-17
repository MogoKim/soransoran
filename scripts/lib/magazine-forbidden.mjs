/**
 * forbiddenPatterns 판정 — **글자가 아니라 뜻으로 본다.**
 *
 * ─────────────────────────────────────────────────────────
 * 🔴 **왜 생겼나** (2026-09-17 실측).
 *
 *    `how-long-did-menopause-last` 원고가 이 문장에서 막혔다.
 *
 *      "폐경 이후 몸에서 느껴지는 변화도 하나씩 **구분해 보는 편이 낫습니다**"
 *
 *    `review.ts` 의 forbiddenPatterns 에 `낫습니다` 가 있고, 검사가
 *    `text.includes('낫습니다')` 였다.
 *
 *    그런데 그 목록이 막으려던 것은 **"(병이) 낫습니다"** — 완치 주장이다.
 *    같은 글자가 한국어에서 **"~하는 편이 낫습니다"** 라는 일상 비교 표현으로도 쓰인다.
 *    생성 지침은 "편이 낫습니다" 를 자연스러운 문장으로 권하고,
 *    검증 정책은 같은 글자를 완치 주장으로 막는다 — **지침과 정책이 어긋나 있었다.**
 *
 * 🔴 **그래서 목록에서 빼지 않는다.** 빼면 "갱년기가 낫습니다" 가 통과한다.
 *    그것이야말로 이 관문이 존재하는 이유다.
 *    대신 **완치 주장으로 읽히는 자리인지**를 본다.
 *
 * 🔴 **좁게 면제한다. 모르면 막는다.**
 *    면제는 ① 동형이의로 **미리 적어 둔** 표현이고
 *          ② 그 자리 **바로 앞**에 비교 구문 표지가 있을 때만이다.
 *    둘 중 하나라도 아니면 그대로 위반이다.
 *
 * 🔴 **주어가 병이면 면제하지 않는다.** "약을 먹으면 갱년기가 낫습니다" 처럼
 *    비교 표지가 앞에 없으면 애초에 면제 대상이 아니고,
 *    "갱년기는 쉬는 편이 낫습니다" 는 비교지 완치 주장이 아니다.
 *
 * 🔴 이 파일은 읽기만 한다. 파일도 네트워크도 만지지 않는다.
 */

/**
 * 동형이의 — 완치 주장과 일상 표현이 **같은 글자**인 것들.
 *
 * 🔴 **여기 없는 패턴은 절대 면제되지 않는다.**
 * 🔴 **실제로 부딪힌 것만 넣는다** (2026-09-17 재검토).
 *    직전 판은 `나아집니다`·`낫는다`·`낫다` 까지 넣었는데 **근거가 없었다.**
 *    특히 `나아집니다` 는 "증상이 나아집니다" 라는 의료 단정으로 훨씬 자주 쓰인다 —
 *    면제 대상에 두면 관문을 그만큼 여는 일이다.
 *    실측으로 부딪힌 것은 `낫습니다` 하나뿐이고, 매거진 문체는 종결어미가
 *    `습니다` 로 고정돼 있어 다른 활용형은 본문에 나타나지 않는다.
 */
export const HOMOGRAPH_PATTERNS = new Set(['낫습니다'])

/**
 * 비교 구문 — **관형절 어미 + 의존명사**의 모양 전체를 본다.
 *
 * ─────────────────────────────────────────────────────────
 * 🔴 **표지만 보면 뚫린다** (2026-09-17 Codex 재현).
 *
 *    직전 판은 표지 목록에 `게` 가 맨몸으로 있었다. 그런데 한국어에서 `-게` 는
 *    **부사를 만드는 흔한 어미**다. 그래서 이런 문장이 전부 면제됐다.
 *
 *      "약을 먹으면 갱년기가 **빠르게** 낫습니다"      ← 완치 단정인데 통과
 *      "이 치료를 받으면 증상이 **빠르게** 나아집니다"  ← 통과
 *
 *    막으려던 바로 그것을 열어 준 것이다. 안전 관문에서 이런 실수는
 *    "검사가 없는 것" 보다 나쁘다 — 검사가 있다고 믿게 만든다.
 *
 * 🔴 **그래서 앞 어미까지 함께 본다.** `~하는 게`, `~하는 편이` 처럼
 *    **관형절 어미(는·은·을)** 뒤에 오는 의존명사만 비교 구문으로 인정한다.
 *    `빠르게` 의 `게` 앞은 `르` 라서 여기에 걸리지 않는다.
 *
 * 🔴 **근거 없이 넓히지 않는다.** `보다`·`거보다` 는 직전 판에 있었으나
 *    실측 근거가 없어 뺐다. 필요해지면 그때 문장과 함께 추가한다.
 */
export const COMPARATIVE_FORMS = ['편이', '쪽이', '것이', '게']

/** 관형절 어미 — 이것이 의존명사 앞에 있어야 비교 구문이다 */
export const CLAUSE_ENDINGS = ['는', '은', '을']

/**
 * 비교 구문 정규식. 예: `(는|은|을)\s*(편이|쪽이|것이|게)\s*$`
 * 🔴 어미와 의존명사 사이, 의존명사와 패턴 사이에 공백만 허용한다.
 */
const COMPARATIVE_RE = new RegExp(
  `(?:${CLAUSE_ENDINGS.join('|')})\\s{0,2}(?:${COMPARATIVE_FORMS.join('|')})\\s{0,3}$`,
)

/**
 * 이 자리의 패턴이 **면제되는가.**
 *
 * @param {string} text     본문
 * @param {number} index    패턴이 시작하는 자리
 * @param {string} pattern
 * @returns {boolean}
 */
function isComparativeUse(text, index, pattern) {
  if (!HOMOGRAPH_PATTERNS.has(pattern)) return false
  // 바로 앞 16자만 본다. 멀리 있는 "편이" 를 끌어오지 않는다.
  const before = text.slice(Math.max(0, index - 16), index)
  return COMPARATIVE_RE.test(before)
}

/**
 * 본문에서 이 패턴이 **실제 위반으로** 쓰였는가.
 *
 * @returns {{hit:boolean, occurrences:number, exempted:number, samples:string[]}}
 */
export function judgePattern(text, pattern) {
  const body = String(text ?? '')
  const p = String(pattern ?? '')
  const out = { hit: false, occurrences: 0, exempted: 0, samples: [] }
  if (!p) return out

  let from = 0
  for (;;) {
    const at = body.indexOf(p, from)
    if (at === -1) break
    out.occurrences += 1
    if (isComparativeUse(body, at, p)) {
      out.exempted += 1
    } else {
      out.hit = true
      if (out.samples.length < 2) {
        out.samples.push(body.slice(Math.max(0, at - 30), Math.min(body.length, at + p.length + 10)).replace(/\s+/g, ' ').trim())
      }
    }
    from = at + p.length
  }
  return out
}

/**
 * 원고 전체를 본다.
 *
 * @param {string} text
 * @param {string[]} patterns
 * @returns {{violations:{pattern:string,samples:string[]}[], exempted:{pattern:string,count:number}[]}}
 */
export function judgeForbidden(text, patterns) {
  const violations = []
  const exempted = []
  for (const p of patterns ?? []) {
    const r = judgePattern(text, p)
    if (r.hit) violations.push({ pattern: p, samples: r.samples })
    // 🔴 면제한 것도 기록에 남긴다. 조용히 넘어가면 관문이 열린 줄도 모른다.
    if (r.exempted > 0) exempted.push({ pattern: p, count: r.exempted })
  }
  return { violations, exempted }
}
