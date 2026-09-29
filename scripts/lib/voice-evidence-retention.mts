/**
 * **말투 근거 삭제** — 보존 기한이 지난 줄 · 삭제 요청 화자의 줄을 **파일에서 지운다** (2026-09-29, #624 보정)
 *
 * 🔴 **왜 있는가.** `rowsFromVoiceEvidence` 는 90일이 지난 줄을 **읽지 않을 뿐**(`EXPIRED`) 지우지 않았다.
 *    읽지 않는 것은 보존이 아니라 보관이다 — 파일은 디스크에 그대로 남는다. 보존 기한이 약속이 되려면
 *    실제로 지우는 경로가 있어야 한다. 이 파일이 그 경로다.
 *
 * 🔴 **예약하지 않는다.** launchd 에 걸지 않는다 — 사람이 `persona:voice-evidence-purge` 로 부른다.
 *    기본은 계획만(write 0)이고 `--execute` 일 때만 지운다.
 *
 * 🔴 **건드리는 파일은 하나의 꼴뿐이다** — `navercafe-voice-*.voice-evidence.jsonl`.
 *    thin · 목록 · 원장 · 회차 기록은 이름이 달라 여기 걸리지 않는다. 하위 디렉터리로 내려가지 않는다.
 *
 * 🔴 **줄의 나이** — `capturedAt` 이 읽히면 그것, 못 읽는 줄(깨진 줄)은 **파일 수정 시각**이다.
 *    나이를 모른다고 영원히 남기지 않는다.
 *
 * 🔴 **삭제 요청** — 화자 해시(`speakerHashOf(salt, 출처, 작성자 표시)`)를 넘기면 그 화자의 줄을 지운다.
 *    해시는 salt 를 가진 사람만 계산할 수 있다 — salt 가 없으면 삭제 요청을 **특정할 수 없다**.
 *
 * 🔴 파일에서 줄을 빼야 하면 임시 파일에 쓰고 rename 한다(반쯤 쓰인 파일을 남기지 않는다).
 *    남는 줄이 0 이면 파일을 지운다. 줄 내용은 출력하지 않는다 — 개수만 돌려준다.
 */
import { readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { VOICE_EVIDENCE_RETENTION_DAYS, VOICE_EVIDENCE_SUFFIX } from './voice-evidence-capture.mjs'

export const VOICE_EVIDENCE_FILE = /^navercafe-voice-[a-z0-9_-]+-.+\.voice-evidence\.jsonl$/i

export type PurgeFilePlan = {
  file: string
  lines: number
  expired: number
  requested: number
  keep: number
  action: 'keep' | 'rewrite' | 'delete'
}

export type PurgeResult = {
  executed: boolean
  files: PurgeFilePlan[]
  totals: { files: number; lines: number; expired: number; requested: number; deletedFiles: number; rewrittenFiles: number }
}

/**
 * 🔴 **보존 기한 · 삭제 요청대로 말투 근거 파일을 정리한다.**
 *    `execute: false` 면 파일을 **읽기만** 하고 계획을 돌려준다.
 */
export function purgeVoiceEvidence(input: {
  dataDir: string
  now: Date
  execute: boolean
  /** 삭제 요청 화자 — `vs1:` 해시. 🔴 원래 이름을 받지 않는다 */
  speakerHashes?: readonly string[]
  retentionDays?: number
}): PurgeResult {
  const days = input.retentionDays ?? VOICE_EVIDENCE_RETENTION_DAYS
  const cutoff = input.now.getTime() - days * 86_400_000
  const requested = new Set(input.speakerHashes ?? [])
  const files: PurgeFilePlan[] = []
  let deletedFiles = 0
  let rewrittenFiles = 0

  const names = readdirSync(input.dataDir).filter((n) => n.endsWith(VOICE_EVIDENCE_SUFFIX) && VOICE_EVIDENCE_FILE.test(n)).sort()
  for (const name of names) {
    const path = join(input.dataDir, name)
    const st = statSync(path)
    if (!st.isFile()) continue
    const raw = readFileSync(path, 'utf-8').split('\n').filter((l) => l.trim() !== '')
    let expired = 0
    let req = 0
    const keep: string[] = []
    for (const l of raw) {
      let at = st.mtimeMs
      let speaker: unknown = null
      try {
        const o = JSON.parse(l) as { capturedAt?: unknown; speakerHash?: unknown }
        const t = typeof o.capturedAt === 'string' ? Date.parse(o.capturedAt) : Number.NaN
        if (!Number.isNaN(t)) at = t
        speaker = o.speakerHash
      } catch { /* 깨진 줄 — 파일 시각으로 나이를 잰다 */ }
      if (at < cutoff) { expired += 1; continue }
      if (typeof speaker === 'string' && requested.has(speaker)) { req += 1; continue }
      keep.push(l)
    }
    const action: PurgeFilePlan['action'] = keep.length === 0 ? 'delete' : keep.length < raw.length ? 'rewrite' : 'keep'
    files.push({ file: name, lines: raw.length, expired, requested: req, keep: keep.length, action })
    if (!input.execute || action === 'keep') continue
    if (action === 'delete') {
      unlinkSync(path)
      deletedFiles += 1
    } else {
      const tmp = `${path}.tmp-${process.pid}`
      writeFileSync(tmp, keep.map((l) => `${l}\n`).join(''), 'utf-8')
      renameSync(tmp, path)
      rewrittenFiles += 1
    }
  }
  const sum = (k: 'lines' | 'expired' | 'requested'): number => files.reduce((a, f) => a + f[k], 0)
  return {
    executed: input.execute,
    files,
    totals: {
      files: files.length, lines: sum('lines'), expired: sum('expired'), requested: sum('requested'),
      deletedFiles, rewrittenFiles,
    },
  }
}
