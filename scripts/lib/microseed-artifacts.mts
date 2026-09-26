/**
 * 🔴 **공급 artifact 정본 색인 — 읽기는 여기 하나다** (2026-09-25)
 *
 *   `*.artifacts.json` · `*.candidates.json` 을 읽어 artifactId → 문서 목록 색인을 만든다.
 *   scan · 복원 · 배치 검토 묶음이 **같은 색인**을 쓴다. 따로 읽으면 한쪽만 중복을 놓친다.
 *   🔴 같은 artifactId 가 둘 이상이면 목록에 둘 다 남긴다 — 고르지 않는다(ambiguous 판정은 호출자가 한다).
 *   🔴 파일만 읽는다. DB·네트워크를 모른다.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import type { ArtifactDoc, CandidateDoc } from '../../src/lib/auto-ready-evidence'

export const DEFAULT_ARTIFACT_DIR = join(homedir(), 'Library', 'Application Support', 'soransoran', 'microseed-data')

const S = (v: unknown): string => (typeof v === 'string' ? v : '')
const rec = (v: unknown): Record<string, unknown> =>
  (v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {})

export type ArtifactIndex = {
  artifacts: Map<string, ArtifactDoc[]>
  candidates: Map<string, CandidateDoc[]>
  files: { artifacts: number; candidates: number }
  /** `${file}#${artifactId}` → 원본 객체 — 검토 묶음이 원문을 보일 때 쓴다 */
  raw: Map<string, Record<string, unknown>>
}

export function loadArtifactIndex(dir: string = DEFAULT_ARTIFACT_DIR): ArtifactIndex {
  const artifacts = new Map<string, ArtifactDoc[]>()
  const candidates = new Map<string, CandidateDoc[]>()
  const raw = new Map<string, Record<string, unknown>>()
  const names = readdirSync(dir)
  const aFiles = names.filter((n) => n.endsWith('.artifacts.json'))
  const cFiles = names.filter((n) => n.endsWith('.candidates.json'))
  for (const f of aFiles) {
    const arr = JSON.parse(readFileSync(join(dir, f), 'utf8')) as unknown
    for (const a of Array.isArray(arr) ? arr : []) {
      const r = rec(a)
      const id = S(r.artifactId)
      if (id === '') continue
      const doc: ArtifactDoc = {
        file: f, artifactId: id, sourceArticleId: S(r.sourceArticleId),
        contract: rec(r.contract), planPersonaCode: S(rec(r.plan).personaCode) || null,
        voice: rec(rec(r.voice).provenance),
        draft: { title: S(rec(r.draft).title), body: S(rec(r.draft).body) },
        review: r.review,
      }
      artifacts.set(id, [...(artifacts.get(id) ?? []), doc])
      raw.set(`${f}#${id}`, r)
    }
  }
  for (const f of cFiles) {
    const env = rec(JSON.parse(readFileSync(join(dir, f), 'utf8')))
    for (const c of Array.isArray(env.candidates) ? env.candidates : []) {
      const r = rec(c)
      const id = S(r.artifactId)
      if (id === '') continue
      const doc: CandidateDoc = { file: f, artifactId: id, sourceArticleId: S(r.sourceArticleId), sourceSite: S(r.sourceSite) }
      candidates.set(id, [...(candidates.get(id) ?? []), doc])
    }
  }
  return { artifacts, candidates, files: { artifacts: aFiles.length, candidates: cFiles.length }, raw }
}
