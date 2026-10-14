/**
 * 🔴 **시험용 source runtime 트리** — 실제 운영 runtime 커밋(v7)을 임시 worktree 로 꺼내, 배포기와 같은 스니펫으로
 *    source snapshot 을 뜬다(2026-10-13 · contract-transition-v4 hotfix). 격리 DB 검사 전용이다.
 *
 *   🔴 source 판정을 이 저장소(target) 코드로 흉내 내지 않는다 — 그러면 hotfix 가 고친 결함(source 기록을 target 게이트로
 *      재해석)이 시험 안에서 그대로 숨는다. CI 는 `fetch-depth: 0` 이라 이 커밋을 꺼낼 수 있다.
 *   🔴 node_modules 는 이 저장소 것을 빌려 **실행만** 한다(prisma generate · build 0). 스키마는 그 커밋과 같다(검사가 대조한다).
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { RUNTIME_GATE_SNIPPET, SOURCE_SNAPSHOT_SNIPPET, readRuntimeGate, sealSnapshot, takeSourceSnapshot } from './source-snapshot.mjs'

/** 🔴 운영 보조 Mac 의 runtime 커밋(2026-10-13 · quality-v7 · draft-gates-v6.1) */
export const RUNTIME_FIXTURE_SHA = 'e4d31d688ab556470029679c380e9064663594f4'

export type RuntimeTree = { root: string; cleanup: () => void }

export function openRuntimeTree(repoRoot: string, sha = RUNTIME_FIXTURE_SHA): RuntimeTree {
  const root = join(mkdtempSync(join(tmpdir(), 'soran-rt-src-')), 'rt')
  execFileSync('git', ['worktree', 'add', '--detach', root, sha], { cwd: repoRoot, stdio: 'ignore' })
  // 🔴 스키마가 같은지 먼저 본다 — 다르면 빌린 client 로 옛 트리를 돌릴 수 없다
  const diff = execFileSync('git', ['diff', '--stat', sha, 'HEAD', '--', 'prisma/schema.prisma'], { cwd: repoRoot, encoding: 'utf-8' })
  if (diff.trim() !== '') throw new Error('runtime 커밋과 지금 저장소의 Prisma 스키마가 다르다 — 빌린 client 로 돌릴 수 없다')
  symlinkSync(join(repoRoot, 'node_modules'), join(root, 'node_modules'))
  return {
    root,
    cleanup: () => {
      try { execFileSync('git', ['worktree', 'remove', '--force', root], { cwd: repoRoot, stdio: 'ignore' }) } catch { /* 이미 없다 */ }
      if (existsSync(root)) rmSync(root, { recursive: true, force: true })
    },
  }
}

/** 🔴 배포기 `snapshotSource` 와 같다 — runtime 트리에서 snapshot · 게이트 판을 떠 봉인 파일로. 실패하면 null */
export function snapshotToFile(tree: RuntimeTree, file: string, env: NodeJS.ProcessEnv = process.env): { gate: string; unresolved: string[]; resolved: string[] } | null {
  const gate = readRuntimeGate(tree.root)
  const snap = takeSourceSnapshot(tree.root, env)
  if (gate === null || snap === null) {
    // 🔴 시험 진단 — 같은 스니펫을 다시 돌려 왜 못 떴는지 남긴다(DB 주소는 가린다)
    const why = (snippet: string): string => {
      try {
        execFileSync('npx', ['tsx', '-e', snippet], { cwd: tree.root, env, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120_000 })
        return 'exit 0'
      } catch (e) {
        const x = e as { status?: number | null; stdout?: string; stderr?: string }
        return `exit ${x.status ?? '?'} · ${`${x.stdout ?? ''}\n${x.stderr ?? ''}`.replace(/postgres(?:ql)?:\/\/\S+/g, '<db>').trim().split('\n').slice(-12).join(' | ')}`
      }
    }
    console.error(`source snapshot 실패 — gate ${gate === null ? why(RUNTIME_GATE_SNIPPET) : 'ok'} · snapshot ${snap === null ? why(SOURCE_SNAPSHOT_SNIPPET) : 'ok'}`)
    return null
  }
  writeFileSync(file, sealSnapshot(snap), 'utf-8')
  return {
    gate,
    unresolved: snap.defects.filter((d) => !d.resolved).map((d) => d.queueId),
    resolved: snap.defects.filter((d) => d.resolved).map((d) => d.queueId),
  }
}
