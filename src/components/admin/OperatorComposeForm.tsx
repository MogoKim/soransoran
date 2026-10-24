'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useFormState } from 'react-dom'

import PostEditor from '@/components/features/PostEditor'
import ActionButton from '@/components/ui/ActionButton'
import { createOperatorContent, type ComposeActionState } from '@/lib/actions/operator-compose'
import { MAX_COMMENT_LENGTH, MIN_COMMENT_LENGTH } from '@/lib/comment-policy'
import {
  MAX_POST_CONTENT_LENGTH,
  MAX_POST_TITLE_LENGTH,
  MIN_POST_CONTENT_LENGTH,
  MIN_POST_TITLE_LENGTH,
} from '@/lib/post-policy'
import { getBoardByType } from '@/lib/board-registry'
import { OPERATOR_BOARDS } from '@/lib/operator-writer'
import type { ComposeTargetPost, ReplyTargetPost, WriterOption } from '@/lib/queries/operator-compose'
import CommentBadges from '@/components/features/CommentBadges'
import { AdminNotice, adminBadgeClass } from '@/components/admin/AdminUi'

/**
 * 창업자 직접 작성 폼 — 글 또는 댓글 한 편.
 *
 * 🔴 **등록 직전에 작성자와 대상이 눈에 보여야 한다.** 이 화면의 사고는 딱 하나다 —
 *    *다른 사람 이름으로 올렸다*. 그래서 미리보기 칸에 "누구 이름으로 · 어디에" 를
 *    문장으로 적는다. 목록 상자만 있으면 고른 값이 무엇인지 스크롤 뒤에 묻힌다.
 *
 * 🔴 **입력을 잃지 않는다.** 서버가 막으면 `state.kept` 로 쓰던 값이 돌아오고,
 *    그것을 다시 화면에 세운다. 길게 쓴 글이 오류 한 번에 사라지는 일을 막는다.
 *
 * 🔴 **중복 등록은 `requestKey` 가 막는다.** 폼이 열릴 때 한 번 만들고, 등록에
 *    성공하면 새 키로 바꾼다. 연속 클릭·새로고침 재전송은 같은 키로 와서
 *    DB unique 제약에 걸린다 — 버튼을 잠그는 것만으로는 재전송을 막지 못한다.
 *
 * 🔴 **AI 를 부르지 않는다.** 생성·검수 버튼을 두지 않는다. 창업자가 직접 쓴다.
 *
 * 🔴 **글 본문은 회원 글쓰기와 같은 `PostEditor`(사진·유튜브·굵게)다** (2026-10-14).
 *    회원용 `PostForm` 을 통째로 가져오지 않는다 — 그쪽은 회원 작성 액션(`createPost`)으로
 *    저장해서 OperatorWriter 작성자·감사 기록이 사라진다. 에디터만 빌리고 저장은 이 화면의
 *    액션 그대로다. 사진은 관리자 전용 업로드(`/api/admin/uploads`)로 간다.
 *    댓글은 지금처럼 글자 칸이다 — 댓글에는 사진·영상을 넣지 않는다.
 *
 * 🔴 **작성자 대댓글(2026-10-21)은 작성자를 고르지 않는다.** 원글 작성자 이름으로만 올라가고,
 *    그 값은 서버가 원글에서 읽는다. 이 모드에서는 작성자 선택창도 `writerId` 입력도 그리지 않는다 —
 *    보내지 않은 값은 위조될 수도 없다. 최상위 「댓글 달기」 는 지금처럼 작성자를 고른다.
 */

/** 🔴 관리자 전용 업로드 — 회원 업로드의 "가입 완료" 문에 기대지 않는다 */
const ADMIN_UPLOAD_ENDPOINT = '/api/admin/uploads'

/** 미리보기에 "사진 N장 · 영상 N개" 를 말해 주려고 센다. 🔴 세기만 한다 — HTML 을 그리지 않는다 */
function countMedia(html: string): { images: number; videos: number } {
  return {
    images: (html.match(/<img\b/gi) ?? []).length,
    videos: (html.match(/<iframe\b/gi) ?? []).length,
  }
}

type Mode = 'post' | 'comment' | 'reply'

const MODE_LABEL: Record<Mode, string> = { post: '글 쓰기', comment: '댓글 달기', reply: '작성자 대댓글' }

