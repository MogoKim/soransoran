#!/usr/bin/env node
/**
 * Magazine vNext S1 경계 검사 변이 — 위반을 하나씩 되살리면 `magazine-vnext-boundary-check` 가 그 규칙으로 실패해야 한다.
 *
 *   node scripts/magazine-vnext-boundary-mutation.mjs
 *
 * 🔴 저장소 파일을 고치지 않는다. package.json · scripts/*.m[jt]s · scripts/lib/*.mjs 를 **시작할 때 한 번 읽어 둔 스냅샷**에서
 *    임시 폴더로 쓰고, 사본 하나에 변이 하나를 심어 MAGAZINE_VNEXT_BOUNDARY_ROOT 로 넘긴다(검사는 읽기만 한다).
 * 🔴 숨김 파일(`.` 로 시작)은 복사하지 않는다 — 다른 검사가 같은 폴더에 잠깐 만들었다 지우는 변이 사본(`.dssc-*` 등)이
 *    목록과 복사 사이에 사라지면 ENOENT 로 하네스가 통째로 죽는다(2026-11-09 Codex 재현). 검사도 그 파일을 보지 않는다.
 * 🔴 무변이 사본이 먼저 fail 0 이어야 한다. 변이 지점이 정확히 1곳이 아니면 하네스 FAIL(검출로 세지 않는다).
 * 🔴 검출 = exit 1 + 기대한 규칙 줄 `FAIL <규칙> ` · 대조군(NC*)은 exit 0 이어야 한다(오탐 방지).
 * 🔴 어떤 예외든 요약 줄을 남기고 하네스 FAIL 로 끝난다 — 요약 없이 죽으면 호출자가 검출 수를 읽을 수 없다.
 * 🔴 집계는 둘로 나눈다 — 변이(VB*)는 기대한 규칙이 실패했을 때만 detected, 대조군(NC*)은 오탐 없이 통과했을 때만 control pass.
 *    둘을 한 숫자로 합치면 "변이 N개 검출" 이 대조군까지 센 값이 된다. 하네스 실패(fail)는 둘 다·하네스 결함을 합산한다.
 * 마지막 줄: `vNext 경계 변이: <검출>/<변이 수> detected · 대조군 <통과>/<대조군 수> · <n> fail`
 */
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const CHECK = join(HERE, 'magazine-vnext-boundary-check.mjs')

/**
 * [id, 설명, 기대(규칙 ID | 'PASS'), 편집[]] — 편집은 { file, from, to } 치환(from 정확히 1곳) · { file, append } · { file, create }
 */
