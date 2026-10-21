#!/usr/bin/env tsx
/**
 * 🔴 **어드민 게시판 변경 — 순수 계약 검사** (DB 없음)
 *
 *   ① 판정표 — 허용 · 막힘 사유 · 우선순위 (board-move.ts)
 *   ② 소스 계약 — 권한이 먼저 · 바꾸는 값은 boardType 하나 · 자동 운영 기록 · OperatorWriteLog write 0 ·
 *      best-v1 이름 0 · 브라우저 확인창 0 · 옛 주소 redirect 는 공개 조회 뒤에만
 *
 *   DB 쪽(실제 트랜잭션 · 동시성 · 불변)은 board-move-db-check.mts, 화면 주소는 board-move-http-check.mts.
 */
import { readFileSync } from 'node:fs'
import {
  BOARD_MOVE_BLOCK_MESSAGE, MOVABLE_BOARDS, OPEN_PERSONA_CANDIDATE_STATUSES, judgeBoardMove, judgeBoardMoveSource,
  type BoardMoveFacts,
} from '../src/lib/board-move'

let pass = 0
let fail = 0
const check = (label: string, ok: boolean, detail = ''): void => {
  ok ? (pass += 1) : (fail += 1)
  console.log(`  ${ok ? '✅' : '🔴'} ${label}${ok || detail === '' ? '' : ` — ${detail}`}`)
}
/** 주석을 뺀 소스 — 주석 속 낱말이 계약을 통과시키지 않게 */
const code = (f: string): string =>
  readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

const BASE: BoardMoveFacts = {
  boardType: 'FREE', status: 'PUBLISHED', personaId: null, microSeedLane: false,
  originalQueueLinked: false, greeting: false, openPersonaCandidates: 0,
}
const verdict = (patch: Partial<BoardMoveFacts>, to: unknown) => {
  const v = judgeBoardMove({ ...BASE, ...patch }, to)
  return v.ok ? `ok:${v.to}` : v.code
}

console.log('\n■ 1. 판정표')
check('옮길 수 있는 게시판은 FREE · MENOPAUSE 둘뿐', MOVABLE_BOARDS.join() === 'FREE,MENOPAUSE')
check('열린 후보 = PENDING · APPROVED · EDITED (PUBLISHED · DECLINED · EXPIRED 는 끝난 후보)',
  OPEN_PERSONA_CANDIDATE_STATUSES.join() === 'PENDING,APPROVED,EDITED')
const cases: [string, Partial<BoardMoveFacts>, unknown, string][] = [
  ['회원 글 FREE → MENOPAUSE', {}, 'MENOPAUSE', 'ok:MENOPAUSE'],
  ['회원 글 MENOPAUSE → FREE', { boardType: 'MENOPAUSE' }, 'FREE', 'ok:FREE'],
  ['같은 게시판', {}, 'FREE', 'SAME_BOARD'],
  ['목표 MAGAZINE', {}, 'MAGAZINE', 'INVALID_TARGET'],
  ['목표 BEST(enum 밖)', {}, 'BEST', 'INVALID_TARGET'],
  ['목표 소문자 free', {}, 'free', 'INVALID_TARGET'],
  ['목표 숫자', {}, 1, 'INVALID_TARGET'],
  ['목표 없음', {}, undefined, 'INVALID_TARGET'],
  ['지금 MAGAZINE', { boardType: 'MAGAZINE' }, 'FREE', 'NOT_COMMUNITY_BOARD'],
  ['Persona 글', { personaId: 'p1' }, 'MENOPAUSE', 'PERSONA_POST'],
  ['Micro Seed 글', { microSeedLane: true }, 'MENOPAUSE', 'MICRO_SEED_POST'],
  ['오리지널 큐 연결 글', { originalQueueLinked: true }, 'MENOPAUSE', 'ORIGINAL_QUEUE_POST'],
  ['가입인사', { greeting: true }, 'MENOPAUSE', 'GREETING_POST'],
  ['숨김 글', { status: 'HIDDEN' }, 'MENOPAUSE', 'NOT_PUBLISHED'],
  ['삭제 글', { status: 'DELETED' }, 'MENOPAUSE', 'NOT_PUBLISHED'],
  ['열린 Persona 후보 1건', { openPersonaCandidates: 1 }, 'MENOPAUSE', 'OPEN_PERSONA_CANDIDATE'],
  ['자동 운영이 다른 사유보다 먼저(Persona + 가입인사 + 숨김)', { personaId: 'p1', greeting: true, status: 'HIDDEN' }, 'MENOPAUSE', 'PERSONA_POST'],
  ['이상한 목표가 글 사유보다 먼저', { personaId: 'p1' }, 'MAGAZINE', 'INVALID_TARGET'],
]
for (const [label, patch, to, want] of cases) check(`${label} → ${want}`, verdict(patch, to) === want, verdict(patch, to))
check('옮길 수 있는 글이면 화면 판정(judgeBoardMoveSource) null', judgeBoardMoveSource(BASE) === null)
check('자동 운영 3종은 같은 문구 "자동 운영 글은 게시판을 변경할 수 없습니다."',
  new Set([BOARD_MOVE_BLOCK_MESSAGE.PERSONA_POST, BOARD_MOVE_BLOCK_MESSAGE.MICRO_SEED_POST, BOARD_MOVE_BLOCK_MESSAGE.ORIGINAL_QUEUE_POST]).size === 1
  && BOARD_MOVE_BLOCK_MESSAGE.PERSONA_POST === '자동 운영 글은 게시판을 변경할 수 없습니다.')
