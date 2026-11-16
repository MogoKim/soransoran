import type { Metadata } from 'next'

import { requireAdmin } from '@/lib/admin'
import { formatKst } from '@/lib/admin-format'
import {
  AdminBadge,
  AdminEmptyState,
  AdminNotice,
  AdminPageHeader,
  AdminSection,
} from '@/components/admin/AdminUi'
import OperatorComposeForm from '@/components/admin/OperatorComposeForm'
import OperatorComposedItemControls from '@/components/admin/OperatorComposedItemControls'
import PersonaVoiceComposeForm from '@/components/admin/PersonaVoiceComposeForm'
import { getPersonaVoiceSpeakers, getPersonaVoiceTargets } from '@/lib/queries/operator-persona-voice'
import { PERSONA_VOICE_CODE_PREFIX } from '@/lib/operator-writer'
import {
  getComposedItems,
  getComposeTargetPost,
  getComposeTargetPosts,
  getOperatorWriters,
  getReplyTargetPosts,
} from '@/lib/queries/operator-compose'

/**
 * 운영자 직접 작성 — 창업자가 운영용 닉네임으로 직접 글·댓글을 쓰는 자리.
 *
 * 🔴 **자동 운영 관제실이 아니다.** 페르소나 상태·대기열·상한은 여기 없다.
 *    저쪽(`/admin/personas`)은 "기계가 무엇을 했나" 를 보는 곳이고,
 *    여기는 "내가 무엇을 썼나" 를 보는 곳이다. 한 화면에 섞으면
 *    자동 발행과 직접 작성이 같은 일로 읽힌다.
 *
 * 🔴 **권한을 다시 확인한다.** layout 이 이미 보지만 layout 은 렌더 경로일 뿐이다.
 *
 * 🔴 **대시보드를 만들지 않는다.** 수치·그래프·집계를 여기 두지 않는다.
 *
 * 🔴 `?postId=` 는 댓글 대상 **미리 선택**일 뿐이다(답 기다리는 글 → 답 쓰기). 자격은 저장 트랜잭션이 판정한다.
 *    `?from=responses` 일 때만 돌아가기 링크를 단다 — 임의 주소를 받지 않는다(리터럴 비교).
 */
export const metadata: Metadata = {
  title: '직접 작성',
  robots: { index: false, follow: false },
}

export const dynamic = 'force-dynamic'

