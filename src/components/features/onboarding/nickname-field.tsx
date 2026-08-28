'use client'

import {
  BANNED,
  NICKNAME_MAX,
  NICKNAME_MIN,
  NICKNAME_PATTERN,
  NICKNAME_PLACEHOLDER,
} from '@/lib/nickname'
import { cn } from '@/lib/utils'

export type NicknameStatus = 'idle' | 'checking' | 'valid' | 'error'

/**
 * 🔴 색으로만 알리지 않는다.
 *    테두리 색이 바뀌는 것은 지나치기 쉽고, 색을 구분하기 어려운 사람에게는
 *    아무 일도 일어나지 않은 화면이다. 테두리·아이콘·문장을 함께 바꾼다.
 */
const BORDER_CLASS: Record<NicknameStatus, string> = {
  idle: 'border-interactive',
  checking: 'border-interactive',
  valid: 'border-state-success',
  error: 'border-state-danger',
}

const ICON: Record<NicknameStatus, string> = {
  idle: '',
  checking: '⏳',
  valid: '✅',
  error: '❌',
}

const MESSAGE_CLASS: Record<NicknameStatus, string> = {
  idle: 'text-content-muted',
  checking: 'text-content-muted',
  valid: 'font-bold text-state-success',
  error: 'font-bold text-state-danger',
}

/**
 * 규칙 세 줄. 지금 입력이 각 줄을 지켰는지 그 자리에서 보여준다.
 *
 * 🔴 판정에 쓰는 값을 그대로 쓴다 (NICKNAME_PATTERN · BANNED).
 *    여기에 정규식이나 금지어를 다시 적으면, 정책이 바뀐 날 규칙 표시와
 *    실제 통과 여부가 어긋난다 — 사람은 ✓ 세 개를 보고도 막히게 된다.
 *
 * 🔴 아무것도 안 쳤을 때는 글자 규칙을 어긴 것이 아니다.
 *    빈 칸에 ✗ 를 띄우면 시작부터 틀렸다고 말하는 화면이 된다.
 */
function checkRules(value: string) {
  const lower = value.toLowerCase()
  return {
    length: value.length >= NICKNAME_MIN && value.length <= NICKNAME_MAX,
    chars: value.length === 0 || NICKNAME_PATTERN.test(value),
    notBanned: !BANNED.some((word) => lower.includes(word.toLowerCase())),
  }
}

const RULE_LABEL = {
  length: `${NICKNAME_MIN}~${NICKNAME_MAX}자`,
  chars: '한글, 영문, 숫자만 (띄어쓰기 불가)',
  notBanned: '금지어 미포함',
} as const

type RuleKey = keyof typeof RULE_LABEL

const RULE_ORDER: readonly RuleKey[] = ['length', 'chars', 'notBanned']

/**
 * 닉네임 입력 한 벌 — 입력칸·글자수·안내 문구·규칙 세 줄.
 *
 * 🔴 여기서 통과 여부를 정하지 않는다. 규칙 표시는 거들 뿐이고,
 *    쓸 수 있는지는 부모가 validateNicknameFormat 과 중복 확인으로 판정한다.
 *    판정이 두 곳이 되면 언젠가 서로 다른 답을 낸다.
 */
export default function NicknameField({
  value,
  status,
  message,
  onChange,
  onCompositionStart,
  onCompositionEnd,
}: {
  value: string
  status: NicknameStatus
  /** 부모가 정한 안내 문구. 형식 오류·중복·통과가 모두 이 자리에 온다 */
  message: string
  onChange: (value: string) => void
  onCompositionStart: () => void
  onCompositionEnd: (value: string) => void
}) {
  const rules = checkRules(value)

  return (
    <>
      <div className="mb-6">
        <label htmlFor="nickname" className="mb-2 block font-bold text-content-primary">
          닉네임
        </label>

        <div className="relative">
          <input
            id="nickname"
            name="nickname"
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onCompositionStart={onCompositionStart}
            onCompositionEnd={(e) => onCompositionEnd(e.currentTarget.value)}
            maxLength={NICKNAME_MAX}
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            aria-invalid={status === 'error'}
            aria-describedby="nickname-status nickname-rules"
            placeholder={NICKNAME_PLACEHOLDER}
            className={cn(
              'min-h-[52px] w-full rounded-xl border-2 bg-surface-card px-4 pr-12 font-medium text-content-primary outline-none transition-colors placeholder:font-normal placeholder:text-content-muted',
              BORDER_CLASS[status],
            )}
          />
          <span
            className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-xl"
            aria-hidden
          >
            {ICON[status]}
          </span>
        </div>

        <p className="mt-1 text-right text-content-muted" aria-hidden>
          {value.length}/{NICKNAME_MAX}
        </p>

        {/* 🔴 비어 있을 때도 자리를 지킨다. 문구가 나타날 때 아래가 밀리면 누르려던 곳이 움직인다 */}
        <p
          id="nickname-status"
          role="status"
          aria-live="polite"
          className={cn('mt-2 min-h-6 break-keep leading-snug', MESSAGE_CLASS[status])}
        >
          {status === 'checking' ? '중복 확인 중...' : message}
        </p>
      </div>

      <div id="nickname-rules" className="mb-8 rounded-xl bg-surface-page p-4">
        <p className="mb-2 font-bold text-content-muted">닉네임 규칙</p>
        <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
          {RULE_ORDER.map((key) => (
            <li
              key={key}
              className={cn(
                'flex items-start gap-1.5 break-keep leading-snug',
                rules[key] ? 'text-state-success' : 'text-content-muted',
              )}
            >
              <span aria-hidden>{rules[key] ? '✓' : '·'}</span>
              <span>{RULE_LABEL[key]}</span>
            </li>
          ))}
        </ul>
      </div>
    </>
  )
}
