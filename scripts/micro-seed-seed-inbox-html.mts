#!/usr/bin/env tsx
/**
 * Seed Inbox 검수 화면 생성기 — 🔴 **읽기 전용 검수 도구다. 저장소가 아니다**
 *
 * 정본: docs/operations/2026-09-03-raw-supply-chain-design.md §4-L · §4-N
 *
 * 🔴 **CLI 와 HTML 이 같은 기준을 쓴다.**
 *    판정은 `verdictOf()` 하나가 내린다 — 이 파일은 그것을 **import 해서 쓸 뿐**
 *    자체 판정 로직을 갖지 않는다. 두 화면이 갈라지면 검수 결과를 믿을 수 없다.
 *    (PR-S2-b-19 의 엔트리포인트 가드 덕에 import 해도 리포트가 돌지 않는다)
 *
 * 🔴 **이 스크립트가 하지 않는 것**
 *    live 크롤 · 상세 fetch · 브라우저 · DB write · Prisma · importer ·
 *    Google Sheet read/write · LLM 호출 · 자동 라우팅 · Raw Vault 적재.
 *    `.microseed-data` 의 scout list JSONL 을 읽고 **HTML 한 장**을 쓴다.
 *
 * 🔴 **생성한 HTML 도 네트워크를 쓰지 않는다.**
 *    외부 CDN · 폰트 · 이미지 요청이 없다. CSS·JS 전부 인라인이다.
 *    저장은 브라우저 localStorage 까지다 — DB · Sheet 로 나가는 경로가 없다.
 *
 * 🔴 **rawBody · 쿠키 · 세션 · HTML 원문을 읽지도 쓰지도 않는다.**
 *    목록 JSONL 에는 본문 자체가 없다.
 *
 * 사용법
 *   npx tsx scripts/micro-seed-seed-inbox-html.mts
 *   npx tsx scripts/micro-seed-seed-inbox-html.mts --out=.microseed-data/review.html
 */
import { writeFileSync } from 'node:fs'
import { resolve, relative } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  VERDICT_LABEL, VERDICT_MEANING, SEED_INBOX_LANES, isSeedInboxLane,
  toCards, TSV_COLUMNS, RECOMMENDED_NOTE, overrideNoteOf,
  type ReviewCard,
} from './micro-seed-seed-inbox-dry-run.mjs'

// 🔴 카드·TSV 정의는 dry-run 모듈이 정본이다. 여기서 다시 만들지 않는다.
//    fixture 가 기존 경로로 import 하므로 그대로 다시 내보낸다.
export { toCards, TSV_COLUMNS, RECOMMENDED_NOTE, overrideNoteOf, type ReviewCard }
import { loadScoutRows, SCOUT_DATA_DIR } from './lib/micro-seed-scout-load.mjs'
import { scoreRows, toArticles, LANE_LABEL } from './lib/micro-seed-scout-score.mjs'

const argv = process.argv.slice(2)
const arg = (n: string): string | undefined => {
  const hit = argv.find((a) => a.startsWith(`--${n}=`))
  return hit ? hit.slice(n.length + 3) : undefined
}

/** 🔴 gitignore 된 `.microseed-data/` 밖으로 내보내지 않는다 — 소스 제목이 git 에 들어가면 안 된다 */
const OUT_DEFAULT = `${SCOUT_DATA_DIR}/seed-inbox-review.html`

const fail = (m: string): never => {
  console.error(`\n🛑 ${m}\n`)
  process.exit(1)
}

/** 🔴 제목은 소스 원문이다. 태그로 해석될 여지를 남기지 않는다 */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

/** 검수 버튼 — 🔴 순서가 곧 권장 순서는 아니다. 판정은 verdictOf 가 이미 냈다 */
export const REVIEW_ACTIONS: readonly (readonly [string, string])[] = [
  ['DETAIL', '본문·댓글 확인'],
  ['SEED', '제목만으로 채택'],
  ['RAW', '긴 원문 재료'],
  ['HOLD', '보류'],
  ['DROP', '버림'],
  ['WRONG', '분류가 틀렸다'],
] as const

