import Link from 'next/link'

/**
 * 상세 하단 다음 액션 — 읽은 사람이 쓰는 사람이 되게 한다.
 *
 * 🔴 댓글 영역의 로그인 안내와 역할이 다르다.
 *    거기는 "이 글에 반응하기", 여기는 "내 글 쓰기"다. 그래서 문구에서
 *    '로그인' 을 앞세우지 않고 글쓰기로 말한다 — 같은 화면에 로그인 유도가
 *    두 번 있는 것처럼 읽히면 둘 다 힘을 잃는다.
 *
 * 🔴 로그인 여부로 갈리지 않는다. 목적지도 문구도 모두에게 같다.
 *    /write 가 비회원에게도 폼을 열게 되면서, 여기서 로그인 화면을 먼저 끼우면
 *    같은 서비스 안에 "바로 쓰는 입구(FAB)" 와 "로그인부터 하는 입구(여기)" 가
 *    함께 있게 된다. 어느 쪽이 진짜인지는 눌러 봐야 알 수 있고,
 *    눌러 보고 로그인 화면을 만난 사람은 두 번 누르지 않는다.
 *    로그인을 요청하는 자리는 글을 다 쓰고 등록을 누른 시점 하나다.
 */
export default function WriteCta({ boardSlug }: { boardSlug: string }) {
  // FAB · U1 과 같은 규약이다. 여기서 형식을 새로 만들지 않는다.
  const writePath = `/write?board=${boardSlug}`

  return (
    /* 🔴 바탕이 중립이 된 뒤로 bg-surface-page 는 이 블록을 보이지 않게 만든다
          (바탕 위 바탕색). 흰 면 + 보더로 자기 자리를 갖게 한다.
          HomeJoinCta 는 여전히 bg-surface-soft 다 — 성격이 다른 블록을 같은 옷으로 두지 않는다. */
    <section className="mt-10 rounded-lg border border-subtle bg-surface-card px-5 py-6 text-center">
      <p className="m-0 font-bold text-content-primary">당신의 이야기도 궁금합니다</p>

      <Link
        href={writePath}
        className="mt-4 inline-flex min-h-[52px] items-center rounded-lg bg-cta px-6 font-bold text-cta-text no-underline transition duration-150 hover:brightness-95 active:scale-95"
      >
        이야기 남기기
      </Link>
    </section>
  )
}
