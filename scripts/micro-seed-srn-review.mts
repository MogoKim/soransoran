#!/usr/bin/env tsx
/**
 * Short Raw Noindex 승인 화면 생성기 — 🔴 **승인 파일만 만든다. 발행하지 않는다**
 *
 * 정본: docs/operations/2026-09-03-raw-supply-chain-design.md §4-Y · §4-Z
 *
 * 🔴 **이 화면이 무엇이 아닌지부터.**
 *    발행이 아니다. noindex 배포가 아니다. Raw Vault 적재가 아니다.
 *    사람이 승인/반려를 누르면 **TSV·JSON 텍스트가 생길 뿐**이다.
 *    그 파일을 무엇에 쓸지는 아직 정하지 않았다 — 정하는 것도 별도 승인이다.
 *
 * 🔴 **판정을 다시 하지 않는다.**
 *    축은 `classifyDetail()` 이 이미 냈다. 이 스크립트는 `.detail.jsonl` 을 읽어
 *    `axis === 'shortRawNoindex'` 인 행만 고른다 — 자체 판정 로직이 없다.
 *    다만 **선별 관문은 다시 확인한다**(접근·기준·길이·안전). 승인은 되돌리기 어렵다.
 *
 * 🔴 **하지 않는 것**
 *    live 크롤 · 브라우저 · 상세 fetch · DB write · Prisma · Google Sheet ·
 *    LLM 호출 · 자동 발행 · noindex 배포 · Raw Vault 적재 · 82cook adapter.
 *
 * 🔴 **생성한 HTML 도 네트워크를 쓰지 않는다.** CSS·JS 전부 인라인이고
 *    저장은 브라우저 localStorage 까지다 — DB · Sheet 로 나가는 경로가 없다.
 *
 * 사용법
 *   npx tsx scripts/micro-seed-srn-review.mts
 *   npx tsx scripts/micro-seed-srn-review.mts --out=.microseed-data/srn-review.html
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve, relative } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  SRN_AXIS, SRN_DECISIONS, EXPORT_COLUMNS, NOT_PUBLISH_NOTE, SHORT_RAW_MAX,
  selectSrn, type DetailRecord, type SrnCard, type SrnReject,
} from './lib/micro-seed-srn-review.mjs'

/** 🔴 gitignore 된 `.microseed-data/` 밖으로 내보내지 않는다 — 원문·제목이 git 에 들어가면 안 된다 */
export const SRN_DATA_DIR = '.microseed-data'
const OUT_DEFAULT = `${SRN_DATA_DIR}/srn-review.html`

const argv = process.argv.slice(2)
const arg = (n: string): string | undefined => {
  const hit = argv.find((a) => a.startsWith(`--${n}=`))
  return hit ? hit.slice(n.length + 3) : undefined
}

const fail = (m: string): never => {
  console.error(`\n🛑 ${m}\n`)
  process.exit(1)
}

/** 🔴 제목·본문은 소스 원문이다. 태그로 해석될 여지를 남기지 않는다 */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

/** 🔴 `.microseed-data/` 밖이면 거부한다 — 쓰고 나서 확인하면 이미 늦다 */
export function assertOutputPath(out: string): void {
  const rel = relative(process.cwd(), resolve(out))
  if (!rel.startsWith(`${SRN_DATA_DIR}/`)) {
    fail(
      `🔴 ${rel} 은 ${SRN_DATA_DIR}/ 밖이다 — 쓰기를 거부한다.\n` +
        '   이 HTML 에는 소스 제목과 100자 미만 본문이 들어간다. gitignore 된 곳에만 쓴다.',
    )
  }
}

