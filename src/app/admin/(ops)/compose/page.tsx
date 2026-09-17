import type { Metadata } from 'next'

import { requireAdmin } from '@/lib/admin'
import { formatKst } from '@/lib/admin-format'
import {
  AdminBadge,
  AdminCard,
  AdminEmptyState,
  AdminPageHeader,
  AdminSection,
} from '@/components/admin/AdminUi'
import OperatorComposeForm from '@/components/admin/OperatorComposeForm'
import OperatorComposedItemControls from '@/components/admin/OperatorComposedItemControls'
import {
  getComposedItems,
  getComposeTargetPosts,
  getOperatorWriters,
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
 */
export const metadata: Metadata = {
  title: '직접 작성',
  robots: { index: false, follow: false },
}

export const dynamic = 'force-dynamic'

export default async function AdminComposePage() {
  const { ok } = await requireAdmin()
  if (!ok) {
    return (
      <AdminEmptyState>운영자만 볼 수 있는 화면입니다.</AdminEmptyState>
    )
  }

  const [writers, targets, items] = await Promise.all([
    getOperatorWriters(),
    getComposeTargetPosts(),
    getComposedItems(),
  ])

  return (
    <>
      <AdminPageHeader
        title="직접 작성"
        description="운영용 이름을 골라 직접 글과 댓글을 씁니다. 자동 페르소나와는 별개입니다."
      />

      <AdminSection
        title="새로 쓰기"
        description="AI 가 만들지 않습니다. 여기서 쓴 것이 그대로 올라갑니다."
      >
        <OperatorComposeForm writers={writers} targets={targets} />
      </AdminSection>

      <AdminSection
        title="작성 내역"
        description="이 도구로 쓴 것만 보입니다. 회원 글과 자동 페르소나 글은 여기서 고치지 않습니다."
      >
        {items.length === 0 ? (
          <div className="mt-2">
            <AdminEmptyState>
              아직 직접 쓴 글이 없습니다. 위에서 처음 한 편을 써 보세요.
            </AdminEmptyState>
          </div>
        ) : (
          <ul className="m-0 mt-2 flex list-none flex-col gap-2 p-0">
            {items.map((item) => (
              <li key={`${item.kind}:${item.id}`}>
                <AdminCard>
                  <div className="flex flex-wrap items-center gap-2">
                    <AdminBadge tone="brand">
                      {item.kind === 'post' ? '글' : '댓글'}
                    </AdminBadge>
                    <span className="text-sm font-bold text-content-primary">
                      {item.writerName}
                    </span>
                    <AdminBadge>{item.writerCode}</AdminBadge>
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
                    <a href={item.href} className="mt-1 text-xs text-link">
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
                </AdminCard>
              </li>
            ))}
          </ul>
        )}
      </AdminSection>
    </>
  )
}