export default async function AdminComposePage({
  searchParams,
}: {
  searchParams: Promise<{ postId?: string; from?: string; mode?: string }>
}) {
  const { ok } = await requireAdmin()
  if (!ok) {
    return (
      <AdminEmptyState>운영자만 볼 수 있는 화면입니다.</AdminEmptyState>
    )
  }

  const { postId: wantedPostId, from, mode } = await searchParams
  const fromResponses = from === 'responses'
  // 🔴 리터럴 비교만 — 「Persona 목소리로 답 쓰기」 로 왔으면 그 칸에 글을 미리 고른다
  const voiceMode = mode === 'persona-voice'
  const now = new Date()
  const [writers, recentTargets, replyTargets, items, speakers, voiceTargets] = await Promise.all([
    getOperatorWriters(),
    getComposeTargetPosts(),
    getReplyTargetPosts(),
    getComposedItems(),
    getPersonaVoiceSpeakers(),
    getPersonaVoiceTargets({ now, ...(voiceMode && wantedPostId ? { includePostId: wantedPostId } : {}) }),
  ])
  // 최근 목록 밖의 글이면 그 한 편만 따로 싣고 맨 앞에 둔다
  const wanted = wantedPostId
    ? (recentTargets.find((t) => t.id === wantedPostId) ?? (await getComposeTargetPost(wantedPostId)))
    : null
  const targets = wanted && !recentTargets.some((t) => t.id === wanted.id) ? [wanted, ...recentTargets] : recentTargets

  return (
    <>
      <AdminPageHeader
        group="노출·작성"
        title="직접 작성"
        description="운영용 이름이나 Persona 목소리로 직접 씁니다. 자동 운영과는 별개입니다."
        {...(fromResponses ? { backHref: '/admin/responses', backLabel: '← 답 기다리는 글' } : {})}
      />

      {wantedPostId && !wanted ? (
        <div className="mb-4">
          <AdminNotice tone="warning" title="그 글에는 댓글을 달 수 없습니다">
            내려갔거나 게시판 글이 아닙니다. 답 기다리는 글 목록을 다시 열어 주세요.
          </AdminNotice>
        </div>
      ) : null}

      <AdminSection
        title="새로 쓰기"
        description="AI 가 만들지 않습니다. 여기서 쓴 것이 그대로 올라갑니다."
      >
        <OperatorComposeForm
          writers={writers}
          targets={targets}
          replyTargets={replyTargets}
          {...(wanted && !voiceMode ? { initialMode: 'comment' as const, initialPostId: wanted.id } : {})}
        />
      </AdminSection>

      {/* 🔴 Persona 목소리 — 정책 정본 src/lib/operator-persona-voice.ts. 저장 모양은 운영자 댓글과 같다(D100 무관) */}
      <section id="persona-voice">
        <AdminSection
          title="Persona 목소리"
          description="Persona 의 이름으로 댓글을 씁니다. 회원에게는 그 Persona 닉네임으로 보입니다."
          className="mt-10"
        >
          <PersonaVoiceComposeForm
            speakers={speakers}
            targets={voiceTargets}
            {...(voiceMode && wantedPostId ? { initialPostId: wantedPostId } : {})}
          />
        </AdminSection>
      </section>

      <AdminSection
        title="작성 내역"
        description="이 도구로 쓴 것만 보입니다. 회원 글과 자동 페르소나 글은 여기서 수정하지 않습니다."
      >
        {items.length === 0 ? (
          <div className="mt-2">
            <AdminEmptyState>
              아직 직접 쓴 글이 없습니다. 위에서 처음 한 편을 써 보세요.
            </AdminEmptyState>
          </div>
        ) : (
          /* 🔴 카드 반복 대신 위아래 선 사이 행 목록(Admin Golden Master). 내용 · 조치 순서는 그대로 */
          <ul className="m-0 mt-3 flex list-none flex-col border-y border-[color:var(--admin-border)] p-0">
            {items.map((item) => (
              <li key={`${item.kind}:${item.id}`} className="border-b border-[color:var(--admin-divider)] px-1 py-4 last:border-b-0">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <AdminBadge tone="brand">
                      {item.kind === 'post' ? '글' : '댓글'}
                    </AdminBadge>
                    <span className="text-sm font-bold text-content-primary">
                      {item.writerName}
                    </span>
                    <AdminBadge>{item.writerCode}</AdminBadge>
                    {item.writerCode.startsWith(PERSONA_VOICE_CODE_PREFIX) ? <AdminBadge tone="info">Persona 목소리</AdminBadge> : null}
                    {item.hidden ? <AdminBadge tone="danger">내림</AdminBadge> : null}
                    <span className="ml-auto text-xs text-content-muted">
                      {formatKst(item.createdAt)}
                    </span>
                  </div>

                  <p className="m-0 mt-1 break-words text-sm text-content-primary">
                    {item.kind === 'post' ? item.title : `↳ ${item.postTitle}`}
                  </p>
                  <p className="m-0 mt-1 break-words text-sm text-content-muted">
                    {item.preview}
                  </p>

                  {item.href ? (
                    <a href={item.href} className="mt-1 inline-flex min-h-[52px] items-center text-xs font-semibold text-link lg:min-h-[44px]">
                      고객 화면에서 보기
                    </a>
                  ) : null}

                  {/* 🔴 content 는 발췌가 아니라 원문이다 — 발췌를 넘기면 저장만으로 본문이 잘린다 */}
                  <OperatorComposedItemControls
                    kind={item.kind}
                    id={item.id}
                    {...(item.kind === 'post' ? { title: item.title } : {})}
                    content={item.content}
                    hidden={item.hidden}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </AdminSection>
    </>
  )
}