/** `.detail.jsonl` 전부 읽기 — 🔴 네트워크가 아니라 파일이다 */
export function loadDetailRecords(dir: string): { records: DetailRecord[]; files: string[] } {
  const files = readdirSync(dir).filter((f) => f.endsWith('.detail.jsonl')).sort()
  const records: DetailRecord[] = []
  for (const f of files) {
    for (const line of readFileSync(`${dir}/${f}`, 'utf-8').split('\n')) {
      if (!line.trim()) continue
      try { records.push(JSON.parse(line) as DetailRecord) } catch { /* 깨진 행은 건너뛴다 */ }
    }
  }
  return { records, files }
}

function main(): void {
  const out = arg('out') ?? OUT_DEFAULT
  assertOutputPath(out)

  const { records, files } = (() => {
    try { return loadDetailRecords(SRN_DATA_DIR) } catch { return fail(`${SRN_DATA_DIR} 를 읽지 못했다`) }
  })()
  if (records.length === 0) fail('.detail.jsonl 행이 없다 — 먼저 상세 fetch 회차가 있어야 한다')

  const { cards, rejected } = selectSrn(records)

  const byCode: Record<string, number> = {}
  for (const r of rejected) byCode[r.code] = (byCode[r.code] ?? 0) + 1
  const withBody = cards.filter((c) => c.body !== null).length

  const meta = {
    generatedAt: new Date().toISOString(),
    files: files.length,
    records: records.length,
    candidates: cards.length,
    withBody,
    withoutBody: cards.length - withBody,
    shortRawMax: SHORT_RAW_MAX,
    rejectedByCode: byCode,
    notPublish: NOT_PUBLISH_NOTE,
  }

  writeFileSync(out, renderHtml(cards, rejected, meta), 'utf-8')

  console.log('\nShort Raw Noindex 승인 화면 — 🔴 발행이 아니다')
  console.log('─────────────────────────────────────────────────────────')
  console.log(`  🔴 ${NOT_PUBLISH_NOTE}`)
  console.log('  🔴 DB write 0 · Sheet 0 · LLM 0 · live fetch 0 · Raw Vault 적재 0')
  console.log(`  🟢 자격 길이는 **본문 기준** ${SHORT_RAW_MAX}자 미만이다 (§4-Y ④)`)
  console.log('  🟡 제목+본문 길이는 참고값으로만 보여준다 — 자격 판정에 쓰지 않는다\n')
  console.log(`  입력  ${files.length}개 파일 · ${records.length}행`)
  console.log(`  후보  ${cards.length}건 (${SRN_AXIS} · access ok · safety pass · body <${SHORT_RAW_MAX}자)`)
  console.log(`        본문 보존 ${withBody}건 · 미보존 ${cards.length - withBody}건`)
  console.log('  제외')
  for (const [code, n] of Object.entries(byCode).sort((a, b) => b[1] - a[1])) {
    console.log(`        ${code.padEnd(14)} ${n}행`)
  }
  console.log(`\n  ✅ ${out}`)
  console.log(`     열기: open ${out}\n`)
}

