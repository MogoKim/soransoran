'use client'

import { useKeyboardInset } from '@/components/features/use-write-viewport'
import ActionButton from '@/components/ui/ActionButton'
import {
  MAX_POST_CONTENT_LENGTH,
  POST_CONTENT_COUNTER_WARN_FROM,
  postBlockMessage,
  type PostSubmitBlock,
} from '@/lib/post-policy'
import { cn } from '@/lib/utils'

/**
 * 바가 차지하는 높이. 폼 끝에 같은 만큼 자리를 비워 본문 마지막 줄이 가리지 않게 한다.
 * 안내 줄(줄바꿈 여유 포함) + 버튼 56px + 위아래 여백.
 */
const BAR_HEIGHT = 'h-[124px]'

/**
 * 글을 쓰다가 그대로 올릴 수 있게 하는 자리 — 안내 · 글자 수 · 등록 버튼.
 *
 * 🔴 화면 아래에 고정하고 키보드 높이만큼 올린다. 문서 흐름에 두면 글이 길어질수록
 *    버튼이 아래로 밀려, 올리려면 키보드를 내리고 스크롤해서 찾아가야 한다.
 *    쓰던 손 그대로 누를 수 있어야 한다.
 *
 * 🔴 새 글과 고치기가 같은 것을 쓴다. 두 화면이 다른 배치를 가지면 같은 사람이
 *    두 번 배운다. 다른 것은 버튼에 적힌 말뿐이다.
 *
 * 🔴 판정은 상단바와 같은 postSubmitBlock 결과를 받는다. 두 버튼이 각자 재면
 *    한쪽만 열려 있는 순간이 생기고, 그때 사용자는 어느 쪽을 믿어야 할지 모른다.
 */
export default function WriteFooter({
  block,
  canSubmit,
  textLength,
  label,
  pendingLabel,
  busy = false,
}: {
  /** 길이·업로드 때문에 막혔다면 그 사유. 아래 안내 문구를 고르는 데만 쓴다 */
  block: PostSubmitBlock | null
  /**
   * 지금 올릴 수 있는가.
   *
   * 🔴 `block !== null` 로 스스로 판정하지 않는다. 그렇게 두면 금칙어처럼
   *    block 이 아닌 사유로 막혔을 때 **상단 버튼은 잠기고 이 버튼만 열린** 상태가 된다.
   *    실제로 그랬다 — 서버가 막았다고 말한 화면에서 아래 CTA 를 다시 누를 수 있었다.
   *    판정은 부모가 한 번 하고, 상단바와 이 버튼이 **같은 값**을 받는다.
   */
  canSubmit: boolean
  textLength: number
  label: string
  pendingLabel: string
  /** 폼 밖에서 남은 일. 상단바와 같은 값을 받아 두 버튼이 같은 상태를 보인다 */
  busy?: boolean
}) {
  const keyboard = useKeyboardInset()
  const over = textLength > MAX_POST_CONTENT_LENGTH
  const near = textLength >= POST_CONTENT_COUNTER_WARN_FROM

  return (
    <div
      // 🔴 화면에 붙이는 것은 모바일뿐이다. 데스크탑은 키보드가 화면을 가리지 않아
      //    붙여 둘 이유가 없고, 넓은 화면 아래에 띠가 하나 더 생기기만 한다.
      className="fixed inset-x-0 bottom-0 z-40 border-t border-subtle bg-surface-card px-4 pt-2 lg:static lg:z-auto lg:border-t-0 lg:bg-transparent lg:px-0 lg:pt-0"
      style={{
        bottom: keyboard,
        // 🔴 키보드가 덮고 있는 동안에는 홈 인디케이터 여백을 두지 않는다.
        //    키보드 위에 빈 띠가 생겨 버튼이 떠 보인다.
        paddingBottom: keyboard > 0 ? 8 : 'calc(8px + env(safe-area-inset-bottom, 0px))',
      }}
    >
      {/* 🔴 안내와 글자 수를 버튼 위 한 줄에 둔다. 안내가 길어지면 줄을 바꾸고
             글자 수는 오른쪽에 그대로 남는다 — 390px 에서 서로 밀지 않는다. */}
      <div className="mb-2 flex min-h-[20px] flex-wrap items-center justify-between gap-x-3 gap-y-1">
        {block ? (
          <p role="alert" className="text-sm font-bold text-state-danger">
            {postBlockMessage(block)}
          </p>
        ) : (
          <span aria-hidden />
        )}

        {/* 🔴 한 글자도 안 썼을 때는 세지 않는다. 빈 화면의 0/5000 은 쓰기 전부터
               숙제처럼 보인다. 쓰기 시작하면 그때부터 상태를 보여 준다. */}
        {textLength > 0 ? (
          <span
            className={cn(
              'ml-auto shrink-0 text-xs tabular-nums',
              over ? 'font-bold text-state-danger' : near ? 'text-state-warning' : 'text-content-muted',
            )}
          >
            {textLength.toLocaleString()} / {MAX_POST_CONTENT_LENGTH.toLocaleString()}
          </span>
        ) : null}
      </div>

      <ActionButton
        tone="primary"
        label={label}
        pendingLabel={pendingLabel}
        disabled={!canSubmit}
        busy={busy}
        className="min-h-[56px] w-full justify-center"
      />
    </div>
  )
}

/**
 * 폼 맨 끝에 두는 자리. 고정된 바가 본문 마지막 줄을 덮지 않게 한다.
 *
 * 🔴 바가 문서 흐름에서 빠져 있으므로 자리를 대신 비워 주는 것이 필요하다.
 */
export function WriteFooterSpacer() {
  return <div className={`${BAR_HEIGHT} lg:hidden`} aria-hidden />
}
