'use client'

import ActionButton from '@/components/ui/ActionButton'
import {
  MAX_POST_CONTENT_LENGTH,
  POST_CONTENT_COUNTER_WARN_FROM,
  postBlockMessage,
  type PostSubmitBlock,
} from '@/lib/post-policy'
import { cn } from '@/lib/utils'

/**
 * 본문 아래 — 왜 아직 못 올리는지, 얼마나 썼는지, 그리고 올리는 버튼.
 *
 * 🔴 새 글과 고치기가 같은 것을 쓴다. 두 화면이 다른 문장·다른 배치를 가지면
 *    같은 사람이 두 번 배워야 한다. 다른 것은 버튼에 적힌 말뿐이다.
 *
 * 🔴 안내는 상단바의 잠긴 등록 버튼과 짝이다. 버튼만 잠가 두면 고장으로 읽힌다 —
 *    무엇이 모자란지는 여기서 말하고, 되는지 안 되는지는 버튼 색이 말한다.
 *
 * 🔴 이 자리는 문서 흐름 안이다. 툴바가 본문 위에 있으므로 아래에서 겹칠 것이 없다.
 */
export default function WriteFooter({
  block,
  textLength,
  label,
  pendingLabel,
}: {
  block: PostSubmitBlock | null
  textLength: number
  label: string
  pendingLabel: string
}) {
  const over = textLength > MAX_POST_CONTENT_LENGTH
  const near = textLength >= POST_CONTENT_COUNTER_WARN_FROM

  return (
    <>
      <div className="flex min-h-[24px] items-center justify-between gap-3">
        {/* 🔴 안내는 눈에 띄는 색으로 둔다. 회색으로 적으면 도움말처럼 읽혀
               "지금 나 때문에 못 올린다" 는 뜻이 전달되지 않는다. */}
        {block ? (
          <p role="status" className="text-sm font-bold text-state-danger">
            {postBlockMessage(block)}
          </p>
        ) : (
          <span aria-hidden />
        )}

        {/* 🔴 한 글자도 안 썼을 때는 세지 않는다. 빈 화면에 0/5000 이 떠 있으면
               쓰기 전부터 숙제처럼 보인다. 넘쳤을 때만 색으로 잡아 준다. */}
        {textLength > 0 ? (
          <span
            className={cn(
              'shrink-0 text-xs tabular-nums',
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
        disabled={block !== null}
        className="w-full justify-center"
      />
    </>
  )
}