/** 🔴 요청 1회를 가리키는 값. 내용이 아니라 **요청**을 식별한다 */
function newRequestKey(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export default function OperatorComposeForm({
  writers,
  targets,
  replyTargets,
}: {
  writers: WriterOption[]
  targets: ComposeTargetPost[]
  /** 작성자 대댓글을 달 운영 직접 작성 글 — 🔴 작성자는 여기 보이는 값이고 고르는 값이 아니다 */
  replyTargets: ReplyTargetPost[]
}) {
  const [mode, setMode] = useState<Mode>('post')
  const [writerId, setWriterId] = useState(writers[0]?.id ?? '')
  const [boardType, setBoardType] = useState('MENOPAUSE')
  const [title, setTitle] = useState('')
  /**
   * 🔴 **초안을 모드마다 따로 둔다** (2026-09-17).
   *
   *    한 칸을 같이 쓰면 글을 쓰다 댓글 모드를 잠깐 열어 본 것만으로 본문이
   *    댓글 칸으로 옮겨 간다. 500자 상한에 걸려 버튼이 잠기고, 사람은
   *    "내 글이 어디 갔나" 를 먼저 묻게 된다.
   *    따로 두면 오가도 **양쪽 다 그대로 남는다.**
   */
  const [postBody, setPostBody] = useState('')
  /**
   * 🔴 글 본문의 **글자만**. 길이·최소 본문 판정은 이것으로 한다 — 서버(`postContentToText`)와
   *    같은 기준이다. HTML 길이로 재면 태그·사진 주소가 글자로 세어져 짧은 글이 통과한다.
   */
  const [postText, setPostText] = useState('')
  /** 사진을 올리는 중인가 — 올리는 동안 본문에는 아직 blob: 주소가 들어 있다 */
  const [uploading, setUploading] = useState(false)
  /** 등록에 성공하면 바꿔 에디터를 빈 상태로 다시 세운다. 🔴 에디터는 처음 값만 받는다 */
  const [editorKey, setEditorKey] = useState(0)
  const [commentBody, setCommentBody] = useState('')
  const [postId, setPostId] = useState(targets[0]?.id ?? '')
  /** 작성자 대댓글 — 원글 · 답할 댓글 · 본문. 🔴 작성자 state 는 없다(원글에서 정해진다) */
  const [replyPostId, setReplyPostId] = useState(replyTargets[0]?.id ?? '')
  const [parentId, setParentId] = useState('')
  const [replyBody, setReplyBody] = useState('')
  const [requestKey, setRequestKey] = useState(newRequestKey)

  /**
   * 🔴 **액션을 바꿔 끼우지 않는다.** 진입점은 하나이고, 무엇을 쓰는지는 `mode` 값으로 보낸다.
   *
   *    옛 판은 모드에 따라 다른 액션을 `useFormState` 에 넣었다. dispatch 는 폼에 심긴
   *    server action 참조와 한 몸이라, 글 → 댓글 → **다시 글** 로 돌아가면 서버에서
   *    여전히 댓글 액션이 돌았다. 글 모드에는 `postId` 가 없으니 막히는데 그 응답은
   *    `kind='comment'` 라 화면에서 걸러져 **아무것도 보이지 않았다** —
   *    버튼을 눌러도 조용히 아무 일도 안 일어나는 상태였다(실측).
   */
  const [rawState, formAction] = useFormState<ComposeActionState, FormData>(createOperatorContent, {})

  /**
   * 🔴 **지금 모드의 결과만 보여 준다.**
   *
   *    `useFormState` 의 상태는 모드를 바꿔도 살아 있다. 그래서 글을 올린 뒤
   *    댓글 모드로 옮기면 **방금 올린 글의 "등록했습니다" 와 그 글 링크가 그대로**
   *    남아 있었다 — 댓글이 등록된 것으로 읽히는 자리다.
   *
   * 🔴 화면이 짐작하지 않는다. 서버가 `kind` 로 어느 쪽 요청이었는지 말해 준다 —
   *    짐작하면 보내고 나서 모드를 바꾼 경우에 틀린다.
   */
  const state: ComposeActionState = rawState.kind === undefined || rawState.kind === mode
    ? rawState
    : {}

  const writer = useMemo(() => writers.find((w) => w.id === writerId) ?? null, [writers, writerId])
  const target = useMemo(() => targets.find((t) => t.id === postId) ?? null, [targets, postId])
  const replyPost = useMemo(() => replyTargets.find((t) => t.id === replyPostId) ?? null, [replyTargets, replyPostId])
  /** 🔴 고른 댓글이 새로 불러온 목록에 없으면(지워짐 · 사라짐) 고르지 않은 것으로 본다 */
  const parent = useMemo(() => replyPost?.comments.find((c) => c.id === parentId) ?? null, [replyPost, parentId])

  /**
   * 🔴 **실패해도 입력이 그대로 남는다.** 제목·내용은 이 컴포넌트의 state 이고,
   *    `useFormState` 는 같은 컴포넌트를 다시 그릴 뿐이라 값이 살아 있다 —
   *    `defaultValue` 로 두었다면 서버가 막은 순간 길게 쓴 글이 사라졌을 것이다.
   *
   * 🔴 **성공한 "요청" 마다 돈다.** 의존 배열이 `state.doneKey` 인 것이 핵심이다.
   *
   *    옛 판은 `[state.ok]` 였다. 두 번째 등록에서 `true` → `true` 라 **바뀐 것이 없고**,
   *    effect 가 돌지 않아 요청 키가 그대로 남았다. 그 키로 보낸 두 번째 글은
   *    중복 차단(unique)에 걸려 *"이미 등록된 글입니다"* 로 막혔다 —
   *    **한 번 열면 한 편밖에 못 쓰는 화면**이었다. 중복 차단이 틀린 것이 아니라
   *    새 요청에 새 키를 주지 못한 것이 틀렸다.
   *
   *    `doneKey` 는 그 요청의 `requestKey` 라 등록마다 다르다. 그래서 매번 돈다.
   *
   * 🔴 **비우는 것은 제목·내용뿐이다.** 작성자와 게시판은 남긴다 —
   *    같은 이름으로 연달아 쓰는 것이 이 화면의 보통 쓰임이고,
   *    매번 다시 고르게 하면 엉뚱한 이름으로 올릴 위험이 오히려 는다.
   */
  useEffect(() => {
    if (rawState.doneKey === undefined) return
    // 🔴 끝난 쪽의 초안만 비운다 — 다른 모드에 써 두고 온 글을 지우지 않는다
    if (rawState.kind === 'comment') setCommentBody('')
    else if (rawState.kind === 'reply') setReplyBody('')
    else {
      setTitle('')
      setPostBody('')
      setPostText('')
      setEditorKey((k) => k + 1)
    }
    setRequestKey(newRequestKey())
  }, [rawState.doneKey, rawState.kind])

  if (writers.length === 0) {
    return (
      <div className="mt-4 border-y border-[color:var(--admin-divider)] px-1 py-6">
        <p className="m-0 text-sm text-content-primary">아직 운영용 작성자가 없습니다.</p>
        <p className="mt-1 text-sm text-content-muted">
          쓸 닉네임을 정하고 <code>OperatorWriter</code> 에 등록한 뒤에 이 화면을 씁니다.
          🔴 자동 페르소나(P01~)는 여기에 오지 않습니다.
        </p>
      </div>
    )
  }

  /** 🔴 글은 글자 수(postText), 댓글은 그대로의 길이 — 서버가 재는 값과 같다 */
  const measured = mode === 'post' ? postText : commentBody
  /** 지금 모드에서 잴 본문 — 대댓글은 그대로의 길이(댓글과 같은 기준) */
  const written = mode === 'reply' ? replyBody : measured
  const contentTooLong =
    mode === 'post' ? written.length > MAX_POST_CONTENT_LENGTH : written.length > MAX_COMMENT_LENGTH
  /**
   * 🔴 화면의 잠금 조건은 **서버와 같은 상수**를 본다. 여기 숫자를 적으면
   *    "버튼은 열렸는데 서버가 막는" 상태가 생긴다 — `postSubmitBlock` 과 같은 계약이다.
   */
  const canSubmit =
    // 🔴 대댓글은 작성자를 고르지 않는다 — 원글 · 답할 댓글 · 원글 자격이 조건이다
    (mode === 'reply' ? replyPost !== null && replyPost.blocked === null && parent !== null : writerId !== '') &&
    written.trim().length >= (mode === 'post' ? MIN_POST_CONTENT_LENGTH : MIN_COMMENT_LENGTH) &&
    !contentTooLong &&
    // 🔴 사진을 올리는 중에는 보내지 않는다 — blob: 주소는 sanitize 가 지워 사진이 사라진 글이 된다
    !(mode === 'post' && uploading) &&
    (mode === 'post' ? title.trim().length >= MIN_POST_TITLE_LENGTH : mode === 'comment' ? postId !== '' : true)

  const media = mode === 'post' ? countMedia(postBody) : { images: 0, videos: 0 }

  return (
    <form
      action={(formData) => {
        /**
         * 🔴 버튼이 잠긴 것만 믿지 않는다. 제목칸 Enter(implicit submission) ·
         *    `form.requestSubmit()` 은 버튼을 거치지 않는다. 같은 `canSubmit` 으로 멈춘다 —
         *    회원 글쓰기(PostForm)와 같은 모양이다.
         */
        if (!canSubmit) return
        formAction(formData)
      }}
      /* 🔴 1280 이상 — 왼쪽 입력 · 오른쪽 「이대로 올라갑니다」 + 등록(따라온다). 그 아래는 한 줄(입력 → 확인 → 등록) */
      className="mt-4 flex flex-col gap-4 xl:grid xl:grid-cols-[minmax(0,1fr)_22rem] xl:items-start xl:gap-8"
    >
      {/* 🔴 무엇을 쓰는지는 값으로 보낸다 — 액션을 바꿔 끼우지 않는다 */}
      <input type="hidden" name="mode" value={mode} />
      <input type="hidden" name="requestKey" value={requestKey} />
      {/* 🔴 대댓글 모드에는 작성자 값이 폼에 아예 없다 — 서버가 원글에서 정한다 */}
      {mode !== 'reply' ? <input type="hidden" name="writerId" value={writerId} /> : null}
      {mode === 'post' ? <input type="hidden" name="boardType" value={boardType} /> : null}
      {mode === 'comment' ? <input type="hidden" name="postId" value={postId} /> : null}
      {mode === 'reply' ? <input type="hidden" name="postId" value={replyPostId} /> : null}
      {mode === 'reply' ? <input type="hidden" name="parentId" value={parent?.id ?? ''} /> : null}

      <div className="flex min-w-0 flex-col gap-4">
      {/* ── 무엇을 쓰는가 ── */}
      <div
        role="radiogroup"
        aria-label="무엇을 쓸까요"
        className="flex w-full overflow-hidden rounded-md border border-interactive sm:w-auto sm:self-start"
      >
        {(['post', 'comment', 'reply'] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={mode === m}
            // 🔴 사진을 올리는 동안 모드를 바꾸지 않는다 — 에디터가 내려가면 올리던 사진을 잃는다
            disabled={uploading && mode !== m}
            onClick={() => setMode(m)}
            /* 🔴 세그먼트 — 고른 칸은 먹색 면 + 흰 글자(aria-checked), 나머지는 조용히. 모양만 바뀌고 고르는 동작은 그대로 */
            className={`inline-flex min-h-[52px] flex-1 items-center justify-center whitespace-nowrap border-r border-subtle px-4 font-semibold transition last:border-r-0 sm:flex-none lg:min-h-[44px] ${
              mode === m
                ? 'bg-[color:var(--admin-action-bg)] text-[color:var(--admin-action-content)]'
                : 'bg-surface-card text-content-secondary hover:bg-surface-page'
            } disabled:cursor-not-allowed disabled:opacity-40`}
          >
            {MODE_LABEL[m]}
          </button>
        ))}
      </div>

      {/* ── 누구 이름으로 ── 🔴 대댓글은 고르지 않는다(아래 「이 글의 작성자」 고정 표시) */}
      {mode !== 'reply' ? (
      <label className="flex flex-col gap-1">
        <span className="text-sm font-bold text-content-primary">누구 이름으로 쓸까요</span>
        <select
          value={writerId}
          onChange={(e) => setWriterId(e.target.value)}
          className="min-h-[52px] rounded-md border border-interactive bg-surface-card px-3 text-content-primary lg:min-h-[44px]"
        >
          {writers.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name} ({w.code})
            </option>
          ))}
        </select>
        {writer?.note ? <span className="text-xs text-content-muted">{writer.note}</span> : null}
      </label>
      ) : null}

      {mode === 'reply' ? (
        <ReplyPicker
          posts={replyTargets}
          postId={replyPostId}
          onPost={(id) => { setReplyPostId(id); setParentId('') }}
          parentId={parentId}
          parentGone={parentId !== '' && parent === null}
          onParent={setParentId}
        />
      ) : mode === 'post' ? (
        <>
          <label className="flex flex-col gap-1">
            <span className="text-sm font-bold text-content-primary">어느 게시판에</span>
            <select
              value={boardType}
              onChange={(e) => setBoardType(e.target.value)}
              className="min-h-[52px] rounded-md border border-interactive bg-surface-card px-3 text-content-primary lg:min-h-[44px]"
            >
              {OPERATOR_BOARDS.map((b) => (
                <option key={b} value={b}>
                  {getBoardByType(b)?.label ?? b}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-sm font-bold text-content-primary">제목</span>
            <input
              name="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={MAX_POST_TITLE_LENGTH}
              className="min-h-[52px] rounded-md border border-interactive bg-surface-card px-3 text-content-primary lg:min-h-[44px]"
            />
          </label>
        </>
      ) : (
        <label className="flex flex-col gap-1">
          <span className="text-sm font-bold text-content-primary">어느 글에 달까요</span>
          <select
            value={postId}
            onChange={(e) => setPostId(e.target.value)}
            className="min-h-[52px] rounded-md border border-interactive bg-surface-card px-3 text-content-primary lg:min-h-[44px]"
          >
            {targets.length === 0 ? <option value="">댓글을 달 글이 없습니다</option> : null}
            {targets.map((t) => (
              <option key={t.id} value={t.id}>
                [{t.boardLabel}] {t.title} · 댓글 {t.commentCount}
              </option>
            ))}
          </select>
        </label>
      )}

      {mode === 'post' ? (
        <div className="flex flex-col gap-1">
          <span className="text-sm font-bold text-content-primary">내용</span>
          {/* 🔴 Tiptap 은 name 을 가진 입력이 아니다 — 본문 HTML 은 hidden 으로 보낸다(PostForm 과 같다).
                 서버가 sanitize · 글자 수 · 콘텐츠 가드를 다시 본다 */}
          <input type="hidden" name="content" value={postBody} readOnly />
          <PostEditor
            key={editorKey}
            value={postBody}
            onChange={setPostBody}
            onTextChange={setPostText}
            onBusyChange={setUploading}
            placeholder="창업자가 직접 쓰는 글입니다. 사진·유튜브·굵게를 쓸 수 있어요."
            uploadEndpoint={ADMIN_UPLOAD_ENDPOINT}
          />
          <span className="text-xs text-content-muted">
            {postText.length} / {MAX_POST_CONTENT_LENGTH}자
            {uploading ? ' · 사진을 올리는 중이에요. 끝나면 등록할 수 있어요.' : ''}
          </span>
        </div>
      ) : mode === 'reply' ? (
        <label className="flex flex-col gap-1">
          <span className="text-sm font-bold text-content-primary">대댓글</span>
          <textarea
            name="content"
            value={replyBody}
            onChange={(e) => setReplyBody(e.target.value)}
            rows={4}
            maxLength={MAX_COMMENT_LENGTH}
            className="w-full rounded-md border border-interactive bg-surface-card p-3 text-content-primary"
          />
          <span className="text-xs text-content-muted">
            {replyBody.length} / {MAX_COMMENT_LENGTH}자
          </span>
        </label>
      ) : (
        <label className="flex flex-col gap-1">
          <span className="text-sm font-bold text-content-primary">댓글</span>
          <textarea
            name="content"
            value={commentBody}
            onChange={(e) => setCommentBody(e.target.value)}
            rows={4}
            maxLength={MAX_COMMENT_LENGTH}
            className="w-full rounded-md border border-interactive bg-surface-card p-3 text-content-primary"
          />
          <span className="text-xs text-content-muted">
            {commentBody.length} / {MAX_COMMENT_LENGTH}자
          </span>
        </label>
      )}

      </div>

      <div className="flex min-w-0 flex-col gap-4 xl:sticky xl:top-6">
      {/* ── 🔴 등록 직전 확인 — 이 화면의 안전장치 ── */}
      {/* 확인 자리 — 흰 면 + 왼쪽 먹색 3px. 입력칸과 다른 자리임이 보이게 */}
      <div className="rounded-md border border-subtle border-l-[3px] border-l-content-primary bg-surface-card p-4">
        <p className="m-0 text-xs font-bold uppercase tracking-wide text-content-muted">
          이대로 올라갑니다
        </p>
        {mode === 'reply' ? (
          <ReplyPreview post={replyPost} parent={parent} text={replyBody} />
        ) : (
        <p className="mt-1 break-words text-sm text-content-primary">
          <strong>{writer?.name ?? '—'}</strong> 이름으로{' '}
          {mode === 'post' ? (
            <>
              {/* 🔴 게시판 이름은 registry 가 정한다 — 화면에 문자열로 적지 않는다 */}
              <strong>{getBoardByType(boardType as 'MENOPAUSE' | 'FREE')?.label ?? boardType}</strong>에 글을 올립니다.
            </>
          ) : (
            <>
              <strong>{target ? target.title : '—'}</strong> 글에 댓글을 답니다.
            </>
          )}
        </p>
        )}
        {mode === 'post' && title.trim() !== '' ? (
          <p className="mt-1 break-words text-sm text-content-muted">제목: {title}</p>
        ) : null}
        {/* 🔴 글은 HTML 을 그리지 않고 **글자만** 보여 준다. 태그 문자열이 그대로 보이지도,
               정제되지 않은 HTML 이 그려지지도 않는다. 사진·영상은 위 에디터가 실제 모습이다 */}
        {mode !== 'reply' ? (
        <p className="mt-2 whitespace-pre-wrap break-words rounded bg-surface-page p-3 text-sm text-content-primary">
          {measured.trim() === '' ? '(내용이 비어 있습니다)' : measured}
        </p>
        ) : null}
        {media.images + media.videos > 0 ? (
          <p className="mt-1 text-xs text-content-muted">
            {media.images > 0 ? `사진 ${media.images}장` : ''}
            {media.images > 0 && media.videos > 0 ? ' · ' : ''}
            {media.videos > 0 ? `영상 ${media.videos}개` : ''}
            {media.images > 0 ? ' — 첫 사진이 목록 대표 사진이 됩니다' : ''}
          </p>
        ) : null}
      </div>

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
        label={mode === 'post' ? '글 등록' : mode === 'reply' ? '대댓글 등록' : '댓글 등록'}
        pendingLabel="등록 중…"
        disabled={!canSubmit}
        className="justify-center px-4"
      />
      </div>
    </form>
  )
}

/**
 * 작성자 대댓글 — 원글 고르기 · 원글 작성자 고정 표시 · 답할 댓글 고르기.
 *
 * 🔴 작성자는 보여 주기만 한다. 고르는 칸이 없다.
 * 🔴 댓글은 고객 화면처럼 한 단계만 들여 쓴다(대댓글의 대댓글도 같은 단계).
 */
function ReplyPicker({
  posts, postId, onPost, parentId, parentGone, onParent,
}: {
  posts: ReplyTargetPost[]
  postId: string
  onPost: (id: string) => void
  parentId: string
  parentGone: boolean
  onParent: (id: string) => void
}) {
  const post = posts.find((p) => p.id === postId) ?? null
  if (posts.length === 0) {
    return (
      <AdminNotice tone="info" title="대댓글을 달 글이 없습니다">
        운영자가 직접 작성한 글만 작성자 대댓글을 달 수 있습니다. 먼저 「글 쓰기」 로 글을 올려 주세요.
      </AdminNotice>
    )
  }
  return (
    <div className="flex flex-col gap-4">
      <label className="flex flex-col gap-1">
        <span className="text-sm font-bold text-content-primary">어느 글에 달까요 (운영 직접 작성 글)</span>
        <select
          value={postId}
          onChange={(e) => onPost(e.target.value)}
          className="min-h-[52px] rounded-md border border-interactive bg-surface-card px-3 text-content-primary lg:min-h-[44px]"
        >
          {posts.map((p) => (
            <option key={p.id} value={p.id}>
              [{p.boardLabel}] {p.title} · 댓글 {p.comments.length}{p.blocked ? ' · 달 수 없음' : ''}
            </option>
          ))}
        </select>
      </label>

      {post ? (
        /* 🔴 고정 작성자 — 고르는 칸이 아니라 읽기 전용 값이다(옅은 면 · 테두리 없음) */
        <div className="rounded-md bg-surface-page px-3 py-3" data-reply-author="">
          <p className="m-0 break-words text-sm text-content-primary">
            이 글의 작성자: <strong>{post.writerName}</strong>{' '}
            <span className={adminBadgeClass('neutral')}>{post.writerCode}</span>
          </p>
          {/* 막힌 글에는 "등록됩니다" 를 말하지 않는다 — 아래 안내가 왜 안 되는지 말한다 */}
          {post.blocked === null ? (
            <p className="m-0 mt-1 text-sm text-content-muted">이 작성자 이름으로 대댓글이 등록됩니다.</p>
          ) : null}
        </div>
      ) : null}

      {post?.blocked ? (
        <AdminNotice tone="warning" title="이 글에는 작성자 대댓글을 달 수 없습니다">{post.blocked}</AdminNotice>
      ) : post && post.comments.length === 0 ? (
        <AdminNotice tone="info" title="답할 댓글이 없습니다">이 글에는 답할 수 있는 댓글이 없습니다.</AdminNotice>
      ) : post ? (
        <div className="flex flex-col gap-1">
          <span className="text-sm font-bold text-content-primary" id="reply-parent-label">어느 댓글에 답할까요</span>
          {parentGone ? (
            <AdminNotice tone="warning" title="다시 골라 주세요">선택한 댓글이 삭제되었거나 더 이상 존재하지 않습니다.</AdminNotice>
          ) : null}
          <ul role="radiogroup" aria-labelledby="reply-parent-label" className="m-0 flex list-none flex-col gap-2 p-0">
            {post.comments.map((c) => {
              const on = c.id === parentId
              return (
                <li key={c.id} className={c.isReply ? 'pl-4 lg:pl-6' : undefined}>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={on}
                    data-parent-id={c.id}
                    onClick={() => onParent(c.id)}
                    /* 🔴 고른 댓글 — 한 단계 진한 쿨그레이 면 + 코랄 왼쪽선(선택 표시). 코랄 면은 깔지 않는다 */
                    className={`flex min-h-[52px] w-full flex-col items-start gap-1 rounded-md border px-3 py-2 text-left transition lg:min-h-[44px] ${
                      on
                        ? 'border-[color:var(--admin-accent)] bg-[color:var(--admin-row-selected)] shadow-[inset_3px_0_0_var(--admin-accent)]'
                        : 'border-subtle bg-surface-card hover:bg-surface-page'
                    }`}
                  >
                    <span className="flex w-full flex-wrap items-center gap-2 text-sm">
                      <span className={adminBadgeClass(c.isReply ? 'info' : 'neutral')}>{c.isReply ? '대댓글' : '댓글'}</span>
                      <strong className="min-w-0 break-words text-content-primary">{c.authorName}</strong>
                      {c.guest ? <span className={adminBadgeClass('neutral')}>비회원</span> : null}
                      <span className="text-xs text-content-muted">{c.createdAtLabel}</span>
                      {on ? <span className={`${adminBadgeClass('brand')} ml-auto`}>선택됨</span> : null}
                    </span>
                    <span className="w-full whitespace-pre-wrap break-words text-sm text-content-secondary">{c.preview}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      ) : null}
    </div>
  )
}

/** 고객 화면에 올라갈 모양 — 답할 댓글 아래 한 단계 들여 쓴 대댓글 */
function ReplyPreview({
  post, parent, text,
}: {
  post: ReplyTargetPost | null
  parent: ReplyTargetPost['comments'][number] | null
  text: string
}) {
  if (!post || !parent) {
    return <p className="mt-1 text-sm text-content-muted">글과 답할 댓글을 고르면 고객 화면 모양이 보입니다.</p>
  }
  return (
    <div className="mt-2 rounded bg-surface-page p-3 text-sm" data-reply-preview="">
      <p className="m-0 break-words text-content-muted">
        <strong className="text-content-primary">{post.title}</strong> 글
      </p>
      <div className="mt-2 border-l-2 border-subtle pl-3">
        <p className="m-0 flex flex-wrap items-center gap-1.5 text-xs text-content-muted">
          <span className="font-bold text-content-primary" data-preview-parent-author="">{parent.authorName}</span>
          <CommentBadges isPostAuthor={false} isGuest={parent.guest} />
        </p>
        <p className="m-0 mt-1 whitespace-pre-wrap break-words text-content-secondary">{parent.preview}</p>
        <div className="mt-2 pl-4">
          <p className="m-0 flex flex-wrap items-center gap-1.5 text-xs text-content-muted">
            <span aria-hidden>↳</span>
            <span className="font-bold text-content-primary" data-preview-author="">{post.writerName}</span>
            <CommentBadges isPostAuthor isGuest={false} />
          </p>
          <p className="m-0 mt-1 whitespace-pre-wrap break-words text-content-primary">
            {text.trim() === '' ? '(내용이 비어 있습니다)' : text}
          </p>
        </div>
      </div>
    </div>
  )
}
