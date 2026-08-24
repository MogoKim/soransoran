#!/usr/bin/env node
/**
 * Slack 알림 — 최소 구현
 *
 * 매거진 자동화가 **조용히 죽는 것**을 막는 장치다.
 * 01:00 producer 도, ChatGPT 세션도, 실패하면 아무도 모른 채 재고만 줄어든다.
 *
 * 🔴 의존성 0. Node 내장 fetch 만 쓴다.
 *    @slack/web-api 를 설치하지 않는다 — package.json 을 건드리지 않기 위해서다.
 *    UnaEO 의 notifier.ts 는 prisma 를 3곳에서 부르므로 가져오지 않았다.
 *    참고한 것은 "curl 로 Slack 에 POST 하고 실패는 삼킨다"는 방식뿐이다.
 *
 * 🔴 secret 을 절대 출력하지 않는다.
 *    webhook URL 은 stdout·stderr·에러 객체 어디에도 나가지 않는다.
 *    fetch 가 던지는 에러에는 URL 이 들어 있을 수 있어 메시지를 직접 만들어 던진다.
 *
 * 🔴 Slack 전송 실패가 본 작업을 죽이지 않는다.
 *    알림 하나 때문에 producer 가 멈추면 그게 더 큰 사고다.
 *    send() 는 어떤 경우에도 throw 하지 않고 결과 객체를 돌려준다.
 *
 * secret 위치 — repo 밖이다.
 *   ~/.config/soransoran/slack.env   (chmod 600)
 *     SLACK_WEBHOOK_URL=https://hooks.slack.com/services/...
 *
 *   .env.local 을 쓰지 않는 이유: launchd 가 그 파일을 읽지 않는다.
 *   plist EnvironmentVariables 에 넣지 않는 이유: plist 가 repo 에 커밋되므로
 *   secret 이 git 에 들어간다.
 *
 * 사용법
 *   node scripts/lib/slack-notify.mjs --dry-run --text "테스트"
 *   node scripts/lib/slack-notify.mjs --dry-run --severity ERROR --title "..." --reason "..."
 *   node scripts/lib/slack-notify.mjs --help
 *
 * 모듈로 쓸 때
 *   import { buildMessage, send, loadWebhook } from './lib/slack-notify.mjs'
 */
import { readFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const SECRET_PATH = join(homedir(), '.config', 'soransoran', 'slack.env')

/** INFO 는 알리지 않아도 되는 것, BLOCKED 는 사람이 손대야 하는 것 */
export const SEVERITY = ['INFO', 'WARN', 'ERROR', 'BLOCKED']

const ICON = { INFO: 'ℹ️', WARN: '⚠️', ERROR: '🚨', BLOCKED: '⛔' }

/** 메시지에 절대 들어가면 안 되는 것. 넣어도 여기서 걸러진다 */
const FORBIDDEN = [
  /https:\/\/hooks\.slack\.com\/\S+/g,
  /xoxb-[\w-]+/g,
  /postgres(?:ql)?:\/\/\S+/g,
]

/** KST 로 고정한다. 서버 TZ 가 무엇이든 사람이 읽는 시각은 하나여야 한다 */
export function kstNow(now = Date.now()) {
  const d = new Date(now + 9 * 60 * 60 * 1000)
  return d.toISOString().replace('T', ' ').slice(0, 16) + ' KST'
}

/**
 * 혹시라도 섞여 들어온 secret 을 지운다.
 * 호출부가 실수해도 Slack 으로 나가지 않게 하는 마지막 방어선이다.
 */
export function redact(text) {
  let out = String(text ?? '')
  for (const re of FORBIDDEN) out = out.replace(re, '[가림]')
  return out
}

/**
 * 한 줄 제목 + 본문. 형식을 여기서만 정해 메시지가 제각각이 되지 않게 한다.
 * next 는 "그래서 뭘 해야 하는가" — 이게 없으면 알림이 소음이 된다.
 */
export function buildMessage({ severity = 'INFO', title, reason, next, logPath, now = Date.now() }) {
  if (!SEVERITY.includes(severity)) throw new Error(`알 수 없는 severity: ${severity}`)
  if (!title) throw new Error('title 이 필요하다')

  const lines = [`${ICON[severity]} *${redact(title)}*`, `등급: ${severity}`, `시각: ${kstNow(now)}`]
  if (reason) lines.push(`사유: ${redact(reason)}`)
  if (next) lines.push(`→ ${redact(next)}`)
  if (logPath) lines.push(`로그: ${redact(logPath)}`)
  return { severity, text: lines.join('\n') }
}

/**
 * webhook 을 읽는다. **값을 돌려주되 절대 출력하지 않는다.**
 * 파일이 없어도 예외를 던지지 않는다 — 알림 설정이 아직 없는 것은 실패가 아니다.
 */
export function loadWebhook(path = SECRET_PATH) {
  if (!existsSync(path)) return null
  try {
    const src = readFileSync(path, 'utf8')
    const m = src.match(/^SLACK_WEBHOOK_URL=(.*)$/m)
    if (!m) return null
    const v = m[1].trim().replace(/^["']|["']$/g, '')
    return v || null
  } catch {
    return null // 권한 문제 등. 알림이 안 갈 뿐 본 작업은 계속된다
  }
}

/** 설정 상태만 알려준다. 값은 돌려주지 않는다 */
export function webhookStatus(path = SECRET_PATH) {
  const hook = loadWebhook(path)
  return {
    configured: Boolean(hook),
    path,
    hint: hook ? `설정됨 (길이 ${hook.length})` : `미설정 — ${path} 없음 또는 SLACK_WEBHOOK_URL 비어 있음`,
  }
}

/**
 * 실제 전송. **어떤 경우에도 throw 하지 않는다.**
 *
 * 🔴 dryRun 이 기본값이다. 실수로 발송되는 쪽보다 안 가는 쪽이 낫다.
 *    호출부가 명시적으로 dryRun: false 를 줘야 나간다.
 */
export async function send(message, { dryRun = true, path = SECRET_PATH, timeoutMs = 3000 } = {}) {
  if (dryRun) return { sent: false, dryRun: true, reason: 'dry-run' }

  const hook = loadWebhook(path)
  if (!hook) return { sent: false, dryRun: false, reason: 'webhook 미설정' }

  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), timeoutMs)
  try {
    const res = await fetch(hook, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: message.text }),
      signal: ac.signal,
    })
    return { sent: res.ok, dryRun: false, reason: res.ok ? 'ok' : `HTTP ${res.status}` }
  } catch (err) {
    // 🔴 err 를 그대로 쓰지 않는다. fetch 에러의 cause/message 에 URL 이 실릴 수 있다.
    const kind = err?.name === 'AbortError' ? '타임아웃' : '네트워크 오류'
    return { sent: false, dryRun: false, reason: kind }
  } finally {
    clearTimeout(timer)
  }
}