const MUTATIONS = [
  ['VB1', 'lib 가 QA CLI 를 새로 정적 import', 'R1', [{ file: 'scripts/lib/magazine-editorial.mjs', append: "import { runQa } from '../magazine-qa.mjs'\n" }]],
  ['VB2', 'lib 가 CLI 를 동적 import(경로 문자열)', 'R1', [{ file: 'scripts/lib/magazine-rehearsal-content.mjs', append: "const X = await import(pathToFileURL(join(REPO, 'scripts/magazine-batch-qa.mjs')).href)\n" }]],
  ['VB3', 'hero 가 readWebpSize 를 다시 QA CLI 에서 import(C3 이전으로 되돌림)', 'R1', [{ file: 'scripts/lib/magazine-hero.mjs', from: "import { readWebpSize } from './magazine-webp.mjs'\n", to: "import { readWebpSize } from '../magazine-qa.mjs'\n" }]],
  ['VB18', 'lib 가 여러 줄 정적 import 로 CLI 를 부른다', 'R1', [{ file: 'scripts/lib/magazine-editorial.mjs', append: "import {\n  runQa,\n  BANNED_WORDS,\n} from\n  '../magazine-qa.mjs'\n" }]],
  ['VB19', 'lib 가 여러 줄 동적 import 로 CLI 를 부른다', 'R1', [{ file: 'scripts/lib/magazine-rehearsal-content.mjs', append: "const Y = await import(\n  pathToFileURL(\n    join(REPO, 'scripts/magazine-qa.mjs'),\n  ).href,\n)\n" }]],
  ['VB20', 'lib 가 부수효과 import 로 CLI 를 부른다', 'R1', [{ file: 'scripts/lib/magazine-editorial.mjs', append: "import '../magazine-batch-qa.mjs'\n" }]],
  ['VB4', '다른 lib 가 QA 원문을 읽어 다시 파싱', 'R2', [{ file: 'scripts/lib/magazine-editorial.mjs', append: "const QA_SRC = readFileSync(join(ROOT, 'scripts/magazine-qa.mjs'), 'utf8')\n" }]],
  ['VB5', 'BANNED_WORDS 값 사본을 새로 둔다', 'R3a', [{ file: 'scripts/lib/magazine-g8-promoter.mjs', append: "const LOCAL_BANNED = ['시니어', '어르신', '노인', '실버']\n" }]],
  ['VB21', 'BANNED_WORDS 를 정본 모듈 안에 두 번째로 둔다', 'R3a', [{ file: 'scripts/lib/magazine-qa-constants.mjs', append: "export const BANNED_AGAIN = ['시니어', '어르신', '노인', '실버']\n" }]],
  ['VB6', 'MEDICAL_ASSERTIONS 값 사본을 새로 둔다', 'R3b', [{ file: 'scripts/lib/magazine-article-spec.mjs', append: "const LOCAL_MED = ['반드시', '치료됩니다', '원인입니다', '완치', '효과적입니다']\n" }]],
  ['VB7', 'MEDICAL_REQUIRED 사본을 새로 둔다', 'R3c', [{ file: 'scripts/lib/magazine-judge.mjs', append: "const LOCAL_REQ = new Set(['menopause-symptom', 'sleep', 'clinic'])\n" }]],
  ['VB8', 'HERO 크기 상수 사본을 CLI 에 둔다', 'R3d', [{ file: 'scripts/magazine-hero-runner.mjs', append: 'const HERO_WIDTH = 1200\n' }]],
  ['VB9', 'sliceLiteral 사본을 새로 둔다', 'R4', [{ file: 'scripts/lib/magazine-gate.mjs', append: 'function sliceLiteral(source, fromIndex, open, close) { return null }\n' }]],
  ['VB22', '정본 literal 모듈 안에 sliceLiteral 을 두 번째로 둔다', 'R4', [{ file: 'scripts/lib/magazine-literal.mjs', append: 'function sliceLiteral2() {}\nfunction sliceLiteral(a) { return a }\n' }]],
  ['VB23', '정본 literal 모듈 안에 evalLiteral 을 두 번째로 둔다', 'R4', [{ file: 'scripts/lib/magazine-literal.mjs', append: 'function evalLiteral(a) { return a }\n' }]],
  ['VB10', 'WebP 헤더 판독 사본을 새로 둔다', 'R5', [{ file: 'scripts/lib/magazine-hero-webp.mjs', append: 'function readWebpSize(path) { return null }\n' }]],
  ['VB24', 'QA 에 WebP 헤더 파싱을 되살린다(정본은 lib)', 'R5', [{ file: 'scripts/magazine-qa.mjs', append: "const isWebp = (buf) => buf.toString('ascii', 8, 12) === 'WEBP'\n" }]],
  ['VB11', 'control 리터럴 판독 사본을 새로 둔다', 'R6', [{ file: 'scripts/lib/magazine-research-current.mjs', append: "const CONTROL_AT = String(x).indexOf('export const CONTROL')\n" }]],
  ['VB25', 'graph-build 안에 control 판독을 두 번째로 둔다', 'R6', [{ file: 'scripts/lib/magazine-graph-build.mjs', append: "const CONTROL_AT2 = String(x).indexOf('export const CONTROL')\n" }]],
  // S1 C4 — qa-core 가 생겼다. 새 lib 를 만드는 대신 이미 있는 S1 lib 를 m3a FILES 에서 뺀다(앞으로 lib 가 늘어도 대상이 사라지지 않는다)
  ['VB12', 'S1 lib(qa-core)를 m3a FILES 스캔에서 뺀다', 'R7', [{ file: 'scripts/magazine-m3a-check.mjs', from: "'scripts/lib/magazine-webp.mjs','scripts/lib/magazine-qa-core.mjs',\n", to: "'scripts/lib/magazine-webp.mjs',\n" }]],
  ['VB13', 'QA 구현을 옮겼는데 변이 겨냥 문장이 0곳(겨냥 파일)', 'R8', [{ file: 'scripts/lib/magazine-qa-core.mjs', from: '  if (!body.hard.ok) report.fail(', to: '  if (!body.hard.ok)  report.fail(' }]],
  ['VB14', '하네스 쪽 겨냥 문장만 바꾸고 표를 옮기지 않음', 'R8', [{ file: 'scripts/magazine-direct-spec-source-check.mjs',
    from: "\"  try { raw = parseDataLiteral(literal) } catch (err) { if (err instanceof ControlLocateError) return null; throw err }\", \"  raw = parseDataLiteral(literal)\"]",
    to: "\"  try { raw = parseDataLiteral(literal) } catch (err) { if (err instanceof ControlLocateError) return  null; throw err }\", \"  raw = parseDataLiteral(literal)\"]" }]],
  ['VB15', 'CI 체인에서 경계 검사를 뺀다', 'R9', [{ file: 'package.json', from: ' && node scripts/magazine-vnext-boundary-check.mjs', to: '' }]],
  ['VB16', 'CI 체인에서 경계 변이를 뺀다', 'R9', [{ file: 'package.json', from: ' && node scripts/magazine-vnext-boundary-mutation.mjs', to: '' }]],
  ['VB17', '운영 CLI 가 QA CLI 를 새로 import', 'R10', [{ file: 'scripts/magazine-dashboard.mjs', append: "import { runQa } from './magazine-qa.mjs'\n" }]],
  // 🔴 펼침 사본은 값 리터럴이 없어 R3 정규식을 피한다 — R11(실제 적재 · 객체 동일성)이 잡아야 한다
  ['VB27', 'brief 정책이 정본 대신 펼친 사본을 내보낸다(리터럴 없음)', 'R11', [{ file: 'scripts/lib/magazine-brief-policy.mjs',
    from: "import { BANNED_WORDS, MEDICAL_ASSERTIONS } from './magazine-qa-constants.mjs'\n",
    to: "import { MEDICAL_ASSERTIONS } from './magazine-qa-constants.mjs'\nconst BANNED_WORDS = [...QA_CONSTANTS.BANNED_WORDS]\n" }]],
  ['VB28', 'QA CLI 가 정본 대신 펼친 사본을 내보낸다(리터럴 없음)', 'R11', [{ file: 'scripts/magazine-qa.mjs',
    from: 'export { BANNED_WORDS, MEDICAL_REQUIRED, MEDICAL_SUGGESTED, HERO_WIDTH, HERO_HEIGHT }\n',
    to: 'const REQUIRED_COPY = new Set([...MEDICAL_REQUIRED])\nexport { BANNED_WORDS, REQUIRED_COPY as MEDICAL_REQUIRED, MEDICAL_SUGGESTED, HERO_WIDTH, HERO_HEIGHT }\n' }]],
  // 🔴 assertQaWordsInSync 의 legacy string 분기는 R2 한시 예외다 — 그 예외가 기본 호출 재파싱으로 넓어지면 잡혀야 한다
  ['VB29', 'assertQaWordsInSync 가 QA 경로 기본값을 되살린다', 'R2', [{ file: 'scripts/lib/magazine-brief-policy.mjs',
    from: 'export function assertQaWordsInSync(qaPath = undefined) {', to: "export function assertQaWordsInSync(qaPath = join(ROOT, 'scripts/magazine-qa.mjs')) {" }]],
  ['VB30', 'brief 정책에 원문 재파싱 정규식을 한 벌 더 둔다', 'R2', [{ file: 'scripts/lib/magazine-brief-policy.mjs',
    append: 'const pickAgain = (src, name) => src.match(new RegExp(`const ${name} = \\\\[`))\n' }]],
  ['VB31', '인자 없는 운영 호출이 legacy 파일 읽기 분기로 간다', 'R11', [{ file: 'scripts/lib/magazine-brief-policy.mjs',
    from: '  if (qaPath === undefined) {\n', to: "  if (qaPath === '__never__') {\n" }]],
  // 🔴 감싼 함수로 다시 내보내면 R4·R5(정의 정규식)는 못 본다 — R11(실제 적재 · 함수 동일성)이 잡아야 한다
  ['VB32', 'QA CLI 가 readWebpSize 를 감싼 함수로 다시 내보낸다', 'R11', [{ file: 'scripts/magazine-qa.mjs',
    from: 'export { readWebpSize }\n', to: 'const readWebpSizeWrapped = (p) => readWebpSize(p)\nexport { readWebpSizeWrapped as readWebpSize }\n' }]],
  ['VB33', 'load 가 sliceLiteral 을 감싼 함수로 다시 내보낸다', 'R11', [{ file: 'scripts/lib/magazine-load.mjs',
    from: 'export { sliceLiteral, evalLiteral }\n', to: 'const sliceWrapped = (...a) => sliceLiteral(...a)\nexport { sliceWrapped as sliceLiteral, evalLiteral }\n' }]],
  // S1 C4 — QA 판정 core
  ['VB34', 'QA CLI 가 runQa 를 감싼 함수로 다시 내보낸다', 'R11', [{ file: 'scripts/magazine-qa.mjs',
    from: 'export { runQa }\n', to: 'const runQaWrapped = (o) => runQa(o)\nexport { runQaWrapped as runQa }\n' }]],
  ['VB35', 'QA CLI 에 판정 구현 사본을 둔다(main 이 사본을 쓸 수 있다)', 'R12', [{ file: 'scripts/magazine-qa.mjs', append: 'function checkArticle(article, context, report) {}\n' }]],
  ['VB36', '운영 소비처가 runQa 를 다시 QA CLI 에서 import(C4 이전으로 되돌림)', 'R10', [{ file: 'scripts/magazine-batch-qa.mjs',
    from: "import { runQa } from './lib/magazine-qa-core.mjs'\n", to: "import { runQa } from './magazine-qa.mjs'\n" }]],
  ['VB37', 'hard FAIL 변이 하네스의 core 경로를 CLI 로 되돌린다(표만 core)', 'R8', [{ file: 'scripts/magazine-auto-recovery-mutation.mjs',
    from: "  qaCore: path.join(HERE, 'lib', 'magazine-qa-core.mjs'),\n", to: "  qaCore: path.join(HERE, 'magazine-qa.mjs'),\n" }]],
  // S1 C5 — control 판독 정본(graph-control). 모든 변이는 유효한 JS 다(문법 · import 실패로 검출되지 않는다)
  ['VB38', 'graph-build 에 control 찾기 사본을 되살린다', 'R13', [{ file: 'scripts/lib/magazine-graph-build.mjs', append: 'function controlLiteral(anchorText, controlText) {\n  return anchorText.indexOf(\'export const CONTROL\')\n}\n' }]],
  ['VB39', 'g8 가 parseControlText 를 graph-build 에서 import', 'R14', [{ file: 'scripts/lib/magazine-g8-promoter.mjs', from: 'import { parseControlText } from \'./magazine-graph-control.mjs\'\n', to: 'import { parseControlText } from \'./magazine-graph-build.mjs\'\n' }]],
  ['VB40', '엄격 판독이 실패하면 느슨한 판독으로 넘어간다(fallback)', 'R14', [{ file: 'scripts/lib/magazine-direct-spec-source.mjs', from: 'import { parseGraphControl } from \'./magazine-graph-control.mjs\'\n', to: 'import { parseGraphControl, parseControlText } from \'./magazine-graph-control.mjs\'\n' },
    { file: 'scripts/lib/magazine-direct-spec-source.mjs', from: '  const control = parseGraphControl(controlText)\n', to: '  const control = parseGraphControl(controlText) ?? parseControlText(controlText)\n' }]],
  ['VB41', '정본 graph-control 이 magazine-load 를 import', 'R15', [{ file: 'scripts/lib/magazine-graph-control.mjs', from: 'import { sliceLiteral } from \'./magazine-literal.mjs\'\n', to: 'import { sliceLiteral } from \'./magazine-load.mjs\'\n' }]],
  ['VB42', 'MS15 변이 소유를 source 로 되돌린다(정본에서 지점 0 — 죽은 변이)', 'R8', [{ file: 'scripts/magazine-direct-spec-source-check.mjs', from: '  [\'control\', \'MS15\',', to: '  [\'source\', \'MS15\',' }]],
  ['VB43', 'MS16 변이 소유를 source 로 되돌린다(정본에서 지점 0 — 죽은 변이)', 'R8', [{ file: 'scripts/magazine-direct-spec-source-check.mjs', from: '  [\'control\', \'MS16\',', to: '  [\'source\', \'MS16\',' }]],
  ['VB44', 'graph-build 호환 export 를 감싼 함수로 바꾼다', 'R11', [{ file: 'scripts/lib/magazine-graph-build.mjs', from: 'import { parseControlText } from \'./magazine-graph-control.mjs\'\n', to: 'import { parseControlText as parseControlTextCanonical } from \'./magazine-graph-control.mjs\'\n' },
    { file: 'scripts/lib/magazine-graph-build.mjs', from: 'export { parseControlText }\n', to: 'export const parseControlText = (text) => parseControlTextCanonical(text)\n' }]],
  ['VB45', 'direct-spec-source 호환 export 를 감싼 함수로 바꾼다', 'R11', [{ file: 'scripts/lib/magazine-direct-spec-source.mjs', from: 'import { parseGraphControl } from \'./magazine-graph-control.mjs\'\n', to: 'import { parseGraphControl as parseGraphControlCanonical } from \'./magazine-graph-control.mjs\'\n' },
    { file: 'scripts/lib/magazine-direct-spec-source.mjs', from: 'export { parseGraphControl }\n', to: 'export const parseGraphControl = (controlText) => parseGraphControlCanonical(controlText)\n' }]],
  ['VB46', 'graph-build 호환 export 를 지운다', 'R11', [{ file: 'scripts/lib/magazine-graph-build.mjs', from: 'export { parseControlText }\n', to: '' }]],
  ['VB47', 'direct-spec-source 호환 export 를 지운다', 'R11', [{ file: 'scripts/lib/magazine-direct-spec-source.mjs', from: 'export { parseGraphControl }\n', to: '' }]],
  // S1 C6 — 관계 수량 세 층. 모든 변이는 유효한 JS 다(문법 · import 실패로 검출되지 않는다)
  ['VB48', 'builder 생산 최소가 vNext 관계 최소를 읽는다(GRAPH_READY 가 쉬워진다)', 'R16', [{ file: 'scripts/lib/magazine-graph-build.mjs', from: 'import { RELATION_DISPLAY_TARGET, RELATION_POLICY } from \'./magazine-relation-policy.mjs\'\n', to: 'import { RELATION_DISPLAY_TARGET, RELATION_POLICY, VNEXT_PUBLICATION_RELATION_MINIMUM } from \'./magazine-relation-policy.mjs\'\n' },
    { file: 'scripts/lib/magazine-graph-build.mjs', from: 'productionMinimum: Object.freeze({ direct: RELATION_POLICY.directMin,', to: 'productionMinimum: Object.freeze({ direct: VNEXT_PUBLICATION_RELATION_MINIMUM.direct,' }]],
  ['VB49', 'source 필수 관계 판정이 vNext 관계 최소를 읽는다(legacy 2~3 이 1 로)', 'R16', [{ file: 'scripts/lib/magazine-direct-spec-source.mjs', from: 'import { isSingleDiscovery, isValidDirectCount } from \'./magazine-relation-policy.mjs\'\n', to: 'import { isSingleDiscovery, isValidDirectCount, VNEXT_PUBLICATION_RELATION_MINIMUM } from \'./magazine-relation-policy.mjs\'\n' },
    { file: 'scripts/lib/magazine-direct-spec-source.mjs', from: '  if (path === \'relations.direct\') return Array.isArray(value) && isValidDirectCount(value.length)', to: '  if (path === \'relations.direct\') return Array.isArray(value) && value.length >= VNEXT_PUBLICATION_RELATION_MINIMUM.direct' }]],
  ['VB50', 'RELATION_POLICY 를 legacy 객체의 펼친 사본으로', 'R16', [{ file: 'scripts/lib/magazine-relation-policy.mjs', from: 'export const RELATION_POLICY = LEGACY_RELATION_POLICY\n', to: 'export const RELATION_POLICY = Object.freeze({ ...LEGACY_RELATION_POLICY })\n' }]],
  ['VB51', '다른 lib 에 vNext 최소 숫자 사본을 둔다', 'R16', [{ file: 'scripts/lib/magazine-graph-build.mjs', append: 'const VNEXT_MIN_COPY = Object.freeze({ direct: 1 })\n' }]],
  ['VB52', 'builder 표시 목표를 숫자 리터럴로(값은 같다)', 'R16', [{ file: 'scripts/lib/magazine-graph-build.mjs', from: '  displayTarget: Object.freeze({ directMax: RELATION_DISPLAY_TARGET.directMax, discovery: RELATION_DISPLAY_TARGET.discovery }),', to: '  displayTarget: Object.freeze({ directMax: 3, discovery: 1 }),' }]],
  ['VB53', 'legacy 명시 alias 를 감싼 함수로', 'R16', [{ file: 'scripts/lib/magazine-relation-policy.mjs', from: 'export { isValidDirectCount as isLegacyDirectCount, isSingleDiscovery as isLegacySingleDiscovery, RELATION_CONTRACT_LABEL as LEGACY_RELATION_CONTRACT_LABEL }\n', to: 'export const isLegacyDirectCount = (n) => isValidDirectCount(n)\nexport { isSingleDiscovery as isLegacySingleDiscovery, RELATION_CONTRACT_LABEL as LEGACY_RELATION_CONTRACT_LABEL }\n' }]],
  ['VB54', 'legacy 기준이 표시 목표 값을 빌려 온다(UI 표시 변경이 legacy 판정을 끌고 간다)', 'R16', [{ file: 'scripts/lib/magazine-relation-policy.mjs', from: '  directMin: 2,\n  directMax: 3,\n', to: '  directMin: 2,\n  directMax: RELATION_DISPLAY_TARGET.directMax,\n' }]],
  // S2 (2026-11-10) — vNext 관계 최소 소비처 · 순수 lib 경계 · S2 검사 등록. 모든 변이는 유효한 JS 다
  ['VB55', 'legacy lib 가 vNext 관계 최소를 읽는다', 'R16', [{ file: 'scripts/lib/magazine-g8-promoter.mjs', append: 'const VNEXT_MIN_READ = VNEXT_PUBLICATION_RELATION_MINIMUM\n' }]],
  ['VB56', 'compiler 가 vNext 최소 대신 숫자 사본을 쓴다', 'R16', [{ file: 'scripts/lib/magazine-content-plan.mjs', from: "import { RELATION_DISPLAY_TARGET, VNEXT_PUBLICATION_RELATION_MINIMUM } from './magazine-relation-policy.mjs'\n", to: "import { RELATION_DISPLAY_TARGET } from './magazine-relation-policy.mjs'\n" },
    { file: 'scripts/lib/magazine-content-plan.mjs', from: '  relationMinimum: { direct: VNEXT_PUBLICATION_RELATION_MINIMUM.direct },', to: '  relationMinimum: { direct: 1 },' }]],
  ['VB57', 'compiler 가 node:fs 를 import', 'R17', [{ file: 'scripts/lib/magazine-content-plan.mjs', append: "import { readFileSync } from 'node:fs'\n" }]],
  ['VB58', 'compiler 가 벽시계를 읽는다', 'R17', [{ file: 'scripts/lib/magazine-content-plan.mjs', from: '    asOf: new Date(nowMs).toISOString(),', to: '    asOf: new Date(Date.now()).toISOString(),' }]],
  ['VB59', 'compiler 가 magazine-load(drafts 주입 검사 · queue 판독)를 import', 'R17', [{ file: 'scripts/lib/magazine-content-plan.mjs', append: "import { sliceLiteral as sliceFromLoad } from './magazine-load.mjs'\n" }]],
  ['VB60', 'Bundle lib 가 env 를 읽는다', 'R17', [{ file: 'scripts/lib/magazine-content-plan-input.mjs', append: 'const ROOT_FROM_ENV = process.env.MAGAZINE_PLAN_INPUT_ROOT\n' }]],
  ['VB61', 'CI 체인에서 content-plan 검사를 뺀다', 'R9', [{ file: 'package.json', from: ' && node scripts/magazine-content-plan-check.mjs', to: '' }]],
  // S2 P1-10 (2026-11-12) — S2 변이 하네스의 CI 소유. 체인에서 빠지면 R9 가 잡는다
  ['VB79', 'CI 체인에서 plan-input 변이를 뺀다', 'R9', [{ file: 'package.json', from: ' && node scripts/magazine-plan-input-mutation.mjs', to: '' }]],
  ['VB80', 'CI 체인에서 content-plan 변이를 뺀다', 'R9', [{ file: 'package.json', from: ' && node scripts/magazine-content-plan-mutation.mjs', to: '' }]],
  ['VB62', 'bootstrap CLI 가 엄격 control 판독을 직접 쓴다(소유표 밖)', 'R14', [{ file: 'scripts/magazine-plan-input-bootstrap.mjs', append: "import { parseGraphControl } from './lib/magazine-graph-control.mjs'\nconst CONTROL_DIRECT = parseGraphControl\n" }]],
  // S2 P1-C (2026-11-10) — R17 은 전이 폐포다. 허용 모듈이 끌고 오는 fs · path · env · cwd · 벽시계도 잡는다
  ['VB63', 'compiler 가 다시 gate(fs · path · cwd · 벽시계 기본값)를 import', 'R17', [{ file: 'scripts/lib/magazine-content-plan.mjs', from: "import { isHeldStatus, isPublicAt, strictPublishAtMs } from './magazine-public-rule.mjs'\n", to: "import { isHeldStatus, isPublicAt, strictPublishAtMs } from './magazine-public-rule.mjs'\nimport { isPublic } from './magazine-gate.mjs'\n" }]],
  ['VB64', 'public-rule 이 벽시계를 읽는다(전이)', 'R17', [{ file: 'scripts/lib/magazine-public-rule.mjs', append: 'export const nowDefault = () => Date.now()\n' }]],
  ['VB65', 'graph-control 이 node:fs 를 import(전이)', 'R17', [{ file: 'scripts/lib/magazine-graph-control.mjs', append: "import { readFileSync as readControlFile } from 'node:fs'\n" }]],
  ['VB66', 'public-rule 이 cwd 를 읽는다(전이)', 'R17', [{ file: 'scripts/lib/magazine-public-rule.mjs', append: 'export const cwdOf = () => process.cwd()\n' }]],
  ['VB67', 'literal 이 node:path 를 import(전이)', 'R17', [{ file: 'scripts/lib/magazine-literal.mjs', append: "import { join as joinLiteralPath } from 'node:path'\n" }]],
  ['VB68', 'relation-policy 가 env 를 읽는다(전이)', 'R17', [{ file: 'scripts/lib/magazine-relation-policy.mjs', append: 'export const ENV_RELATION_MIN = process.env.MAGAZINE_RELATION_MIN\n' }]],
  ['VB69', 'qa-constants 가 순수 표 밖 모듈(gate)을 import(전이)', 'R17', [{ file: 'scripts/lib/magazine-qa-constants.mjs', append: "import { statusLabel as statusLabelFromGate } from './magazine-gate.mjs'\n" }]],
  // S2 P1-3 (2026-11-11) — R17 은 토큰 판정이다. 정규식 · 주석 지우기가 놓치던 형태를 정확히 겨냥한다
  ['VB70', '주석 틈이 있는 동적 import', 'R17', [{ file: 'scripts/lib/magazine-content-plan.mjs', append: "export const gapImport = () => import /* 틈 */ ('node:fs')\n" }]],
  ['VB71', '주석으로 시작하는 줄의 static import', 'R17', [{ file: 'scripts/lib/magazine-content-plan.mjs', append: "/* 앞 주석 */ import { readFileSync as readAfterComment } from 'node:fs'\n" }]],
  ['VB72', 're-export 로 외부 모듈을 끌어온다', 'R17', [{ file: 'scripts/lib/magazine-public-rule.mjs', append: "export { join as reJoin } from 'node:path'\n" }]],
  ['VB73', "process['env'] (계산 접근)", 'R17', [{ file: 'scripts/lib/magazine-content-plan.mjs', append: "export const envGap = () => process['env'].MAGAZINE_X\n" }]],
  ['VB74', "Date['now']() (계산 접근)", 'R17', [{ file: 'scripts/lib/magazine-public-rule.mjs', append: "export const nowGap = () => Date['now']()\n" }]],
  ['VB75', 'template 식 안의 process.cwd()', 'R17', [{ file: 'scripts/lib/magazine-content-plan.mjs', append: "export const tplGap = () => `${process.cwd()}`\n" }]],
  ['VB76', 'Date 를 별칭으로 넘겨 now 를 부른다', 'R17', [{ file: 'scripts/lib/magazine-relation-policy.mjs', append: "const DateAlias = Date\nexport const aliasNow = () => DateAlias.now()\n" }]],
  ['VB77', 'globalThis 계산 접근으로 process 를 찾는다', 'R17', [{ file: 'scripts/lib/magazine-literal.mjs', append: "export const gtGap = () => globalThis['pro' + 'cess']\n" }]],
  ['VB78', '인자 없는 new Date()', 'R17', [{ file: 'scripts/lib/magazine-content-plan.mjs', append: "export const bareNow = () => new Date().getTime()\n" }]],
  ['NC6', '대조군 — 주석 · 문자열 안의 동적 import · process[env] · Date[now] 는 위반이 아니다', 'PASS', [{ file: 'scripts/lib/magazine-content-plan.mjs', append: "// import /* 틈 */ ('node:fs') · process['env'] · Date['now']()\nexport const NC_TEXT = \"import x from 'node:fs'; process['env']; Date['now']()\"\n" }]],
  ['NC7', '대조군 — Date.UTC · 인자 있는 new Date(ms) 는 순수다', 'PASS', [{ file: 'scripts/lib/magazine-public-rule.mjs', append: "export const utcProbe = (ms) => [Date.UTC(2026, 0, 1), new Date(ms).getTime()]\n" }]],
  ['VB26', '운영 CLI 가 여러 줄 import 로 QA CLI 를 부른다', 'R10', [{ file: 'scripts/magazine-dashboard.mjs', append: "import {\n  runQa,\n} from './magazine-qa.mjs'\n" }]],
  ['NC1', '대조군 — 주석 속 import 는 위반이 아니다', 'PASS', [{ file: 'scripts/lib/magazine-editorial.mjs', append: "// import { runQa } from '../magazine-qa.mjs'\n//    import { X } from '../magazine-batch-qa.mjs'\n" }]],
  ['NC2', '대조군 — spawn 대상 경로 문자열은 import 가 아니다', 'PASS', [{ file: 'scripts/magazine-dashboard.mjs', append: "const QA_PATH = join(ROOT, 'scripts/magazine-qa.mjs')\n" }]],
  ['NC4', '대조군 — S2 lib 주석 속 Date.now · fs · env 언급은 위반이 아니다', 'PASS', [{ file: 'scripts/lib/magazine-content-plan.mjs', append: '// Date.now · readFileSync · process.env · drafts/ 는 쓰지 않는다\n' }]],
  ['NC5', '대조군 — 폐포 모듈(public-rule) 주석 속 Date.now · process.cwd 언급은 위반이 아니다', 'PASS', [{ file: 'scripts/lib/magazine-public-rule.mjs', append: '// Date.now · process.cwd() · node:fs 는 쓰지 않는다\n' }]],
  ['NC3', '대조군 — lib 안 여러 줄 import 가 lib 를 부르면 위반이 아니다', 'PASS', [{ file: 'scripts/lib/magazine-editorial.mjs', append: "import {\n  sliceLiteral,\n} from './magazine-load.mjs'\nconst Z = await import(\n  './magazine-gate.mjs'\n)\n" }]],
]

