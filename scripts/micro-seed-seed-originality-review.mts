#!/usr/bin/env tsx
/**
 * Seed Originality 초안 검수 화면 — 🔴 **검수 파일만 만든다. 발행하지 않는다**
 *
 * 정본: docs/operations/2026-09-03-raw-supply-chain-design.md §4-AA · §4-AB
 *
 * 🔴 **이 화면이 무엇이 아닌지부터.**
 *    발행이 아니다. noindex 배포가 아니다. Post 생성이 아니다.
 *    사람이 채택/수정/버림을 누르면 **TSV·JSON 텍스트가 생길 뿐**이다.
 *
 * 🔴 **여기 오는 것은 초안이지 원문이 아니다.**
 *    dry-run 이 이미 원문에서 소재만 떼어냈다(§4-AA). 이 화면은 그 결과물을 본다.
 *    다만 **복붙 금지 검증 결과(겹침·유출·금지 호칭)를 그대로 표시한다** —
 *    사람이 "이건 원문 냄새가 난다" 를 스스로 판단할 수 있어야 한다.
 *
 * 🔴 **하지 않는 것**
 *    DB write · Prisma · Google Sheet · LLM · 자동 발행 · noindex 배포 ·
 *    Raw Vault 적재 · 네이버 재접속 · live 크롤 · 브라우저 · 82cook adapter.
 *
 * 🔴 **생성한 HTML 도 네트워크를 쓰지 않는다.** CSS·JS 전부 인라인이고
 *    저장은 브라우저 localStorage 까지다.
 *
 * 사용법
 *   npx tsx scripts/micro-seed-seed-originality-review.mts
 *   npx tsx scripts/micro-seed-seed-originality-review.mts --in=.microseed-data/seed-originality-dry-run-20260905.json
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve, relative } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  REVIEW_DECISIONS, REVIEW_COLUMNS, NOT_PUBLISH_NOTE, RECOMMENDED_ADOPT_PER_SOURCE,
  toGroups, type ExpansionIn, type SourceGroup,
} from './lib/micro-seed-seed-originality-review.mjs'

export const REVIEW_DATA_DIR = '.microseed-data'
const OUT_DEFAULT = `${REVIEW_DATA_DIR}/seed-originality-review.html`

const argv = process.argv.slice(2)
const arg = (n: string): string | undefined => {
  const hit = argv.find((a) => a.startsWith(`--${n}=`))
  return hit ? hit.slice(n.length + 3) : undefined
}

const fail = (m: string): never => {
  console.error(`\n🛑 ${m}\n`)
  process.exit(1)
}

/** 🔴 초안 제목·본문이 들어간다. gitignore 된 곳에만 읽고 쓴다 */
export function assertInsideDataDir(p: string): void {
  const rel = relative(process.cwd(), resolve(p))
  if (!rel.startsWith(`${REVIEW_DATA_DIR}/`)) {
    fail(`🔴 ${rel} 은 ${REVIEW_DATA_DIR}/ 밖이다 — 거부한다.`)
  }
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

/** 최신 dry-run 산출물 — 🔴 이름으로 고른다. 네트워크가 아니다 */
export function latestDryRunFile(dir: string): string | null {
  const files = readdirSync(dir).filter((f) => /^seed-originality-dry-run-.*\.json$/.test(f)).sort()
  return files.length ? `${dir}/${files[files.length - 1]}` : null
}

export function readExpansions(path: string): ExpansionIn[] {
  const j = JSON.parse(readFileSync(path, 'utf-8')) as { expansions?: ExpansionIn[] }
  return Array.isArray(j.expansions) ? j.expansions : []
}

function main(): void {
  const inPath = arg('in') ?? latestDryRunFile(REVIEW_DATA_DIR)
  if (!inPath) fail(`${REVIEW_DATA_DIR}/seed-originality-dry-run-*.json 을 찾지 못했다 — 먼저 dry-run 을 돌린다`)
  assertInsideDataDir(inPath)
  const out = arg('out') ?? OUT_DEFAULT
  assertInsideDataDir(out)

  const expansions = (() => {
    try { return readExpansions(inPath) } catch { return fail(`${inPath} 를 읽지 못했다`) }
  })()
  const groups = toGroups(expansions)
  const drafts = groups.reduce((a, g) => a + g.drafts.length, 0)
  if (drafts === 0) fail('초안이 없다 — dry-run 이 분류하지 못했을 수 있다')

  const clean = groups.reduce((a, g) => a + g.drafts.filter((d) => d.clean).length, 0)
  const recommended = groups.filter((g) => g.drafts.some((d) => d.recommended)).length

  const meta = {
    generatedAt: new Date().toISOString(),
    source: inPath,
    sources: groups.length,
    drafts,
    clean,
    flagged: drafts - clean,
    recommended,
    recommendedPerSource: RECOMMENDED_ADOPT_PER_SOURCE,
    notPublish: NOT_PUBLISH_NOTE,
  }

  writeFileSync(out, renderHtml(groups, meta), 'utf-8')

  console.log('\nSeed Originality 초안 검수 화면 — 🔴 발행이 아니다')
  console.log('─────────────────────────────────────────────────────────')
  console.log(`  🔴 ${NOT_PUBLISH_NOTE}`)
  console.log('  🔴 DB write 0 · Sheet 0 · LLM 0 · 네이버 0 · Raw Vault 0 · 자동 발행 0\n')
  console.log(`  입력  ${inPath}`)
  console.log(`  원천  ${groups.length}건 → 초안 ${drafts}건 (검증 깨끗 ${clean} · 확인 필요 ${drafts - clean})`)
  console.log(`  권장  원천당 ${RECOMMENDED_ADOPT_PER_SOURCE}개 — ${recommended}건에 권장 표시`)
  console.log(`\n  ✅ ${out}`)
  console.log(`     열기: open ${out}\n`)
}

export function renderHtml(groups: readonly SourceGroup[], meta: object): string {
  const data = JSON.stringify({ groups, meta }).replace(/</g, '\\u003c')
  const decisions = REVIEW_DECISIONS.map(([k, d]) => `['${k}','${escapeHtml(d)}']`).join(',')
  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Seed Originality 초안 검수</title>
<style>
:root{--bg:#faf9f7;--fg:#1c1a17;--mut:#6b665e;--line:#e4e0d9;--card:#fff;
--adopt:#1f9254;--revise:#b06a00;--drop:#9a9691;--warn:#d43b3b;--rec:#1d6fd6}
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
main{padding:16px;max-width:940px;margin:0 auto}
.group{border:1px solid var(--line);border-radius:14px;padding:14px;margin-bottom:20px;background:#fdfcfa}
.ghead{font-size:13px;color:var(--mut);line-height:1.8}
.ghead b{color:var(--fg)}
.src{font-size:15px;font-weight:700;margin:2px 0 6px}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px;margin-top:12px}
.card[data-done="1"]{border-color:var(--fg)}
.card[data-rec="1"]{border-left:4px solid var(--rec)}
.top{display:flex;flex-wrap:wrap;gap:8px;align-items:baseline}
.tag{font-size:12px;border:1px solid var(--line);border-radius:6px;padding:2px 7px;color:var(--mut)}
.tag.rec{border-color:var(--rec);color:var(--rec);font-weight:700}
.tag.clean{border-color:var(--adopt);color:var(--adopt)}
.tag.flag{border-color:var(--warn);color:var(--warn);font-weight:700}
.title{margin:8px 0;font-size:17px;font-weight:600;word-break:keep-all}
.body{margin:8px 0;padding:10px 12px;background:var(--bg);border:1px solid var(--line);
border-radius:8px;font-size:15px;word-break:keep-all;white-space:pre-wrap}
.why{font-size:13px;color:var(--mut);margin-top:4px}
.why.bad{color:var(--warn);font-weight:700}
.acts{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}
button.act{min-height:52px;min-width:92px;padding:0 14px;border-radius:10px;border:1px solid var(--line);
background:var(--card);font-size:15px;font-weight:600;cursor:pointer}
button.act:hover{border-color:var(--fg)}
button.act[aria-pressed="true"]{color:#fff;border-color:transparent}
button.act[data-k="ADOPT"][aria-pressed="true"]{background:var(--adopt)}
button.act[data-k="REVISE"][aria-pressed="true"]{background:var(--revise)}
button.act[data-k="DROP"][aria-pressed="true"]{background:var(--drop)}
.state{margin-top:8px;font-size:13px;font-weight:700}
textarea{width:100%;margin-top:8px;min-height:44px;padding:8px;border:1px solid var(--line);
border-radius:8px;font:inherit;font-size:14px;resize:vertical}
#out,#outjson{width:100%;min-height:170px;font:13px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace}
footer{padding:16px;max-width:940px;margin:0 auto}
.note{font-size:13px;color:var(--mut);margin-top:8px}
#over{margin-top:8px;font-size:13px;color:var(--revise);font-weight:700}
</style></head><body>
<header>
<h1>Seed Originality 초안 검수 <span class="tag" id="cnt"></span></h1>
<div class="banner">🔴 ${escapeHtml(NOT_PUBLISH_NOTE)}</div>
<div class="warn">
🔴 <b>이 화면은 발행 버튼이 아니다.</b> DB write 0 · Sheet 0 · LLM 0 · 네이버 0 · Raw Vault 0.<br>
🔴 <b>채택</b> 을 눌러도 아무것도 나가지 않는다 — TSV/JSON 텍스트가 생길 뿐이다.<br>
🟢 여기 있는 것은 <b>초안</b> 이지 원문이 아니다. 원문에서 <b>소재만</b> 가져와 다시 쓴 글이다.<br>
🟡 그래도 <b>복붙 금지 검증 결과</b>(원문 겹침 · 유출 낱말 · 금지 호칭)를 그대로 표시한다 —
사람이 "원문 냄새가 난다" 를 스스로 판단할 수 있어야 한다.<br>
🔵 한 원천에서 <b>여러 개 채택할 수 있다.</b> 다만 <b>권장은 ${RECOMMENDED_ADOPT_PER_SOURCE}개</b> 다 —
같은 소재로 여러 글을 한꺼번에 올리면 커뮤니티가 도배로 읽는다.<br>
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
<div id="over"></div>
</header>
<main id="list"></main>
<footer>
<h2 style="font-size:16px">검수 결과 TSV</h2>
<textarea id="out" readonly></textarea>
<h2 style="font-size:16px">검수 결과 JSON</h2>
<textarea id="outjson" readonly></textarea>
<div class="note">🔴 사람이 누른 초안만 나간다. 누르지 않은 것은 결과에 없다 —
기본값으로 채우면 "검수" 가 사람의 행위가 아니게 된다.</div>
</footer>
<script type="application/json" id="data">${data}</script>
<script>
(function(){
'use strict';
var DATA = JSON.parse(document.getElementById('data').textContent);
var GROUPS = DATA.groups, META = DATA.meta;
var DECISIONS = [${decisions}];
var KEY = 'seed-originality-review-v1';
var COLS = ${JSON.stringify(REVIEW_COLUMNS)};
var NOTE = ${JSON.stringify(NOT_PUBLISH_NOTE)};
var REC_MAX = ${RECOMMENDED_ADOPT_PER_SOURCE};
function cell(v){ return String(v == null ? '' : v).replace(/[\\t\\r\\n]+/g, ' '); }

function load(){ try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { return {}; } }
function save(){ try { localStorage.setItem(KEY, JSON.stringify(STATE)); } catch (e) { /* 사파리 프라이빗 등 */ } }
var STATE = load();

var listEl = document.getElementById('list');
var outEl = document.getElementById('out');
var outJsonEl = document.getElementById('outjson');
var filter = 'ALL';

function esc(s){ var d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; }

// 🔴 export 계약 — lib.reviewRows 와 같은 규칙이다. 누른 것만, 컬럼 순서 그대로.
// 🔴 reviewedAt 은 **이 export 를 만든 시각**이다. 한 파일 안의 모든 행이 같은 값을 쓴다.
//    초안을 만든 시각(generatedAt)과 다르다 — 둘 사이가 검수에 걸린 시간이다.
function rows(at){
  at = at || new Date().toISOString();
  var out = [];
  GROUPS.forEach(function(g){
    g.drafts.forEach(function(d){
      var st = STATE[d.key] || {};
      if (!st.v) return;
      out.push({
        decision: st.v, sourceArticleId: g.sourceArticleId, draftNo: d.draftNo,
        topic: g.topic, material: g.material, generalized: g.generalized, direction: g.direction,
        title: d.title, body: d.body, bodyLength: d.bodyLength,
        safetyVerdict: d.safetyVerdict, safetyReasons: d.safetyReasons,
        maxOverlap: d.maxOverlap, leakedTokens: d.leakedTokens.join('/'),
        clean: d.clean ? 'clean' : 'check',
        recommended: d.recommended ? 'recommended' : '',
        memo: st.memo || '', note: NOTE,
        // 🔴 §4-AC ③ — 행 하나만 떼어 봐도 출처와 두 시각을 알 수 있어야 한다
        sourceSite: g.sourceSite, generatedAt: d.generatedAt, reviewedAt: at
      });
    });
  });
  return out;
}

function tsv(at){
  var lines = [COLS.join('\\t')];
  rows(at).forEach(function(r){ lines.push(COLS.map(function(k){ return cell(r[k]); }).join('\\t')); });
  return lines.join('\\n');
}

// 🟡 한 원천에서 권장보다 많이 채택했는가 — 막지 않고 알린다
function overAdopted(){
  return GROUPS.filter(function(g){
    var n = g.drafts.filter(function(d){ return (STATE[d.key] || {}).v === 'ADOPT'; }).length;
    return n > REC_MAX;
  }).map(function(g){ return g.sourceArticleId; });
}

function refresh(){
  // 🔴 TSV 와 JSON 이 같은 시각을 써야 한다 — 따로 부르면 몇 밀리초 어긋난다
  var at = new Date().toISOString();
  var rs = rows(at);
  outEl.value = tsv(at);
  outJsonEl.value = JSON.stringify({ note: NOTE, reviewedAt: at, source: META.source, decisions: rs }, null, 2);
  var total = GROUPS.reduce(function(a, g){ return a + g.drafts.length; }, 0);
  document.getElementById('prog').textContent = '검수 ' + rs.length + ' / ' + total;
  var over = overAdopted();
  document.getElementById('over').textContent = over.length
    ? '🟡 한 원천에서 권장(' + REC_MAX + '개)보다 많이 채택한 곳: ' + over.join(', ') +
      ' — 막지는 않는다. 같은 소재를 몰아 올리면 도배로 읽힌다.'
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
  listEl.innerHTML = '';
  GROUPS.forEach(function(g){
    var shown = g.drafts.filter(function(d){
      if (filter === 'ALL') return true;
      if (filter === 'UNDECIDED') return !(STATE[d.key] || {}).v;
      if (filter === 'RECOMMENDED') return d.recommended;
      if (filter === 'FLAGGED') return !d.clean;
      return (STATE[d.key] || {}).v === filter;
    });
    if (shown.length === 0) return;

    var gel = document.createElement('section');
    gel.className = 'group';
    gel.setAttribute('data-src', g.sourceArticleId);
    gel.innerHTML =
      '<div class="src">원천 ' + esc(g.sourceArticleId) +
      (g.sourceSite ? ' · ' + esc(g.sourceSite) : '') + ' · ' + esc(g.topicLabel) + '</div>' +
      '<div class="ghead">' +
      '<b>소재</b> ' + esc(g.material) + (g.matched && g.matched !== g.material ? ' &larr; 원문 "' + esc(g.matched) + '"' : '') + '<br>' +
      '<b>일반화</b> ' + esc(g.generalized) + '<br>' +
      '<b>방향</b> ' + esc(g.direction) +
      '</div>';

    shown.forEach(function(d){
      var st = STATE[d.key] || {};
      var el = document.createElement('article');
      el.className = 'card';
      el.setAttribute('data-key', d.key);
      if (st.v) el.setAttribute('data-done', '1');
      if (d.recommended) el.setAttribute('data-rec', '1');

      var flags = '';
      if (d.leakedTokens.length) flags += '<div class="why bad">🔴 원문 낱말이 남았다: ' + esc(d.leakedTokens.join(', ')) + '</div>';
      if (d.bannedHonorifics.length) flags += '<div class="why bad">🔴 금지 호칭: ' + esc(d.bannedHonorifics.join(', ')) + '</div>';
      if (d.safetyVerdict !== 'pass') flags += '<div class="why bad">🔴 safety ' + esc(d.safetyVerdict) + ' · ' + esc(d.safetySummary) + '</div>';

      el.innerHTML =
        '<div class="top">' +
        '<span class="tag">초안 ' + d.draftNo + '</span>' +
        (d.recommended ? '<span class="tag rec">권장</span>' : '') +
        '<span class="tag ' + (d.clean ? 'clean' : 'flag') + '">' + (d.clean ? '복붙 검증 통과' : '확인 필요') + '</span>' +
        '<span class="tag">원문 겹침 ' + d.maxOverlap + '자' + (d.overlapFragment ? ' ("' + esc(d.overlapFragment) + '")' : '') + '</span>' +
        '<span class="tag">safety ' + esc(d.safetyVerdict) + '</span>' +
        '<span class="tag">본문 ' + d.bodyLength + '자</span>' +
        '</div>' +
        '<div class="title">' + esc(d.title) + '</div>' +
        '<div class="body">' + esc(d.body) + '</div>' +
        flags +
        '<div class="acts"></div>' +
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
        b.addEventListener('click', function(){
          var cur = STATE[d.key] || {};
          cur.v = (cur.v === a[0]) ? '' : a[0];   // 같은 버튼 다시 누르면 해제
          STATE[d.key] = cur;
          Array.prototype.forEach.call(acts.querySelectorAll('.act'), function(x){
            x.setAttribute('aria-pressed', x.getAttribute('data-k') === cur.v ? 'true' : 'false');
          });
          el.setAttribute('data-done', cur.v ? '1' : '0');
          setState();
          // 🔴 '미판정만' 을 보고 있으면 방금 판정한 카드는 목록에서 빠져야 한다
          if (filter === 'UNDECIDED' || filter === 'ADOPT' || filter === 'REVISE' || filter === 'DROP') { render(); return; }
          refresh();
        });
        acts.appendChild(b);
      });

      var memo = el.querySelector('.memo');
      memo.value = st.memo || '';
      memo.addEventListener('input', function(){
        var cur = STATE[d.key] || {};
        cur.memo = memo.value;
        STATE[d.key] = cur;
        refresh();
      });

      function setState(){
        var cur = STATE[d.key] || {};
        el.querySelector('.state').textContent = cur.v ? ('내 판정: ' + cur.v) : '내 판정: (미정)';
      }
      setState();
      gel.appendChild(el);
    });
    listEl.appendChild(gel);
  });
  document.getElementById('cnt').textContent =
    '원천 ' + META.sources + '건 · 초안 ' + META.drafts + '건 · 검증 깨끗 ' + META.clean + ' · 확인 필요 ' + META.flagged;
  refresh();
}

var fEl = document.getElementById('filters');
var FILTERS = [['ALL','전체'],['UNDECIDED','미판정만'],['RECOMMENDED','권장만'],['FLAGGED','확인 필요']];
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
  download('seed-originality-review.tsv', outEl.value, 'text/tab-separated-values');
});
document.getElementById('dljson').addEventListener('click', function(){
  download('seed-originality-review.json', outJsonEl.value, 'application/json');
});
document.getElementById('reset').addEventListener('click', function(){
  if (!confirm('검수 결과를 모두 지웁니다.')) return;
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

/** 🔴 CLI 로 직접 실행할 때만 돈다 — import 만으로 파일을 쓰지 않는다 */
const isDirectRun = process.argv[1] !== undefined
  && import.meta.url === pathToFileURL(process.argv[1]).href

if (isDirectRun) main()
