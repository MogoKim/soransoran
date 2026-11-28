#!/usr/bin/env node
/**
 * vNext S4 생산기 진입점 (runbook §0.0B.1 ~ §0.0B.3 · §0.0B.5).
 *
 *   node scripts/magazine-vnext-produce.mjs --launcher [--dry-run]
 *        00:10 producer 자리 — `magazine-producer-run.mjs` 가 rollout vnext 일 때만 부른다.
 *        live 설정(`magazine-provider-live.json`)이 켜져 있을 때만 실제 생성, 아니면 **계획만**(쓰기 0 · 호출 0 · 종료 0).
 *   node scripts/magazine-vnext-produce.mjs --live          사람이 부르는 실제 생성 — rollout vnext · live 설정 ON · 승인된 client 와 키체인 동의가 모두 있어야 한다
 *   node scripts/magazine-vnext-produce.mjs --plan [--preview-target <n>]
 *        계획만 — 무엇을 만들지 · ProviderPlan 판정 · 기존 Job 상태. --preview-target 은 rollout 대신 vnext/draft/<n> 으로 가정한다(쓰기 0)
 *   node scripts/magazine-vnext-produce.mjs --canary <설정 파일> [--compare-revision]
 *        비교 시험은 원고 계약별 저장소에서 이어 간다. 이전 시험도 같은 비용 상한에 합산한다.
 *   node scripts/magazine-vnext-produce.mjs --rerun <planHash> --scope hero|all --by <이름>
 *        HOLD(또는 창업자 '아니오') 뒤 명시적 재호출 표시 — provider 호출 0. 다음 생산 회차가 이어 간다
 *
 * 🔴 fake provider 는 이 진입점에 없다 — 리허설은 `magazine-vnext-rehearsal.mjs`(격리 저장소)만 쓴다.
 * 🔴 이 프로세스는 키를 읽지 않는다. 고정 경로의 네이티브 client 가 키체인에서 직접 읽어 전송한다(설치 · 동의: `magazine-provider-client.mjs`).
 *    client 가 준비되지 않았으면(미설치 · 미승인 · 동의 없음) 요청을 기록하기 전에 KEY_UNAVAILABLE 로 끝난다(호출 0 · 종료 1).
 * 결과: JSON 한 줄(stdout). 실제 생성 회차는 `~/Library/Application Support/soransoran/magazine-produce/runs/<KST 날짜>/` 에도 남긴다.
 * 종료 코드: 정상(계획 · 할 일 없음 · 생성 · 잠금 대기 · 예산 정지) 0 · 막힘 1 · 사용법 2
 */
import { readdirSync, readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { randomUUID } from 'node:crypto'
import { readRollout } from './lib/magazine-rollout.mjs'
import { jobsRootPath } from './lib/magazine-release-candidates.mjs'
import { makeReleaseDeps, readMainFacts } from './lib/magazine-release-run.mjs'
import { LIVE_TEXT_RATES, NATIVE_CLIENT, manuscriptContractHash, makeNativeProviders, nativeClientStatus } from './lib/magazine-provider.mjs'
import { OK_OUTCOMES, liveConfigPath, readLiveConfig, rerunJob, runProduce } from './lib/magazine-vnext-produce.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')

/** main 사실 — release writer 와 같은 함수(readMainFacts)로 origin/main 바이트를 읽는다 */
export function readMainFromOrigin(root) {
  const rd = makeReleaseDeps({ root, stateRoot: null, jobsRoot: null, readRollout: null, readCandidates: null })
  if (!rd.fetchMain()) return { ok: false, code: 'FETCH_FAILED', why: 'origin/main 을 가져오지 못했다' }
  const baseSha = rd.readBaseSha()
  if (!baseSha) return { ok: false, code: 'BASE_SHA_UNKNOWN', why: 'origin/main SHA 를 읽지 못했다' }
  const f = readMainFacts(rd, baseSha)
  if (!f.articlesText || !f.controlText || !f.bundle) return { ok: false, code: 'MAIN_UNREADABLE', why: 'articles · control · Bundle 중 읽지 못한 것이 있다' }
  return { ok: true, baseSha, bundle: f.bundle, controlText: f.controlText, articlesText: f.articlesText, legacyQueue: f.legacyQueue }
}

