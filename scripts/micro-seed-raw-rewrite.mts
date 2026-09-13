#!/usr/bin/env tsx
/**
 * Raw 재작성 작업대 — 🔴 **사람이 직접 쓴다. LLM 이 아니다** (§4-AG T7-1)
 *
 * 정본: docs/operations/2026-09-03-raw-supply-chain-design.md §4-AG
 *
 * 🔴 **이 도구가 무엇이 아닌지부터.**
 *    발행이 아니다. 발행 후보 확정도 아니다. LLM 호출이 아니다. DB write 가 아니다.
 *    `decision=RAW` 로 고른 사연을 놓고 **사람이 우리 말로 다시 쓰는 작업대**다.
 *
 * 🔴 **LLM 전 단계다.** RAW 가 아직 2건이고 회차당 1건꼴이다(§4-AF ⑭ 수확률 7.5%).
 *    회차당 1건에 LLM 파이프라인을 얹는 것은 순서가 뒤바뀐 것이고,
 *    재작성은 이 서비스에서 가장 되돌리기 어려운 결정이라 표본 2건으로 정할 일이 아니다.
 *    **사람이 몇 건 써 봐야 무엇을 자동화할지 알 수 있다** — 그것이 이 도구의 목적이다.
 *
 * 🔴 **원문 전문을 쓰지 않는다.** 화면이 보여주는 것은 `bodyHead`(마스킹 후 앞 300자)뿐이고,
 *    산출 파일에는 그마저도 넣지 않는다. 재접속도 하지 않는다(§4-AG ② 는 다음 단계 논의다).
 *
 * 🔴 **하지 않는 것**
 *    네이버 접속 · 목록 scout · 상세 fetch · DB write · Prisma · Google Sheet · LLM ·
 *    자동 발행 · noindex 배포 · Raw Vault 적재 · 82cook adapter.
 *
 * 사용법
 *   npx tsx scripts/micro-seed-raw-rewrite.mts
 *   npx tsx scripts/micro-seed-raw-rewrite.mts --out=.microseed-data/raw-rewrite-workbench.html
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
/**
 * 🔴 화면 경고선도 **정본에서 가져온다** (2026-09-13).
 *    이 화면의 겹침 계산은 공백을 살린 글자 나열이므로 글자 연속 기준과 같은 눈이다.
 */
import { COPY_RUN_CHARS } from '../src/lib/draft-originality'
import { BODY_HEAD_CHARS } from './lib/micro-seed-raw-originality.mjs'

export const REWRITE_DATA_DIR = '.microseed-data'
const OUT_DEFAULT = `${REWRITE_DATA_DIR}/raw-rewrite-workbench.html`

/** 🔴 이 단계의 판정. **ADOPT 는 아직 쓰지 않는다** — 발행 후보 확정이 아니라 작업대다 */
export const REWRITE_DECISIONS: readonly (readonly [string, string])[] = [
  ['SAVE', '초안을 저장한다 — 아직 발행 후보가 아니다'],
  ['HOLD', '더 생각한다 — 각도가 안 잡혔다'],
  ['DROP', '다시 쓰지 않는다'],
] as const

export const NOT_PUBLISH_NOTE = '발행 아님 · 발행 후보 확정 아님 · 사람이 다시 쓴 초안일 뿐'

const argv = process.argv.slice(2)
const arg = (n: string): string | undefined => {
  const hit = argv.find((a) => a.startsWith(`--${n}=`))
  return hit ? hit.slice(n.length + 3) : undefined
}
const fail = (m: string): never => {
  console.error(`\n🛑 ${m}\n`)
  process.exit(1)
}

