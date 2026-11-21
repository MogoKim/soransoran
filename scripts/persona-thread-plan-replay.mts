#!/usr/bin/env tsx
/**
 * 대화 계획 **재생** — 실제 하루의 글(글 id · 공개 시각 · 글쓴이 · 첫 댓글)에 계획을 세우고 러너를 하루치 돌려 본다
 *
 *   npx tsx scripts/persona-thread-plan-replay.mts <글 목록 파일> <YYYY-MM-DD>
 *
 * 🔴 DB · 네트워크 · provider 0. 판정은 운영과 같은 함수(`judgeFollowupPost` · `pickFollowupSeat` · `orderFollowupGo`)다.
 *    생성기는 가짜다 — 통과율만 흉내 낸다(글 · 자리 · 사람으로 결정적). 본문은 읽지 않는다.
 *    글 목록은 `#n HH:MM Pxx … | <글 id> | 제목` 줄과 그 아래 `+N분 Pyy PERSONA` 줄(첫 댓글)을 읽는다.
 */
import { readFileSync } from 'node:fs'

import {
  FOLLOWUP_ATTEMPTS_PER_POST_PER_TICK, judgeFollowupPost, orderFollowupGo, pickFollowupSeat, unitOf,
  type FollowupCommentRow, type FollowupPostVerdict,
} from '../src/lib/persona-comment-followup'
import { threadPlanOf } from '../src/lib/persona-thread-plan'

const [file, day] = process.argv.slice(2)
if (file === undefined || day === undefined) { console.error('사용법: <글 목록 파일> <YYYY-MM-DD>'); process.exit(2) }
const MIN = 60_000
const at = (d: string, hm: string): number => Date.parse(`${d}T${hm}:00+09:00`)
type Post = { id: string; publishedAtMs: number; author: string; first: { persona: string; atMs: number } }
const posts: Post[] = []
{
  let on = false
  let cur: { id: string; publishedAtMs: number; author: string } | null = null
  for (const line of readFileSync(file, 'utf-8').split('\n')) {
    if (line.startsWith('== ')) { on = line.includes(day); cur = null; continue }
    if (!on) continue
    const head = /^#\d+ (\d\d:\d\d) (P\d+) .*\| (\S+) \|/.exec(line)
    if (head !== null) { cur = { id: head[3]!, publishedAtMs: at(day, head[1]!), author: head[2]! }; continue }
    const c = /^\s+\+(\d+)분 (P\d+)(?:\(글쓴이\))? PERSONA/.exec(line)
    if (c !== null && cur !== null && c[2] !== cur.author) {
      posts.push({ ...cur, first: { persona: c[2]!, atMs: cur.publishedAtMs + Number(c[1]) * MIN } })
      cur = null
    }
  }
}
if (posts.length === 0) { console.error(`${day} 글을 찾지 못했다`); process.exit(2) }
const PERSONAS = Array.from({ length: 63 }, (_, i) => `P${String(i + 1).padStart(2, '0')}`)
const dayOf = (ms: number): string => new Date(ms + 9 * 3_600_000).toISOString().slice(0, 10)

/** 러너 회차 — 08:07~22:00 · 20분마다. 글이 공개된 날과 그다음 날을 돈다 */
function ticks(): number[] {
  const out: number[] = []
  for (const d of [day!, dayOf(at(day!, '12:00') + 24 * 60 * MIN)]) for (let t = at(d, '08:07'); t <= at(d, '22:00'); t += 20 * MIN) out.push(t)
  return out
}