function main(): void {
  const out = arg('out') ?? OUT_DEFAULT
  const rel = relative(process.cwd(), resolve(out))
  // 🔴 gitignore 밖이면 거부한다. 쓰고 나서 확인하면 이미 워킹트리에 제목이 놓인 뒤다
  if (!rel.startsWith('.microseed-data/')) {
    fail(
      `🔴 ${rel} 은 .microseed-data/ 밖이다 — 쓰기를 거부한다.\n` +
        '   이 HTML 에는 소스 제목이 들어간다. gitignore 된 곳에만 쓴다.',
    )
  }

  const { loaded, legacyRows, legacyFiles } = (() => {
    try { return loadScoutRows(SCOUT_DATA_DIR, null) } catch { return fail(`${SCOUT_DATA_DIR} 를 읽지 못했다`) }
  })()
  if (loaded.length === 0) fail('분석할 행이 없다')

  const rows = loaded.flatMap((l) => l.rows)
  const articles = toArticles(rows)
  const { scored } = scoreRows(rows)
  const seed = scored.filter((s) => isSeedInboxLane(s.laneHint.lane))
  const cards = toCards(seed)

  const counts = { seedOk: 0, needsDetail: 0, visualDependent: 0, rawMaybe: 0 } as Record<string, number>
  for (const c of cards) counts[c.verdict] = (counts[c.verdict] ?? 0) + 1

  const meta = {
    generatedAt: new Date().toISOString(),
    files: loaded.length,
    rows: rows.length,
    articles: articles.length,
    legacyRows,
    legacyFiles: legacyFiles.length,
    lanes: SEED_INBOX_LANES.map((l) => ({ lane: l, label: LANE_LABEL[l], n: cards.filter((c) => c.lane === l).length })),
    counts,
    meanings: VERDICT_MEANING,
  }

  writeFileSync(out, renderHtml(cards, meta), 'utf-8')

  console.log(`\nSeed Inbox 검수 화면 — 🔴 저장소가 아니다`)
  console.log('─────────────────────────────────────────────────────────')
  console.log(`  🔴 DB write 0 · Sheet write 0 · LLM 0 · live 0 · 상세 fetch 0`)
  console.log(`  🔴 판정은 CLI 와 같은 verdictOf() 가 낸다 — 이 파일은 판정 로직이 없다`)
  console.log(`  🔴 저장은 브라우저 localStorage 까지다\n`)
  console.log(`  입력  파일 ${loaded.length}개 · 관측 ${rows.length}행 → 고유 글 ${articles.length}건`)
  console.log(`        legacy 제외 ${legacyRows}행 · 파일 ${legacyFiles.length}개`)
  console.log(`  후보  ${cards.length}건`)
  for (const l of meta.lanes) console.log(`        ${l.label.padEnd(9)} ${l.n}건`)
  console.log(`  추천  상세 읽기 ${counts.needsDetail ?? 0} · Seed로 좋음 ${counts.seedOk ?? 0} · 이미지 의존 ${counts.visualDependent ?? 0} · Raw 후보 ${counts.rawMaybe ?? 0}`)
  console.log(`\n  ✅ ${out}`)
  console.log(`     열기: open ${out}\n`)
}

