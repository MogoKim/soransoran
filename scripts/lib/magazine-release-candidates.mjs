/**
 * release 후보 판독 — Job 저장소(runbook §0.0B.1 · `magazine-jobs/<planHash>/job.json`)를 **읽기만** 한다 (S3-P2).
 *
 * S4(Job · provider · 검증 · hero)가 만드는 기록 중 release 가 쓰는 사실만 읽는다 — 이 파일이 S3 ↔ S4 인계 계약의 정본이다.
 *   job.json   schemaVersion 'magazine-job/1' · planId · planHash(폴더 이름과 같다) · providerPlanHash · slugProposal(원고가 낸 영문 slug) ·
 *              manuscript { file, sha256 } · validation { verdict } · hero { file, sha256 } · hold(null | { reason })
 *   <manuscript.file>  release 원고 JSON(`magazine-release-article/1` — 계약은 lib/magazine-release.mjs 의 articleProblems)
 *   <hero.file>        WebP 1200x675
 * 상태는 저장하지 않고 계산한다 — VALID ∧ HERO_READY ∧ HOLD 아님 = 후보. RELEASED 는 main 의 Article 출처가 말한다(admission 이 중복으로 뺀다).
 * 🔴 기록과 산출물 해시가 다르면 그 Job 만 빼고 이유를 돌려준다(다른 Job 은 계속). 저장소를 고치거나 지우지 않는다.
 */
import * as nodeFs from 'node:fs'
import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { readWebpSize } from './magazine-webp.mjs'

export const JOB_SCHEMA = 'magazine-job/1'
const HEX64 = /^[0-9a-f]{64}$/
const SAFE_FILE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/
const sha256 = (b) => createHash('sha256').update(b).digest('hex')

export const jobsRootPath = ({ home = homedir() } = {}) => join(home, 'Library', 'Application Support', 'soransoran', 'magazine-jobs')

/**
 * @returns {{ ok: boolean, code: string|null, candidates: object[], skipped: { dir: string, code: string }[] }}
 */
export function readReleaseCandidates({ jobsRoot, fs = nodeFs }) {
  let dirs
  try { dirs = fs.readdirSync(jobsRoot) } catch (e) {
    if (e?.code === 'ENOENT') return { ok: true, code: null, candidates: [], skipped: [] }
    return { ok: false, code: 'JOBS_UNREADABLE', candidates: [], skipped: [] }
  }
  const candidates = [], skipped = []
  for (const dir of dirs.sort()) {
    if (!HEX64.test(dir)) continue
    const base = join(jobsRoot, dir)
    const skip = (code) => skipped.push({ dir, code })
    let job
    try { job = JSON.parse(fs.readFileSync(join(base, 'job.json'), 'utf8')) } catch { skip('JOB_UNREADABLE'); continue }
    if (job?.schemaVersion !== JOB_SCHEMA || job.planHash !== dir || typeof job.planId !== 'string') { skip('JOB_SCHEMA'); continue }
    if (job.hold) continue // 그 Job 의 HOLD — 후보가 아니다(정상)
    if (job.validation?.verdict !== 'VALID') continue // 아직 검증 전 · 수리 중 — 정상
    if (!job.hero || !HEX64.test(String(job.hero.sha256)) || !SAFE_FILE.test(String(job.hero.file))) continue // HERO_READY 전 — 정상
    if (!job.manuscript || !HEX64.test(String(job.manuscript.sha256)) || !SAFE_FILE.test(String(job.manuscript.file))) { skip('JOB_MANUSCRIPT_MISSING'); continue }
    let mBytes, hBytes
    try { mBytes = fs.readFileSync(join(base, job.manuscript.file)); hBytes = fs.readFileSync(join(base, job.hero.file)) } catch { skip('JOB_ARTIFACT_MISSING'); continue }
    if (sha256(mBytes) !== job.manuscript.sha256 || sha256(hBytes) !== job.hero.sha256) { skip('JOB_ARTIFACT_MISMATCH'); continue }
    let article
    try { article = JSON.parse(mBytes.toString('utf8')) } catch { skip('JOB_MANUSCRIPT_UNREADABLE'); continue }
    let size = null
    try { size = readWebpSize(join(base, job.hero.file)) } catch { size = null }
    candidates.push({
      planId: job.planId, planHash: job.planHash, providerPlanHash: typeof job.providerPlanHash === 'string' ? job.providerPlanHash : null,
      slugProposal: typeof job.slugProposal === 'string' ? job.slugProposal : null, article,
      hero: { sha256: job.hero.sha256, width: size?.width ?? null, height: size?.height ?? null }, heroPath: join(base, job.hero.file),
    })
  }
  return { ok: true, code: null, candidates, skipped }
}
