import type { Metadata } from 'next'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/admin'
import { formatKst } from '@/lib/admin-format'
import { SIGNUP_FUNNEL_RATIOS, SIGNUP_FUNNEL_STEPS } from '@/lib/signup-funnel'
import {
  CONVERSION_SCOPES,
  CONVERSION_SCOPE_LABELS,
  SIGNUP_FUNNEL_STEP_LABELS,
  conversionGateNotice,
  ratioValue,
} from '@/lib/signup-funnel-admin'
import { loadSignupConversion } from '@/lib/queries/signup-funnel'
import MemberAdminTabs from '@/components/admin/MemberAdminTabs'
import { AdminCell, AdminPageHeader, AdminSection, AdminTable } from '@/components/admin/AdminUi'

/**
 * 가입 전환 — 콘텐츠 끝 가입 제안의 익명 일별 집계를 수집 시작일부터 오늘(KST)까지 누계로 본다.
 * 정책: 회원가입 전환 영역 정본(docs/operations/MEMBER-CONVERSION-CANON.md) §8-6 · §8-7 · §8-10 · §10.
 *
 * 🔴 관리자 확인이 먼저다. 확인 뒤에만 reader 를 부른다.
 * 🔴 수집 gate 가 닫혀 있으면 집계 표를 읽지 않고 상태만 보인다. 시작 전 기간은 0 이 아니라 UNKNOWN 이다.
 * 🔴 숫자만 보인다. 회원·콘텐츠 목록 · 차트 · 기간 선택은 없다.
 * 🔴 비율은 정의된 세 개뿐이고 늘 분자/분모와 함께다. 가입 완료는 건수로만 보인다.
 */
export const metadata: Metadata = { title: '가입 전환' }
export const dynamic = 'force-dynamic'

/** 표 — 이름 · 전체 · 커뮤니티 · 매거진 */
const COLS = 'lg:grid-cols-[minmax(0,1.4fr)_repeat(3,minmax(0,1fr))]'

function Row({ children }: { children: React.ReactNode }) {
  return (
    <li className={`flex flex-col gap-1.5 rounded-lg border border-subtle bg-surface-card p-3 lg:grid lg:min-h-[52px] lg:items-center lg:gap-3 lg:rounded-none lg:border-x-0 lg:border-t-0 lg:px-2 lg:py-2 ${COLS}`}>
      {children}
    </li>
  )
}

const HEAD = (
  <>
    <span>항목</span>
    {CONVERSION_SCOPES.map((scope) => (
      <span key={scope}>{CONVERSION_SCOPE_LABELS[scope]}</span>
    ))}
  </>
)

export default async function AdminSignupConversionPage() {
  const { ok } = await requireAdmin()
  if (!ok) return null

  const now = new Date()
  const report = await loadSignupConversion(
    prisma,
    {
      VERCEL_ENV: process.env.VERCEL_ENV,
      SIGNUP_FUNNEL_COLLECTION_START: process.env.SIGNUP_FUNNEL_COLLECTION_START,
    },
    now,
  )
  const notice = conversionGateNotice(report.gate)
  const { gate, configuredStartDay, counts } = report

  return (
    <main className="pt-2 lg:pt-0">
      <AdminPageHeader title="가입 전환" description={`측정 시각 ${formatKst(now)}`} />
      <MemberAdminTabs current="conversion" />

      <AdminSection title="수집 상태" description={notice.description}>
        <dl className="m-0 mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
          <div className="rounded-lg border border-subtle bg-surface-card p-3">
            <dt className="text-sm text-content-muted">상태</dt>
            <dd className="m-0 mt-1 text-lg font-bold text-content-primary">{notice.status}</dd>
          </div>
          <div className="rounded-lg border border-subtle bg-surface-card p-3">
            <dt className="text-sm text-content-muted">수집 시작일</dt>
            <dd className="m-0 mt-1 text-lg font-bold tabular-nums text-content-primary">{configuredStartDay ?? '—'}</dd>
          </div>
          <div className="rounded-lg border border-subtle bg-surface-card p-3">
            <dt className="text-sm text-content-muted">누계 기준 종료일(KST)</dt>
            <dd className="m-0 mt-1 text-lg font-bold tabular-nums text-content-primary">{gate.active ? gate.today : '—'}</dd>
          </div>
        </dl>
      </AdminSection>

      {counts ? (
        <>
          <AdminSection
            title="단계별 건수"
            description="콘텐츠 끝 가입 제안(content_end)만 셉니다. 전체는 커뮤니티와 매거진의 합입니다."
          >
            <AdminTable columns={COLS} head={HEAD}>
              {SIGNUP_FUNNEL_STEPS.map((step) => (
                <Row key={step}>
                  <span className="font-bold text-content-primary">{SIGNUP_FUNNEL_STEP_LABELS[step]}</span>
                  {CONVERSION_SCOPES.map((scope) => (
                    <AdminCell key={scope} label={CONVERSION_SCOPE_LABELS[scope]} className="tabular-nums">
                      {counts[step][scope]}건
                    </AdminCell>
                  ))}
                </Row>
              ))}
            </AdminTable>
          </AdminSection>

          <AdminSection
            title="운영 비율"
            description="분자 / 분모 · 비율입니다. 분모가 0 이면 산정 불가입니다. 단계마다 세는 단위가 달라 100% 를 넘을 수 있습니다."
          >
            <AdminTable columns={COLS} head={HEAD}>
              {SIGNUP_FUNNEL_RATIOS.map((ratio) => (
                <Row key={ratio.id}>
                  <span className="font-bold text-content-primary">{ratio.label}</span>
                  {CONVERSION_SCOPES.map((scope) => (
                    <AdminCell key={scope} label={CONVERSION_SCOPE_LABELS[scope]} className="tabular-nums">
                      {ratioValue(ratio, counts, scope)}
                    </AdminCell>
                  ))}
                </Row>
              ))}
            </AdminTable>
          </AdminSection>
        </>
      ) : null}

      <AdminSection title="고객 구성은 「고객 구성」 탭에서">
        <p className="m-0 mt-2 text-sm text-content-secondary">
          가입한 실제 고객의 여성·연령 구성과 참여는 위 「고객 구성」 탭이 셉니다. 이 화면은 그 숫자를 다시 적지 않습니다.
        </p>
      </AdminSection>

      <AdminSection title="해석 한계">
        <ul className="m-0 mt-2 flex list-disc flex-col gap-1.5 pl-5 text-sm text-content-secondary">
          <li>고유 사람 수가 아니라 단계별 발생 횟수입니다. 한 사람의 퍼널로 읽지 않습니다.</li>
          <li>로그아웃한 기존 회원이 다시 로그인한 경우도 카카오 시작에 섞일 수 있습니다.</li>
          <li>로그아웃 상태의 운영자는 일반 방문과 구분할 수 없어 열람·도달·노출·카카오 시작에 섞일 수 있습니다.</li>
          <li>날짜 경계를 넘긴 방문은 단계별 날짜가 다를 수 있습니다. 하루 단위보다 누계로 봅니다.</li>
          <li>익명 요청과 귀속 값은 운영 관측 지표입니다. 감사·과금급 증거가 아닙니다.</li>
          <li>확인된 가입 완료의 귀속은 서버가 검증한 브라우저 표식이며, 가입이 어디서 시작됐는지를 서버가 직접 증명한 값은 아닙니다.</li>
          <li>수집 시작 전 기간은 0 이 아니라 알 수 없음(UNKNOWN)입니다.</li>
        </ul>
      </AdminSection>
    </main>
  )
}
