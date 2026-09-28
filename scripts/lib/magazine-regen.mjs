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
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  MAX_REGEN_CALLS, QUARANTINE_PATH, readQuarantine, updateQuarantine,
  regenBudget, DELIVERY_HOLD_REASON, REGEN_EXHAUSTED_REASON, MANUSCRIPT_IN_PROGRESS_REASON, revertRegenAttempt,
} from './magazine-quarantine.mjs'
import { deliveryGate } from './magazine-delivery-gate.mjs'
import { DRAFTS_DIR } from './magazine-load.mjs'
import { classifyFailure, consumesAttempt, sentOf } from './magazine-failure-kind.mjs'


export { MAX_REGEN_CALLS }

/** 🔴 저장소 밖 — 패킷은 전달용 임시 파일이다 */
export const PACKET_DIR = join(homedir(), 'Library', 'Application Support', 'soransoran', 'regen-packets')
/**
 * 🔴 **패킷 경로는 slug + 시도 UUID 다** (2026-09-28 · Codex P1).
 *    앞판은 `${slug}.json` 하나를 같은 slug 의 모든 재생성이 같이 썼다. 두 프로세스가 동시에
 *    돌면 한쪽이 다른 쪽 패킷을 덮어 **남의 지적을 읽고**, 한쪽 `finally` 가 **남의 패킷을 지웠다.**
 *    이제 각 시도는 자기 파일만 쓰고, 자기 파일만 읽히고, 자기 파일만 지운다.
 */
export const packetPathFor = (slug, dir = PACKET_DIR, attemptId) => {
  if (!attemptId) throw new TypeError('packetPathFor 는 시도 UUID 가 필요하다 — slug 하나로 공유하지 않는다')
  return join(dir, `${slug}.${attemptId}.json`)
}
/** 이 slug 의 패킷이 폴더에 남아 있는가 — 🔴 시도 UUID 가 붙은 이름까지 전부 센다 */
export const packetsLeftFor = (slug, dir = PACKET_DIR) =>
  (existsSync(dir) ? readdirSync(dir) : []).filter((f) => f === `${slug}.json` || f.startsWith(`${slug}.`))

/**
 * 🔴 **기계가 읽는 실패 패킷.** 사람이 읽는 설명이 아니라
 *    "어느 코드가 어느 문장에서 터졌나" 를 그대로 담아 재생성 지시에 넣는다.
 */