export function isInsideDataDir(p: string): boolean {
  const rel = relative(process.cwd(), resolve(p))
  return rel !== '' && !rel.startsWith('..') && rel.startsWith(`${REWRITE_DATA_DIR}/`)
}
export function assertInsideDataDir(p: string): void {
  if (!isInsideDataDir(p)) fail(`🔴 ${relative(process.cwd(), resolve(p))} 은 ${REWRITE_DATA_DIR}/ 밖이다 — 거부한다.`)
}
export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] ?? c))
}
export function rewriteRunId(now: Date): string {
  const p2 = (n: number): string => String(n).padStart(2, '0')
  return `${now.getFullYear()}${p2(now.getMonth() + 1)}${p2(now.getDate())}`
    + `-${p2(now.getHours())}${p2(now.getMinutes())}${p2(now.getSeconds())}`
}

export type ApprovalRow = {
  decision?: string; sourceArticleId?: string; sourceSite?: string; url?: string; title?: string
  score?: number; lane?: string; axis?: string
  bodyLength?: number; bodyHead?: string
  safetyVerdict?: string; safetyReasons?: string
  runId?: string; fetchedAt?: string; reviewedAt?: string; memo?: string
}

/** 승인 파일 읽기 — JSON·TSV 둘 다. 같은 id 는 **나중 파일**이 이긴다(재검수가 최신이다) */
export function loadApprovals(dir: string): { rows: ApprovalRow[]; files: string[] } {
  let files: string[] = []
  try {
    files = readdirSync(dir).filter((f) => /^raw-originality-approvals-.*\.(json|tsv)$/.test(f)).sort()
  } catch { return { rows: [], files: [] } }
  const byId = new Map<string, ApprovalRow>()
  for (const f of files) {
    const raw = readFileSync(join(dir, f), 'utf-8')
    let list: ApprovalRow[] = []
    if (f.endsWith('.json')) {
      try { list = (JSON.parse(raw) as { decisions?: ApprovalRow[] }).decisions ?? [] } catch { continue }
    } else {
      const L = raw.split('\n').filter((l) => l.trim())
      if (L.length < 2) continue
      const cols = L[0]!.split('\t')
      list = L.slice(1).map((l) => {
        const cells = l.split('\t')
        const o: Record<string, string> = {}
        cols.forEach((c, i) => { o[c] = cells[i] ?? '' })
        return o as ApprovalRow
      })
    }
    for (const r of list) {
      const id = String(r.sourceArticleId ?? '')
      if (id) byId.set(id, r)
    }
  }
  return { rows: [...byId.values()], files }
}

/**
 * 이미 다뤄 본 원천 — 지난 작업대 산출물에서 모은다.
 *
 * 🔴 §4-AE 와 같은 이유다. 승인 파일은 판정 기록이라 한 번 RAW 면 계속 RAW 로 남고,
 *    막지 않으면 **어제 쓴 사연이 오늘도 작업대에 다시 오른다.**
 *    Seed 쪽에서 그 재탕이 반복 지표를 83.3% 로 만든 적이 있다.
 * 🔴 `SAVE` 만 센다. `HOLD` 는 다시 봐야 하는 것이고, `DROP` 은 다시 볼 필요가 없지만
 *    둘 다 "초안이 나왔다" 는 아니다 — HOLD 를 빼면 영영 못 돌아온다.
 */
export function handledArticleIds(dir: string = REWRITE_DATA_DIR): Map<string, string> {
  const done = new Map<string, string>()
  let files: string[] = []
  try {
    files = readdirSync(dir).filter((f) => /^raw-rewrite-workbench-.*\.json$/.test(f)).sort()
  } catch { return done }
  for (const f of files) {
    let j: { drafts?: { sourceArticleId?: string; decision?: string }[] }
    try { j = JSON.parse(readFileSync(join(dir, f), 'utf-8')) as typeof j } catch { continue }
    for (const d of j.drafts ?? []) {
      const id = String(d?.sourceArticleId ?? '')
      if (id && String(d?.decision ?? '') === 'SAVE' && !done.has(id)) done.set(id, f)
    }
  }
  return done
}