check('가입인사 문구', BOARD_MOVE_BLOCK_MESSAGE.GREETING_POST === '가입인사 글은 게시판을 변경할 수 없습니다.')
check('열린 후보 문구', BOARD_MOVE_BLOCK_MESSAGE.OPEN_PERSONA_CANDIDATE === '대기 중인 Persona 댓글 후보가 있어 이동할 수 없습니다.')

console.log('\n■ 2. 서버 action — 권한이 먼저 · 판정 · 쓰기는 트랜잭션 한 곳')
{
  const admin = code('src/lib/actions/admin.ts')
  const at = admin.indexOf('export async function movePostBoard(')
  const body = admin.slice(at, admin.indexOf('\nexport ', at + 1))
  check('movePostBoard 가 있다', at >= 0)
  check('첫 문장이 requireAdmin — 통과 못 하면 한 줄도 쓰지 않는다',
    /^export async function movePostBoard\([^)]*\)[^{]*\{\s*const \{ ok \} = await requireAdmin\(\)\s*if \(!ok\) return/.test(body))
  check('쓰기는 movePostBoardTx 하나 · action 안에서 prisma 로 직접 쓰지 않는다',
    (body.match(/movePostBoardTx\(/g) ?? []).length === 1 && !/prisma\.\w+\.(update|updateMany|create|delete)/.test(body))
  const edit = admin.slice(admin.indexOf('export async function updatePost('), admin.indexOf('export async function setPostHidden('))
  check('본문 수정 action(updatePost)은 그대로 — 게시판을 쓰지 않는다(읽어서 revalidate 만)', !/data:\s*\{[^}]*boardType/.test(edit) && /data: \{ title, content, thumbnailUrl/.test(edit))
  check('옛 · 새 게시판 목록 · 상세 · 관리자 경로를 다시 그린다',
    /communityPostHref\(postId, res\.from\)/.test(body) && /getBoardByType\(res\.from\)/.test(body)
    && /revalidatePostSurfaces\(postId, res\.to\)/.test(body)
    && ['/admin/content', '/admin/home'].every((p) => body.includes(`'${p}'`)) && body.includes('`/admin/content/${postId}`'))
}

console.log('\n■ 3. 트랜잭션 — 바꾸는 값은 boardType 하나 · 자동 운영 기록 write 0')
{
  const tx = code('src/lib/board-move-tx.ts')
  const updates = tx.match(/tx\.\w+\.(update|updateMany|create|createMany|upsert|delete|deleteMany)\(/g) ?? []
  check('쓰기 호출은 post.updateMany 하나뿐', updates.join() === 'tx.post.updateMany(', updates.join())
  check('그 쓰기의 data 는 { boardType: … } 하나', /data: \{ boardType: verdict\.to \}/.test(tx))
  check('조건부 update — 화면이 본 게시판 · 공개 · 자동 운영 아님 · 가입인사 아님을 where 에 다시 건다',
    /boardType: from/.test(tx) && /status: 'PUBLISHED'/.test(tx) && /personaId: null/.test(tx)
    && /originalPostQueue: \{ is: null \}/.test(tx) && /NOT_MICRO_SEED_LANE_WHERE/.test(tx) && /EXCLUDE_GREETING/.test(tx))
  check('판정을 트랜잭션 안에서 다시 한다(readBoardMoveFacts(tx) → judgeBoardMove)',
    /readBoardMoveFacts\(tx, input\.postId\)/.test(tx) && /judgeBoardMove\(facts, input\.to\)/.test(tx))
  check('🔴 OperatorWriteLog · 오리지널 큐 · Persona 후보 · 자동 READY · 단계 결정을 쓰지 않는다',
    !/(operatorWriteLog|originalPostApprovalQueue|personaApprovalQueue|autoReadyAudit|stageDecision)\.(create|update|updateMany|upsert|delete|deleteMany)/.test(tx))
  check('/best — syncBestEligibility(tx) 를 boardType 변경 뒤에 한 번',
    (tx.match(/syncBestEligibility\(tx, input\.postId\)/g) ?? []).length === 1
    && tx.indexOf('syncBestEligibility(tx') > tx.indexOf('tx.post.updateMany('))
  check('다시 시도하지 않는다(두 번 이동 방지)', !/for \(|while \(|retry|attempt/i.test(tx))
}

console.log('\n■ 4. best-v1 개념을 되살리지 않는다')
{
  const LEGACY = /\b(recordBestEntries|recomputePostRanking|syncBestRanking|refreshBestRanking|BEST_RANK_ORDER|BEST_GLOBAL_WHERE|REACTION_BOOST_\w+|reactionBoostSeconds\w*|bestRankScore)\b/
  for (const f of ['src/lib/board-move.ts', 'src/lib/board-move-tx.ts', 'src/lib/actions/admin.ts', 'src/components/admin/AdminBoardMovePanel.tsx']) {
    check(`${f}: best-v1 이름 0`, !LEGACY.test(code(f)))
  }
}

console.log('\n■ 5. 화면 — 이름 · 확인 단계 · 숨기지 않고 이유를 보인다')
{
  const panel = code('src/components/admin/AdminBoardMovePanel.tsx')
  const raw = readFileSync('src/components/admin/AdminBoardMovePanel.tsx', 'utf8')
  check('명칭 "게시판 변경" · "카테고리 변경" 0', raw.includes('게시판 변경') && !raw.includes('카테고리 변경'))
  check('브라우저 확인창 0 — 화면 안 확인 단계가 있다', !/\bconfirm\s*\(/.test(panel) && /step === 'confirm'/.test(panel) && panel.includes('변경 확정'))
  check('확인 문구 — "…에서 …으로 변경합니다." + 유지 항목', /에서 \{boardLabels\[target\]\}으로 변경합니다\./.test(panel) && /제목·본문·작성자·댓글/.test(raw))
  check('막힌 글 — 패널을 숨기지 않고 이유 문구를 보인다', /blockedReason/.test(panel) && /\{blockedReason\}/.test(panel) && !/if \(locked\) return null/.test(panel))
  check('같은 게시판은 고를 수 없고 버튼이 닫힌다', /disabled=\{b === current\}/.test(panel) && /target !== current/.test(panel))
  check('임의 hex 색 0', !/#[0-9a-fA-F]{3,8}\b/.test(raw))
  const page = code('src/app/admin/(ops)/content/[id]/page.tsx')
  check('관리자 글 상세가 서버와 같은 사실 읽기 · 판정을 쓴다', /readBoardMoveFacts\(prisma, post\.id\)/.test(page) && /judgeBoardMoveSource\(moveFacts\)/.test(page) && /<AdminBoardMovePanel/.test(page))
}

console.log('\n■ 6. 옛 고객 주소 — 공개 글만 새 정식 주소로 308')
{
  const detail = code('src/app/community/[boardSlug]/[postId]/page.tsx')
  const at = detail.indexOf('export default async function PostDetailPage(')
  const body = detail.slice(at)
  const nf = body.indexOf('if (!detail) notFound()')
  const rd = body.indexOf('permanentRedirect(')
  check('공개 조회(getPostDetail)가 null 이면 404 가 먼저 — 숨김 · 삭제 · 차단 글은 redirect 로 새지 않는다', nf >= 0 && rd > nf)
  check('redirect 는 게시판이 다를 때만 · 커뮤니티 게시판이 아니면 404', /if \(detail\.post\.boardType !== board\.type\) \{/.test(body) && /!current\.isCommunity\) notFound\(\)/.test(body))
  check('정식 주소는 board-registry 에서 만든다', /permanentRedirect\(`\$\{current\.href\}\/\$\{detail\.post\.id\}`\)/.test(body))
}

console.log(`\n${fail === 0 ? '✅' : '🔴'} board-move-check: ${pass} 통과 · ${fail} 실패\n`)
if (fail > 0) process.exit(1)