function run(o: { passRate: number; dailyCount: number; runMax: number; perPersonaDailyMax: number }) {
  const rows = new Map<string, FollowupCommentRow[]>()
  for (const p of posts) {
    rows.set(p.id, [{
      id: `${p.id}-1`, postId: p.id, parentId: null, createdAt: new Date(p.first.atMs), isDeleted: false, authorId: null,
      commentOrigin: 'PERSONA', personaId: p.first.persona, operatorWriterId: null, reported: false, provenance: 'auto',
    }])
  }
  let calls = 0
  let curDay = ''
  let today = 0
  let byPersona = new Map<string, number>()
  let failedToday = new Set<string>()
  for (const now of ticks()) {
    if (dayOf(now) !== curDay) { curDay = dayOf(now); today = 0; byPersona = new Map(); failedToday = new Set() }
    const ready: { postId: string; publishedAtMs: number; go: Extract<FollowupPostVerdict, { verdict: 'GO' }> }[] = []
    for (const p of posts) {
      if (p.publishedAtMs > now) continue
      const v = judgeFollowupPost({
        postId: p.id, publishedAtMs: p.publishedAtMs, postStatus: 'PUBLISHED', authorPersonaId: p.author, autoManagedPost: true,
        comments: rows.get(p.id)!.filter((c) => c.createdAt.getTime() <= now), hasOpenQueue: false,
      }, now)
      if (v.verdict === 'GO') ready.push({ postId: p.id, publishedAtMs: p.publishedAtMs, go: v })
    }
    let made = 0
    const used = new Set<string>()
    for (const r of orderFollowupGo(ready)) {
      if (made >= Math.min(o.runMax, o.dailyCount - today)) break
      const author = posts.find((p) => p.id === r.postId)!.author
      const tickFailed = new Set<string>()
      for (let n = 0; n < FOLLOWUP_ATTEMPTS_PER_POST_PER_TICK; n++) {
        const picked = pickFollowupSeat({
          go: r.go, postId: r.postId, perPersonaDailyMax: o.perPersonaDailyMax,
          // 글쓴이는 자기 글에서 하루 격리되지 않는다(같은 회차에서만 건너뛴다) — 다른 사람은 그 글에서 그날 다시 서지 않는다
          candidates: PERSONAS.filter((c) => !used.has(c) && !tickFailed.has(c) && (c === author || !failedToday.has(`${r.postId}:${c}`)))
            .map((c) => ({ personaId: c, eligible: true, followupsToday: byPersona.get(c) ?? 0 })),
          prepare: (seatGo) => ({ ok: true as const, value: seatGo }),
        })
        if (!picked.ok) break
        calls += 1
        if (unitOf('replay-pass', r.postId, String(r.go.ordinal), picked.personaId, String(now)) >= o.passRate) {
          tickFailed.add(picked.personaId); failedToday.add(`${r.postId}:${picked.personaId}`); continue
        }
        const t = picked.value.target
        rows.get(r.postId)!.push({
          id: `${r.postId}-${r.go.ordinal}`, postId: r.postId, parentId: t.kind === 'reply' ? t.commentId : null, createdAt: new Date(now),
          isDeleted: false, authorId: null, commentOrigin: 'PERSONA', personaId: picked.personaId, operatorWriterId: null, reported: false, provenance: 'followup',
        })
        made += 1; today += 1; used.add(picked.personaId)
        byPersona.set(picked.personaId, (byPersona.get(picked.personaId) ?? 0) + 1)
        break
      }
    }
  }
  const endOfDay = at(day!, '22:00')
  const stat = (until: number | null) => posts.map((p) => {
    const cs = rows.get(p.id)!.filter((c) => until === null || c.createdAt.getTime() <= until)
    const byId = new Map(cs.map((c) => [c.id, c]))
    return {
      n: cs.length,
      others: new Set(cs.filter((c) => c.personaId !== p.author).map((c) => c.personaId)).size,
      otherReplies: cs.filter((c) => c.parentId !== null && c.personaId !== p.author).length,
      strangers: cs.filter((c) => c.parentId !== null && c.personaId !== p.author && byId.get(c.parentId)?.personaId !== p.author).length,
      gaps: cs.slice(1).map((c) => Math.round((c.createdAt.getTime() - p.publishedAtMs) / MIN)),
    }
  })
  return { calls, sameDay: stat(endOfDay), full: stat(null) }
}

const plans = posts.map((p) => threadPlanOf(p.id))
const dist = (xs: number[]): string => [...new Set(xs)].sort((a, b) => a - b).map((n) => `${n}개 ${xs.filter((x) => x === n).length}편`).join(' · ')
const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0)
const slots = plans.flatMap((p) => p.slots)
console.log(`# 대화 계획 재생 — ${day} 글 ${posts.length}편\n`)
console.log(`계획 크기: ${dist(plans.map((p) => p.size))} — 합 ${sum(plans.map((p) => p.size))} · 글당 ${(sum(plans.map((p) => p.size)) / posts.length).toFixed(2)}`)
console.log(`계획 자리(2번부터 ${slots.length}개): 글에 답 ${slots.filter((s) => s.kind === 'post').length} · 글쓴이 답글 ${slots.filter((s) => s.kind === 'author').length} · 다른 사람 답글 ${slots.filter((s) => s.kind === 'reply').length}`)
console.log(`계획 모양(길이는 꼴 본보기가 정한다): 한마디 ${slots.filter((s) => s.shape === 'other').length} · 되묻기 ${slots.filter((s) => s.shape === 'question').length} · 공감 ${slots.filter((s) => s.shape === 'empathy').length} · 경험 ${slots.filter((s) => s.shape === 'experience').length}`)
console.log(`계획상 4개 이상(타인 3명 이상이 되게 짠 글): ${plans.filter((p) => p.size >= 4).length}편\n`)
console.log('| 상한 | 통과율 | 당일 22:00 | 공개 24시간 창 끝 | 글당 | 타인 3명+ | 1개로 끝 | 타인 답글(그중 타인끼리) | 호출 |')
console.log('|---|---|---|---|---|---|---|---|---|')
const caps = [
  { name: '지금 profile(하루 40 · 회차 3 · Persona 3)', dailyCount: 40, runMax: 3, perPersonaDailyMax: 3 },
  { name: '제안 값(하루 130 · 회차 6 · Persona 4)', dailyCount: 130, runMax: 6, perPersonaDailyMax: 4 },
]
let last: ReturnType<typeof run> | null = null
for (const cap of caps) for (const passRate of [0.78, 1]) {
  const r = run({ ...cap, passRate })
  last = r
  const n = r.full.map((x) => x.n)
  console.log(`| ${cap.name} | ${passRate} | ${sum(r.sameDay.map((x) => x.n))} | ${sum(n)} | ${(sum(n) / posts.length).toFixed(2)} | ${r.full.filter((x) => x.others >= 3).length}편 | ${n.filter((x) => x === 1).length}편 | ${sum(r.full.map((x) => x.otherReplies))}(${sum(r.full.map((x) => x.strangers))}) | ${r.calls} |`)
}
if (last !== null) {
  const gaps = last.full.flatMap((x) => x.gaps)
  const bin = (a: number, b: number): number => gaps.filter((g) => g >= a && g < b).length
  console.log(`\n마지막 줄 조건의 글당 댓글 수: ${dist(last.full.map((x) => x.n))}`)
  console.log(`추가 댓글 시각(공개 뒤): ~60분 ${bin(0, 60)} · 1~3시간 ${bin(60, 180)} · 3~6시간 ${bin(180, 360)} · 6~12시간 ${bin(360, 720)} · 12시간~ ${bin(720, 1e9)}`)
}