const lines = []
let detected = 0, controlsPassed = 0, harnessFail = 0
const MUTATION_COUNT = MUTATIONS.filter(([, , expect]) => expect !== 'PASS').length
const CONTROL_COUNT = MUTATIONS.length - MUTATION_COUNT
let base = null
try {
  /** 스냅샷 — 숨김 파일 제외 · 이후 디스크를 다시 읽지 않는다 */
  const visible = (d, re) => readdirSync(join(ROOT, d)).filter((f) => !f.startsWith('.') && re.test(f)).map((f) => `${d}/${f}`)
  const snapshot = new Map()
  for (const f of ['package.json', ...visible('scripts', /\.m[jt]s$/), ...visible('scripts/lib', /\.mjs$/)]) {
    try { snapshot.set(f, readFileSync(join(ROOT, f), 'utf8')) } catch (e) {
      if (e?.code !== 'ENOENT') throw e // 목록 뒤 사라진 일반 파일은 이 회차 사본에 없을 뿐이다 — 다른 오류는 숨기지 않는다
    }
  }
  base = mkdtempSync(join(tmpdir(), 'vnext-boundary-mutation-'))

  const world = (tag, edits) => {
    const dir = join(base, tag)
    const files = new Map(snapshot)
    for (const e of edits) {
      if (e.create !== undefined) { files.set(e.file, e.create); continue }
      const src = files.get(e.file)
      if (src === undefined) return { error: `${e.file} 가 스냅샷에 없다` }
      if (e.append !== undefined) { files.set(e.file, `${src}${src.endsWith('\n') ? '' : '\n'}${e.append}`); continue }
      const n = src.split(e.from).length - 1
      if (n !== 1) return { error: `${e.file} 변이 지점 ${n}곳` }
      files.set(e.file, src.replace(e.from, e.to))
    }
    for (const [f, t] of files) { mkdirSync(dirname(join(dir, f)), { recursive: true }); writeFileSync(join(dir, f), t) }
    return { dir }
  }
  const run = (dir) => {
    const r = spawnSync(process.execPath, [CHECK], { encoding: 'utf8', env: { ...process.env, MAGAZINE_VNEXT_BOUNDARY_ROOT: dir } })
    const m = /vNext 경계 검사: (\d+) pass, (\d+) fail/.exec(r.stdout ?? '')
    return { status: r.status, out: r.stdout ?? '', err: r.stderr ?? '', pass: m ? +m[1] : null, fail: m ? +m[2] : null }
  }

  const b = world('base', [])
  const rb = b.error ? null : run(b.dir)
  if (!rb || rb.fail === null || rb.status !== 0 || rb.fail !== 0) {
    harnessFail++; lines.push(`FAIL 무변이 사본이 통과하지 않는다 — ${b.error ?? `${rb.out}${rb.err}`.slice(-400)}`)
  } else lines.push(`PASS 무변이 사본 ${rb.pass} pass · 0 fail`)

  for (const [id, label, expect, edits] of MUTATIONS) {
    try {
      const w = world(id, edits)
      if (w.error) { harnessFail++; lines.push(`FAIL ${id} ${label} — ${w.error} (하네스 결함)`); continue }
      const r = run(w.dir)
      if (r.fail === null) { harnessFail++; lines.push(`FAIL ${id} ${label} — 요약 줄 없음(검출 아님): ${(r.out + r.err).slice(-200)}`); continue }
      if (expect === 'PASS') {
        if (r.status === 0 && r.fail === 0) { controlsPassed++; lines.push(`PASS ${id} ${label} → 오탐 없음`) }
        else { harnessFail++; lines.push(`FAIL ${id} ${label} — 대조군이 실패했다(오탐): ${r.out.split('\n').filter((l) => l.startsWith('FAIL')).join(' / ').slice(0, 300)}`) }
        continue
      }
      const hit = r.out.split('\n').some((l) => l.startsWith(`FAIL ${expect} `))
      if (r.status === 1 && hit) { detected++; lines.push(`PASS ${id} ${label} → ${expect} 실패로 검출`) }
      else { harnessFail++; lines.push(`FAIL ${id} ${label} — 기대한 ${expect} 가 실패하지 않았다 (status ${r.status} fail=${r.fail})`) }
    } catch (e) {
      harnessFail++; lines.push(`FAIL ${id} ${label} — 하네스 예외(검출 아님): ${e?.code ?? ''} ${String(e?.message ?? e).split('\n')[0].slice(0, 200)}`)
    }
  }
} catch (e) {
  harnessFail++; lines.push(`FAIL 하네스 예외로 중단(검출 아님): ${e?.code ?? ''} ${String(e?.message ?? e).split('\n')[0].slice(0, 200)}`)
} finally {
  if (base) rmSync(base, { recursive: true, force: true })
}
console.log(lines.join('\n'))
console.log(`\nvNext 경계 변이: ${detected}/${MUTATION_COUNT} detected · 대조군 ${controlsPassed}/${CONTROL_COUNT} · ${harnessFail} fail`)
process.exit(harnessFail ? 1 : 0)