export type RewriteCard = {
  articleId: string; sourceSite: string; url: string; title: string
  bodyHead: string; bodyLength: number; headChars: number; truncated: boolean
  safetyVerdict: string; safetyReasons: string
  reviewDecision: string; reviewMemo: string; reviewedAt: string
}
export type RewriteReject = { articleId: string; code: string }

/** 🔴 `decision === 'RAW'` 만 작업대에 오른다. HOLD·DROP·미선택은 입력이 아니다 */
export function selectRewriteCards(
  rows: readonly ApprovalRow[], handled: ReadonlySet<string> = new Set(),
): { cards: RewriteCard[]; rejected: RewriteReject[] } {
  const cards: RewriteCard[] = []
  const rejected: RewriteReject[] = []
  for (const r of rows) {
    const id = String(r.sourceArticleId ?? '')
    if (!id) continue
    const d = String(r.decision ?? '')
    if (d !== 'RAW') { rejected.push({ articleId: id, code: `판정 ${d || '미선택'}` }); continue }
    if (handled.has(id)) { rejected.push({ articleId: id, code: '이미 초안 있음' }); continue }
    const head = String(r.bodyHead ?? '')
    const len = Number(r.bodyLength ?? 0)
    cards.push({
      articleId: id,
      sourceSite: String(r.sourceSite ?? ''),
      url: String(r.url ?? ''),
      title: String(r.title ?? ''),
      bodyHead: head,
      bodyLength: len,
      headChars: [...head].length,
      truncated: len > [...head].length,
      safetyVerdict: String(r.safetyVerdict ?? ''),
      safetyReasons: String(r.safetyReasons ?? ''),
      reviewDecision: d,
      // 🟡 검수 화면에서 사람이 적은 메모 — 다시 쓸 각도의 출발점이다.
      //    옛 export 에는 이 컬럼이 없다(2026-09-06 에 더했다). 없으면 빈 값으로 둔다.
      reviewMemo: String(r.memo ?? ''),
      reviewedAt: String(r.reviewedAt ?? ''),
    })
  }
  cards.sort((a, b) => b.bodyLength - a.bodyLength || a.articleId.localeCompare(b.articleId))
  return { cards, rejected }
}

/**
 * 산출 컬럼 — 🔴 **원문 조각(`bodyHead`)을 넣지 않는다.**
 *    화면에서 참고만 하고, 파일에 남는 것은 **사람이 쓴 것**뿐이다.
 *    원문을 초안 파일로 옮기면 그 파일이 다시 원문 저장소가 된다(§4-AF ⑤).
 * 🔴 컬럼은 언제나 맨 뒤에만 더한다.
 */
export const REWRITE_COLUMNS: readonly string[] = [
  'decision', 'sourceArticleId', 'sourceSite', 'sourceTitle', 'sourceBodyLength',
  'angle', 'avoid', 'draftTitle', 'draftBody', 'draftBodyLength',
  'overlapWithSource', 'writtenBy', 'writtenAt', 'note',
] as const

