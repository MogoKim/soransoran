/**
 * QA 실패 → **자동 재생성** — 사람 승인 없이, 실패한 글만.
 *
 * 🔴 새 AI API 를 부르지 않는다. **기존 경로 그대로**다:
 *      Claude CLI(구독) brief + **실패 패킷** → ChatGPT 웹 UI(구독) → draft.md 회수
 *    이 모듈은 그 경로를 `runner` 로 **주입받아** 돌린다. 실제 호출은
 *    `scripts/magazine-webui-runner.mjs --fetch <slug> --force --regen-packet <경로>` 다.
 *
 * 🔴 **장부는 하나다** — `magazine-quarantine.mjs`.
 *    앞판은 별도 retry ledger 를 저장소 안에 두고 따로 셌다. 두 장부가 어긋나면
 *    한쪽은 HOLD, 다른 쪽은 재시도가 되어 무엇이 참인지 알 수 없다.
 *
 * 🔴 **패킷도 저장소 밖**에 쓴다. 추적 파일이 늘면 레인이 `DIRTY_TREE` 로 멈춘다.
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  MAX_REGEN_CALLS, QUARANTINE_PATH, readQuarantine, updateQuarantine,
  recordRegenCall, regenBudget, DELIVERY_HOLD_REASON,
} from './magazine-quarantine.mjs'
import { deliveryGate } from './magazine-delivery-gate.mjs'
import { DRAFTS_DIR } from './magazine-load.mjs'
import { classifyFailure, consumesAttempt, sentOf } from './magazine-failure-kind.mjs'


export { MAX_REGEN_CALLS }

/** 🔴 저장소 밖 — 패킷은 전달용 임시 파일이다 */
export const PACKET_DIR = join(homedir(), 'Library', 'Application Support', 'soransoran', 'regen-packets')
export const packetPathFor = (slug, dir = PACKET_DIR) => join(dir, `${slug}.json`)

/**
 * 🔴 **기계가 읽는 실패 패킷.** 사람이 읽는 설명이 아니라
 *    "어느 코드가 어느 문장에서 터졌나" 를 그대로 담아 재생성 지시에 넣는다.
 */
export function buildFailurePacket({ slug, profile, failures, attempt }) {
  const rows = (failures ?? []).map((f) => ({
    code: f.code, label: f.label ?? f.message ?? '', sentence: String(f.sentence ?? '').slice(0, 160),
  }))
  return {
    schemaVersion: 'regen-packet/2',
    slug,
    profile,
    attempt,
    failures: rows,
    instruction: [
      `아래 문장이 ${profile} 규칙에 걸렸다. **그 문장만** 고쳐 다시 써라.`,
      ...rows.map((f) => `- [${f.code}] ${f.label}${f.sentence ? `: "${f.sentence}"` : ''}`),
      '🔴 다른 문단은 그대로 둔다. 새 주장을 추가하지 않는다.',
      '🔴 수치를 단정하지 말고 "기관마다 다르다 · 확인해 보세요" 처럼 가변성을 밝혀라.',
    ].join('\n'),
  }
}

export function packetHashOf(packet) {
  return createHash('sha256')
    .update(JSON.stringify({ slug: packet.slug, codes: packet.failures.map((f) => f.code).sort() }))
    .digest('hex').slice(0, 16)
}

/** 🔴 원자적으로 쓴다 — 반쪽 패킷을 ChatGPT 경로가 읽으면 엉뚱한 지시가 나간다 */
export function writePacket(packet, path = packetPathFor(packet.slug)) {
  mkdirSync(dirname(path), { recursive: true })
  const text = `${JSON.stringify(packet, null, 2)}\n`
  const tmp = `${path}.tmp-${process.pid}`
  writeFileSync(tmp, text, 'utf8')
  renameSync(tmp, path)
  if (readFileSync(path, 'utf8') !== text) throw new Error('🔴 패킷 저장 확인 실패')
  return path
}

export function readPacket(path) {
  if (!existsSync(path)) return null
  try { return JSON.parse(readFileSync(path, 'utf8')) } catch { return null }
}