export function renderHtml(
  cards: readonly SrnCard[],
  rejected: readonly SrnReject[],
  meta: object,
): string {
  // 🔴 데이터는 <script type="application/json"> 으로 넣는다.
  //    JS 문자열로 이어붙이면 제목 안의 따옴표 하나에 화면이 깨진다.
  const data = JSON.stringify({ cards, rejected, meta }).replace(/</g, '\\u003c')
  const decisions = SRN_DECISIONS.map(([k, d]) => `['${k}','${escapeHtml(d)}']`).join(',')
  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Short Raw Noindex 승인</title>
<style>
:root{--bg:#faf9f7;--fg:#1c1a17;--mut:#6b665e;--line:#e4e0d9;--card:#fff;
--approve:#1f9254;--seed:#1d6fd6;--hold:#7a6ff0;--drop:#9a9691;--warn:#d43b3b;--ref:#8a6d3b}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);
font:16px/1.6 -apple-system,BlinkMacSystemFont,'Pretendard Variable',Pretendard,sans-serif}
header{position:sticky;top:0;z-index:9;background:var(--bg);border-bottom:1px solid var(--line);padding:14px 16px}
h1{margin:0 0 6px;font-size:19px}
.warn{font-size:13px;color:var(--mut);line-height:1.7}
.warn b{color:var(--warn)}
.banner{margin:8px 0;padding:10px 12px;border:2px solid var(--warn);border-radius:10px;
background:#fff5f5;color:var(--warn);font-size:14px;font-weight:700}
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
.tag.len{border-color:var(--approve);color:var(--approve);font-weight:700}
.tag.ref{border-color:var(--ref);color:var(--ref)}
.title{margin:8px 0;font-size:17px;font-weight:600;word-break:keep-all}
.body{margin:8px 0;padding:10px 12px;background:var(--bg);border:1px solid var(--line);
border-radius:8px;font-size:15px;word-break:keep-all;white-space:pre-wrap}
.body.none{color:var(--mut);font-size:13px;font-style:italic}
.meta{font-size:13px;color:var(--mut);word-break:break-all}
.why{font-size:13px;color:var(--mut);margin-top:4px}
.acts{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}
button.act{min-height:52px;min-width:88px;padding:0 14px;border-radius:10px;border:1px solid var(--line);
background:var(--card);font-size:15px;font-weight:600;cursor:pointer}
button.act:hover{border-color:var(--fg)}
button.act[aria-pressed="true"]{color:#fff;border-color:transparent}
button.act[data-k="APPROVE"][aria-pressed="true"]{background:var(--approve)}
button.act[data-k="SEED"][aria-pressed="true"]{background:var(--seed)}
button.act[data-k="HOLD"][aria-pressed="true"]{background:var(--hold)}
button.act[data-k="DROP"][aria-pressed="true"]{background:var(--drop)}
.state{margin-top:8px;font-size:13px;font-weight:700}
button.act[disabled]{opacity:.42;cursor:not-allowed;background:var(--bg)}
button.act[disabled]:hover{border-color:var(--line)}
.lock{margin-top:6px;font-size:13px;color:var(--warn);font-weight:700}
#blocked{margin-top:8px;font-size:13px;color:var(--warn);font-weight:700}
textarea{width:100%;margin-top:8px;min-height:44px;padding:8px;border:1px solid var(--line);
border-radius:8px;font:inherit;font-size:14px;resize:vertical}
#out,#outjson{width:100%;min-height:180px;font:13px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace}
footer{padding:16px;max-width:920px;margin:0 auto}
.note{font-size:13px;color:var(--mut);margin-top:8px}
details{margin-top:12px;font-size:13px;color:var(--mut)}
summary{cursor:pointer;min-height:34px}
table{border-collapse:collapse;margin-top:8px;font-size:13px}
td,th{border:1px solid var(--line);padding:4px 8px;text-align:left}
</style></head><body>
<header>
<h1>Short Raw Noindex 승인 <span class="tag" id="cnt"></span></h1>
<div class="banner">🔴 ${escapeHtml(NOT_PUBLISH_NOTE)}</div>
<div class="warn">
🔴 <b>이 화면은 발행 버튼이 아니다.</b> DB write 0 · Sheet 0 · LLM 0 · live fetch 0 · Raw Vault 적재 0.<br>
🔴 <b>승인</b> 을 눌러도 아무것도 나가지 않는다 — TSV/JSON 텍스트가 생길 뿐이다.<br>
🟢 자격 길이는 <b>본문(body) 기준 ${SHORT_RAW_MAX}자 미만</b> 이다 (§4-Y ④ 확정).<br>
🟡 <b>제목+본문</b> 길이는 <b>참고값</b> 이다 — 자격 판정에 쓰지 않는다. 제목은 운영자가 바꿀 수 있기 때문이다.<br>
🔴 여기에는 <b>${escapeHtml(SRN_AXIS)} 축만</b> 올라온다. Seed Originality · Raw · Hold · Drop · Access 는 섞이지 않는다.<br>
🔴 안전·브랜드 필터가 <b>길이보다 먼저</b> 다 — safety 가 pass 가 아닌 글은 애초에 후보가 아니다.<br>
🟡 ${SHORT_RAW_MAX}자 미만은 <b>자격 조건</b> 이지 <b>자동 발행 조건이 아니다</b>.<br>
🔴 저장은 이 브라우저 <b>localStorage</b> 까지다. 결과는 TSV/JSON 으로 직접 가져간다.<br>
🟢 <b>APPROVE 된 SRN 행에만</b> 원문(body)이 export 에 실린다 — 승인 파일이 다음 단계의 입력이 되기 때문이다.<br>
🔴 <b>본문 미보존 후보는 승인할 수 없다</b> — 원문을 보지 않고 누르는 승인을 막는다. 다른 판정은 가능하다.
</div>
<div class="bar" id="filters"></div>
<div class="bar">
<button class="pill" id="copy">TSV 복사</button>
<button class="pill" id="dl">TSV 내려받기</button>
<button class="pill" id="dljson">JSON 내려받기</button>
<button class="pill" id="reset">승인 초기화</button>
<span class="tag" id="prog"></span>
</div>
</header>
<main id="list"></main>
<footer>
<div id="blocked"></div>
<h2 style="font-size:16px">승인 결과 TSV</h2>
<textarea id="out" readonly></textarea>
<h2 style="font-size:16px">승인 결과 JSON</h2>
<textarea id="outjson" readonly></textarea>
<div class="note">🔴 사람이 누른 것만 나간다. 누르지 않은 후보는 결과에 없다 —
기본값으로 채우면 "승인" 이 사람의 행위가 아니게 된다.</div>
<details><summary>후보에서 빠진 행 보기</summary><div id="rej"></div></details>
</footer>
<script type="application/json" id="data">${data}</script>
<script>
(function(){
'use strict';
var DATA = JSON.parse(document.getElementById('data').textContent);
var CARDS = DATA.cards, REJECTED = DATA.rejected, META = DATA.meta;
var DECISIONS = [${decisions}];
var KEY = 'srn-review-v1';
// 🔴 컬럼 계약은 lib 이 정본이다. 화면이 따로 만들지 않는다.
var COLS = ${JSON.stringify(EXPORT_COLUMNS)};
var NOTE = ${JSON.stringify(NOT_PUBLISH_NOTE)};
var MAX = ${SHORT_RAW_MAX};
function cell(v){ return String(v == null ? '' : v).replace(/[\\t\\r\\n]+/g, ' '); }

function load(){ try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { return {}; } }
function save(){ try { localStorage.setItem(KEY, JSON.stringify(STATE)); } catch (e) { /* 사파리 프라이빗 등 */ } }
var STATE = load();

var listEl = document.getElementById('list');
var outEl = document.getElementById('out');
var outJsonEl = document.getElementById('outjson');
var filter = 'ALL';

function esc(s){ var d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; }

// 🔴 export 계약 — lib.exportRows 와 같은 규칙이다. 누른 것만, 컬럼 순서 그대로.
function rows(){
  var out = [];
  CARDS.forEach(function(c){
    var st = STATE[c.articleId] || {};
    if (!st.v) return;
    // 🔴 승인인데 원문이 없으면 행 자체를 만들지 않는다 (lib.exportRows 와 같은 규칙)
    if (st.v === 'APPROVE' && !c.approvable) return;
    out.push({
      decision: st.v, axis: ${JSON.stringify(SRN_AXIS)},
      sourceArticleId: c.articleId, sourceSite: c.sourceSite, url: c.url,
      score: c.score, lane: c.lane,
      bodyLength: c.bodyLength, lengthBasis: c.lengthBasis,
      titleBodyRefLength: c.titleBodyRefLength,
      imageCount: c.imageCount, commentCount: c.commentCount,
      safetyVerdict: c.safetyVerdict, safetyReasons: c.safetyReasons,
      title: c.title, memo: st.memo || '', note: NOTE,
      // 🟢 원문은 APPROVE 된 행에만 — 승인하지 않은 글의 원문까지 실으면 그것은 원문 배포다
      body: st.v === 'APPROVE' ? (c.body || '') : ''
    });
  });
  return out;
}

function tsv(){
  var lines = [COLS.join('\\t')];
  rows().forEach(function(r){ lines.push(COLS.map(function(k){ return cell(r[k]); }).join('\\t')); });
  return lines.join('\\n');
}

// 🔴 승인했지만 못 내보내는 행 — 조용히 사라지지 않게 화면에 이름을 남긴다
function blocked(){
  return CARDS.filter(function(c){
    var st = STATE[c.articleId] || {};
    return st.v === 'APPROVE' && !c.approvable;
  });
}

function refresh(){
  var rs = rows();
  var bl = blocked();
  document.getElementById('blocked').textContent = bl.length
    ? '🔴 승인했지만 내보내지 못한 ' + bl.length + '건 — 본문 미보존이라 원문 없이 승인할 수 없다 (' +
      bl.map(function(c){ return c.articleId; }).join(', ') + ')'
    : '';
  outEl.value = tsv();
  outJsonEl.value = JSON.stringify({ note: NOTE, generatedAt: META.generatedAt, decisions: rs }, null, 2);
  document.getElementById('prog').textContent = '승인 검토 ' + rs.length + ' / ' + CARDS.length;
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
    // 🔴 남은 일을 찾는 필터 — 후보가 늘면 이것 없이는 진행 상황을 눈으로 못 쫓는다
    if (filter === 'UNDECIDED') return !(STATE[c.articleId] || {}).v;
    if (filter === 'BODY') return c.body !== null;
    if (filter === 'NOBODY') return c.body === null;
    return (STATE[c.articleId] || {}).v === filter;
  });
  listEl.innerHTML = '';
  shown.forEach(function(c, i){
    var st = STATE[c.articleId] || {};
    var el = document.createElement('article');
    el.className = 'card';
    el.setAttribute('data-id', c.articleId);
    if (st.v) el.setAttribute('data-done','1');

    var bodyHtml = c.body !== null
      ? '<div class="body">' + esc(c.body) + '</div>'
      : '<div class="body none">본문 미보존 — 이 회차는 본문을 저장하기 전에 수집했다. ' +
        '길이(' + c.bodyLength + '자)는 수집 시점에 잰 값이다. 원문은 링크로 확인한다.</div>';

    el.innerHTML =
      '<div class="top"><span class="rank">#' + (i + 1) + '</span>' +
      '<span class="score">' + c.score + '점</span>' +
      '<span class="tag len">본문 ' + c.bodyLength + '자 (자격 기준)</span>' +
      '<span class="tag ref">제목+본문 ' + c.titleBodyRefLength + '자 · 참고값</span>' +
      '<span class="tag">이미지 ' + c.imageCount + '</span>' +
      '<span class="tag">댓글 ' + c.commentCount + '</span></div>' +
      '<div class="title">' + esc(c.title) + '</div>' +
      bodyHtml +
      '<div class="meta">' + esc(c.sourceSite) + ' · id ' + esc(c.articleId) +
      ' · <a href="' + esc(c.url) + '" target="_blank" rel="noreferrer noopener">원문 열기</a></div>' +
      '<div class="why">safety <b>' + esc(c.safetyVerdict) + '</b>' +
      (c.safetyReasons ? ' · ' + esc(c.safetyReasons) : '') + '</div>' +
      '<div class="why">판정 ' + esc(c.reason) + '</div>' +
      '<div class="acts"></div>' +
      (c.approvable ? '' : '<div class="lock">🔴 본문 미보존이라 <b>승인 불가</b> — SEED · HOLD · DROP 은 가능하다</div>') +
      '<div class="state"></div>' +
      '<textarea class="memo" placeholder="메모 (선택)"></textarea>';

    var acts = el.querySelector('.acts');
    DECISIONS.forEach(function(a){
      var b = document.createElement('button');
      b.className = 'act'; b.type = 'button';
      b.setAttribute('data-k', a[0]);
      b.setAttribute('aria-pressed', st.v === a[0] ? 'true' : 'false');
      b.title = a[1];
      b.textContent = a[0];
      // 🔴 본문을 못 보는 후보는 승인 자체를 막는다 — 다른 판정은 열어 둔다
      if (a[0] === 'APPROVE' && !c.approvable) {
        b.disabled = true;
        b.title = '본문 미보존이라 승인 불가 — 원문을 보지 않고 승인할 수 없다';
      }
      b.addEventListener('click', function(){
        var cur = STATE[c.articleId] || {};
        cur.v = (cur.v === a[0]) ? '' : a[0];   // 같은 버튼 다시 누르면 해제
        STATE[c.articleId] = cur;
        Array.prototype.forEach.call(acts.querySelectorAll('.act'), function(x){
          x.setAttribute('aria-pressed', x.getAttribute('data-k') === cur.v ? 'true' : 'false');
        });
        el.setAttribute('data-done', cur.v ? '1' : '0');
        setState();
        // 🔴 '미판정만' 을 보고 있으면 방금 판정한 카드는 목록에서 빠져야 한다
        if (filter === 'UNDECIDED') { render(); return; }
        refresh();
      });
      acts.appendChild(b);
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
  document.getElementById('cnt').textContent =
    '후보 ' + CARDS.length + '건 · 본문 보존 ' + META.withBody + ' · 미보존 ' + META.withoutBody;
  refresh();
}

var fEl = document.getElementById('filters');
var FILTERS = [['ALL','전체'],['UNDECIDED','미판정만'],['BODY','본문 있음'],['NOBODY','본문 미보존']];
DECISIONS.forEach(function(d){ FILTERS.push([d[0], d[0]]); });
FILTERS.forEach(function(f){
  var b = document.createElement('button');
  b.className = 'pill' + (filter === f[0] ? ' on' : '');
  b.type = 'button'; b.setAttribute('data-f', f[0]);
  b.textContent = f[1];
  b.addEventListener('click', function(){
    filter = f[0];
    Array.prototype.forEach.call(fEl.querySelectorAll('.pill'), function(x){
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
  download('srn-review.tsv', tsv(), 'text/tab-separated-values');
});
document.getElementById('dljson').addEventListener('click', function(){
  download('srn-review.json', outJsonEl.value, 'application/json');
});
document.getElementById('reset').addEventListener('click', function(){
  if (!confirm('승인 결과를 모두 지웁니다.')) return;
  STATE = {};
  try { localStorage.removeItem(KEY); } catch (e) { /* 무시 */ }
  render();
});

// 🔴 빠진 행을 숨기지 않는다 — 후보가 조용히 줄어드는 것이 이 화면의 위험이다
(function(){
  var counts = {};
  REJECTED.forEach(function(r){ counts[r.code] = (counts[r.code] || 0) + 1; });
  var rows = Object.keys(counts).sort(function(a,b){ return counts[b] - counts[a]; });
  var html = '<table><tr><th>제외 사유</th><th>행</th></tr>';
  rows.forEach(function(k){ html += '<tr><td>' + esc(k) + '</td><td>' + counts[k] + '</td></tr>'; });
  html += '</table>';
  document.getElementById('rej').innerHTML = html;
})();

render();
})();
</script>
</body></html>
`
}

/**
 * 🔴 CLI 로 직접 실행할 때만 돈다.
 *    fixture 가 renderHtml · selectSrn 을 import 해서 검사하는데,
 *    가드가 없으면 import 만으로 파일을 쓴다 (PR-S2-b-19 사고).
 */
const isDirectRun = process.argv[1] !== undefined
  && import.meta.url === pathToFileURL(process.argv[1]).href

if (isDirectRun) main()
