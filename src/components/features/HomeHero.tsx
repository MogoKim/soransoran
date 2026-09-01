import Image from 'next/image'

/**
 * 홈 첫 화면 배너 — 사진 위에 커뮤니티 정체성 한 줄.
 *
 * 🔴 워드마크와 설명문 두 줄로는 "여기가 어떤 곳인지" 가 서지 않는다.
 *    첫 화면에서 우리 손님이 확인하는 건 서비스 이름이 아니라
 *    "나 같은 사람이 여기 있는가" 다. 그건 글자가 아니라 사진이 답한다.
 *
 * 🔴 좁은 화면은 3:1 이다. 세로로 더 키우면 첫 화면에서 글 목록이 밀려 내려간다.
 *
 * 🔴 넓은 화면만 300px 로 세운다. 본문 폭이 768px 에서 멈추는데 3:1 을 그대로 두면
 *    256px 짜리 띠가 되어, 사진 23% 지점을 지나는 crop 이 세 사람의 머리 위를 자른다.
 *    사람이 보이라고 쓰는 사진인데 머리가 잘리면 쓸 이유가 없다.
 *    300px 면 crop 이 18.6% 로 내려가 머리 위에 여백이 생기고,
 *    글자가 얼굴 아래로 내려와 얼굴 셋이 다 보인다.
 *
 * 🔴 좁은 화면은 사진을 위쪽으로 잡는다(40%). 가운데로 두면 3:1 crop 이 사진 23% 지점을
 *    지나는데 세 사람의 머리 최상단이 24% 라 머리 위가 잘린다.
 *    40% 면 18.6% 로 내려가 머리 위에 여백이 남는다.
 *    넓은 화면은 300px 로 세워 이미 여유가 있으므로 가운데 그대로 둔다 —
 *    거기서 더 올리면 천장만 넓어진다.
 *
 * 🔴 어두운 그라디언트는 장식이 아니라 글자를 읽히게 하는 장치다.
 *    왼쪽이 진하고 오른쪽으로 옅어진다 — 글자는 왼쪽에만 놓기 때문이다.
 *    사진이 바뀌어도 왼쪽 대비는 유지된다.
 *
 * 🔴 배너 문구는 글씨 크기 설정을 따르지 않는다. 화면 폭에만 반응한다
 *    (모바일 29/20px · 데스크탑 44/24px).
 *    여기 두 줄은 읽는 본문이 아니라 브랜드 타이포다 — 사진 위에 놓인 고정 문구라
 *    자리와 크기가 정해져 있고, 늘릴 여백이 없다.
 *    실제로 "크게" 에서 3단을 따라가게 뒀더니 31.2px 이 되어 필요 폭 257px 이
 *    상한 252px 을 넘겼고, 제목이 "여성을 위한…" 으로 잘렸다.
 *    본문·목록·카테고리는 그대로 3단을 따라간다 — 여기만 예외다.
 */
export default function HomeHero() {
  return (
    <section className="relative w-full overflow-hidden [aspect-ratio:3/1] lg:[aspect-ratio:auto] lg:h-[300px]">
      <Image
        src="/images/hero/soransoran-community-hero.jpg"
        alt="소란소란 커뮤니티 hero 이미지"
        fill
        priority
        sizes="(min-width: 1200px) 1200px, 100vw"
        className="object-cover object-[50%_40%] lg:object-center"
      />

      {/* 왼쪽 0.55 → 55% 지점 0.3 → 오른쪽 0.08. 색 리터럴 없이 팔레트 black 의 투명도만 쓴다. */}
      <div
        aria-hidden
        className="absolute inset-0 bg-gradient-to-r from-black/55 from-0% via-black/30 via-55% to-black/[0.08] to-100%"
      />

      {/* 좁은 화면은 아래에 붙이고, 넓은 화면은 세로 가운데에 둔다 —
          모바일에서 가운데 정렬하면 글자가 얼굴 위로 올라온다. */}
      <div className="absolute inset-0 flex flex-col items-start justify-end gap-1.5 px-5 pb-3 text-left lg:justify-center lg:gap-3 lg:px-16 lg:pb-0">
        <h1 className="line-clamp-1 max-w-[72%] shrink-0 break-keep font-bold leading-[1.4] text-white text-[clamp(29px,7.4vw,44px)] lg:line-clamp-none lg:max-w-none">
          여성을 위한 커뮤니티
        </h1>
        <p className="line-clamp-1 max-w-[72%] shrink-0 break-keep leading-snug text-white/90 text-[clamp(20px,4.8vw,24px)] lg:line-clamp-none lg:max-w-none">
          갱년기, 가족, 일상까지 같이
        </p>
      </div>
    </section>
  )
}
