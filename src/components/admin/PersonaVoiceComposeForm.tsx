'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useFormState } from 'react-dom'

import ActionButton from '@/components/ui/ActionButton'
import { AdminNotice, adminBadgeClass } from '@/components/admin/AdminUi'
import { createOperatorContent, type ComposeActionState } from '@/lib/actions/operator-compose'
import { MAX_COMMENT_LENGTH, MIN_COMMENT_LENGTH } from '@/lib/comment-policy'
import type { PersonaVoiceSpeakerOption, PersonaVoiceTargetOption } from '@/lib/queries/operator-persona-voice'

/**
 * Persona 목소리 댓글 폼 — 창업자가 Persona 의 이름으로 댓글 한 편을 쓴다(2026-11-16 창업자 결정 ②).
 *
 * 🔴 정책 정본은 src/lib/operator-persona-voice.ts. 이 폼은 그 판정 결과(막힌 이유)를 보여 줄 뿐이고,
 *    저장 때는 트랜잭션이 다시 판정한다.
 * 🔴 등록 직전에 "누구 이름으로 · 어디에" 를 문장으로 보인다(OperatorComposeForm 과 같은 원칙).
 * 🔴 액션을 바꿔 끼우지 않는다 — 같은 createOperatorContent 에 mode=persona-voice 로 보낸다.
 * 🔴 보내는 값은 personaId · postId · content · requestKey 넷뿐이다. 작성자 행(PV)은 서버가 정한다.
 */

