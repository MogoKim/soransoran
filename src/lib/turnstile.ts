import 'server-only'

/**
 * Cloudflare Turnstile 검증.
 *
 * 🔴 개발 환경은 통과시킨다. 로컬에서 위젯이 뜨지 않으면 비회원 댓글을
 *    한 줄도 시험할 수 없다.
 *
 * 🔴 production 에서 키가 없으면 막는다(fail closed).
 *    키를 안 넣은 채 배포되면 봇 방어가 조용히 꺼진 상태로 살아 있게 된다 —
 *    통과시키는 쪽이 훨씬 위험하다.
 *
 * 🔴 네트워크가 실패해도 막는다. Cloudflare 가 흔들릴 때 스팸이 열리는 것보다
 *    비회원 댓글이 잠시 안 되는 쪽이 낫다.
 */
const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'

export type TurnstileResult = { ok: boolean; reason?: string }

export async function verifyTurnstile(token: string): Promise<TurnstileResult> {
  if (process.env.NODE_ENV === 'development') return { ok: true }

  const secret = process.env.CF_TURNSTILE_SECRET_KEY
  if (!secret) {
    console.error('[turnstile] CF_TURNSTILE_SECRET_KEY 가 없다 — 비회원 댓글을 막는다')
    return { ok: false, reason: '지금은 댓글을 등록할 수 없어요. 잠시 후 다시 시도해 주세요.' }
  }
  if (!token) return { ok: false, reason: '잠시 후 다시 시도해 주세요.' }

  try {
    const res = await fetch(VERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ secret, response: token }),
      cache: 'no-store',
    })
    if (!res.ok) return { ok: false, reason: '확인에 실패했어요. 잠시 후 다시 시도해 주세요.' }

    const data = (await res.json()) as { success?: boolean; 'error-codes'?: string[] }
    if (data.success === true) return { ok: true }

    console.error('[turnstile] 검증 실패:', JSON.stringify(data['error-codes'] ?? []))
    return { ok: false, reason: '자동 입력으로 보여 등록하지 못했어요. 다시 시도해 주세요.' }
  } catch (error) {
    console.error('[turnstile] 요청 실패:', (error as Error).message)
    return { ok: false, reason: '확인에 실패했어요. 잠시 후 다시 시도해 주세요.' }
  }
}
