#!/usr/bin/env tsx
/**
 * Raw Originality 검수 화면 — 🔴 **판정 파일만 만든다. 발행하지 않는다** (§4-AF T3)
 *
 * 정본: docs/operations/2026-09-03-raw-supply-chain-design.md §4-AF ⑥⑦
 *
 * 🔴 **이 화면이 무엇이 아닌지부터.**
 *    발행이 아니다. Raw Vault 적재가 아니다. DB write 가 아니다. LLM 호출이 아니다.
 *    `*.raw-detail.jsonl` 에서 **rawOriginality 축만** 골라 보여주고,
 *    사람이 RAW / HOLD / DROP 을 누른 결과를 파일로 내려받게 할 뿐이다.
 *
 * 🔴 **APPROVE · ADOPT · SEED 버튼을 두지 않는다.** 그 셋은 각각
 *    SRN 승인(§4-Z) · 초안 검수(§4-AB) · 소스 승인(§4-AD) 의 말이다.
 *    같은 낱말이 화면마다 다른 뜻이면 사람이 무엇을 누르는지 모르게 된다.
 *
 * 🔴 **생성한 HTML 도 네트워크를 쓰지 않는다.** CSS·JS 인라인 · localStorage 까지다.
 *
 * 사용법
 *   npx tsx scripts/micro-seed-raw-review.mts
 *   npx tsx scripts/micro-seed-raw-review.mts --out=.microseed-data/raw-review.html
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  RAW_AXIS, RAW_DECISIONS, NOT_PUBLISH_NOTE, BODY_HEAD_CHARS,
} from './lib/micro-seed-raw-originality.mjs'

export const RAW_DATA_DIR = '.microseed-data'
const OUT_DEFAULT = `${RAW_DATA_DIR}/raw-review.html`

const argv = process.argv.slice(2)
const arg = (n: string): string | undefined => {
  const hit = argv.find((a) => a.startsWith(`--${n}=`))
  return hit ? hit.slice(n.length + 3) : undefined
}
const fail = (m: string): never => {
  console.error(`\n🛑 ${m}\n`)
  process.exit(1)
}

/** 🔴 gitignore 된 `.microseed-data/` 밖으로 읽지도 쓰지도 않는다 */
export function isInsideDataDir(p: string): boolean {
  const rel = relative(process.cwd(), resolve(p))
  return rel !== '' && !rel.startsWith('..') && rel.startsWith(`${RAW_DATA_DIR}/`)
}
export function assertInsideDataDir(p: string): void {
  if (!isInsideDataDir(p)) {
    fail(`🔴 ${relative(process.cwd(), resolve(p))} 은 ${RAW_DATA_DIR}/ 밖이다 — 거부한다.`
      + '\n   원문 조각이 들어가는 파일이라 gitignore 된 곳에만 둔다.')
  }
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] ?? c))
}

/** 산출 파일 이름의 회차 id — `YYYYMMDD-HHMMSS` */
export function rawReviewId(now: Date): string {
  const p2 = (n: number): string => String(n).padStart(2, '0')
  return `${now.getFullYear()}${p2(now.getMonth() + 1)}${p2(now.getDate())}`
    + `-${p2(now.getHours())}${p2(now.getMinutes())}${p2(now.getSeconds())}`
}

export type RawRecord = {
  sourceArticleId?: string; sourceSite?: string; url?: string; title?: string
  score?: number; lane?: string; accessStatus?: string
  bodyLength?: number; bodyHead?: string; axis?: string
  safetyVerdict?: string; safetyReasons?: string
  imageCount?: number; commentCount?: number
  runId?: string; fetchedAt?: string
}

