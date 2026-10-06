import type { Metadata } from 'next'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/admin'
import { boardLabel, formatKst } from '@/lib/admin-format'
import {
  AGE_BAND_ORDER,
  FIFTIES_BANDS,
  ageBandLabel,
  formatShare,
  sumBands,
  totalOf,
  type AgeCounts,
} from '@/lib/customer-composition'
import { loadCustomerComposition } from '@/lib/queries/customer-composition'
import {
  AdminCell,
  AdminPageHeader,
  AdminSection,
  AdminTable,
} from '@/components/admin/AdminUi'

/**
 * 고객 구성 — 실제 여성 가입 완료 고객의 연령 구성과 참여. 정본: MEMBER-CONVERSION-CANON.md v2.1 §7.
 *
 * 🔴 집계만 보여 준다. 이름·닉네임·이메일·전화번호·출생연도·회원 id·활동 목록이 이 화면에 없다 —
 *    loadCustomerComposition 이 숫자만 돌려준다.
 *
 * 🔴 비율은 항상 분자/분모와 함께 쓴다(formatShare). 표본이 작은 동안 퍼센트만 보면 한 명의 변화가
 *    큰 흐름처럼 읽힌다.
 *
 * 🔴 "7일 내 참여" 는 재방문이 아니다. 같은 가입 세션에서 바로 쓴 것일 수 있다 — 방문 지표 이름으로
 *    부르지 않는다(금지 문구는 scripts/customer-composition-check.mts 가 본다).
 *
 * 🔴 운영 메뉴를 늘리지 않는다. /admin/members 아래라 「회원」 메뉴가 켜진다(AdminOpsNav isCurrent).
 */
export const metadata: Metadata = { title: '고객 구성' }
export const dynamic = 'force-dynamic'

/** 연령 구성 표 — 구간 · 인원(비율) */
const COMPOSITION_COLS = 'lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]'
/** 연령대별 참여 표 — 구간 · 대상 · 일반 글 · 댓글 · 글 또는 댓글 · 가입인사 · 7일 내 참여 */
const PARTICIPATION_COLS =
  'lg:grid-cols-[minmax(0,1fr)_minmax(0,0.6fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]'
/** 게시판별 표 — 게시판 · 일반 글 · 댓글 */
const BOARD_COLS = 'lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,1.2fr)]'

/**
 * 링크가 없는 표의 한 줄. AdminTableRow 와 같은 모양이되 누를 곳이 없다 —
 * 집계 줄은 열 상세가 없으므로 링크처럼 보이면 안 된다.
 */
function StatRow({
  columns,
  children,
  emphasis = false,
}: {
  columns: string
  children: React.ReactNode
  emphasis?: boolean
}) {
  return (
    <li
      className={`flex flex-col gap-1.5 rounded-lg border border-subtle p-3 lg:grid lg:min-h-[52px] lg:items-center lg:gap-3 lg:rounded-none lg:border-x-0 lg:border-t-0 lg:px-2 lg:py-2 ${
        emphasis ? 'bg-surface-soft' : 'bg-surface-card'
      } ${columns}`}
    >
      {children}
    </li>
  )
}

/** 큰 숫자 한 칸 — 제목 · 값 · 분모 설명 */
function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-lg border border-subtle bg-surface-card p-3">
      <p className="m-0 text-sm text-content-muted">{label}</p>
      <p className="m-0 mt-1 break-words text-lg font-bold tabular-nums text-content-primary">{value}</p>
      {note ? <p className="m-0 mt-1 text-xs text-content-muted">{note}</p> : null}
    </div>
  )
}

const fifties = (c: AgeCounts) => sumBands(c, FIFTIES_BANDS)

