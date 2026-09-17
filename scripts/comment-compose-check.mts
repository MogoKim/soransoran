#!/usr/bin/env tsx
/**
 * 댓글 작성 흐름 fixture — 🔴 DB · 세션 · 네트워크 · 브라우저 없음
 *
 * 🔴 하단 바 노출과 비회원 단계 전환을 컴포넌트 안에 두면 브라우저 없이는 확인할 수 없다.
 *    순수 함수로 빼 두었기 때문에 조건표를 전수로 돌려볼 수 있다.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  resolveComposeBarVisible,
  resolveScrollBehavior,
  SMOOTH_SCROLL_MAX_VIEWPORTS,
  FORM_NEAR_MARGIN_PX,
  KEYBOARD_MIN_SHRINK_PX,
  type ComposeBarInput,
} from '../src/lib/comment-compose-bar'
import {
  canSubmitGuestComment,
  evaluateTokenWait,
  planSubmit,
  resolveIdentityOpen,
  submitPendingLabel,
  type SubmitPhase,
} from '../src/lib/guest-comment-compose'
import {
  GUEST_CHALLENGE_TIMEOUT,
  GUEST_PASSWORD_HINT,
  GUEST_PASSWORD_LENGTH,
  GUEST_TURNSTILE_TIMEOUT,
} from '../src/lib/guest-comment-policy'
import { MIN_COMMENT_LENGTH } from '../src/lib/comment-policy'

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC = join(HERE, '..', 'src')
const read = (...parts: string[]) => readFileSync(join(SRC, ...parts), 'utf8')

const report: Array<{ ok: boolean; name: string; detail: string }> = []
let failures = 0
const ok = (name: string, detail: string) => report.push({ ok: true, name, detail })
const bad = (name: string, detail: string) => {
  report.push({ ok: false, name, detail })
  failures++
}

// ── 하단 바: 숨길 이유가 하나라도 있으면 숨긴다 (2^5 전수) ──
{
  const keys = [
    'sectionPassed',
    'formNear',
    'composing',
    'keyboardOpen',
    'otherComposerOpen',
  ] as const
  const offenders: string[] = []
  let shownCount = 0

  for (let mask = 0; mask < 1 << keys.length; mask++) {
    const input = { enabled: true } as ComposeBarInput
    keys.forEach((key, i) => {
      input[key] = Boolean(mask & (1 << i))
    })
    // 보일 조건은 단 하나뿐이다: 섹션을 지났고 나머지 숨길 이유가 전부 없다
    const expected =
      input.sectionPassed &&
      !input.formNear &&
      !input.composing &&
      !input.keyboardOpen &&
      !input.otherComposerOpen
    const actual = resolveComposeBarVisible(input)
    if (actual !== expected) {
      offenders.push(`${keys.map((k, i) => (mask & (1 << i) ? k : '')).filter(Boolean).join('+') || '없음'}=${actual}`)
    }
    if (actual) shownCount++
  }

  if (offenders.length) bad('하단 바 조건 전수', `🔴 ${offenders.join(' / ')}`)
  else ok('하단 바 조건 전수', `32가지 중 보이는 조합은 ${shownCount}가지뿐`)
}

// ── enabled 가 거짓이면 어떤 조합에서도 뜨지 않는다 ──
{
  const offenders: string[] = []
  for (let mask = 0; mask < 32; mask++) {
    const visible = resolveComposeBarVisible({
      enabled: false,
      sectionPassed: Boolean(mask & 1),
      formNear: Boolean(mask & 2),
      composing: Boolean(mask & 4),
      keyboardOpen: Boolean(mask & 8),
      otherComposerOpen: Boolean(mask & 16),
    })
    if (visible) offenders.push(`mask=${mask}`)
  }
  if (offenders.length) bad('댓글 없는 글', `🔴 ${offenders.length}가지 조합에서 떴다`)
  else ok('댓글 없는 글', 'enabled=false 면 32가지 전부 숨김')
}

// ── 문턱값이 의미를 잃지 않았는가 ──
{
  const offenders: string[] = []
  if (FORM_NEAR_MARGIN_PX < 52) offenders.push(`🔴 폼 여유 ${FORM_NEAR_MARGIN_PX}px 가 터치 높이보다 작다`)
  if (KEYBOARD_MIN_SHRINK_PX < 100) offenders.push(`🔴 키보드 문턱 ${KEYBOARD_MIN_SHRINK_PX}px 는 주소창 변화와 구분되지 않는다`)
  if (offenders.length) bad('문턱값', offenders.join(' / '))
  else ok('문턱값', `폼 여유 ${FORM_NEAR_MARGIN_PX}px · 키보드 ${KEYBOARD_MIN_SHRINK_PX}px`)
}

// ── 먼 길은 건너뛰고 가까운 길만 미끄러진다 ──
{
  const vh = 844
  const offenders: string[] = []
  const near = resolveScrollBehavior({ distance: vh, viewportHeight: vh, reduceMotion: false })
  const far = resolveScrollBehavior({
    distance: vh * SMOOTH_SCROLL_MAX_VIEWPORTS + 1,
    viewportHeight: vh,
    reduceMotion: false,
  })
  const reduced = resolveScrollBehavior({ distance: 10, viewportHeight: vh, reduceMotion: true })
  if (near !== 'smooth') offenders.push(`🔴 가까운 거리에서 ${near}`)
  if (far !== 'auto') offenders.push(`🔴 먼 거리에서 ${far}`)
  if (reduced !== 'auto') offenders.push(`🔴 움직임 줄이기에서 ${reduced}`)
  // 실측(2026-09-17 fx-long · 390x844): 바에서 폼까지 5,197px = 6.2 화면
  const measured = resolveScrollBehavior({ distance: 5197, viewportHeight: vh, reduceMotion: false })
  if (measured !== 'auto') offenders.push(`🔴 실측 거리에서 ${measured}`)
  if (offenders.length) bad('스크롤 방식', offenders.join(' / '))
  else ok('스크롤 방식', `${SMOOTH_SCROLL_MAX_VIEWPORTS}화면 이내만 smooth · 그 밖과 reduced-motion 은 건너뛴다`)
}

// ── 비회원: 신원 칸은 한번 열리면 닫히지 않는다 ──
{
  const offenders: string[] = []
  if (resolveIdentityOpen(false, '')) offenders.push('🔴 빈 본문에서 열렸다')
  if (resolveIdentityOpen(false, '   ')) offenders.push('🔴 공백만으로 열렸다')
  if (!resolveIdentityOpen(false, 'ㅇ')) offenders.push('🔴 한 글자에 열리지 않았다')
  if (!resolveIdentityOpen(true, '')) offenders.push('🔴 본문을 지우자 닫혔다')
  if (!resolveIdentityOpen(true, '   ')) offenders.push('🔴 공백만 남기자 닫혔다')
  if (offenders.length) bad('신원 칸 단방향', offenders.join(' / '))
  else ok('신원 칸 단방향', '빈 본문에서 닫힘 · 한 글자에 열림 · 그 뒤로는 계속 열림')
}

// ── 비회원: 등록 가능 판정에 토큰이 끼지 않는다 ──
{
  const full = { content: '안녕하세요', nickname: '소란맘', password: '1'.repeat(GUEST_PASSWORD_LENGTH) }
  const offenders: string[] = []
  if (!canSubmitGuestComment(full)) offenders.push('🔴 다 채웠는데 막혔다')
  if (canSubmitGuestComment({ ...full, content: 'ㄱ'.repeat(MIN_COMMENT_LENGTH - 1) }))
    offenders.push('🔴 짧은 본문이 통과했다')
  if (canSubmitGuestComment({ ...full, content: '   안녕   '.trim().slice(0, 1) }))
    offenders.push('🔴 한 글자 본문이 통과했다')
  if (canSubmitGuestComment({ ...full, nickname: '  ' })) offenders.push('🔴 공백 이름이 통과했다')
  if (canSubmitGuestComment({ ...full, password: '1'.repeat(GUEST_PASSWORD_LENGTH - 1) }))
    offenders.push('🔴 짧은 번호가 통과했다')
  if (canSubmitGuestComment({ ...full, password: '1'.repeat(GUEST_PASSWORD_LENGTH + 1) }))
    offenders.push('🔴 긴 번호가 통과했다')
  if (offenders.length) bad('등록 가능 판정', offenders.join(' / '))
  else ok('등록 가능 판정', '본문·이름·번호만 본다 · 토큰은 보지 않는다')
}

// ── 비회원: 제출 계획 전수 ──
{
  const offenders: string[] = []
  for (const needsToken of [true, false]) {
    for (const hasToken of [true, false]) {
      const plan = planSubmit({ needsToken, hasToken })
      const expected = needsToken && !hasToken ? 'wait' : 'send'
      if (plan.action !== expected) {
        offenders.push(`🔴 needs=${needsToken}/has=${hasToken} → ${plan.action}`)
      }
    }
  }
  if (offenders.length) bad('제출 계획 전수', offenders.join(' / '))
  else ok('제출 계획 전수', '키 없으면 바로 send · 토큰 없으면 wait · 4가지 전수')
}

// ── 대기와 등록 중은 다른 말을 한다 ──
{
  const waiting = submitPendingLabel('awaiting-token')
  const sending = submitPendingLabel('submitting')
  if (waiting === sending) bad('진행 문구', `🔴 두 단계가 같은 말을 한다: ${waiting}`)
  else ok('진행 문구', `대기 "${waiting}" · 등록 "${sending}"`)
}

// ── 보안·계약이 느슨해지지 않았는가 ──
{
  const action = read('lib', 'actions', 'guest-comments.ts')
  const offenders: string[] = []
  // 🔴 봇 검증은 어떤 write 보다 먼저다
  const verifyAt = action.indexOf('verifyTurnstile(')
  const createAt = action.indexOf('prisma.comment.create')
  if (verifyAt < 0) offenders.push('🔴 verifyTurnstile 이 없다')
  else if (createAt >= 0 && verifyAt > createAt) offenders.push('🔴 검증이 write 뒤에 있다')
  for (const key of ['checkRateLimit', 'GUEST_PASSWORD_PATTERN', 'bcrypt.hash', 'checkContent']) {
    if (!action.includes(key)) offenders.push(`🔴 ${key} 가 사라졌다`)
  }
  if (!/isDeleted:\s*true/.test(action)) offenders.push('🔴 소프트 삭제가 아니다')
  if (/prisma\.comment\.delete/.test(action)) offenders.push('🔴 진짜로 지운다')
  if (offenders.length) bad('서버 계약', offenders.join(' / '))
  else ok('서버 계약', 'write 전 검증 · rate limit · 4자리 · bcrypt · 금칙어 · 소프트 삭제')
}

// ── 시트·딤 오버레이가 되살아나지 않았는가 ──
{
  const anchor = read('components', 'features', 'CommentComposeAnchor.tsx')
  const offenders: string[] = []
  for (const gone of ['max-md:fixed', 'opacity-50', 'z-[60]', 'z-[61]', 'reservedHeight']) {
    if (anchor.includes(gone)) offenders.push(`🔴 ${gone} 가 남아 있다`)
  }
  // 🔴 window 스크롤로 판정하지 않는다. visualViewport 의 scroll 은 다른 일이다 —
  //    iOS 가 화면을 밀어 올릴 때 offsetTop 이 바뀌는 것을 따라가는 용도다.
  if (anchor.includes("window.addEventListener('scroll'"))
    offenders.push('🔴 window scroll 리스너로 판정한다')
  if (!anchor.includes('IntersectionObserver')) offenders.push('🔴 IntersectionObserver 를 쓰지 않는다')
  if (!anchor.includes('disconnect()')) offenders.push('🔴 observer 를 정리하지 않는다')
  if (!anchor.includes('preventScroll: true')) offenders.push('🔴 포커스가 브라우저 스크롤을 부른다')
  if (!anchor.includes('prefers-reduced-motion')) offenders.push('🔴 움직임 설정을 보지 않는다')
  if (offenders.length) bad('시트 잔재', offenders.join(' / '))
  else ok('시트 잔재', '시트·딤·예약높이·scroll 판정 0 · IO 정리 · preventScroll · reduced-motion')
}

// ── 확인 상자가 떠 있는 동안 우리 시계가 멈추는가 (반례) ──
{
  const QUIET = 10_000
  const CHALLENGE = 120_000
  const wait = (o: Partial<Parameters<typeof evaluateTokenWait>[0]>) =>
    evaluateTokenWait({
      hasToken: false, challengeActive: false, quietElapsedMs: 0, challengeElapsedMs: 0,
      quietLimitMs: QUIET, challengeLimitMs: CHALLENGE, ...o,
    })
  const offenders: string[] = []

  // 🔴 사람이 푸는 중에는 조용한 대기 상한을 아무리 넘겨도 끊지 않는다
  const solving = wait({ challengeActive: true, quietElapsedMs: QUIET * 100, challengeElapsedMs: 5_000 })
  if (solving.action !== 'keep-waiting') offenders.push(`🔴 푸는 중에 ${solving.action}`)

  // 아무도 아무것도 하지 않는 조용한 대기는 상한에서 끊는다
  const quiet = wait({ quietElapsedMs: QUIET })
  if (quiet.action !== 'give-up' || (quiet.action === 'give-up' && quiet.reason !== 'quiet'))
    offenders.push('🔴 조용한 대기가 끊기지 않는다')

  // 확인 상자가 떠 있는 채 상한을 넘기면 다른 사유로 끊는다
  const stuck = wait({ challengeActive: true, challengeElapsedMs: CHALLENGE })
  if (stuck.action !== 'give-up' || (stuck.action === 'give-up' && stuck.reason !== 'challenge'))
    offenders.push('🔴 확인 상자 상한이 없다')

  // 🔴 두 사유의 안내 문구가 같으면 다음에 할 일을 알 수 없다
  if (GUEST_TURNSTILE_TIMEOUT === GUEST_CHALLENGE_TIMEOUT)
    offenders.push('🔴 조용한 대기와 확인 미완료가 같은 말을 한다')

  // 토큰이 오면 어떤 상태에서도 보낸다
  for (const challengeActive of [true, false]) {
    const got = wait({ hasToken: true, challengeActive, quietElapsedMs: QUIET * 10, challengeElapsedMs: CHALLENGE * 10 })
    if (got.action !== 'submit') offenders.push(`🔴 토큰이 있는데 ${got.action}`)
  }

  // 사람이 푸는 시간이 조용한 대기보다 넉넉한가
  if (CHALLENGE <= QUIET) offenders.push('🔴 확인 시간이 조용한 대기보다 짧다')

  if (offenders.length) bad('확인 중 시계 정지', offenders.join(' / '))
  else ok('확인 중 시계 정지', `푸는 중 무한정 keep-waiting · 조용한 대기 ${QUIET / 1000}초 · 확인 상한 ${CHALLENGE / 1000}초`)
}

// ── 지난 서버 오류가 새 시도를 가리지 않는가 (반례) ──
{
  const form = read('components', 'features', 'GuestCommentForm.tsx')
  const offenders: string[] = []
  /**
   * 🔴 실제 반례: ① 서버 오류 → ② 입력 보정 → ③ 토큰 없이 재제출 → ④ 대기 → ⑤ 시간 초과.
   *    렌더가 state.error 를 직접 읽으면 ⑤ 의 새 안내 대신 ① 의 옛 오류가 계속 보인다.
   *    useFormState 의 state 는 다음 응답이 올 때까지 그대로 남기 때문이다.
   */
  if (/const error = state\.error/.test(form)) offenders.push('🔴 렌더가 state.error 를 직접 읽는다')
  if (!/setFormError\(state\.error \?\? ''\)/.test(form))
    offenders.push('🔴 서버 응답을 폼 오류 칸으로 옮겨 담지 않는다')
  if (!/const error = formError/.test(form)) offenders.push('🔴 오류 출처가 하나가 아니다')
  // 새 시도를 시작할 때 지난 말을 지우는가 (send·wait 두 경로 모두)
  if ((form.match(/setFormError\(''\)/g) ?? []).length < 2)
    offenders.push('🔴 새 시도에서 지난 오류를 지우지 않는 경로가 있다')
  // 🔴 잠금을 먼저 풀고 나서 말한다 — 안내는 떴는데 눌리지 않는 한 박자를 막는다
  const giveUp = form.slice(form.indexOf('const giveUp ='), form.indexOf('const timer ='))
  const order = ['stop()', 'releaseSubmit()', "setPhase('idle')", 'setFormError(']
    .map((k) => giveUp.indexOf(k))
  if (order.some((i) => i < 0) || order.some((v, i) => i > 0 && v < order[i - 1]!))
    offenders.push('🔴 멈춤 → 잠금 해제 → 단계 복귀 → 안내 순서가 아니다')
  if (offenders.length) bad('지난 오류 가림', offenders.join(' / '))
  else ok('지난 오류 가림', '서버 응답을 한 칸으로 옮겨 담고 새 시도마다 비운다 · 해제가 안내보다 먼저')
}

