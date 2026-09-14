'use client'

import { useState } from 'react'
import { useFormState, useFormStatus } from 'react-dom'
import { updateHeroBanner, type HeroBannerActionState } from '@/lib/actions/admin-hero-banner'
import {
  HERO_BANNER_MAX_ALT_LENGTH,
  HERO_BANNER_MAX_NAME_LENGTH,
  type HeroBannerLinkKind,
} from '@/lib/hero-banner-rules'

/**
 * 배너의 글자 값들 — 이름 · 설명 · 링크 · 예약.
 *
 * 🔴 이미지는 이 폼에 없다. 파일 업로드는 저장 버튼을 기다리지 않고 바로 올라가고
 *    (그래야 실패한 업로드가 폼 상태를 붙잡지 않는다), 여기는 글자만 맡는다.
 *
 * 🔴 켜기·끄기도 이 폼에 없다. 저장과 켜기를 한 버튼에 묶으면
 *    "저장만 하려던" 운영자가 배너를 홈에 내보낸다.
 *
 * 🔴 예약은 한국 시간으로 적고 UTC 로 저장된다. 입력칸 옆에 그 사실을 적는다 —
 *    적지 않으면 9시간 어긋난 예약이 조용히 들어간다.
 *
 * 🔴 브라우저 검사(maxLength·required)는 편의일 뿐이다. 서버가 같은 규칙을 다시 본다.
 */
function SaveBtn() {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex min-h-[52px] items-center justify-center rounded-lg bg-cta px-4 font-bold text-content-primary transition duration-150 hover:brightness-95 active:scale-[0.98] disabled:opacity-50 lg:min-h-[48px]"
    >
      {pending ? '저장 중…' : '저장'}
    </button>
  )
}

const FIELD =
  'min-h-[52px] w-full rounded-lg border border-subtle bg-surface-card px-3 text-base text-content-primary lg:min-h-[48px]'
const LABEL = 'text-sm font-bold text-content-primary'
const HINT = 'm-0 mt-1 text-xs text-content-muted'

export default function HeroBannerEditForm({
  bannerId,
  defaults,
  disabled,
}: {
  bannerId: string
  defaults: {
    name: string
    alt: string
    linkKind: HeroBannerLinkKind
    linkUrl: string
    startsAt: string
    endsAt: string
  }
  /** 보관한 배너는 고칠 수 없다 — 먼저 복원해야 한다. */
  disabled?: boolean
}) {
  const [state, formAction] = useFormState<HeroBannerActionState, FormData>(updateHeroBanner, {})
  const [linkKind, setLinkKind] = useState<HeroBannerLinkKind>(defaults.linkKind)

  return (
    <form action={formAction} className="mt-2 flex flex-col gap-4">
      <input type="hidden" name="bannerId" value={bannerId} />

      <div>
        <label htmlFor="banner-name" className={LABEL}>
          운영용 이름
        </label>
        <input
          id="banner-name"
          name="name"
          defaultValue={defaults.name}
          maxLength={HERO_BANNER_MAX_NAME_LENGTH}
          required
          disabled={disabled}
          className={`${FIELD} mt-1`}
        />
        <p className={HINT}>
          목록에서 구분하는 이름입니다. 화면에는 나가지 않습니다 · {HERO_BANNER_MAX_NAME_LENGTH}
          자까지
        </p>
      </div>

      <div>
        <label htmlFor="banner-alt" className={LABEL}>
          이미지 설명
        </label>
        <textarea
          id="banner-alt"
          name="alt"
          defaultValue={defaults.alt}
          maxLength={HERO_BANNER_MAX_ALT_LENGTH}
          rows={2}
          disabled={disabled}
          className={`${FIELD} mt-1 py-2`}
        />
        <p className={HINT}>
          이미지 안에 있는 글을 그대로 적어 주세요. 화면을 읽어 주는 분께 이 글이 전달됩니다 ·{' '}
          {HERO_BANNER_MAX_ALT_LENGTH}자까지 · 배너를 켜려면 반드시 필요합니다
        </p>
      </div>

      <div>
        <label htmlFor="banner-link-kind" className={LABEL}>
          누르면 가는 곳
        </label>
        <select
          id="banner-link-kind"
          name="linkKind"
          value={linkKind}
          disabled={disabled}
          onChange={(e) => setLinkKind(e.target.value as HeroBannerLinkKind)}
          className={`${FIELD} mt-1`}
        >
          <option value="NONE">없음 — 누를 수 없는 배너</option>
          <option value="INTERNAL">소란소란 안 — /community/free 처럼</option>
          <option value="EXTERNAL">바깥 주소 — https 로 시작</option>
        </select>

        {linkKind === 'NONE' ? (
          <p className={HINT}>링크가 없으면 배너는 이미지로만 보입니다.</p>
        ) : (
          <>
            <label htmlFor="banner-link-url" className="sr-only">
              링크 주소
            </label>
            <input
              id="banner-link-url"
              name="linkUrl"
              defaultValue={defaults.linkUrl}
              disabled={disabled}
              placeholder={linkKind === 'INTERNAL' ? '/community/free' : 'https://example.com/page'}
              className={`${FIELD} mt-2`}
            />
            <p className={HINT}>
              {linkKind === 'INTERNAL'
                ? '/ 로 시작하는 소란소란 안쪽 주소만 됩니다.'
                : 'https 로 시작하는 주소만 됩니다. http 는 받지 않습니다.'}
            </p>
          </>
        )}
        {/* 🔴 NONE 일 때도 값을 보낸다 — 빈 문자열이어야 서버가 "짝이 맞다" 고 본다 */}
        {linkKind === 'NONE' ? <input type="hidden" name="linkUrl" value="" /> : null}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="banner-starts" className={LABEL}>
            노출 시작
          </label>
          <input
            id="banner-starts"
            name="startsAt"
            type="datetime-local"
            defaultValue={defaults.startsAt}
            disabled={disabled}
            className={`${FIELD} mt-1`}
          />
          <p className={HINT}>비워 두면 켜는 즉시 나갑니다 · 한국 시간</p>
        </div>
        <div>
          <label htmlFor="banner-ends" className={LABEL}>
            노출 종료
          </label>
          <input
            id="banner-ends"
            name="endsAt"
            type="datetime-local"
            defaultValue={defaults.endsAt}
            disabled={disabled}
            className={`${FIELD} mt-1`}
          />
          <p className={HINT}>비워 두면 끌 때까지 나갑니다 · 종료 시각에는 나가지 않습니다</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {disabled ? (
          <p className="m-0 text-sm text-content-muted">
            보관한 배너는 고칠 수 없습니다. 먼저 보관을 풀어 주세요.
          </p>
        ) : (
          <SaveBtn />
        )}
        {state.error ? <p className="m-0 text-sm text-state-danger">{state.error}</p> : null}
        {!state.error && state.ok ? (
          <p className="m-0 text-sm text-state-success">저장했습니다.</p>
        ) : null}
      </div>
    </form>
  )
}
