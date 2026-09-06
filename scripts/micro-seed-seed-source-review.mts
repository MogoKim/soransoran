#!/usr/bin/env tsx
/**
 * Seed Originality 소스 검수 화면 생성기 — 🔴 **소재 승인 파일만 만든다**
 *
 * 정본: docs/operations/2026-09-03-raw-supply-chain-design.md §4-AD
 *
 * 🔴 **이 화면이 무엇이 아닌지부터.**
 *    발행이 아니다. noindex 배포가 아니다. 원문을 그대로 쓰는 결정도 아니다.
 *    사람이 SEED/HOLD/DROP 을 누르면 **TSV·JSON 텍스트가 생길 뿐**이다.
 *
 * 🔴 **SRN 승인 화면과 섞지 않는다** (§4-AD ②).
 *    SRN 의 `APPROVE` 는 *"원문 그대로 noindex 로 낸다"* 는 뜻이다(§4-Z ②).
 *    그 버튼이 여기 보이면 한 번 잘못 눌러 **재가공해야 할 글이 원문 그대로** 후보가 된다.
 *    화면 하나에 질문 하나 — 그래서 파일도 화면도 따로 둔다.
 *
 * 🔴 **본문이 없다.** `body` 는 SRN 축일 때만 저장된다(§4-Z ⑥).
 *    이 화면의 질문은 *"이 원문이 좋은가"* 가 아니라
 *    **"이 소재를 우리 질문으로 바꿀 수 있나"** 다 — 제목과 메타로 판단한다.
 *    판단이 안 서면 **HOLD 로 두고 멈춘다.** 재접속은 별도 승인이다(§4-AD ⑤).
 *
 * 🔴 **하지 않는 것**
 *    live 크롤 · 브라우저 · 상세 fetch · DB write · Prisma · Google Sheet ·
 *    LLM · 자동 발행 · noindex 배포 · Raw Vault 적재 · 82cook adapter.
 *
 * 🔴 **생성한 HTML 도 네트워크를 쓰지 않는다.** CSS·JS 인라인 · localStorage 까지다.
 *
 * 사용법
 *   npx tsx scripts/micro-seed-seed-source-review.mts
 *   npx tsx scripts/micro-seed-seed-source-review.mts --out=.microseed-data/x.html
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve, relative } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  SOURCE_AXIS, SOURCE_DECISIONS, SOURCE_COLUMNS, NOT_PUBLISH_NOTE,
  selectSources, type DetailRecord, type SourceCard, type SourceReject,
} from './lib/micro-seed-seed-source-review.mjs'

export const SOURCE_DATA_DIR = '.microseed-data'
const OUT_DEFAULT = `${SOURCE_DATA_DIR}/seed-source-review.html`

const argv = process.argv.slice(2)
const arg = (n: string): string | undefined => {
  const hit = argv.find((a) => a.startsWith(`--${n}=`))
  return hit ? hit.slice(n.length + 3) : undefined
}

const fail = (m: string): never => {
  console.error(`\n🛑 ${m}\n`)
  process.exit(1)
}

/** 🔴 소스 제목이 들어간다. gitignore 된 곳에만 읽고 쓴다 */
export function assertInsideDataDir(p: string): void {
  const rel = relative(process.cwd(), resolve(p))
  if (!rel.startsWith(`${SOURCE_DATA_DIR}/`)) {
    fail(`🔴 ${rel} 은 ${SOURCE_DATA_DIR}/ 밖이다 — 거부한다.`)
  }
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

/** 🔴 파일 이름에 시각을 넣는다 — 날짜만 쓰면 같은 날 재실행이 덮어쓴다 (§4-AA ⑨ 사고) */
export function sourceRunId(now: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}`
    + `-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`
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
  assertInsideDataDir(out)

  const { records, files } = (() => {
    try { return loadDetailRecords(SOURCE_DATA_DIR) } catch { return fail(`${SOURCE_DATA_DIR} 를 읽지 못했다`) }
  })()
  if (records.length === 0) fail('.detail.jsonl 행이 없다 — 먼저 상세 fetch 회차가 있어야 한다')

  const { cards, rejected } = selectSources(records)
  if (cards.length === 0) fail(`${SOURCE_AXIS} 후보가 없다 — 이 축으로 판정된 글이 아직 없다`)

  const byCode: Record<string, number> = {}
  for (const r of rejected) byCode[r.code] = (byCode[r.code] ?? 0) + 1

  const meta = {
    generatedAt: new Date().toISOString(),
    files: files.length,
    records: records.length,
    candidates: cards.length,
    rejectedByCode: byCode,
    notPublish: NOT_PUBLISH_NOTE,
  }

  writeFileSync(out, renderHtml(cards, rejected, meta), 'utf-8')

  console.log('\nSeed Originality 소스 검수 화면 — 🔴 발행이 아니다')
  console.log('─────────────────────────────────────────────────────────')
  console.log(`  🔴 ${NOT_PUBLISH_NOTE}`)
  console.log('  🔴 DB write 0 · Sheet 0 · LLM 0 · 네이버 0 · Raw Vault 0 · 자동 발행 0')
  console.log('  🔴 SRN 승인 화면과 섞지 않는다 — 여기에 APPROVE · ADOPT 는 없다 (§4-AD ②⑥)')
  console.log('  🟡 본문은 저장되지 않는다 — 제목과 메타로 소재를 판단한다 (§4-AD ④)\n')
  console.log(`  입력  ${files.length}개 파일 · ${records.length}행`)
  console.log(`  후보  ${cards.length}건 (${SOURCE_AXIS} · access ok · safety pass)`)
  console.log('  제외')
  for (const [code, n] of Object.entries(byCode).sort((a, b) => b[1] - a[1])) {
    console.log(`        ${code.padEnd(15)} ${n}행`)
  }
  console.log(`\n  ✅ ${out}`)
  console.log(`     열기: open ${out}\n`)
}

export function renderHtml(
  cards: readonly SourceCard[],
  rejected: readonly SourceReject[],
  meta: object,
): string {
  const data = JSON.stringify({ cards, rejected, meta }).replace(/</g, '\\u003c')
  const decisions = SOURCE_DECISIONS.map(([k, d]) => `['${k}','${escapeHtml(d)}']`).join(',')
  const stamp = sourceRunId(new Date())
  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Seed Originality 소스 검수</title>
<style>
:root{--bg:#faf9f7;--fg:#1c1a17;--mut:#6b665e;--line:#e4e0d9;--card:#fff;
--seed:#1f9254;--hold:#b06a00;--drop:#9a9691;--warn:#d43b3b;--meta:#1d6fd6}
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
.tag.axis{border-color:var(--meta);color:var(--meta);font-weight:700}
.title{margin:8px 0;font-size:17px;font-weight:600;word-break:keep-all}
.nobody{margin:8px 0;padding:10px 12px;background:var(--bg);border:1px solid var(--line);
border-radius:8px;font-size:13px;color:var(--mut);font-style:italic}
.meta{font-size:13px;color:var(--mut);word-break:break-all}
.why{font-size:13px;color:var(--mut);margin-top:4px}
.acts{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}
button.act{min-height:52px;min-width:88px;padding:0 14px;border-radius:10px;border:1px solid var(--line);
background:var(--card);font-size:15px;font-weight:600;cursor:pointer}
button.act:hover{border-color:var(--fg)}
button.act[aria-pressed="true"]{color:#fff;border-color:transparent}
button.act[data-k="SEED"][aria-pressed="true"]{background:var(--seed)}
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
<h1>Seed Originality 소스 검수 <span class="tag" id="cnt"></span></h1>
<div class="banner">🔴 ${escapeHtml(NOT_PUBLISH_NOTE)}</div>
<div class="ask">🟢 이 화면의 질문 — <b>"이 소재를 우리 질문으로 바꿀 수 있나"</b> 이지 "이 원문이 좋은가" 가 아니다</div>
<div class="warn">
🔴 <b>이 화면은 발행 버튼이 아니다.</b> DB write 0 · Sheet 0 · LLM 0 · 네이버 0 · Raw Vault 0.<br>
🔴 여기에는 <b>${escapeHtml(SOURCE_AXIS)} 축만</b> 올라온다. SRN · Raw · Hold · Drop · Access 는 섞이지 않는다.<br>
🔴 <b>APPROVE · ADOPT 버튼이 없다.</b> APPROVE 는 SRN 의 "원문 그대로 낸다" 이고(§4-Z ②),
ADOPT 는 초안 검수 단계의 말이다(§4-AB). 여기서 고르는 것은 <b>초안이 아니라 소재</b> 다.<br>
🟡 <b>본문은 저장되지 않는다</b> — 원문 그대로 쓰지 않는 레인이라 전문을 모아두지 않는다(§4-Z ⑥).
제목과 메타로 판단한다.<br>
🔴 판단이 안 서면 <b>HOLD</b> 로 두고 멈춘다. 전문을 보려면 <b>재접속이 필요하고 그것은 별도 승인</b> 이다.<br>
🟢 <b>SEED</b> 로 고른 행만 이후 <code>micro-seed:seed-originality</code> 입력 후보가 된다.<br>
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
<h2 style="font-size:16px">소재 승인 TSV</h2>
<textarea id="out" readonly></textarea>
<h2 style="font-size:16px">소재 승인 JSON</h2>
<textarea id="outjson" readonly></textarea>
<div class="note">🔴 사람이 누른 것만 나간다. 누르지 않은 후보는 결과에 없다 —
기본값으로 채우면 "검수" 가 사람의 행위가 아니게 된다.</div>
<details><summary>후보에서 빠진 행 보기</summary><div id="rej"></div></details>
</footer>
<script type="application/json" id="data">${data}</script>
<script>
(function(){
'use strict';
var DATA = JSON.parse(document.getElementById('data').textContent);
var CARDS = DATA.cards, REJECTED = DATA.rejected, META = DATA.meta;
var DECISIONS = [${decisions}];
var KEY = 'seed-source-review-v1';
var COLS = ${JSON.stringify(SOURCE_COLUMNS)};
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

// 🔴 export 계약 — lib.sourceRows 와 같은 규칙이다. 누른 것만, 컬럼 순서 그대로.
//    reviewedAt 은 이 export 를 만든 시각이고, 한 파일 안 모든 행이 같은 값을 쓴다.
function rows(at){
  at = at || new Date().toISOString();
  var out = [];
  CARDS.forEach(function(c){
    var st = STATE[c.articleId] || {};
    if (!st.v) return;
    out.push({
      decision: st.v, sourceArticleId: c.articleId, sourceSite: c.sourceSite, url: c.url,
      score: c.score, lane: c.lane,
      bodyLength: c.bodyLength, imageCount: c.imageCount, commentCount: c.commentCount,
      assetAxes: c.assetAxes,
      safetyVerdict: c.safetyVerdict, safetyReasons: c.safetyReasons,
      title: c.title, memo: st.memo || '',
      detailRunId: c.detailRunId, reviewedAt: at, note: NOTE
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
  // 🔴 TSV 와 JSON 이 같은 시각을 써야 한다 — 따로 부르면 몇 밀리초 어긋난다
  var at = new Date().toISOString();
  var rs = rows(at);
  outEl.value = tsv(at);
  outJsonEl.value = JSON.stringify({ note: NOTE, reviewedAt: at, decisions: rs }, null, 2);
  document.getElementById('prog').textContent = '검수 ' + rs.length + ' / ' + CARDS.length
    + ' · SEED ' + rs.filter(function(r){ return r.decision === 'SEED'; }).length;
  // 🟡 HOLD 는 재접속 요청 대상으로 모인다 (§4-AD ⑤)
  var held = rs.filter(function(r){ return r.decision === 'HOLD'; });
  document.getElementById('held').textContent = held.length
    ? '🟡 HOLD ' + held.length + '건 — 전문이 필요하면 재접속을 따로 요청한다 (별도 승인 · 이 화면은 네트워크를 쓰지 않는다)'
    : '';
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
      '<span class="tag axis">Seed Originality</span>' +
      '<span class="tag">본문 ' + c.bodyLength + '자</span>' +
      '<span class="tag">이미지 ' + c.imageCount + '</span>' +
      '<span class="tag">댓글 ' + c.commentCount + '</span>' +
      (c.assetAxes ? '<span class="tag">사연 축 ' + esc(c.assetAxes) + '</span>' : '') +
      '</div>' +
      '<div class="title">' + esc(c.title) + '</div>' +
      '<div class="nobody">본문은 저장되지 않는다 — 이 레인은 원문을 그대로 쓰지 않는다. ' +
      '길이(' + c.bodyLength + '자)는 수집 시점에 잰 값이다. 전문이 필요하면 HOLD 로 두고 재접속을 따로 요청한다.</div>' +
      '<div class="meta">' + esc(c.sourceSite) + ' · id ' + esc(c.articleId) +
      ' · run ' + esc(c.detailRunId) +
      ' · <a href="' + esc(c.url) + '" target="_blank" rel="noreferrer noopener">원문 열기</a></div>' +
      '<div class="why">safety <b>' + esc(c.safetyVerdict) + '</b>' +
      (c.safetyReasons ? ' · ' + esc(c.safetyReasons) : '') + '</div>' +
      '<div class="why">판정 ' + esc(c.reason) + '</div>' +
      '<div class="acts"></div>' +
      '<div class="state"></div>' +
      '<textarea class="memo" placeholder="메모 (선택) — 사람이 읽는 근거다. 소재 분류 입력이 아니다"></textarea>';

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
  // 🔴 화면에 보이는 값 그대로 내려받는다 — 다시 계산하면 시각이 달라진다
  download('seed-originality-source-approvals-' + STAMP + '.tsv', outEl.value, 'text/tab-separated-values');
});
document.getElementById('dljson').addEventListener('click', function(){
  download('seed-originality-source-approvals-' + STAMP + '.json', outJsonEl.value, 'application/json');
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