// ── 챌린지 콜백을 공식 의미대로 쓰는가 ──
{
  const widget = read('components', 'features', 'GuestTurnstile.tsx')
  const offenders: string[] = []
  for (const key of ['before-interactive-callback', 'after-interactive-callback', 'timeout-callback', 'unsupported-callback']) {
    if (!widget.includes(key)) offenders.push(`🔴 ${key} 가 없다`)
  }
  // 🔴 timeout-callback 안에서 reset 하지 않는다 — refresh-timeout(auto) 이 맡는다
  const timeoutBody = widget.slice(widget.indexOf("'timeout-callback'"), widget.indexOf("'unsupported-callback'"))
  if (/reset\(/.test(timeoutBody)) offenders.push('🔴 시간 초과에서 위젯을 직접 reset 한다')
  if (!widget.includes("appearance: 'interaction-only'")) offenders.push('🔴 평소에도 보이는 위젯이다')
  const phases: SubmitPhase[] = ['idle', 'awaiting-token', 'solving-challenge', 'submitting']
  const labels = phases.map(submitPendingLabel)
  if (new Set([labels[1], labels[2], labels[3]]).size !== 3)
    offenders.push(`🔴 진행 문구가 겹친다: ${labels.join(' / ')}`)
  if (offenders.length) bad('챌린지 계약', offenders.join(' / '))
  else ok('챌린지 계약', `before/after/timeout/unsupported · reset 은 Cloudflare 에 맡김 · 문구 3종 구분`)
}

// ── 번호 안내가 용도와 복구 불가를 함께 말하는가 ──
{
  const offenders: string[] = []
  if (!GUEST_PASSWORD_HINT.includes('수정·삭제')) offenders.push('🔴 쓰임새를 말하지 않는다')
  if (!/되찾을 수 없/.test(GUEST_PASSWORD_HINT)) offenders.push('🔴 되찾을 수 없다는 사실이 없다')
  const form = read('components', 'features', 'GuestCommentForm.tsx')
  // import 는 세지 않는다 — 화면에 그리는 자리가 하나인지를 본다
  if ((form.match(/\{GUEST_PASSWORD_HINT\}/g) ?? []).length !== 1)
    offenders.push('🔴 번호 안내를 그리는 자리가 하나가 아니다')
  if (/비밀번호는 이 댓글을/.test(form)) offenders.push('🔴 옛 안내문이 리터럴로 남아 있다')
  if (offenders.length) bad('번호 안내', offenders.join(' / '))
  else ok('번호 안내', `"${GUEST_PASSWORD_HINT}" · 한 자리에만`)
}

// ── 연타 차단을 한 곳에서, 세 폼 전부가 쓰는가 ──
{
  const guard = read('lib', 'use-submit-guard.ts')
  const offenders: string[] = []
  /**
   * 🔴 격리 DB 검증(2026-09-17)에서 비회원 폼도 회원 폼도 3연타에 댓글이 3개 들어갔다.
   *    같은 tick 에 들어온 두 번째 클릭은 React 가 다시 그리기 전이라 옛 state 를 본다.
   */
  if (!guard.includes('useRef')) offenders.push('🔴 가드가 ref 로 막지 않는다')
  if (!/useEffect\(\(\) => \{\s*inFlightRef\.current = false/.test(guard))
    offenders.push('🔴 서버 응답으로 풀지 않는다')
  if (/setTimeout|setInterval/.test(guard)) offenders.push('🔴 타이머로 푼다')

  for (const file of ['CommentForm.tsx', 'CommentEditor.tsx', 'GuestCommentForm.tsx']) {
    const code = read('components', 'features', file)
    if (!code.includes('useSubmitGuard')) offenders.push(`🔴 ${file} 가 가드를 쓰지 않는다`)
    if (!code.includes('guardSubmit')) offenders.push(`🔴 ${file} 에 guardSubmit 이 없다`)
  }
  if (offenders.length) bad('연타 차단', offenders.join(' / '))
  else ok('연타 차단', '가드 한 벌을 세 폼이 함께 쓴다 · 실측 5연타 → 1건')
}

// ── cleanup 반례: 떠난 뒤에 남는 것이 없는가 ──
{
  const widget = read('components', 'features', 'GuestTurnstile.tsx')
  const anchor = read('components', 'features', 'CommentComposeAnchor.tsx')
  const offenders: string[] = []

  /**
   * 🔴 script 요소는 <head> 에 한 번 붙으면 화면을 옮겨 다녀도 살아남는다.
   *    load 리스너를 떼지 않으면 글을 열 때마다 같은 요소에 render 가 한 겹씩 쌓인다.
   */
  const addCount = (widget.match(/addEventListener\('load'/g) ?? []).length
  const removeCount = (widget.match(/removeEventListener\('load'/g) ?? []).length
  if (addCount !== removeCount) offenders.push(`🔴 load 리스너 add ${addCount} · remove ${removeCount}`)
  // 건 요소와 떼는 요소가 같은가 — cleanup 에서 다시 찾아 떼면 엉뚱한 것을 뗄 수 있다
  if (!widget.includes('listeningScript?.removeEventListener'))
    offenders.push('🔴 리스너를 건 요소를 기억하지 않는다')
  const cleanupBody = widget.slice(widget.lastIndexOf('return () => {'))
  if (!/removeEventListener\('load'/.test(cleanupBody))
    offenders.push('🔴 제거가 cleanup 안에 있지 않다')
  // 기존 위젯 remove·취소 처리가 남아 있는가
  for (const kept of ['cancelled = true', 'turnstile.remove(']) {
    if (!cleanupBody.includes(kept)) offenders.push(`🔴 cleanup 에서 ${kept} 가 사라졌다`)
  }

  /**
   * 🔴 예약한 프레임의 번호를 들고 있지 않으면 취소할 수 없다.
   *    리스너와 타이머는 정리되는데 프레임만 살아남아, 화면을 떠난 뒤
   *    다음 페이지에서 scrollBy 가 실행된다.
   */
  const rafCalls = (anchor.match(/requestAnimationFrame\(/g) ?? []).length
  if (rafCalls === 0) offenders.push('🔴 보정 프레임이 없다')
  if (!/frame = window\.requestAnimationFrame\(/.test(anchor))
    offenders.push('🔴 프레임 번호를 보관하지 않는다')
  if (!anchor.includes('window.cancelAnimationFrame(frame)'))
    offenders.push('🔴 프레임을 취소하지 않는다')
  // 취소가 세 자리 모두에서 일어나는가: 새 보정 시작 · 중단 · 재보정
  const abortBody = anchor.slice(anchor.indexOf('const abort = () =>'), anchor.indexOf('function onResize'))
  if (!abortBody.includes('cancelFrame()')) offenders.push('🔴 중단(abort)이 프레임을 취소하지 않는다')
  const onResizeBody = anchor.slice(anchor.indexOf('function onResize'), anchor.indexOf('const timer ='))
  if (!onResizeBody.includes('cancelFrame()')) offenders.push('🔴 새 보정이 이전 예약을 취소하지 않는다')
  if (!anchor.includes('settleCleanupRef.current?.()'))
    offenders.push('🔴 unmount 에서 보정을 놓지 않는다')
  // 🔴 손잡이를 비우는 것은 아직 내 것일 때만 — 새 보정이 잡은 자리를 지난 보정이 지우면 안 된다
  if (!anchor.includes('if (settleCleanupRef.current === abort)'))
    offenders.push('🔴 지난 보정이 새 보정의 손잡이를 지울 수 있다')
  // 타이머가 부르는 것이 "전부 놓기" 인가 — 듣기만 끊으면 프레임이 남는다
  if (!/setTimeout\(abort, KEYBOARD_SETTLE_MS\)/.test(anchor))
    offenders.push('🔴 시간이 다 됐을 때 전부 놓지 않는다')

  if (offenders.length) bad('cleanup 반례', offenders.join(' / '))
  else ok('cleanup 반례', `load 리스너 add=${addCount}/remove=${removeCount} · 프레임 번호 보관·3자리 취소 · 위젯 remove 유지`)
}

// ── 폼은 한 벌뿐인가 ──
{
  const section = read('components', 'features', 'CommentSection.tsx')
  const dock = read('components', 'features', 'CommentDock.tsx')
  const offenders: string[] = []
  if ((section.match(/<GuestCommentForm/g) ?? []).length !== 1)
    offenders.push('🔴 비회원 폼이 한 벌이 아니다')
  if ((section.match(/<CommentForm/g) ?? []).length !== 1)
    offenders.push('🔴 회원 폼이 한 벌이 아니다')
  for (const forbidden of ['textarea', 'GuestTurnstile', 'CommentForm']) {
    if (dock.includes(forbidden)) offenders.push(`🔴 하단 바가 ${forbidden} 를 갖고 있다`)
  }
  if (!dock.includes('md:hidden')) offenders.push('🔴 하단 바가 데스크톱에도 뜬다')
  if (offenders.length) bad('폼 단일성', offenders.join(' / '))
  else ok('폼 단일성', '회원·비회원 각 한 벌 · 바는 입력을 갖지 않음 · 모바일 전용')
}

console.log('\n댓글 작성 흐름 fixture')
console.log('  네트워크 · DB · 세션 · 브라우저를 타지 않는다\n')
for (const r of report) console.log(`  ${r.ok ? '✅' : '❌'} ${r.name.padEnd(18)} → ${r.detail}`)
if (failures > 0) {
  console.log(`\n🔴 ${failures}건 실패\n`)
  process.exit(1)
}
console.log(`\n✅ fixture ${report.length}건 전부 기대와 일치\n`)
