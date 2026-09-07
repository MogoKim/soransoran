import Link from 'next/link'
import { TOUCH_MIN } from '@/lib/spacing'
import type { NewcomerGreeting } from '@/lib/queries/greeting'

/**
 * 홈 "최근 새로 온 이웃".
 *
 * 첫 인사 글은 자유게시판 목록에도 홈 인기글에도 나오지 않는다. 그렇다고
 * 아무 데도 보이지 않으면 인사를 남긴 사람만 남고 받아 줄 사람이 없다.
 * 이 자리가 그 하나뿐인 창구다.
 *
 * 🔴 data-nosnippet 을 단다.
 *    인사 글 상세는 noindex 지만 홈은 색인 대상이다. 그대로 두면 새로 온
 *    회원의 이름과 인사말이 검색 결과 발췌로 나갈 수 있다 — 인사는
 *    이 안에서 주고받자고 쓴 글이지 검색에 걸리라고 쓴 글이 아니다.
 *
 * 🔴 SEO 유입 장치로 다루지 않는다.
 *    더보기도 모아보기도 두지 않는다. 최근 몇 사람을 보여주고 끝낸다.
 *
 * 🔴 0 건이면 부르는 쪽이 렌더하지 않는다.
 *    빈 목록에 머리글만 남으면 "아무도 안 왔다" 를 크게 적어 두는 화면이 된다.
 */
export default function NewcomerGreetings({ greetings }: { greetings: NewcomerGreeting[] }) {
  return (
    <section className="px-4 py-5" aria-label="최근 새로 온 이웃" data-nosnippet>
      {/**
       * 🔴 SectionHeading 을 쓰지 않는다.
       *    그쪽은 board 의 아이콘·색을 받아 그리는데 인사에는 대응하는 게시판이 없다.
       *    배지 치수(h-8 w-8 rounded-[9px])와 제목 크기는 그대로 맞춰
       *    홈의 다른 머리글과 높이가 어긋나지 않게 둔다.
       */}
      <div className="mb-3 flex min-h-[52px] items-center">
        <h2 className="flex items-center gap-2 text-lg font-bold text-content-primary">
          <span
            aria-hidden
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] bg-surface-soft text-xl"
          >
            👋
          </span>
          최근 새로 온 이웃
        </h2>
      </div>

      {/**
       * 🔴 구분선은 항목 사이에만 긋는다.
       *    항목마다 아래 선을 두면 마지막 줄 밑에도 선이 남아, 여백으로 갈리는
       *    홈의 다른 섹션 사이에 선 하나가 끼어든다. 마지막 예외를 따로 둘
       *    필요가 없는 쪽을 쓴다 (홈 인기글 목록과 같은 규약).
       */}
      <ul className="m-0 flex list-none flex-col p-0 [&>li+li]:border-t [&>li+li]:border-subtle">
        {greetings.map((g) => (
          <li key={g.id}>
            <Link
              href={g.href}
              className={`group block ${TOUCH_MIN} rounded-lg py-3.5 no-underline`}
            >
              {/**
               * 🔴 이름과 "님이 인사를 남겼어요" 를 나란히 두되 접히게 한다.
               *    한 문장으로 이으면 긴 닉네임에서 줄바꿈 자리를 고를 수 없고,
               *    붙여 두면 320px 에서 이름이 잘린다. flex-wrap 이 두 조각을
               *    각자 온전히 유지한 채 다음 줄로 넘긴다.
               */}
              <div className="mb-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-1">
                <span className="break-keep font-bold text-brand-strong">{g.name}</span>
                <span className="text-sm text-content-muted">님이 인사를 남겼어요</span>
              </div>

              {/**
               * 🔴 두 줄까지만 보여준다.
               *    인사말은 200자까지 쓸 수 있어 전부 실으면 한 사람이 목록을 차지한다.
               *    나머지는 눌러서 본다.
               */}
              {g.content ? (
                <p className="m-0 line-clamp-2 break-keep font-medium leading-[1.5] text-content-primary transition-colors duration-150 group-hover:text-brand-strong group-active:text-brand-strong">
                  {g.content}
                </p>
              ) : null}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