export function buildFailurePacket({ slug, profile, failures, attempt, attemptId = null }) {
  const rows = (failures ?? []).map((f) => ({
    code: f.code, label: f.label ?? f.message ?? '', sentence: String(f.sentence ?? '').slice(0, 160),
  }))
  return {
    schemaVersion: 'regen-packet/3',
    slug,
    // 🔴 이 시도의 표식 — 패킷 파일 이름과 자식이 올린 regenCalls 를 잇는다 (지시문에는 들어가지 않는다)
    attemptId,
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

  const attemptId = randomUUID()
  const packet = buildFailurePacket({ slug, profile, failures, attempt: budget.used + 1, attemptId })
  const hash = packetHashOf(packet)

  /**
   * 🔴 **이미 보낸 재생성 요청이면 아무것도 시작하지 않는다** (앞단 확인 · 불필요한 Chrome 회피).
   *    판정은 전송 경계와 **같은 함수**(`deliveryGate`)다. 위 `packet` 은 메모리의 값일 뿐이다.
   *    HOLD 면 packet 파일 0 · runner 0 · Chrome/probe/send 0 · 장부 쓰기 0 이다.
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
   * 🔴 **부모는 regenCalls 를 올리지 않는다** (2026-09-28 · Codex P0).
   *    앞판은 여기서 runner **전에** 올렸다. 두 부모가 위 앞단 확인을 동시에 통과하면 **둘 다 올렸고**,
   *    runner 가 HOLD 를 돌려준 뒤 진 쪽이 들고 있던 옛 `budget.used` 로 **이긴 쪽 횟수까지 되돌렸다.**
   *    횟수는 이제 자식이 **send 직전 예약과 같은 임계구역**(`reserveDelivery`)에서만 오른다.
   *    예약을 못 얻은 시도는 어디서 죽어도 횟수를 쓰지 않는다.
   *
   * 🔴 무한 반복을 막는 것은 「같은 실패 코드」가 아니라 「안 바뀐 원고」다 (아래 `previousFingerprint`).
   */
  const packetPath = writePacket(packet, packetPathFor(slug, packetDir, attemptId))

  /**
   * 🔴 **runner 가 돌아온 뒤에만** 지운다 — 읽기 전에 지우면 전달 자체가 깨진다.
   *    성공·실패·예외 **세 경우 모두** `finally` 에서 지운다. **자기 시도의 파일만** 지운다.
   */
  let r
  try { r = runner({ slug, packet, packetPath }) }
  catch (e) { r = { ok: false, why: `재생성 경로 예외: ${e.message}` } }
  finally { removePacket(packetPath) }

  /** 🔴 횟수는 추측하지 않고 **최신 장부에서** 읽는다 */
  const usedNow = () => {
    const x = readQuarantine(quarantinePath)
    return x.ok ? regenBudget({ entry: x.store[slug] }).used : budget.used
  }

  /**
   * 🔴 **전송 경계가 HOLD·소진으로 멈췄다** — 자식은 예약도 횟수도 적지 않았다.
   *    그러니 부모도 **아무것도 바꾸지 않는다.** 되돌릴 것이 없다.
   */
  if (r?.reason === DELIVERY_HOLD_REASON) {
    return {
      ok: false, code: 'REGEN_DELIVERY_HOLD', kind: 'DELIVERY_UNCERTAIN', held: true,
      // 🔴 `sent` 는 이번 실행(0건) · `priorSent` 는 앞선 전송의 사실(대개 모름=null)
      sent: false, priorSent: r.prior ? (r.prior.sent ?? null) : null,
      messageFingerprint: r.messageFingerprint ?? null,
      why: `이미 보낸 재생성 요청이다 — 다시 보내지 않는다 (전송 0건): ${r?.why ?? ''}`,
      regenCalls: usedNow(),
    }
  }
  /**
   * 🔴 **같은 slug 의 다른 원고 작업(일반 회수·재생성)이 진행 중이다** — 자식은 lease 를 못 잡아 probe·send·draft·횟수 전부 0.
   *    부모도 아무것도 바꾸지 않는다. 승자가 끝난 뒤 다음 회차가 (지문이 바뀌었으면) 다시 시도한다.
   */
  if (r?.reason === MANUSCRIPT_IN_PROGRESS_REASON) {
    return { ok: false, code: 'REGEN_IN_PROGRESS', kind: 'DELIVERY_UNCERTAIN', held: true, sent: false,
      attemptId, childAttemptId: r.attemptId ?? null, packetHash: hash,
      why: `같은 slug 의 원고 작업이 진행 중이다 — 기다리지 않고 멈춘다 (전송 0건): ${r?.why ?? ''}`,
      regenCalls: usedNow() }
  }
  /**
   * 🔴 **자식이 다른 시도의 패킷을 읽었다** — 이 결과를 이 시도의 것으로 믿지 않는다.
   *    어느 몫도 되돌리지 않는다 (누구의 횟수인지 모르므로 보수적으로 둔다).
   */
  if (r?.attemptId && r.attemptId !== attemptId) {
    return { ok: false, code: 'REGEN_ATTEMPT_MISMATCH', held: true, sent: sentOf(r), attemptId,
      childAttemptId: r.attemptId, packetHash: hash,
      why: `자식이 다른 시도의 패킷을 읽었다 (${r.attemptId} ≠ ${attemptId})`, regenCalls: usedNow() }
  }
  if (r?.reason === REGEN_EXHAUSTED_REASON) {
    const used = usedNow()
    return { ok: false, code: 'REGEN_EXHAUSTED',
      why: `🔴 재생성 ${used}회를 이미 썼다 (상한 ${MAX_REGEN_CALLS}) — 이 글만 HOLD (전송 0건)`, regenCalls: used }
  }

  if (!r?.ok) {
    /**
     * 🔴 **구조화된 값을 그대로 넘긴다** — `sent` 는 세 값(보냄/안 보냄/모름)이다.
     */
    const kind = classifyFailure({
      code: r?.reason ?? 'REGEN_RUNNER_FAILED',
      stage: r?.stage ?? null,
      message: [r?.why, r?.errorName, r?.errorDetail].filter(Boolean).join(' · '),
      sent: sentOf(r),
    }).kind
    if (!consumesAttempt(kind)) {
      /**
       * 🔴 **인프라·전송불명은 원고 탓이 아니다 — 자식이 올린 횟수를 되돌린다.**
       *    단, ① 자식이 **정상 종료해 결과를 적은 경우**(`resultSource: 'file'`)만, ② **자기 시도의 몫**만
       *    (`attemptId` compare-and-set) 되돌린다. 옛 `budget.used` 로 덮지 않는다 — 그 사이 다른 시도가
       *    올린 횟수를 지우게 된다. 자식이 결과 없이 죽었으면(급사) 예약과 횟수를 **보수적으로 남긴다.**
       */
      const finished = r?.resultSource === 'file'
      revertRegenAttempt({ slug, attemptId: finished ? attemptId : null,
        extra: { kind, sent: sentOf(r), lastRegenAt: now }, path: quarantinePath })
      return {
        ok: false,
        code: kind === 'DELIVERY_UNCERTAIN' ? 'REGEN_DELIVERY_UNCERTAIN' : 'REGEN_INFRA_FAILED',
        kind,
        sent: sentOf(r),
        why: `${kind === 'DELIVERY_UNCERTAIN' ? '보냈지만 응답을 확인하지 못했다 — 다시 보내지 않는다' : '인프라 실패 — 원고 문제가 아니다'}: ${r?.why ?? ''}`,
        regenCalls: usedNow(),
      }
    }
    return { ok: false, code: 'REGEN_RUNNER_FAILED', kind, why: r?.why ?? '재생성 경로 실패', regenCalls: usedNow() }
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
    regenCalls: usedNow(), packetHash: hash, attemptId, childAttemptId: r.attemptId ?? null }
}

/** 등록에 성공했다 — 재생성 횟수를 지운다 */
export function clearRegen(slug, quarantinePath = QUARANTINE_PATH) {
  const u = updateQuarantine((cur) => {
    const next = { ...cur }
    if (next[slug]) { const { regenCalls, lastPacketHash, lastRegenAt, regenAttemptIds, ...rest } = next[slug]; next[slug] = rest }
    return next
  }, quarantinePath)
  return u.ok ? { ok: true } : { ok: false, why: u.why }
}