/** 공개 hero — 작업 트리의 public/magazine/<slug>/hero.webp (지각 해시 중복 대조용 · 읽기만) */
export function publishedHeroesOf(root) {
  const dir = join(root, 'public', 'magazine')
  let slugs = []
  try { slugs = readdirSync(dir) } catch { return [] }
  return slugs.filter((s) => existsSync(join(dir, s, 'hero.webp'))).map((s) => ({ name: s, bytes: readFileSync(join(dir, s, 'hero.webp')) }))
}

// 공용 잠금을 잡은 뒤 호출한다. 수정 전 모델 폴더와 계약별 재시험 폴더를 모두 읽는다.
export function trialBudgetRoots(productionJobs, canaryDir) {
  let entries
  try { entries = readdirSync(canaryDir, { withFileTypes: true }) } catch (error) {
    if (error.code === 'ENOENT') return [productionJobs]
    throw error
  }
  const roots = [productionJobs]
  for (const entry of entries) {
    if (entry.isSymbolicLink()) throw Error('CANARY_ROOT_INVALID')
    if (entry.isDirectory()) roots.push(join(canaryDir, entry.name))
  }
  return roots
}

function readOptions(argv) {
  const options = {}
  for (const key of ['launcher', 'dry-run', 'live', 'plan', 'compare-revision']) options[key] = { type: 'boolean' }
  for (const key of ['canary', 'preview-target', 'rerun', 'scope', 'by']) options[key] = { type: 'string' }
  const { values, tokens } = parseArgs({ args: argv, options, tokens: true })
  const keys = tokens.map(token => token.name)
  const modes = ['launcher', 'live', 'plan', 'canary', 'rerun'].filter(k => k in values)
  if (new Set(keys).size !== keys.length || modes.length !== 1) throw Error('실행 모드를 하나만 지정하세요.')
  const allowed = { launcher: ['dry-run'], live: [], plan: ['preview-target'], canary: ['compare-revision'], rerun: ['scope', 'by'] }
  if (keys.some(k => k !== modes[0] && !allowed[modes[0]].includes(k))) throw Error('이 실행 모드에서 사용할 수 없는 옵션입니다.')
  if (modes[0] === 'rerun' && (!/^[0-9a-f]{64}$/.test(values.rerun) || !values.by?.trim() || !['hero', 'all'].includes(values.scope))) throw Error('--rerun <planHash> --scope hero|all --by <이름>')
  if ('preview-target' in values && !/^[1-9]$/.test(values['preview-target'])) throw Error('--preview-target <1~9>')
  if (modes[0] === 'canary' && !values.canary.trim()) throw Error('--canary <설정 파일>')
  return values
}

