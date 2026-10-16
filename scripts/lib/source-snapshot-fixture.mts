/**
 * 🔴 **시험용 source runtime 트리** — 실제 운영 runtime 커밋(v7)을 임시 worktree 로 꺼내, 배포기와 같은 스니펫으로
 *    source snapshot 을 뜬다(2026-10-13 · contract-transition-v4 hotfix). 격리 DB 검사 전용이다.
 *
 *   🔴 source 판정을 이 저장소(target) 코드로 흉내 내지 않는다 — 그러면 hotfix 가 고친 결함(source 기록을 target 게이트로
 *      재해석)이 시험 안에서 그대로 숨는다. CI 는 `fetch-depth: 0` 이라 이 커밋을 꺼낼 수 있다.
 *   🔴 node_modules 는 이 저장소 것을 빌려 **실행만** 한다(prisma generate · build 0). 스키마는 그 커밋과 같다(검사가 대조한다).
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { RUNTIME_GATE_SNIPPET, SOURCE_SNAPSHOT_SNIPPET, readRuntimeGate, sealSnapshot, takeSourceSnapshot } from './source-snapshot.mjs'

/** 🔴 운영 보조 Mac 의 runtime 커밋(2026-10-13 · quality-v7 · draft-gates-v6.1) */
export const RUNTIME_FIXTURE_SHA = 'e4d31d688ab556470029679c380e9064663594f4'

export type RuntimeTree = { root: string; cleanup: () => void }

type PrismaBlock = { kind: 'model' | 'enum'; name: string; lines: string[] }

function schemaBlocks(source: string): Map<string, PrismaBlock> {
  const blocks = new Map<string, PrismaBlock>()
  const re = /^(model|enum)\s+(\w+)\s*\{([\s\S]*?)^\}/gm
  for (const match of source.matchAll(re)) {
    const kind = match[1] as PrismaBlock['kind']
    const name = match[2]!
    const lines = match[3]!
      .split('\n')
      .map((line) => line.replace(/\/\/.*$/, '').trim())
      .filter(Boolean)
    blocks.set(`${kind}:${name}`, { kind, name, lines })
  }
  return blocks
}

function withoutBlocks(source: string): string {
  return source
    .replace(/^(?:model|enum)\s+\w+\s*\{[\s\S]*?^\}/gm, '')
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, '').trim())
    .filter(Boolean)
    .join('\n')
}

function isSubsequence(needles: readonly string[], haystack: readonly string[]): boolean {
  let at = 0
  for (const line of haystack) if (line === needles[at]) at += 1
  return at === needles.length
}

/**
 * 옛 runtime 코드가 현재 Prisma Client를 빌려 써도 되는 additive schema인지 판정한다.
 * 기존 datasource·generator·model·enum은 그대로여야 한다. 예외는 새 model로 향하는
 * 역관계 배열뿐이다. 새 scalar나 기존 필드 변경은 계속 fail-closed다.
 */
export function schemaCompatibleForBorrowedClient(runtimeSource: string, currentSource: string): boolean {
  if (withoutBlocks(runtimeSource) !== withoutBlocks(currentSource)) return false

  const runtime = schemaBlocks(runtimeSource)
  const current = schemaBlocks(currentSource)
  const newModels = new Set(
    [...current.values()]
      .filter((block) => block.kind === 'model' && !runtime.has(`model:${block.name}`))
      .map((block) => block.name),
  )

  for (const [key, oldBlock] of runtime) {
    const next = current.get(key)
    if (!next || next.kind !== oldBlock.kind) return false
    if (oldBlock.kind === 'enum') {
      if (JSON.stringify(oldBlock.lines) !== JSON.stringify(next.lines)) return false
      continue
    }

    const extras = next.lines.filter((line) => !oldBlock.lines.includes(line))
    if (!isSubsequence(oldBlock.lines, next.lines)) return false
    if (extras.some((line) => {
      const field = /^(\w+)\s+(\w+)\[\](?:\s+.*)?$/.exec(line)
      return field === null || !newModels.has(field[2]!)
    })) return false
  }
  return true
}

export function openRuntimeTree(repoRoot: string, sha = RUNTIME_FIXTURE_SHA): RuntimeTree {
  const root = join(mkdtempSync(join(tmpdir(), 'soran-rt-src-')), 'rt')
  execFileSync('git', ['worktree', 'add', '--detach', root, sha], { cwd: repoRoot, stdio: 'ignore' })
  // 🔴 기존 model·필드가 같고 새 model만 더해진 경우에만 현재 client를 빌린다.
  const runtimeSchema = readFileSync(join(root, 'prisma/schema.prisma'), 'utf8')
  const currentSchema = readFileSync(join(repoRoot, 'prisma/schema.prisma'), 'utf8')
  if (!schemaCompatibleForBorrowedClient(runtimeSchema, currentSchema)) {
    throw new Error('runtime 커밋과 지금 저장소의 기존 Prisma 계약이 다르다 — 빌린 client 로 돌릴 수 없다')
  }
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