/** `*.raw-detail.jsonl` 을 전부 읽는다 — 같은 id 는 **나중 runId** 가 이긴다(재수집 결과가 최신이다) */
export function loadRawRecords(dir: string): { records: RawRecord[]; files: string[] } {
  let files: string[] = []
  try { files = readdirSync(dir).filter((f) => f.endsWith('.raw-detail.jsonl')).sort() } catch { return { records: [], files: [] } }
  const byId = new Map<string, RawRecord>()
  for (const f of files) {
    for (const line of readFileSync(join(dir, f), 'utf-8').split('\n')) {
      if (line.trim() === '') continue
      try {
        const o = JSON.parse(line) as RawRecord
        const id = String(o.sourceArticleId ?? '')
        if (!id) continue
        const prev = byId.get(id)
        if (!prev || String(o.runId ?? '') >= String(prev.runId ?? '')) byId.set(id, o)
      } catch { /* 깨진 줄은 건너뛴다 */ }
    }
  }
  return { records: [...byId.values()], files }
}

export type RawCard = {
  articleId: string; sourceSite: string; url: string; title: string
  score: number; lane: string; axis: string
  bodyLength: number; bodyHead: string; headChars: number; truncated: boolean
  safetyVerdict: string; safetyReasons: string
  imageCount: number; commentCount: number
  runId: string; fetchedAt: string
}
export type RawReject = { articleId: string; code: string }

/**
 * 화면에 올릴 후보 — 🔴 **세 조건을 모두 만족해야 한다.**
 *
 * ① `axis === 'rawOriginality'` — 다른 축은 각자의 화면이 있다. 섞으면 사람이 기준을 잃는다.
 * ② `accessStatus === 'ok'` — 읽지 못한 글을 판정하는 것은 판정이 아니다.
 * ③ `safetyVerdict === 'pass'` — hold·drop 은 사람이 고를 대상이 아니라 이미 걸러진 것이다.
 *
 * 🔴 **빠진 행을 조용히 버리지 않는다.** 사유와 함께 돌려주고 화면 아래에 센다 —
 *    후보가 소리 없이 줄어드는 것이 이런 화면의 가장 큰 위험이다.
 */
export function selectRawCards(records: readonly RawRecord[]): { cards: RawCard[]; rejected: RawReject[] } {
  const cards: RawCard[] = []
  const rejected: RawReject[] = []
  for (const r of records) {
    const id = String(r.sourceArticleId ?? '')
    if (!id) continue
    const axis = String(r.axis ?? '')
    if (axis !== RAW_AXIS) { rejected.push({ articleId: id, code: `축 ${axis || '없음'}` }); continue }
    if (String(r.accessStatus ?? '') !== 'ok') { rejected.push({ articleId: id, code: `access ${r.accessStatus ?? '?'}` }); continue }
    if (String(r.safetyVerdict ?? '') !== 'pass') { rejected.push({ articleId: id, code: `safety ${r.safetyVerdict ?? '?'}` }); continue }
    const head = String(r.bodyHead ?? '')
    const len = Number(r.bodyLength ?? 0)
    cards.push({
      articleId: id,
      sourceSite: String(r.sourceSite ?? ''),
      url: String(r.url ?? ''),
      title: String(r.title ?? ''),
      score: Number(r.score ?? 0),
      lane: String(r.lane ?? ''),
      axis,
      bodyLength: len,
      bodyHead: head,
      headChars: [...head].length,
      // 🔴 화면이 "이게 전부인가" 를 스스로 답해야 한다 — 잘렸으면 잘렸다고 말한다
      truncated: len > [...head].length,
      safetyVerdict: String(r.safetyVerdict ?? ''),
      safetyReasons: String(r.safetyReasons ?? ''),
      imageCount: Number(r.imageCount ?? 0),
      commentCount: Number(r.commentCount ?? 0),
      runId: String(r.runId ?? ''),
      fetchedAt: String(r.fetchedAt ?? ''),
    })
  }
  cards.sort((a, b) => b.bodyLength - a.bodyLength || a.articleId.localeCompare(b.articleId))
  return { cards, rejected }
}

/**
 * 승인 파일 컬럼 — 🔴 **`body` 전문 컬럼이 없다.** `bodyHead` 뿐이다(§4-AF ⑤).
 * 🔴 컬럼은 언제나 맨 뒤에만 더한다 — TSV 를 위치로 읽는 쪽이 있다.
 */