async function main() {
  let args
  try { args = readOptions(process.argv.slice(2)) } catch (e) { console.error(e.message); process.exit(2) }
  const home = homedir()
  const productionJobs = jobsRootPath({ home })
  const canaryConfig = args.canary
  const canaryModels = Object.keys(LIVE_TEXT_RATES)
  const state = dirname(productionJobs)
  const canaryDir = join(state, 'magazine-canary-jobs')
  let jobsRoot = productionJobs
  const nowIso = new Date().toISOString()

  if (args.rerun) {
    const r = rerunJob({ jobsRoot, planHash: args.rerun, scope: args.scope, by: args.by, nowIso })
    console.log(JSON.stringify(r))
    process.exit(r.ok ? 0 : 1)
  }
  const { launcher, live } = args
  const dry = args['dry-run'], preview = args['preview-target']
  const rollout = canaryConfig ? { code: 'VALID', effective: { path: 'vnext', release: 'draft', targetCandidates: 1 } } : preview ? { code: 'VALID', effective: { path: 'vnext', release: 'draft', targetCandidates: Number(preview) }, assumed: true } : readRollout()
  const liveCfg = readLiveConfig({ path: canaryConfig ?? liveConfigPath({ home }) })
  if (canaryConfig) {
    const c = liveCfg.config
    if (!liveCfg.on || c.stage !== 'S5_CANARY' || !canaryModels.includes(c.manuscript.model) ||
      c.image.model !== 'gpt-image-2.5-flare' || c.image.size !== '1536x864' || c.image.perImage < 0.14) {
      console.error('CANARY_CONFIG_INVALID'); process.exit(2)
    }
    const trial = args['compare-revision']
      ? c.manuscript.model + '-' + manuscriptContractHash(c.manuscript)
      : c.manuscript.model
    jobsRoot = join(canaryDir, trial)
  } else if (liveCfg.on && liveCfg.config.stage === 'S5_CANARY') {
    console.error('S5는 명시적인 --canary 설정으로만 호출한다'); process.exit(2)
  }
  const runMode = canaryConfig || (launcher && !dry && liveCfg.on) || (live && liveCfg.on) ? 'run' : 'plan'
  if (live && !liveCfg.on) { console.log(JSON.stringify({ outcome: 'LIVE_OFF', live: { code: liveCfg.code, why: liveCfg.why } })); process.exit(1) }

  let provider = null
  if (runMode === 'run') {
    const c = liveCfg.config
    const rates = LIVE_TEXT_RATES[c.manuscript.model]
    if (!rates || c.manuscript.inputPer1M !== rates.inputPer1M || c.manuscript.outputPer1M !== rates.outputPer1M ||
        c.image.model !== 'gpt-image-2.5-flare' || c.image.size !== '1536x864' || c.image.perImage < 0.14) {
      console.error('LIVE_PRICE_UNVERIFIED'); process.exit(1)
    }
    if (c.keychain.service !== NATIVE_CLIENT.service || c.keychain.account !== NATIVE_CLIENT.account) {
      console.log(JSON.stringify({ outcome: 'KEYCHAIN_CONFIG_MISMATCH', why: 'live 설정의 키체인 항목이 client 에 고정된 항목과 다르다' })); process.exit(1)
    }
    // 요청을 하나도 기록하기 전에 본다 — 설치본이 승인본과 같은지 · 키가 창 없이 읽히는지(네트워크 0 · 유료 호출 0)
    const client = await nativeClientStatus({ home })
    if (!client.ready) {
      console.log(JSON.stringify({ outcome: 'KEY_UNAVAILABLE', client, why: '네이티브 client 가 준비되지 않았다 — node scripts/magazine-provider-client.mjs status' })); process.exit(1)
    }
    const p = makeNativeProviders({ home })
    provider = { ...p, models: { manuscript: c.manuscript.model, image: c.image.model }, maxOutputTokens: c.manuscript.maxOutputTokens,
      repairMaxOutputTokens: c.manuscript.repairMaxOutputTokens, imageSize: c.image.size,
      prices: { manuscript: rates, image: { perImage: c.image.perImage } } }
  }
  const deps = {
    jobsRoot, lockRoot: productionJobs, readBudgetRoots: () => trialBudgetRoots(productionJobs, canaryDir),
    manuscriptOnly: Boolean(canaryConfig) && liveCfg.config.manuscript.model === 'gpt-6.1-terra',
    now: () => Date.now(), sleep: (ms) => new Promise((r) => setTimeout(r, ms)), runId: `${nowIso.replace(/[:.]/g, '-')}-${process.pid}-${randomUUID().slice(0, 8)}`,
    readRollout: () => rollout, readMain: () => readMainFromOrigin(ROOT), provider, stage: liveCfg.config?.stage ?? null, publishedHeroes: () => publishedHeroesOf(ROOT),
  }
  let produced
  try { produced = await runProduce({ deps, mode: runMode }) } catch (e) {
    produced = { outcome: 'PRODUCE_ERROR', error: { code: e?.code ?? e?.name ?? 'Error' } }
  }
  const report = { ...produced, live: { code: liveCfg.code, on: liveCfg.on, stage: liveCfg.config?.stage ?? null }, entry: canaryConfig ? 'canary' : launcher ? 'launcher' : live ? 'live' : 'plan' }
  if (runMode === 'run') {
    try {
      const dir = join(home, 'Library', 'Application Support', 'soransoran', 'magazine-produce', 'runs', new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10))
      mkdirSync(dir, { recursive: true, mode: 0o700 })
      writeFileSync(join(dir, `produce-${nowIso.replace(/[:.]/g, '-')}-${process.pid}.json`), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 })
    } catch (e) { console.error(`결과 파일을 남기지 못했다 (${e?.code ?? e?.message}) — 판정은 그대로다`) }
  }
  console.log(JSON.stringify(report))
  process.exit(OK_OUTCOMES.includes(report.outcome) ? 0 : 1)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