export function renderHtml(cards: readonly ReviewCard[], meta: object): string {
  // 🔴 데이터는 <script type="application/json"> 으로 넣는다.
  //    JS 문자열로 이어붙이면 제목 안의 따옴표 하나에 화면이 깨진다.
  const data = JSON.stringify({ cards, meta }).replace(/</g, '\\u003c')
  const actions = REVIEW_ACTIONS.map(([k, d]) => `['${k}','${escapeHtml(d)}']`).join(',')
  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Seed Inbox 검수</title>
<style>
:root{--bg:#faf9f7;--fg:#1c1a17;--mut:#6b665e;--line:#e4e0d9;--card:#fff;
--detail:#1d6fd6;--seed:#1f9254;--raw:#b06a00;--visual:#8a6d3b;--hold:#7a6ff0;--drop:#9a9691;--wrong:#d43b3b}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);
font:16px/1.6 -apple-system,BlinkMacSystemFont,'Pretendard Variable',Pretendard,sans-serif}
header{position:sticky;top:0;z-index:9;background:var(--bg);border-bottom:1px solid var(--line);padding:14px 16px}
h1{margin:0 0 6px;font-size:19px}
.warn{font-size:13px;color:var(--mut);line-height:1.7}
.warn b{color:var(--wrong)}
.bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:10px}
.pill{border:1px solid var(--line);background:var(--card);border-radius:999px;padding:5px 12px;font-size:13px;cursor:pointer;min-height:34px}
.pill.on{background:var(--fg);color:#fff;border-color:var(--fg)}
main{padding:16px;max-width:920px;margin:0 auto}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px;margin-bottom:14px}
.card[data-done="1"]{border-color:var(--fg)}
.top{display:flex;flex-wrap:wrap;gap:8px;align-items:baseline}
.rank{font-weight:700}.score{font-variant-numeric:tabular-nums}
.tag{font-size:12px;border:1px solid var(--line);border-radius:6px;padding:2px 7px;color:var(--mut)}
.rec{font-size:13px;font-weight:700}
.rec[data-v="needsDetail"]{color:var(--detail)}
.rec[data-v="seedOk"]{color:var(--seed)}
.rec[data-v="rawMaybe"]{color:var(--raw)}
.rec[data-v="visualDependent"]{color:var(--visual)}
.title{margin:8px 0;font-size:17px;font-weight:600;word-break:keep-all}
.meta{font-size:13px;color:var(--mut);word-break:break-all}
.why{font-size:13px;color:var(--mut);margin-top:4px}
.acts{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}
button.act{min-height:52px;min-width:84px;padding:0 14px;border-radius:10px;border:1px solid var(--line);
background:var(--card);font-size:15px;font-weight:600;cursor:pointer}
button.act:hover{border-color:var(--fg)}
button.act[aria-pressed="true"]{color:#fff;border-color:transparent}
button.act[data-k="DETAIL"][aria-pressed="true"]{background:var(--detail)}
button.act[data-k="SEED"][aria-pressed="true"]{background:var(--seed)}
button.act[data-k="RAW"][aria-pressed="true"]{background:var(--raw)}
button.act[data-k="HOLD"][aria-pressed="true"]{background:var(--hold)}
button.act[data-k="DROP"][aria-pressed="true"]{background:var(--drop)}
button.act[data-k="WRONG"][aria-pressed="true"]{background:var(--wrong)}
.state{margin-top:8px;font-size:13px;font-weight:700}
textarea{width:100%;margin-top:8px;min-height:44px;padding:8px;border:1px solid var(--line);
border-radius:8px;font:inherit;font-size:14px;resize:vertical}
#out{width:100%;min-height:220px;font:13px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace}
footer{padding:16px;max-width:920px;margin:0 auto}
.note{font-size:13px;color:var(--mut);margin-top:8px}
</style></head><body>
<header>
<h1>Seed Inbox 검수 <span class="tag" id="cnt"></span></h1>
<div class="warn">
🔴 <b>이 화면은 저장소가 아니다.</b> DB write 0 · Sheet write 0 · LLM 0 · live 0 · 상세 fetch 0.<br>
🔴 판정은 CLI 와 <b>같은 verdictOf()</b> 가 낸다. 이 화면은 판정 로직을 갖지 않는다.<br>
🔴 저장은 이 브라우저 <b>localStorage</b> 까지다. 결과는 TSV 로 직접 가져간다.<br>
🔴 여기는 <b>triage</b> 다 — 최종 채택이 아니다. Raw Vault 확정은 DETAIL 이후에만 가능하다.<br>
🟢 추천 기준은 <b>창업자 승인 v1</b> 이다 (§4-O). 승인된 것은 <b>추천 기준</b>이지 자동화가 아니다 — 버튼은 사람이 누른다.<br>
🟡 <b>추천값으로 전체 선택</b> = 47건을 <b>추천값으로 초기화</b>한다. 🔴 <b>사람이 바꾼 값도 덮어쓴다</b> — 바로 뒤 <b>되돌리기</b> 한 번으로 복구된다.
</div>
<div class="bar" id="filters"></div>
<div class="bar">
<button class="pill" id="fill">추천값으로 전체 선택</button>
<button class="pill" id="undo" disabled>되돌리기</button>
<button class="pill" id="copy">TSV 복사</button>
<button class="pill" id="dl">TSV 내려받기</button>
<button class="pill" id="reset">검수 초기화</button>
<span class="tag" id="prog"></span>
</div>
</header>
<main id="list"></main>
<footer>
<h2 style="font-size:16px">결과 TSV</h2>
<textarea id="out" readonly></textarea>
<div class="note">🔴 이 결과로 DB/Sheet 저장 경로를 확정하지 않는다. 자동 상세 fetch 기준도 아직 정하지 않았다.</div>
</footer>
<script type="application/json" id="data">${data}</script>
<script>
(function(){
'use strict';
var DATA = JSON.parse(document.getElementById('data').textContent);
var CARDS = DATA.cards, META = DATA.meta;
var ACTIONS = [${actions}];
var KEY = 'seed-inbox-review-v1';
// 🔴 컬럼·note 문구는 dry-run 모듈이 정본이다. 화면이 따로 만들지 않는다.
var COLS = ${JSON.stringify(TSV_COLUMNS)};
var REC_NOTE = ${JSON.stringify(RECOMMENDED_NOTE)};
function cell(v){ return String(v == null ? '' : v).replace(/[\\t\\r\\n]+/g, ' '); }

function load(){ try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { return {}; } }
function save(){ try { localStorage.setItem(KEY, JSON.stringify(STATE)); } catch (e) { /* 사파리 프라이빗 등 */ } }
var STATE = load();

var listEl = document.getElementById('list');
var outEl = document.getElementById('out');
var filter = 'ALL';

function esc(s){ var d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; }

function tsv(){
  var lines = [COLS.join('\\t')];
  CARDS.forEach(function(c){
    var st = STATE[c.articleId] || {};
    if (!st.v && !st.memo) return;
    var note = (st.v === '' || st.v === c.verdict) ? REC_NOTE : ('founder override (recommended: ' + c.verdict + ')');
    if (st.memo) note = note + ' | memo: ' + st.memo;
    lines.push([st.v || c.verdict, c.lane, c.score, c.sourceSite, c.boardKey, c.boardName,
      c.articleId, c.page, c.rank_, c.comments, c.views, c.lag, c.watch ? 'watch' : '',
      c.title, c.why, c.signal, note].map(cell).join('\\t'));
  });
  return lines.join('\\n');
}

function refresh(){
  outEl.value = tsv();
  var done = CARDS.filter(function(c){ return (STATE[c.articleId]||{}).v; }).length;
  document.getElementById('prog').textContent = '검수 ' + done + ' / ' + CARDS.length;
  save();
}

function render(){
  var shown = CARDS.filter(function(c){ return filter === 'ALL' || c.verdict === filter; });
  listEl.innerHTML = '';
  shown.forEach(function(c){
    var st = STATE[c.articleId] || {};
    var el = document.createElement('article');
    el.className = 'card';
    el.setAttribute('data-id', c.articleId);
    if (st.v) el.setAttribute('data-done','1');
    el.innerHTML =
      '<div class="top"><span class="rank">#' + c.rank + '</span>' +
      '<span class="score">' + c.score + '점</span>' +
      '<span class="tag">' + esc(c.laneLabel) + '</span>' +
      (c.watch ? '<span class="tag">watch</span>' : '') +
      '<span class="tag">관측 ' + c.seenCount + '회</span>' +
      '<span class="rec" data-v="' + c.verdict + '">추천: ' + esc(c.verdictLabel) + '</span></div>' +
      '<div class="title">' + esc(c.title) + '</div>' +
      '<div class="meta">' + esc(c.sourceSite) + ' · ' + esc(c.boardKey) + ' · ' + esc(c.boardName) +
      ' · id ' + esc(c.articleId) + ' · p' + esc(c.page) + '/r' + esc(c.rank_) +
      ' · 댓글 ' + esc(c.comments) + ' · 조회 ' + esc(c.views) + ' · lag ' + esc(c.lag) +
      ' · Δ댓글 +' + c.commentDelta + ' · Δ조회 ' + esc(c.viewDelta) + '</div>' +
      '<div class="why">why ' + esc(c.why) + '</div>' +
      '<div class="why">signal ' + esc(c.signal) + '</div>' +
      '<div class="why">추천 이유 ' + esc(c.verdictReason) + '</div>' +
      '<div class="acts"></div>' +
      '<div class="state"></div>' +
      '<textarea class="memo" placeholder="메모 (선택)"></textarea>';

    var acts = el.querySelector('.acts');
    ACTIONS.forEach(function(a){
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
    '후보 ' + CARDS.length + '건 · 상세 읽기 ' + (META.counts.needsDetail||0) +
    ' · Seed로 좋음 ' + (META.counts.seedOk||0) + ' · 이미지 의존 ' + (META.counts.visualDependent||0) +
    ' · Raw 후보 ' + (META.counts.rawMaybe||0);
  refresh();
}

var fEl = document.getElementById('filters');
[['ALL','전체'],['needsDetail','상세 읽기'],['seedOk','Seed로 좋음'],['visualDependent','이미지 의존'],['rawMaybe','Raw 후보']].forEach(function(f){
  var b = document.createElement('button');
  b.className = 'pill' + (filter === f[0] ? ' on' : '');
  b.type = 'button'; b.setAttribute('data-f', f[0]);
  b.textContent = f[1] + (f[0] === 'ALL' ? '' : ' ' + (META.counts[f[0]]||0));
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
  var blob = new Blob([tsv()], { type: 'text/tab-separated-values;charset=utf-8' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'seed-inbox-review.tsv';
  a.click();
  URL.revokeObjectURL(a.href);
});
// 🔴 되돌리기 1단계. 전체 선택은 사람이 바꾼 값을 덮으므로 복구 경로를 둔다.
var UNDO = null;
var undoBtn = document.getElementById('undo');
function snapshot(){ UNDO = JSON.parse(JSON.stringify(STATE)); undoBtn.disabled = false; }

document.getElementById('fill').addEventListener('click', function(){
  snapshot();
  CARDS.forEach(function(c){
    var cur = STATE[c.articleId] || {};
    cur.v = c.verdict;          // 🔴 추천값으로 초기화 — 수동 값도 덮는다
    STATE[c.articleId] = cur;
  });
  render();
});

undoBtn.addEventListener('click', function(){
  if (!UNDO) return;
  STATE = UNDO; UNDO = null; undoBtn.disabled = true;
  render();
});

document.getElementById('reset').addEventListener('click', function(){
  if (!confirm('검수 결과를 모두 지웁니다.')) return;
  snapshot();
  STATE = {};
  try { localStorage.removeItem(KEY); } catch (e) { /* 무시 */ }
  render();
});

render();
})();
</script>
</body></html>
`
}

/**
 * 🔴 CLI 로 직접 실행할 때만 돈다 (PR-S2-b-19 와 같은 이유).
 *    fixture 가 renderHtml · toCards 를 import 해서 검사하는데,
 *    가드가 없으면 import 만으로 파일을 쓴다.
 */
const isDirectRun = process.argv[1] !== undefined
  && import.meta.url === pathToFileURL(process.argv[1]).href

if (isDirectRun) main()