export default async function AdminCustomerCompositionPage() {
  const { ok } = await requireAdmin()
  if (!ok) return null

  const data = await loadCustomerComposition(prisma)
  const femaleTotal = totalOf(data.femaleByAge)
  const p = data.participation
  const eligibleTotal = totalOf(p.eligible)
  const sevenDayDenominator = totalOf(data.sevenDay.complete)

  return (
    <main className="pt-2 lg:pt-0">
      <AdminPageHeader
        title="고객 구성"
        backHref="/admin/members"
        backLabel="← 회원"
        description={`집계 기준 ${formatKst(data.measuredAt)} · 분석연령 기준연도 ${data.baseYear}년(KST)`}
      />

      <AdminSection
        title="실제 여성 가입 완료 고객"
        description="카카오로 가입하고 가입 절차를 마친 여성 회원입니다. 페르소나·운영 작성자·관리자·시험 계정은 뺐습니다."
      >
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          <Stat label="실제 여성 고객" value={`${femaleTotal}명`} note="차단 회원 포함" />
          <Stat
            label="50대 (50~59세)"
            value={formatShare(fifties(data.femaleByAge), femaleTotal)}
            note="분모: 실제 여성 고객"
          />
          <Stat
            label="연령 미확인"
            value={formatShare(data.femaleByAge.unknown, femaleTotal)}
            note="출생연도가 없거나 형식이 맞지 않음"
          />
          <Stat
            label="차단 고객"
            value={formatShare(data.femaleBlocked, femaleTotal)}
            note="구성에는 포함 · 참여 지표에서는 제외"
          />
          <Stat
            label="성별 미확인"
            value={`${data.onboarded.genderUnknown}명`}
            note="가입 완료 회원 중 · 여성으로 추정하지 않고 고객 수에서 뺌"
          />
          <Stat
            label="확인된 남성"
            value={`${data.onboarded.male}명`}
            note="가입 완료 회원 중 · 고객 수에서 뺌"
          />
        </div>
      </AdminSection>

      <AdminSection
        title="연령 구간"
        description="분석연령 = 기준연도 − 출생연도입니다. 생일을 모르므로 만 나이가 아닙니다. 분모: 실제 여성 고객."
      >
        <AdminTable
          columns={COMPOSITION_COLS}
          head={
            <>
              <span>구간</span>
              <span>인원 (비율)</span>
            </>
          }
        >
          {AGE_BAND_ORDER.map((key) => (
            <StatRow key={key} columns={COMPOSITION_COLS}>
              <span className="font-bold text-content-primary">{ageBandLabel(key)}</span>
              <AdminCell label="인원" className="tabular-nums">
                {formatShare(data.femaleByAge[key], femaleTotal)}
              </AdminCell>
            </StatRow>
          ))}
          <StatRow columns={COMPOSITION_COLS} emphasis>
            <span className="font-bold text-content-primary">50대 합계</span>
            <AdminCell label="인원" className="tabular-nums">
              {formatShare(fifties(data.femaleByAge), femaleTotal)}
            </AdminCell>
          </StatRow>
        </AdminTable>
      </AdminSection>

      <AdminSection
        title="참여 회원"
        description="지금 공개된 글과 삭제되지 않은 댓글만 셉니다. 한 사람이 여러 번 써도 한 명입니다. 분모: 차단되지 않은 실제 여성 고객."
      >
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Stat label="일반 글 작성" value={formatShare(totalOf(p.generalPost), eligibleTotal)} note="가입인사 제외" />
          <Stat label="댓글 작성" value={formatShare(totalOf(p.comment), eligibleTotal)} />
          <Stat label="일반 글 또는 댓글" value={formatShare(totalOf(p.postOrComment), eligibleTotal)} />
          <Stat
            label="가입인사 작성"
            value={formatShare(totalOf(p.greeting), eligibleTotal)}
            note="일반 글 참여와 합치지 않음"
          />
        </div>
      </AdminSection>

      <AdminSection
        title="연령대별 참여"
        description="각 칸의 분모는 그 구간의 차단되지 않은 실제 여성 고객입니다. 7일 내 참여의 분모는 7일 관측이 끝난 회원입니다."
      >
        <AdminTable
          columns={PARTICIPATION_COLS}
          head={
            <>
              <span>구간</span>
              <span>대상</span>
              <span>일반 글</span>
              <span>댓글</span>
              <span>글 또는 댓글</span>
              <span>가입인사</span>
              <span>7일 내 참여</span>
            </>
          }
        >
          {AGE_BAND_ORDER.map((key) => (
            <StatRow key={key} columns={PARTICIPATION_COLS}>
              <span className="font-bold text-content-primary">{ageBandLabel(key)}</span>
              <AdminCell label="대상" className="tabular-nums">
                {p.eligible[key]}명
              </AdminCell>
              <AdminCell label="일반 글" className="tabular-nums">
                {formatShare(p.generalPost[key], p.eligible[key])}
              </AdminCell>
              <AdminCell label="댓글" className="tabular-nums">
                {formatShare(p.comment[key], p.eligible[key])}
              </AdminCell>
              <AdminCell label="글 또는 댓글" className="tabular-nums">
                {formatShare(p.postOrComment[key], p.eligible[key])}
              </AdminCell>
              <AdminCell label="가입인사" className="tabular-nums">
                {formatShare(p.greeting[key], p.eligible[key])}
              </AdminCell>
              <AdminCell label="7일 내 참여" className="tabular-nums">
                {formatShare(data.sevenDay.participated[key], data.sevenDay.complete[key])}
              </AdminCell>
            </StatRow>
          ))}
        </AdminTable>
      </AdminSection>

      <AdminSection
        title="게시판별 참여"
        description="일반 글은 가입인사를 뺍니다. 분모: 차단되지 않은 실제 여성 고객."
      >
        <AdminTable
          columns={BOARD_COLS}
          head={
            <>
              <span>게시판</span>
              <span>일반 글 작성 회원</span>
              <span>댓글 작성 회원</span>
            </>
          }
        >
          {data.boards.map((b) => (
            <StatRow key={b.boardType} columns={BOARD_COLS}>
              <span className="font-bold text-content-primary">{boardLabel(b.boardType)}</span>
              <AdminCell label="일반 글" className="tabular-nums">
                {formatShare(b.postAuthors, eligibleTotal)}
              </AdminCell>
              <AdminCell label="댓글" className="tabular-nums">
                {formatShare(b.commentAuthors, eligibleTotal)}
              </AdminCell>
            </StatRow>
          ))}
        </AdminTable>
      </AdminSection>

      <AdminSection
        title="가입 후 7일 내 참여"
        description="가입 완료 시각은 회원의 가장 이른 이용약관 동의 시각입니다(계정 생성일이 아닙니다). 그 뒤 7일 안에 일반 글이나 댓글을 남긴 회원을 셉니다. 재방문을 뜻하지 않습니다."
      >
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
          <Stat
            label="7일 내 참여"
            value={formatShare(totalOf(data.sevenDay.participated), sevenDayDenominator)}
            note="분모: 7일 관측이 끝난 회원"
          />
          <Stat label="관측 중" value={`${data.sevenDay.observing}명`} note="가입 완료 후 7일이 아직 지나지 않음" />
          <Stat
            label="산정 불가"
            value={`${data.sevenDay.noBasis}명`}
            note="가입 완료 시각 근거(약관 동의 기록)가 없음"
          />
        </div>
      </AdminSection>

      <AdminSection title="집계 기준과 한계">
        <ul className="m-0 mt-2 flex list-disc flex-col gap-1.5 pl-5 text-sm text-content-secondary">
          <li>화면을 열 때마다 새로 셉니다. 기준 시각은 맨 위에 있습니다.</li>
          <li>성별·출생연도는 카카오가 준 값입니다. 다시 로그인하지 않은 회원은 예전 값이 남아 있을 수 있습니다.</li>
          <li>참여는 지금 공개 상태인 글과 삭제되지 않은 댓글만 셉니다. 숨김·삭제된 활동과 차단 회원의 활동은 빠집니다.</li>
          <li>7일 내 참여는 약관 동의 기록이 있는 회원만 셉니다. 약관 동의 경로가 바뀌면 이 기준을 다시 확인해야 합니다.</li>
          <li>방문 기록이 없어 재방문은 셀 수 없습니다. 7일 내 참여는 가입 당일 바로 쓴 경우도 포함합니다.</li>
        </ul>
      </AdminSection>
    </main>
  )
}