/**
 * 🔴 **전달이 끝난 패킷은 지운다.**
 *    패킷은 runner 에게 건네는 임시 파일이지 증거가 아니다. 남겨 두면
 *    ① 다음 회차가 옛 지시를 주워 읽을 수 있고
 *    ② 저장소 밖 폴더가 slug 마다 쌓이며
 *    ③ "패킷이 있다" 를 성공 증거로 착각하게 된다.
 *
 *    🔴 지우다 실패해도 회차 판정을 뒤집지 않는다. 정리는 판정이 아니다.
 */
export function removePacket(path) {
  try { rmSync(path, { force: true }); return { ok: true } }
  catch (e) { return { ok: false, why: e.message } }
}

/**
 * 한 slug 의 재생성을 **한 번** 시도한다.
 *
 * 🔴 호출부(drive)가 QA 를 돌리고, 실패하면 이것을 부른다.
 *    여기서 QA 를 다시 돌리지 않는다 — QA 는 운영 경로의 실제 스크립트가 한다.
 *
 * @param {object} p
 * @param {string} p.slug
 * @param {string} p.profile
 * @param {Array}  p.failures   QA 가 낸 실패 목록
 * @param {(ctx:{slug,packet,packetPath})=>{ok:boolean, why?:string}} p.runner
 *        🔴 기존 ChatGPT 웹 UI 경로. 시험에서는 주입된 fake 가 들어온다.
 * @param {string} [p.quarantinePath]
 * @param {number} [p.now]
 * @returns {{ok:boolean, code:string, why:string, regenCalls:number}}
 */