function newRequestKey(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

const KIND_LABEL: Record<NonNullable<PersonaVoiceTargetOption['kind']>, string> = {
  member: '회원 글',
  operator: '운영자 이름 글',
  persona: 'Persona 글',
}

export default function PersonaVoiceComposeForm({
  speakers,
  targets,
  initialPostId,
}: {
  speakers: PersonaVoiceSpeakerOption[]
  targets: PersonaVoiceTargetOption[]
  /** 처음 고를 대상 글 — 목록에 있을 때만 쓴다 */
  initialPostId?: string
}) {
  const firstOpenSpeaker = speakers.find((s) => s.blockedReason === null)?.id ?? ''
  const [personaId, setPersonaId] = useState(firstOpenSpeaker)
  const [postId, setPostId] = useState(
    initialPostId && targets.some((t) => t.id === initialPostId) ? initialPostId : (targets.find((t) => t.kind !== null)?.id ?? ''),
  )
  const [content, setContent] = useState('')
  const [requestKey, setRequestKey] = useState(newRequestKey)
  const [rawState, formAction] = useFormState<ComposeActionState, FormData>(createOperatorContent, {})
  const state: ComposeActionState = rawState.kind === undefined || rawState.kind === 'persona-voice' ? rawState : {}

  const speaker = useMemo(() => speakers.find((s) => s.id === personaId) ?? null, [speakers, personaId])
  const target = useMemo(() => targets.find((t) => t.id === postId) ?? null, [targets, postId])

  // 🔴 성공한 요청마다 본문을 비우고 새 요청 키를 만든다(OperatorComposeForm 과 같은 계약 — doneKey 기준)
  useEffect(() => {
    if (rawState.doneKey === undefined || rawState.kind !== 'persona-voice') return
    setContent('')
    setRequestKey(newRequestKey())
  }, [rawState.doneKey, rawState.kind])

  if (speakers.length === 0) {
    return (
      <div className="mt-2">
        <AdminNotice tone="info" title="쓸 수 있는 Persona 가 없습니다">활동 중인 Persona 가 없습니다.</AdminNotice>
      </div>
    )
  }

  const tooLong = content.length > MAX_COMMENT_LENGTH
  const canSubmit =
    speaker !== null &&
    speaker.blockedReason === null &&
    target !== null &&
    target.kind !== null &&
    content.trim().length >= MIN_COMMENT_LENGTH &&
    !tooLong

  return (
    <form
      action={(formData) => {
        if (!canSubmit) return
        formAction(formData)
      }}
      className="mt-4 flex flex-col gap-4"
    >
      <input type="hidden" name="mode" value="persona-voice" />
      <input type="hidden" name="requestKey" value={requestKey} />
      <input type="hidden" name="personaId" value={personaId} />
      <input type="hidden" name="postId" value={postId} />

      <p className="m-0 text-sm text-content-muted">
        자동 운영과 별개입니다. 회원 글 · 운영자 이름 글은 바로, Persona 자동 글은 공개 25시간 뒤부터 씁니다. 06:30~08:30 은 쉽니다.
      </p>

      <label className="flex flex-col gap-1">
        <span className="text-sm font-bold text-content-primary">어느 Persona 로 쓸까요</span>
        <select
          value={personaId}
          onChange={(e) => setPersonaId(e.target.value)}
          className="min-h-[52px] rounded-md border border-interactive bg-surface-card px-3 text-content-primary lg:min-h-[44px]"
        >
          {speakers.map((s) => (
            <option key={s.id} value={s.id} disabled={s.blockedReason !== null}>
              {s.name} ({s.code}){s.blockedReason ? ` · 지금 쓸 수 없음` : ''}
            </option>
          ))}
        </select>
      </label>
      {speaker?.blockedReason ? (
        <AdminNotice tone="warning" title="이 Persona 는 지금 쓸 수 없습니다">
          {speaker.blockedReason}
        </AdminNotice>
      ) : null}

      {speaker ? (
        <details open className="rounded-md border border-[color:var(--admin-border)] px-3 py-2">
          <summary className="flex min-h-[44px] cursor-pointer items-center text-sm font-bold text-content-primary">
            {speaker.name} 말투 카드 (참고용)
          </summary>
          <dl className="m-0 grid grid-cols-[7rem_minmax(0,1fr)] gap-x-3 gap-y-1 py-2 text-sm">
            {speaker.card.map((row) => (
              <div key={row.label} className="contents">
                <dt className="text-content-muted">{row.label}</dt>
                <dd className="m-0 break-words text-content-primary">{row.value}</dd>
              </div>
            ))}
          </dl>
        </details>
      ) : null}

      <div className="flex flex-col gap-1">
        <label className="flex flex-col gap-1">
          <span className="text-sm font-bold text-content-primary">어느 글에 달까요</span>
          <select
            value={postId}
            onChange={(e) => setPostId(e.target.value)}
            className="min-h-[52px] rounded-md border border-interactive bg-surface-card px-3 text-content-primary lg:min-h-[44px]"
          >
            {targets.length === 0 ? <option value="">댓글을 달 글이 없습니다</option> : null}
            {targets.map((t) => (
              <option key={t.id} value={t.id} disabled={t.kind === null}>
                [{t.boardLabel}] {t.title} · {t.kind ? KIND_LABEL[t.kind] : t.opensAtLabel ? `${t.opensAtLabel} 부터` : '쓸 수 없음'}
              </option>
            ))}
          </select>
        </label>
        {target?.href ? (
          <a
            href={target.href}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-[52px] items-center self-start text-sm font-semibold text-link lg:min-h-[44px]"
          >
            이 글 보기 ↗
          </a>
        ) : null}
        {target && target.kind === null && target.blockedReason ? (
          <AdminNotice tone="warning" title="이 글에는 지금 쓸 수 없습니다">
            {target.blockedReason}
            {target.opensAtLabel ? ` (${target.opensAtLabel} 부터)` : ''}
          </AdminNotice>
        ) : null}
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-sm font-bold text-content-primary">댓글</span>
        <textarea
          name="content"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={4}
          className="rounded-md border border-interactive bg-surface-card px-3 py-2 text-content-primary"
        />
        <span className={tooLong ? 'text-sm text-state-danger' : 'text-sm text-content-muted'}>
          {content.length} / {MAX_COMMENT_LENGTH}
        </span>
      </label>

      <p className="m-0 text-sm text-content-primary">
        이대로 올라갑니다:{' '}
        <strong>{speaker ? speaker.name : '—'}</strong> 이름으로 ·{' '}
        {target ? (
          <>
            <span className={adminBadgeClass('neutral')}>{target.boardLabel}</span> <strong>{target.title}</strong>
          </>
        ) : (
          '—'
        )}{' '}
        에 댓글
      </p>

      {state.error ? <p className="m-0 text-sm text-state-danger">{state.error}</p> : null}
      {state.ok ? (
        <p className="m-0 text-sm text-state-success">
          등록했습니다.{' '}
          {state.href ? (
            <Link href={state.href} className="text-link">
              올라간 자리 보기
            </Link>
          ) : null}
        </p>
      ) : null}

      <ActionButton
        tone="primary"
        size="compact"
        label="Persona 목소리로 댓글 등록"
        pendingLabel="등록 중…"
        disabled={!canSubmit}
        className="justify-center px-4"
      />
    </form>
  )
}
