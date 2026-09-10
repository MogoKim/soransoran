'use client'

/**
 * 막힌 입력칸 바로 옆에 붙는 안내.
 *
 * 🔴 화면 위쪽 요약 하나로 끝내지 않는다. 제목이 막혔는데 안내가 화면 맨 위에만 있으면,
 *    본문을 길게 쓴 사람은 스크롤을 올려야 이유를 보고 다시 내려와야 한다.
 *    막힌 자리에서 말한다.
 *
 * 🔴 role="alert" 로 즉시 읽힌다. 그리고 같은 문장을 위쪽 요약이 또 읽지 않도록
 *    부르는 쪽이 요약을 감춘다 — 두 번 낭독되면 무엇이 문제인지 더 헷갈린다.
 *
 * 🔴 문구를 자르지 않는다. 걸린 표현이 길어도 줄바꿈으로 흘려보낸다 —
 *    말줄임표로 끊기면 정작 바꿔야 할 말이 보이지 않는다.
 */
export default function FieldErrorNotice({ id, message }: { id: string; message: string }) {
  return (
    <p
      id={id}
      role="alert"
      className="text-sm font-bold text-state-danger [word-break:keep-all] [overflow-wrap:anywhere]"
    >
      {message}
    </p>
  )
}