export function attemptRegeneration({
  slug, profile, failures, runner, quarantinePath = QUARANTINE_PATH, now = Date.now(),
  previousFingerprint = null, fingerprintOf: fpOf = null, packetDir = PACKET_DIR,
  /** 🔴 전송 경계와 **같은 brief** 로 지문을 만들기 위한 폴더. 운영은 저장소 폴더 그대로다 */
  draftsDir = DRAFTS_DIR,
}) {
  const read = readQuarantine(quarantinePath)
  if (!read.ok) {
    // 🔴 장부를 못 읽으면 이 slug 는 HOLD 다. 빈 장부로 보고 다시 태우지 않는다.
    return { ok: false, code: 'LEDGER_UNREADABLE', why: read.why, regenCalls: 0 }
  }
  const entry = read.store[slug]
  const budget = regenBudget({ entry })
  if (budget.exhausted) {
    return { ok: false, code: 'REGEN_EXHAUSTED',
      why: `🔴 재생성 ${budget.used}회를 이미 썼다 (상한 ${MAX_REGEN_CALLS}) — 이 글만 HOLD`,
      regenCalls: budget.used }
  }

  const packet = buildFailurePacket({ slug, profile, failures, attempt: budget.used + 1 })
  const hash = packetHashOf(packet)

  /**
   * 🔴 **이미 보낸 재생성 요청이면 아무것도 시작하지 않는다** (2026-09-28 · Codex P1).
   *
   *    앞판은 packet 을 쓰고 regenCalls 를 올린 **뒤에** runner 를 불렀고, runner 가 HOLD 를
   *    돌려주면 그제야 되돌렸다. 그 사이 프로세스가 죽으면 **전송 0건인데 regenCalls=1** 이 남았다.
   *
   *    판정은 전송 경계와 **같은 함수**(`deliveryGate` — 같은 메시지 생성기·지문·HOLD 조건)다.
   *    위 `packet` 은 메모리의 값일 뿐이다 — 파일은 이 판정을 통과한 뒤에만 쓴다.
   *    HOLD 면 packet 파일 0 · runner 0 · Chrome/probe/send 0 · regenCalls 0 · attempts 0 이고,
   *    **장부에 한 글자도 쓰지 않는다** — 앞선 전송 기록(sent=null 등)을 그대로 둔다.
   */
  const gate = deliveryGate({ slug, draftsDir, packet, quarantinePath })
  if (!gate.ok) {
    return { ok: false, code: 'LEDGER_UNREADABLE', why: gate.why, regenCalls: budget.used }
  }
  if (gate.hold) {
    return {
      ok: false, code: 'REGEN_DELIVERY_HOLD', kind: 'DELIVERY_UNCERTAIN', held: true,
      sent: false, priorSent: gate.hold.delivery?.sent ?? null,
      messageFingerprint: gate.messageFingerprint,
      why: `이미 보낸 재생성 요청이다 — 다시 보내지 않는다 (전송 0건 · runner 0): ${gate.hold.why}`,
      regenCalls: budget.used,
    }
  }
  /**
   * 🔴 **무한 반복을 막는 것은 「같은 실패 코드」가 아니라 「안 바뀐 원고」다.**
   *
   *    앞판은 실패 코드 묶음이 같으면 즉시 HOLD 했다. 그런데 `QA_FAIL` 처럼
   *    코드가 하나뿐인 단계에서는 **두 번째 시도가 아예 일어나지 않는다** —
   *    "최대 2회" 계약이 실제로는 1회가 됐다.
   *
   *    두 번째 시도는 해 볼 값어치가 있다. 같은 지적을 받고 다시 쓰면 달라질 수 있다.
   *    정말로 무의미한 경우는 **원고가 한 글자도 안 바뀐 때**이고, 그건
   *    호출부가 `draftFingerprint` 로 알려 준다 (아래 `previousFingerprint`).
   */
  // 🔴 호출 **전에** 센다. 도중에 죽어도 횟수가 남는다. (잠금 안에서 최신 행을 다시 읽어 올린다)
  let bumped = null
  const up = updateQuarantine((cur) => {
    bumped = recordRegenCall({ entry: cur[slug], now, packetHash: hash })
    return { ...cur, [slug]: bumped }
  }, quarantinePath)
  if (!up.ok) {
    // 🔴 횟수를 못 적었으면 부르지 않는다 — 기억할 수 없는 재생성은 하지 않는다
    return { ok: false, code: 'LEDGER_UNREADABLE', why: up.why, regenCalls: budget.used }
  }
  const packetPath = writePacket(packet, packetPathFor(slug, packetDir))

  /**
   * 🔴 **runner 가 돌아온 뒤에만** 지운다 — 읽기 전에 지우면 전달 자체가 깨진다.
   *    성공·실패·예외 **세 경우 모두** `finally` 에서 지운다. 실패 경로만 남기면
   *    정상 회차마다 패킷이 하나씩 쌓인다.
   */
  let r
  try { r = runner({ slug, packet, packetPath }) }
  catch (e) { r = { ok: false, why: `재생성 경로 예외: ${e.message}` } }
  finally { removePacket(packetPath) }

  /**
   * 🔴 **전송 경계가 HOLD 로 멈췄다** (2026-09-28 · 재생성 중복 전송).
   *    같은 slug · 같은 최종 메시지 지문이 이미 DELIVERY_UNCERTAIN 이라 **한 글자도 안 보냈다.**
   *    판정은 전송 경계(`deliveryGate`)가 했다 — 여기서 조건을 다시 쓰지 않고 사유만 읽는다.
   *
   *    그래서 **아무것도 바꾸지 않는다.** 먼저 올려 둔 재생성 횟수만 제자리로 돌리고,
   *    앞 회차가 남긴 `sent`·`kind`·전송 기록은 그대로 둔다 — 안 보낸 실행이
   *    "보냈다(true)" 를 "안 보냈다(false)" 로 덮어쓰면 다음 판단이 흐려진다.
   */
  if (r?.reason === DELIVERY_HOLD_REASON) {
    // 🔴 위 사전 판정 뒤에 다른 프로세스가 먼저 예약한 경우(경합)만 여기로 온다
    updateQuarantine((cur) => ({
      ...cur,
      [slug]: { ...(cur[slug] ?? {}), regenCalls: budget.used, lastRegenAt: entry?.lastRegenAt, lastPacketHash: entry?.lastPacketHash },
    }), quarantinePath)
    return {
      ok: false, code: 'REGEN_DELIVERY_HOLD', kind: 'DELIVERY_UNCERTAIN', held: true,
      // 🔴 `sent` 는 이번 실행(0건) · `priorSent` 는 앞선 전송의 사실(대개 모름=null)
      sent: false, priorSent: r.prior ? (r.prior.sent ?? null) : null,
      messageFingerprint: r.messageFingerprint ?? null,
      why: `이미 보낸 재생성 요청이다 — 다시 보내지 않는다 (전송 0건): ${r?.why ?? ''}`,
      regenCalls: budget.used,
    }
  }

  if (!r?.ok) {
    /**
     * 🔴 **인프라 실패는 재생성 횟수를 먹지 않는다** (2026-09-28).
     *    `[attach] upload_timeout` 으로 두 번 실패하면 원고가 멀쩡한데도 HOLD 가 됐다.
     *    브라우저가 파일을 못 올린 것을 "이 글은 못 고친다" 로 적은 셈이다.
     *    호출 **전에** 올려 둔 횟수를 여기서 되돌린다 — 중간에 죽는 경우를 대비해
     *    먼저 올리는 설계는 그대로 두고, **분류가 끝난 뒤** 제자리로 돌린다.
     *
     * 🔴 `sent` 가 참이면 **다시 보내지 않는다.** 보냈는지 모르는 것과 안 보낸 것은 다르다.
     */
    /**
     * 🔴 **구조화된 값을 그대로 넘긴다** (2026-09-28 · P0-2).
     *    앞판은 `why` 문장 하나만 넘겼다 — 자식이 만든 `reason`·`stage`·`errorDetail`
     *    을 버린 것이다. 그러면 분류기가 문장에서 다시 추측해야 하고,
     *    `sent` 는 `Boolean()` 에 뭉개져 **모름이 "안 보냄" 으로 바뀌었다.**
     */
    const kind = classifyFailure({
      code: r?.reason ?? 'REGEN_RUNNER_FAILED',
      stage: r?.stage ?? null,
      message: [r?.why, r?.errorName, r?.errorDetail].filter(Boolean).join(' · '),
      sent: sentOf(r),
    }).kind
    if (!consumesAttempt(kind)) {
      // 올려 둔 횟수를 되돌린다 — 최신 장부를 다시 읽어 덮어쓰기를 피한다
      updateQuarantine((cur) => ({
        ...cur,
        [slug]: { ...(cur[slug] ?? {}), kind, sent: sentOf(r), regenCalls: budget.used, lastRegenAt: now },
      }), quarantinePath)
      return {
        ok: false,
        code: kind === 'DELIVERY_UNCERTAIN' ? 'REGEN_DELIVERY_UNCERTAIN' : 'REGEN_INFRA_FAILED',
        kind,
        sent: sentOf(r),
        why: `${kind === 'DELIVERY_UNCERTAIN' ? '보냈지만 응답을 확인하지 못했다 — 다시 보내지 않는다' : '인프라 실패 — 원고 문제가 아니다'}: ${r?.why ?? ''}`,
        regenCalls: budget.used,
      }
    }
    return { ok: false, code: 'REGEN_RUNNER_FAILED', kind, why: r?.why ?? '재생성 경로 실패', regenCalls: bumped.regenCalls }
  }

  /**
   * 🔴 **원고가 한 글자도 안 바뀌었으면 더 보내지 않는다.**
   *    같은 원고를 같은 지적과 함께 다시 보내는 것은 예산만 태운다.
   */
  if (previousFingerprint && typeof fpOf === 'function') {
    const after = fpOf()
    if (after && after === previousFingerprint) {
      // 🔴 들고 있던 사본으로 덮지 않는다 — 자식이 방금 적은 전송 기록이 사라진다
      updateQuarantine((cur) => ({ ...cur, [slug]: { ...(cur[slug] ?? {}), regenCalls: MAX_REGEN_CALLS } }), quarantinePath)
      return { ok: false, code: 'REGEN_NO_CHANGE',
        why: '🔴 재생성했는데 원고가 그대로다 — 다시 보내도 같다. 이 글만 HOLD', regenCalls: MAX_REGEN_CALLS }
    }
  }

  /**
   * 🔴 `packetPath` 를 돌려주지 않는다. 그 파일은 이미 지웠다 —
   *    경로를 넘기면 호출부가 "남아 있는 파일" 을 증거로 다시 읽게 된다.
   *    남는 것은 장부의 `lastPacketHash` 하나다.
   */
  return { ok: true, code: 'REGENERATED', why: `실패 패킷 ${packet.failures.length}건 전달 후 원고 회수`,
    regenCalls: bumped.regenCalls, packetHash: hash }
}

/** 등록에 성공했다 — 재생성 횟수를 지운다 */
export function clearRegen(slug, quarantinePath = QUARANTINE_PATH) {
  const u = updateQuarantine((cur) => {
    const next = { ...cur }
    if (next[slug]) { const { regenCalls, lastPacketHash, lastRegenAt, ...rest } = next[slug]; next[slug] = rest }
    return next
  }, quarantinePath)
  return u.ok ? { ok: true } : { ok: false, why: u.why }
}