export const RAW_REVIEW_COLUMNS: readonly string[] = [
  'decision', 'sourceArticleId', 'sourceSite', 'url', 'title', 'score', 'lane', 'axis',
  'bodyLength', 'bodyHead', 'safetyVerdict', 'safetyReasons',
  'runId', 'fetchedAt', 'reviewedAt', 'note',
] as const

function main(): void {
  const out = arg('out') ?? OUT_DEFAULT
  assertInsideDataDir(out)

  const { records, files } = loadRawRecords(RAW_DATA_DIR)
  if (files.length === 0) {
    fail(`${RAW_DATA_DIR}/*.raw-detail.jsonl 을 찾지 못했다 —\n`
      + '   먼저 micro-seed:raw-detail-fetch 를 돌린다')
  }
  const { cards, rejected } = selectRawCards(records)

  console.log('\nRaw Originality 검수 화면 — 🔴 발행하지 않는다')
  console.log('─────────────────────────────────────────────────────────')
  console.log(`  🔴 ${NOT_PUBLISH_NOTE}`)
  console.log('  🔴 DB write 0 · Sheet 0 · LLM 0 · 네이버 0 · Raw Vault 0 · 자동 발행 0')
  console.log(`  입력  ${files.length}개 파일 · 글 ${records.length}건`)
  console.log(`  후보  ${cards.length}건 (axis=${RAW_AXIS} · access=ok · safety=pass)`)
  console.log(`  제외  ${rejected.length}건 — 화면 아래에 사유별로 센다`)
  for (const c of cards) {
    console.log(`    ${c.articleId.padEnd(10)} ${String(c.bodyLength).padStart(5)}자`
      + ` → 저장 ${String(c.headChars).padStart(3)}자${c.truncated ? ' (잘림)' : ''}`)
  }
  if (cards.length === 0) {
    console.log('\n  🟡 후보가 0건이다 — rawOriginality 축이 아직 없다.')
  }

  const meta = {
    note: NOT_PUBLISH_NOTE,
    generatedAt: new Date().toISOString(),
    files, axis: RAW_AXIS, bodyHeadChars: BODY_HEAD_CHARS,
  }
  writeFileSync(out, renderHtml(cards, rejected, meta), 'utf-8')
  console.log(`\n  ✅ ${out}`)
  console.log('  🔴 브라우저로 열어 사람이 누른다. 누르지 않으면 결과에 없다.')
  console.log(`  🔴 ${NOT_PUBLISH_NOTE}\n`)
}