// ── CLI ────────────────────────────────────────────────────

function help() {
  console.log(`Slack 알림 — 최소 구현 (의존성 0)

  node scripts/lib/slack-notify.mjs --dry-run --text "본문"
  node scripts/lib/slack-notify.mjs --dry-run --severity ERROR --title "제목" --reason "사유" --next "다음 행동"
  node scripts/lib/slack-notify.mjs --status        webhook 설정 여부만 (값 출력 안 함)

severity: ${SEVERITY.join(' | ')}

🔴 --dry-run 없이 실행하면 거부한다. 실제 발송은 창업자 승인 후 별도 배치에서 연다.
🔴 webhook URL 은 어떤 출력에도 나오지 않는다.
secret 위치: ${SECRET_PATH}`)
}

function main() {
  const argv = process.argv.slice(2)
  if (argv.includes('--help') || argv.length === 0) return help()

  const arg = (k) => {
    const i = argv.indexOf(k)
    return i === -1 ? undefined : argv[i + 1]
  }

  if (argv.includes('--status')) {
    const s = webhookStatus()
    console.log(`  webhook: ${s.hint}`)
    console.log(`  경로   : ${s.path}`)
    return
  }

  // 🔴 안전장치: 이번 단계에서는 dry-run 만 허용한다
  if (!argv.includes('--dry-run')) {
    console.error('  --dry-run 이 필요하다. 실제 발송은 아직 열려 있지 않다.')
    process.exit(2)
  }

  const message = arg('--text')
    ? { severity: 'INFO', text: redact(arg('--text')) }
    : buildMessage({
        severity: arg('--severity') ?? 'INFO',
        title: arg('--title') ?? '(제목 없음)',
        reason: arg('--reason'),
        next: arg('--next'),
        logPath: arg('--log'),
      })

  const s = webhookStatus()
  console.log('')
  console.log('  [dry-run] 발송하지 않는다. 아래가 보낼 내용이다.')
  console.log(`  webhook: ${s.hint}`)
  console.log('  ───────────────────────────────')
  console.log(message.text.split('\n').map((l) => '  ' + l).join('\n'))
  console.log('  ───────────────────────────────')
  console.log('')
}

// 모듈로 import 될 때는 CLI 를 돌리지 않는다
if (process.argv[1] && process.argv[1].endsWith('slack-notify.mjs')) main()