function main(): void {
  const out = arg('out') ?? OUT_DEFAULT
  assertInsideDataDir(out)

  const { rows, files } = loadApprovals(REWRITE_DATA_DIR)
  if (files.length === 0) {
    fail(`${REWRITE_DATA_DIR}/raw-originality-approvals-*.{json,tsv} 을 찾지 못했다 —\n`
      + '   먼저 micro-seed:raw-review 에서 RAW 를 판정하고 export 한다')
  }
  const handled = handledArticleIds(REWRITE_DATA_DIR)
  const { cards, rejected } = selectRewriteCards(rows, new Set(handled.keys()))

  console.log('\nRaw 재작성 작업대 — 🔴 사람이 직접 쓴다. LLM 이 아니다')
  console.log('─────────────────────────────────────────────────────────')
  console.log(`  🔴 ${NOT_PUBLISH_NOTE}`)
  console.log('  🔴 네이버 0 · DB write 0 · Sheet 0 · LLM 0 · 발행 0 · noindex 0 · Raw Vault 0')
  console.log(`  🔴 원문은 앞 ${BODY_HEAD_CHARS}자만 본다. 재접속하지 않는다.`)
  console.log(`  입력  ${files.length}개 파일 · 판정 ${rows.length}건`)
  console.log(`  후보  ${cards.length}건 (decision=RAW · 이미 초안 있는 것 제외 ${handled.size}건)`)
  console.log(`  제외  ${rejected.length}건`)
  for (const c of cards) {
    console.log(`    ${c.articleId.padEnd(10)} ${String(c.bodyLength).padStart(5)}자`
      + ` · 참고 ${c.headChars}자${c.truncated ? '(잘림)' : ''}`
      + ` · 검수 메모 ${c.reviewMemo ? `${[...c.reviewMemo].length}자` : '없음'}`)
  }
  if (cards.length === 0) console.log('\n  🟡 후보가 0건이다 — raw-review 에서 RAW 를 더 고르거나, 이미 전부 초안이 있다.')

  const meta = {
    note: NOT_PUBLISH_NOTE, generatedAt: new Date().toISOString(),
    files, bodyHeadChars: BODY_HEAD_CHARS, maxOverlap: COPY_RUN_CHARS,
    handled: [...handled.keys()],
  }
  writeFileSync(out, renderHtml(cards, rejected, meta), 'utf-8')
  console.log(`\n  ✅ ${out}`)
  console.log('  🔴 브라우저로 열어 **사람이 직접 쓴다.** 쓰지 않으면 결과에 없다.')
  console.log(`  🔴 ${NOT_PUBLISH_NOTE}\n`)
}