export function renderHtml(
  cards: readonly RawCard[],
  rejected: readonly RawReject[],
  meta: object,
): string {
  const data = JSON.stringify({ cards, rejected, meta }).replace(/</g, '\\u003c')
  const decisions = RAW_DECISIONS.map(([k, d]) => `['${k}','${escapeHtml(d)}']`).join(',')
  const stamp = rawReviewId(new Date())
  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Raw Originality 검수</title>
<style>
:root{--bg:#faf9f7;--fg:#1c1a17;--mut:#6b665e;--line:#e4e0d9;--card:#fff;
--raw:#1f6fd6;--hold:#b06a00;--drop:#9a9691;--warn:#d43b3b;--meta:#1d6fd6}
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
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px;margin-bottom:14px}
.card[data-done="1"]{border-color:var(--fg)}
.top{display:flex;flex-wrap:wrap;gap:8px;align-items:baseline}
.rank{font-weight:700}.score{font-variant-numeric:tabular-nums}
.tag{font-size:12px;border:1px solid var(--line);border-radius:6px;padding:2px 7px;color:var(--mut)}
.tag.axis{border-color:var(--raw);color:var(--raw);font-weight:700}
.title{margin:8px 0;font-size:17px;font-weight:600;word-break:keep-all}
.head{margin:8px 0;padding:12px;background:var(--bg);border:1px solid var(--line);
border-radius:8px;font-size:15px;line-height:1.75;white-space:pre-wrap;word-break:break-word}
.headnote{font-size:12px;color:var(--mut);margin-top:6px}
.headnote b{color:var(--warn)}
.enough{display:flex;gap:8px;align-items:center;margin-top:8px;font-size:13px;color:var(--mut)}
.meta{font-size:13px;color:var(--mut);word-break:break-all}
.why{font-size:13px;color:var(--mut);margin-top:4px}
.acts{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}
button.act{min-height:52px;min-width:88px;padding:0 14px;border-radius:10px;border:1px solid var(--line);
background:var(--card);font-size:15px;font-weight:600;cursor:pointer}
button.act:hover{border-color:var(--fg)}
button.act[aria-pressed="true"]{color:#fff;border-color:transparent}
button.act[data-k="RAW"][aria-pressed="true"]{background:var(--raw)}
button.act[data-k="HOLD"][aria-pressed="true"]{background:var(--hold)}
button.act[data-k="DROP"][aria-pressed="true"]{background:var(--drop)}
.state{margin-top:8px;font-size:13px;font-weight:700}
textarea{width:100%;margin-top:8px;min-height:44px;padding:8px;border:1px solid var(--line);
border-radius:8px;font:inherit;font-size:14px;resize:vertical}
#out,#outjson{width:100%;min-height:170px;font:13px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace}
footer{padding:16px;max-width:920px;margin:0 auto}
.note{font-size:13px;color:var(--mut);margin-top:8px}
#held{margin-top:8px;font-size:13px;color:var(--hold);font-weight:700}
details{margin-top:12px;font-size:13px;color:var(--mut)}
summary{cursor:pointer;min-height:34px}
table{border-collapse:collapse;margin-top:8px;font-size:13px}
td,th{border:1px solid var(--line);padding:4px 8px;text-align:left}
</style></head><body>
<header>
<h1>Raw Originality 검수 <span class="tag" id="cnt"></span></h1>
<div class="banner">🔴 ${escapeHtml(NOT_PUBLISH_NOTE)}</div>
<div class="ask">🔵 이 화면의 질문 — <b>"이 사연을 우리 말로 다시 쓸 수 있나"</b> 이지 "이 원문을 그대로 낼까" 가 아니다</div>
<div class="warn">
🔴 <b>이 화면은 발행 버튼이 아니다.</b> DB write 0 · Sheet 0 · LLM 0 · 네이버 0 · Raw Vault 적재 0.<br>
🔴 여기에는 <b>${escapeHtml(RAW_AXIS)} 축만</b> 올라온다. SRN · Seed · Hold · Drop · Access 는 섞이지 않는다.<br>
🔴 <b>APPROVE · ADOPT · SEED 버튼이 없다.</b> 각각 SRN 승인(§4-Z) · 초안 검수(§4-AB) ·
소스 승인(§4-AD) 의 말이다. 여기서 고르는 것은 <b>다시 쓸 사연</b> 이다.<br>
🟡 <b>아래 본문은 전문이 아니다</b> — 마스킹 후 앞 ${BODY_HEAD_CHARS}자다(§4-AF ⑤).
원문이 남으면 그 문장을 참고하게 되고, 이 레인은 <b>다시 쓰는</b> 레인이다.<br>
🔴 판단이 안 서면 <b>HOLD</b> 로 두고 멈춘다. 전문을 보려면 <b>재접속이 필요하고 그것은 별도 승인</b> 이다.<br>
🔴 저장은 이 브라우저 <b>localStorage</b> 까지다.
</div>
<div class="bar" id="filters"></div>
<div class="bar">
<button class="pill" id="copy">TSV 복사</button>
<button class="pill" id="dl">TSV 내려받기</button>
<button class="pill" id="dljson">JSON 내려받기</button>
<button class="pill" id="reset">검수 초기화</button>
<span class="tag" id="prog"></span>
</div>
<div id="held"></div>
</header>
<main id="list"></main>
<footer>
<h2 style="font-size:16px">Raw 판정 TSV</h2>
<textarea id="out" readonly></textarea>
<h2 style="font-size:16px">Raw 판정 JSON</h2>
<textarea id="outjson" readonly></textarea>
<div class="note">🔴 사람이 누른 것만 나간다. 누르지 않은 후보는 결과에 없다 —
기본값으로 채우면 "검수" 가 사람의 행위가 아니게 된다.</div>
<div class="note" id="enoughsum"></div>
<details><summary>후보에서 빠진 행 보기</summary><div id="rej"></div></details>
</footer>
<script type="application/json" id="data">${data}</script>
<script>
(function(){
'use strict';
var DATA = JSON.parse(document.getElementById('data').textContent);
var CARDS = DATA.cards, REJECTED = DATA.rejected, META = DATA.meta;
var DECISIONS = [${decisions}];
var KEY = 'raw-originality-review-v1';
var COLS = ${JSON.stringify(RAW_REVIEW_COLUMNS)};
var NOTE = ${JSON.stringify(NOT_PUBLISH_NOTE)};
var STAMP = ${JSON.stringify(stamp)};
function cell(v){ return String(v == null ? '' : v).replace(/[\\t\\r\\n]+/g, ' '); }

function load(){ try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { return {}; } }
function save(){ try { localStorage.setItem(KEY, JSON.stringify(STATE)); } catch (e) { /* 사파리 프라이빗 등 */ } }
var STATE = load();

var listEl = document.getElementById('list');
var outEl = document.getElementById('out');
var outJsonEl = document.getElementById('outjson');
var filter = 'ALL';

function esc(s){ var d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; }

// 🔴 export 계약 — 누른 것만, 컬럼 순서 그대로. body 전문 컬럼은 없다.
function rows(at){
  at = at || new Date().toISOString();
  var out = [];
  CARDS.forEach(function(c){
    var st = STATE[c.articleId] || {};
    if (!st.v) return;
    out.push({
      decision: st.v, sourceArticleId: c.articleId, sourceSite: c.sourceSite, url: c.url,
      title: c.title, score: c.score, lane: c.lane, axis: c.axis,
      bodyLength: c.bodyLength, bodyHead: c.bodyHead,
      safetyVerdict: c.safetyVerdict, safetyReasons: c.safetyReasons,
      runId: c.runId, fetchedAt: c.fetchedAt, reviewedAt: at, note: NOTE
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
  outJsonEl.value = JSON.stringify({ note: NOTE, reviewedAt: at, decisions: rs }, null, 2);
  document.getElementById('prog').textContent = '검수 ' + rs.length + ' / ' + CARDS.length
    + ' · RAW ' + rs.filter(function(r){ return r.decision === 'RAW'; }).length;
  var held = rs.filter(function(r){ return r.decision === 'HOLD'; });
  document.getElementById('held').textContent = held.length
    ? '🟡 HOLD ' + held.length + '건 — 전문이 필요하면 재접속을 따로 요청한다 (별도 승인 · 이 화면은 네트워크를 쓰지 않는다)'
    : '';
  // 🟢 300자로 판단이 됐는지 세어 둔다 — 이 화면이 스스로 답해야 할 질문이다 (§4-AF ⑤)
  var yes = 0, no = 0;
  CARDS.forEach(function(c){
    var st = STATE[c.articleId] || {};
    if (st.enough === 'y') yes++; else if (st.enough === 'n') no++;
  });
  document.getElementById('enoughsum').textContent =
    '🟢 ' + META.bodyHeadChars + '자로 판단 가능 ' + yes + '건 · 부족 ' + no + '건'
    + (no ? ' — 부족이 쌓이면 저장 길이를 다시 논의한다(전문 저장이 아니라 길이 조정이다)' : '');
  save();
}

function download(name, text, type){
  var blob = new Blob([text], { type: type + ';charset=utf-8' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
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
      '<div class="top"><span class="rank">#' + (i + 1) + '</span>' +
      '<span class="score">' + c.score + '점</span>' +
      '<span class="tag axis">Raw Originality</span>' +
      '<span class="tag">본문 ' + c.bodyLength + '자</span>' +
      '<span class="tag">이미지 ' + c.imageCount + '</span>' +
      '<span class="tag">댓글 ' + c.commentCount + '</span>' +
      '</div>' +
      '<div class="title">' + esc(c.title) + '</div>' +
      '<div class="head">' + esc(c.bodyHead) + (c.truncated ? '…' : '') + '</div>' +
      '<div class="headnote">🟡 <b>전문이 아니다</b> — 마스킹 후 앞 ' + c.headChars + '자' +
      (c.truncated ? (' (원문 ' + c.bodyLength + '자 중)') : ' (원문 전체)') +
      '. 연락처·링크는 지워져 있다.</div>' +
      '<div class="enough">이 ' + c.headChars + '자로 판단이 되셨나요?' +
      '<button class="pill" data-e="y" type="button">된다</button>' +
      '<button class="pill" data-e="n" type="button">부족하다</button></div>' +
      '<div class="meta">' + esc(c.sourceSite) + ' · id ' + esc(c.articleId) +
      ' · run ' + esc(c.runId) +
      ' · <a href="' + esc(c.url) + '" target="_blank" rel="noreferrer noopener">원문 열기</a></div>' +
      '<div class="why">safety <b>' + esc(c.safetyVerdict) + '</b>' +
      (c.safetyReasons ? ' · ' + esc(c.safetyReasons) : '') + '</div>' +
      '<div class="acts"></div>' +
      '<div class="state"></div>' +
      '<textarea class="memo" placeholder="메모 (선택) — 왜 그렇게 판정했는지. 다시 쓸 각도를 적어두면 좋다"></textarea>';

    var acts = el.querySelector('.acts');
    DECISIONS.forEach(function(a){
      var b = document.createElement('button');
      b.className = 'act'; b.type = 'button';
      b.setAttribute('data-k', a[0]);
      b.setAttribute('aria-pressed', st.v === a[0] ? 'true' : 'false');
      b.title = a[1];
      b.textContent = a[0];
      b.addEventListener('click', function(){
        var cur = STATE[c.articleId] || {};
        cur.v = (cur.v === a[0]) ? '' : a[0];   // 같은 버튼 다시 누르면 해제
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

    Array.prototype.forEach.call(el.querySelectorAll('[data-e]'), function(b){
      if (st.enough === b.getAttribute('data-e')) b.className = 'pill on';
      b.addEventListener('click', function(){
        var cur = STATE[c.articleId] || {};
        var k = b.getAttribute('data-e');
        cur.enough = (cur.enough === k) ? '' : k;
        STATE[c.articleId] = cur;
        Array.prototype.forEach.call(el.querySelectorAll('[data-e]'), function(x){
          x.className = 'pill' + (x.getAttribute('data-e') === cur.enough ? ' on' : '');
        });
        refresh();
      });
    });

    var memo = el.querySelector('.memo');
    memo.value = st.memo || '';
    memo.addEventListener('input', function(){
      var cur = STATE[c.articleId] || {};
      cur.memo = memo.value;
      STATE[c.articleId] = cur;
      refresh();
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
var FILTERS = [['ALL','전체'],['UNDECIDED','미판정만']];
DECISIONS.forEach(function(d){ FILTERS.push([d[0], d[0]]); });
FILTERS.forEach(function(f){
  var b = document.createElement('button');
  b.className = 'pill' + (filter === f[0] ? ' on' : '');
  b.type = 'button'; b.setAttribute('data-f', f[0]);
  b.textContent = f[1];
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
  outEl.select();
  try { document.execCommand('copy'); } catch (e) { /* 무시 */ }
});
document.getElementById('dl').addEventListener('click', function(){
  download('raw-originality-approvals-' + STAMP + '.tsv', outEl.value, 'text/tab-separated-values');
});
document.getElementById('dljson').addEventListener('click', function(){
  download('raw-originality-approvals-' + STAMP + '.json', outJsonEl.value, 'application/json');
});
document.getElementById('reset').addEventListener('click', function(){
  if (!confirm('검수 결과를 모두 지웁니다.')) return;
  STATE = {};
  try { localStorage.removeItem(KEY); } catch (e) { /* 무시 */ }
  render();
});

// 🔴 빠진 행을 숨기지 않는다 — 후보가 조용히 줄어드는 것이 이 화면의 위험이다
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