export function renderHtml(
  cards: readonly RewriteCard[], rejected: readonly RewriteReject[], meta: object,
): string {
  const data = JSON.stringify({ cards, rejected, meta }).replace(/</g, '\\u003c')
  const decisions = REWRITE_DECISIONS.map(([k, d]) => `['${k}','${escapeHtml(d)}']`).join(',')
  const stamp = rewriteRunId(new Date())
  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Raw 재작성 작업대</title>
<style>
:root{--bg:#faf9f7;--fg:#1c1a17;--mut:#6b665e;--line:#e4e0d9;--card:#fff;
--save:#1f9254;--hold:#b06a00;--drop:#9a9691;--warn:#d43b3b;--meta:#1d6fd6}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);
font:16px/1.6 -apple-system,BlinkMacSystemFont,'Pretendard Variable',Pretendard,sans-serif}
header{position:sticky;top:0;z-index:9;background:var(--bg);border-bottom:1px solid var(--line);padding:14px 16px}
h1{margin:0 0 6px;font-size:19px}
.warn{font-size:13px;color:var(--mut);line-height:1.7}
.warn b{color:var(--warn)}
.banner{margin:8px 0;padding:10px 12px;border:2px solid var(--warn);border-radius:10px;
background:#fff5f5;color:var(--warn);font-size:14px;font-weight:700}
.ask{margin:8px 0;padding:10px 12px;border:2px solid var(--meta);border-radius:10px;
background:#f2f7fe;color:var(--meta);font-size:14px;font-weight:700}
.bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:10px}
.pill{border:1px solid var(--line);background:var(--card);border-radius:999px;padding:5px 12px;
font-size:13px;cursor:pointer;min-height:34px}
.pill.on{background:var(--fg);color:#fff;border-color:var(--fg)}
main{padding:16px;max-width:920px;margin:0 auto}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px;margin-bottom:16px}
.card[data-done="1"]{border-color:var(--fg)}
.top{display:flex;flex-wrap:wrap;gap:8px;align-items:baseline}
.tag{font-size:12px;border:1px solid var(--line);border-radius:6px;padding:2px 7px;color:var(--mut)}
.src{margin:8px 0;padding:12px;background:var(--bg);border:1px solid var(--line);border-radius:8px}
.srctitle{font-size:15px;font-weight:600;color:var(--mut)}
.srcbody{margin-top:8px;font-size:14px;line-height:1.75;white-space:pre-wrap;word-break:break-word;color:var(--mut)}
.srcnote{font-size:12px;color:var(--mut);margin-top:6px}
.srcnote b{color:var(--warn)}
.memo{margin-top:8px;padding:8px 10px;border-left:3px solid var(--meta);background:#f7fafe;
font-size:13px;color:var(--fg);white-space:pre-wrap}
label{display:block;margin-top:12px;font-size:13px;font-weight:700}
label span{font-weight:400;color:var(--mut)}
input[type=text],textarea{width:100%;margin-top:4px;padding:9px;border:1px solid var(--line);
border-radius:8px;font:inherit;font-size:15px;resize:vertical}
textarea.body{min-height:190px;line-height:1.8}
.count{font-size:12px;color:var(--mut);margin-top:4px}
.count b{color:var(--warn)}
.acts{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}
button.act{min-height:52px;min-width:88px;padding:0 14px;border-radius:10px;border:1px solid var(--line);
background:var(--card);font-size:15px;font-weight:600;cursor:pointer}
button.act:hover{border-color:var(--fg)}
button.act[aria-pressed="true"]{color:#fff;border-color:transparent}
button.act[data-k="SAVE"][aria-pressed="true"]{background:var(--save)}
button.act[data-k="HOLD"][aria-pressed="true"]{background:var(--hold)}
button.act[data-k="DROP"][aria-pressed="true"]{background:var(--drop)}
.state{margin-top:8px;font-size:13px;font-weight:700}
#out,#outjson{width:100%;min-height:170px;font:13px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace}
footer{padding:16px;max-width:920px;margin:0 auto}
.note{font-size:13px;color:var(--mut);margin-top:8px}
details{margin-top:12px;font-size:13px;color:var(--mut)}
summary{cursor:pointer;min-height:34px}
table{border-collapse:collapse;margin-top:8px;font-size:13px}
td,th{border:1px solid var(--line);padding:4px 8px;text-align:left}
</style></head><body>
<header>
<h1>Raw 재작성 작업대 <span class="tag" id="cnt"></span></h1>
<div class="banner">🔴 ${escapeHtml(NOT_PUBLISH_NOTE)}</div>
<div class="ask">✍️ 이 화면의 일 — <b>"이 사연을 우리 말로 다시 쓴다"</b>. 옮겨 적는 것이 아니다</div>
<div class="warn">
🔴 <b>여기는 LLM 이 아니라 사람이 쓰는 자리다.</b> RAW 가 아직 2건이고 회차당 1건꼴이라,
그 규모에 자동화를 얹는 것은 순서가 뒤바뀐 것이다. <b>몇 건 써 봐야 무엇을 자동화할지 알 수 있다.</b><br>
🔴 <b>발행이 아니다.</b> 발행 후보 확정도 아니다 — 그래서 <b>ADOPT 버튼이 없다</b>.
여기서 고르는 것은 <code>SAVE</code>(초안을 남긴다) 뿐이다.<br>
🟡 <b>아래 원문은 전문이 아니다</b> — 앞 ${BODY_HEAD_CHARS}자다. 재접속하지 않는다.
줄거리를 잡는 데 쓰고, <b>문장은 보지 말고 쓴다.</b><br>
🔴 <b>원문 문장을 옮기지 않는다.</b> 연속 ${COPY_RUN_CHARS}자 이상 겹치면 화면이 빨갛게 알린다 —
그건 다시 쓴 글이 아니라 인용이다.<br>
🔴 산출 파일에는 <b>원문이 들어가지 않는다.</b> 사람이 쓴 것만 남는다.<br>
🔴 저장은 이 브라우저 <b>localStorage</b> 까지다.
</div>
<div class="bar" id="filters"></div>
<div class="bar">
<button class="pill" id="copy">TSV 복사</button>
<button class="pill" id="dl">TSV 내려받기</button>
<button class="pill" id="dljson">JSON 내려받기</button>
<button class="pill" id="reset">작업 초기화</button>
<span class="tag" id="prog"></span>
</div>
</header>
<main id="list"></main>
<footer>
<h2 style="font-size:16px">초안 TSV</h2>
<textarea id="out" readonly></textarea>
<h2 style="font-size:16px">초안 JSON</h2>
<textarea id="outjson" readonly></textarea>
<div class="note">🔴 사람이 누른 것만 나간다. 쓰지 않은 카드는 결과에 없다.</div>
<div class="note">🔴 이 파일은 <b>발행 후보가 아니다.</b> 다음 단계(T7-3)의 검수를 거쳐야 한다.</div>
<details><summary>후보에서 빠진 행 보기</summary><div id="rej"></div></details>
</footer>
<script type="application/json" id="data">${data}</script>
<script>
(function(){
'use strict';
var DATA = JSON.parse(document.getElementById('data').textContent);
var CARDS = DATA.cards, REJECTED = DATA.rejected, META = DATA.meta;
var DECISIONS = [${decisions}];
var KEY = 'raw-rewrite-workbench-v1';
var COLS = ${JSON.stringify(REWRITE_COLUMNS)};
var NOTE = ${JSON.stringify(NOT_PUBLISH_NOTE)};
var STAMP = ${JSON.stringify(stamp)};
var MAXOV = META.maxOverlap;
function cell(v){ return String(v == null ? '' : v).replace(/[\\t\\r\\n]+/g, ' '); }
function load(){ try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { return {}; } }
function save(){ try { localStorage.setItem(KEY, JSON.stringify(STATE)); } catch (e) { /* 사파리 프라이빗 등 */ } }
var STATE = load();
var listEl = document.getElementById('list');
var outEl = document.getElementById('out');
var outJsonEl = document.getElementById('outjson');
var filter = 'ALL';
function esc(s){ var d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; }

// 🔴 원문과 가장 길게 이어 붙은 조각을 찾는다 — 인용이 되지 않게 사람이 쓰는 동안 알려준다
function longestOverlap(draft, source){
  if (!draft || !source) return { len: 0, frag: '' };
  var best = { len: 0, frag: '' };
  var d = String(draft), s = String(source);
  for (var i = 0; i < d.length; i++) {
    for (var j = d.length; j > i + best.len; j--) {
      var piece = d.slice(i, j);
      if (piece.length <= best.len) break;
      if (s.indexOf(piece) !== -1) { best = { len: piece.length, frag: piece }; break; }
    }
  }
  return best;
}

function rows(at){
  at = at || new Date().toISOString();
  var out = [];
  CARDS.forEach(function(c){
    var st = STATE[c.articleId] || {};
    if (!st.v) return;
    var body = st.body || '';
    var ov = longestOverlap(body, c.title + ' ' + c.bodyHead);
    out.push({
      decision: st.v, sourceArticleId: c.articleId, sourceSite: c.sourceSite,
      sourceTitle: c.title, sourceBodyLength: c.bodyLength,
      angle: st.angle || '', avoid: st.avoid || '',
      draftTitle: st.title || '', draftBody: body,
      draftBodyLength: Array.from(body).length,
      overlapWithSource: ov.len,
      writtenBy: 'human', writtenAt: at, note: NOTE
    });
  });
  return out;
}
function tsv(at){
  var lines = [COLS.join('\\t')];
  rows(at).forEach(function(r){ lines.push(COLS.map(function(k){ return cell(r[k]); }).join('\\t')); });
  return lines.join('\\n');
}
function refresh(){
  var at = new Date().toISOString();
  var rs = rows(at);
  outEl.value = tsv(at);
  outJsonEl.value = JSON.stringify({ note: NOTE, writtenAt: at, drafts: rs }, null, 2);
  document.getElementById('prog').textContent = '작업 ' + rs.length + ' / ' + CARDS.length
    + ' · SAVE ' + rs.filter(function(r){ return r.decision === 'SAVE'; }).length;
  save();
}
function download(name, text, type){
  var blob = new Blob([text], { type: type + ';charset=utf-8' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; a.click();
  URL.revokeObjectURL(a.href);
}

function render(){
  var shown = CARDS.filter(function(c){
    if (filter === 'ALL') return true;
    if (filter === 'UNDECIDED') return !(STATE[c.articleId] || {}).v;
    return (STATE[c.articleId] || {}).v === filter;
  });
  listEl.innerHTML = '';
  shown.forEach(function(c, i){
    var st = STATE[c.articleId] || {};
    var el = document.createElement('article');
    el.className = 'card';
    el.setAttribute('data-id', c.articleId);
    if (st.v) el.setAttribute('data-done','1');
    el.innerHTML =
      '<div class="top"><span class="tag">#' + (i + 1) + '</span>' +
      '<span class="tag">원문 ' + c.bodyLength + '자</span>' +
      '<span class="tag">' + esc(c.sourceSite) + '</span>' +
      '<span class="tag">safety ' + esc(c.safetyVerdict) + '</span>' +
      '<span class="tag">검수 ' + esc(c.reviewDecision) + '</span></div>' +
      '<div class="src">' +
        '<div class="srctitle">' + esc(c.title) + '</div>' +
        '<div class="srcbody">' + esc(c.bodyHead) + (c.truncated ? '…' : '') + '</div>' +
        '<div class="srcnote">🟡 <b>전문이 아니다</b> — 앞 ' + c.headChars + '자' +
        (c.truncated ? (' (원문 ' + c.bodyLength + '자 중)') : '') +
        '. 줄거리만 잡고 <b>문장은 보지 말고 쓴다.</b></div>' +
        (c.reviewMemo ? ('<div class="memo">검수 때 남긴 메모 — ' + esc(c.reviewMemo) + '</div>') : '') +
      '</div>' +
      '<label>다시 쓸 각도 <span>— 무엇을 묻는 글로 만들 것인가</span>' +
      '<input type="text" class="angle" placeholder="예: 부모가 적적해하실 때 무엇이 도움이 됐나"></label>' +
      '<label>버릴 원문 요소 <span>— 옮기면 안 되는 구체 사정</span>' +
      '<input type="text" class="avoid" placeholder="예: 임신 주수 · 결혼식 날짜 · 특정 지역"></label>' +
      '<label>새 제목<input type="text" class="dtitle" placeholder="우리 말로"></label>' +
      '<label>새 본문<textarea class="body" placeholder="원문을 보지 말고, 각도만 보고 쓴다"></textarea></label>' +
      '<div class="count" data-count></div>' +
      '<div class="acts"></div><div class="state"></div>';

    var angle = el.querySelector('.angle'), avoid = el.querySelector('.avoid');
    var dtitle = el.querySelector('.dtitle'), body = el.querySelector('.body');
    var countEl = el.querySelector('[data-count]');
    angle.value = st.angle || ''; avoid.value = st.avoid || '';
    dtitle.value = st.title || ''; body.value = st.body || '';

    function setCount(){
      var v = body.value || '';
      var ov = longestOverlap(v, c.title + ' ' + c.bodyHead);
      var warn = ov.len >= MAXOV;
      countEl.innerHTML = '본문 ' + Array.from(v).length + '자 · 원문과 최대 겹침 ' +
        (warn ? ('<b>' + ov.len + '자 — "' + esc(ov.frag) + '" 는 원문 문장이다. 다시 쓴다.</b>')
              : (ov.len + '자 (기준 ' + MAXOV + '자 미만)'));
    }
    setCount();

    [['angle', angle], ['avoid', avoid], ['title', dtitle], ['body', body]].forEach(function(pair){
      pair[1].addEventListener('input', function(){
        var cur = STATE[c.articleId] || {};
        cur[pair[0]] = pair[1].value;
        STATE[c.articleId] = cur;
        if (pair[0] === 'body') setCount();
        refresh();
      });
    });

    var acts = el.querySelector('.acts');
    DECISIONS.forEach(function(a){
      var b = document.createElement('button');
      b.className = 'act'; b.type = 'button';
      b.setAttribute('data-k', a[0]);
      b.setAttribute('aria-pressed', st.v === a[0] ? 'true' : 'false');
      b.title = a[1]; b.textContent = a[0];
      b.addEventListener('click', function(){
        var cur = STATE[c.articleId] || {};
        cur.v = (cur.v === a[0]) ? '' : a[0];
        STATE[c.articleId] = cur;
        Array.prototype.forEach.call(acts.querySelectorAll('.act'), function(x){
          x.setAttribute('aria-pressed', x.getAttribute('data-k') === cur.v ? 'true' : 'false');
        });
        el.setAttribute('data-done', cur.v ? '1' : '0');
        setState();
        if (filter !== 'ALL') { render(); return; }
        refresh();
      });
      acts.appendChild(b);
    });
    function setState(){
      var cur = STATE[c.articleId] || {};
      el.querySelector('.state').textContent = cur.v ? ('내 판정: ' + cur.v) : '내 판정: (미정)';
    }
    setState();
    listEl.appendChild(el);
  });
  document.getElementById('cnt').textContent = '후보 ' + CARDS.length + '건';
  refresh();
}

var fEl = document.getElementById('filters');
var FILTERS = [['ALL','전체'],['UNDECIDED','미작업만']];
DECISIONS.forEach(function(d){ FILTERS.push([d[0], d[0]]); });
FILTERS.forEach(function(f){
  var b = document.createElement('button');
  b.className = 'pill' + (filter === f[0] ? ' on' : '');
  b.type = 'button'; b.setAttribute('data-f', f[0]); b.textContent = f[1];
  b.addEventListener('click', function(){
    filter = f[0];
    Array.prototype.forEach.call(fEl.querySelectorAll('.pill[data-f]'), function(x){
      x.className = 'pill' + (x.getAttribute('data-f') === filter ? ' on' : '');
    });
    render();
  });
  fEl.appendChild(b);
});
document.getElementById('copy').addEventListener('click', function(){
  outEl.select(); try { document.execCommand('copy'); } catch (e) { /* 무시 */ }
});
document.getElementById('dl').addEventListener('click', function(){
  download('raw-rewrite-workbench-' + STAMP + '.tsv', outEl.value, 'text/tab-separated-values');
});
document.getElementById('dljson').addEventListener('click', function(){
  download('raw-rewrite-workbench-' + STAMP + '.json', outJsonEl.value, 'application/json');
});
document.getElementById('reset').addEventListener('click', function(){
  if (!confirm('작업 내용을 모두 지웁니다.')) return;
  STATE = {};
  try { localStorage.removeItem(KEY); } catch (e) { /* 무시 */ }
  render();
});
(function(){
  var counts = {};
  REJECTED.forEach(function(r){ counts[r.code] = (counts[r.code] || 0) + 1; });
  var keys = Object.keys(counts).sort(function(a,b){ return counts[b] - counts[a]; });
  var html = '<table><tr><th>제외 사유</th><th>행</th></tr>';
  keys.forEach(function(k){ html += '<tr><td>' + esc(k) + '</td><td>' + counts[k] + '</td></tr>'; });
  html += '</table>';
  document.getElementById('rej').innerHTML = html;
})();
render();
})();
</script>
</body></html>
`
}

/** 🔴 CLI 로 직접 실행할 때만 돈다 — import 만으로 파일을 쓰지 않는다 */
const isDirectRun = process.argv[1] !== undefined
  && import.meta.url === pathToFileURL(process.argv[1]).href
if (isDirectRun) main()
