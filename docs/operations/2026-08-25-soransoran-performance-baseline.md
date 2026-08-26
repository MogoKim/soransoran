# 소란소란 성능 기준선 — P0 리전 수정 (2026-08-25)

> 목적: 속도 병목의 **실측 기준선**과 판단 근거를 남긴다.
> 이후 성능 작업은 이 문서의 after 수치를 baseline으로 삼는다.
> 관련 PR: #44 (`perf: Vercel Function 리전을 서울(icn1)로 고정`, merge `a0bf85c`)

---

## 1. 문제 — 함수 리전과 DB 리전 불일치

`vercel.json` 파일 자체가 없어 Vercel **기본 리전 `iad1`(워싱턴DC)** 로 함수가 실행되고 있었다.
DB는 `aws-0-ap-northeast-2.pooler.supabase.com` — **서울**이다.

```
BEFORE  x-vercel-id: icn1::iad1::…
                     └서울 엣지  └iad1 실행   → 모든 Prisma 쿼리가 태평양 왕복
```

### 병목 특정의 결정적 근거

`force-dynamic`이나 렌더 모드가 아니라 **DB 접근 여부**로 갈렸다.

| 대조군 | before TTFB | DB | `force-dynamic` |
|---|---:|---|---|
| `/magazine` | 297ms | X (정적 배열 `MAGAZINE_ARTICLES`) | O |
| `/` | 1593ms | O | O |

매거진도 `force-dynamic`인데 297ms다. → **렌더 모드는 병목이 아니었다.**

로컬 `next build && next start`(서울 ↔ 서울 DB)에서 같은 페이지가 **79~158ms**로 나온 것이 교차 확인이다.

비용 분해:
- Vercel 기본 오버헤드(서울 유저 → iad1 함수): `297 − 13 ≈ 250ms`
- DB 왕복(iad1 → 서울 pooler): `1593 − 250 − 132 ≈ 1450ms`

---

## 2. 조치

`vercel.json` 신규 1파일, 4줄. **코드 변경 0.**

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "regions": ["icn1"]
}
```

---

## 3. 결과 — x-vercel-id 전환

```
BEFORE  icn1::iad1::…   ← 워싱턴DC 실행
AFTER   icn1::icn1::…   ← 서울 실행
```

7경로 전부 `icn1::icn1`, 전부 HTTP 200.

---

## 4. TTFB before/after (production · 쿠키 없음 · 5회 평균 · 동일 경로)

| 경로 | before | after | 개선 | 배수 | DB |
|---|---:|---:|---:|---:|---|
| `/community/[boardSlug]/[postId]` | 2690ms | **141ms** | −2549ms | **19.1×** | O |
| `/` | 1593ms | **327ms** | −1266ms | **4.9×** | O |
| `/community/free` | 1552ms | **124ms** | −1428ms | **12.5×** | O |
| `/community/menopause` | 1502ms | **126ms** | −1376ms | **11.9×** | O |
| `/magazine` | 297ms | **95ms** | −202ms | 3.1× | X |
| `/best` | 271ms | **74ms** | −197ms | 3.7× | X |
| `/login` | 264ms | **79ms** | −185ms | 3.3× | X |

**DB 사용 페이지 평균 1834ms → 180ms (약 10배).**

측정 조건: `curl -w '%{time_starttransfer}'` · `x-bot-type` 헤더 부착 · 경로당 5회 평균.
before = `d9f87b1`(iad1) / after = `a0bf85c`(icn1).

### 예상 대비 실측

감사 단계 예상은 `~400ms`였으나 실측은 **74~327ms**로 예상을 상회했다.
DB 왕복뿐 아니라 **서울 유저 → iad1 함수 구간(~250ms)도 함께 사라졌기 때문**이다.
정적 페이지가 297→95ms로 줄어든 것이 그 근거다.

---

## 5. 후속 우선순위 재조정

### 🔽 PR-S2 `getPostDetail` 중복 제거 — **우선순위 하향**

[`community/[boardSlug]/[postId]/page.tsx`](../../src/app/community/[boardSlug]/[postId]/page.tsx)에서
`getPostDetail`이 같은 인자로 2회 호출된다(`:23` generateMetadata, `:59` 컴포넌트).
React `cache()` 미적용이라 실제 쿼리도 2회다. 중복 자체는 여전히 사실이다.

**하지만 실익이 크게 줄었다:**
- 리전 수정 전: 상세 2690ms — 목록(1502ms)보다 **+1188ms**
- 리전 수정 후: 상세 141ms — 목록(126ms)보다 **+15ms**

왕복 1회 비용이 ~200ms에서 수 ms로 떨어져 중복 제거의 절대 이득이 사라졌다.
또한 `src/lib/queries/posts.ts`는 **수정 금지 파일**이라 별도 승인이 필요하다.
→ **지금 착수할 이유 없음. 백로그 유지.**

### 🔴 정적 페이지 `revalidate` — **후보에서 내린다** (2026-08-26 감사로 정정)

> **이 문서가 처음에 적었던 후보가 틀렸다.**
> `/magazine`, `/magazine/[slug]`, `/login`, `/privacy`, `/terms` 를
> "DB·개인화 미사용 페이지" 로 보고 `revalidate` 후보로 올렸는데,
> 전수 감사 결과 **다섯 곳 모두 불가하거나 효과가 0** 이다.
> 조건("DB·개인화 미사용") 자체는 옳았지만 **`HeaderAuth` 가 모든 페이지를
> 개인화 페이지로 만든다**는 사실이 빠져 있었다.

#### 왜 `revalidate` 를 붙여도 정적이 되지 않는가

```
PageShell  →  Header  →  HeaderAuth  →  await auth()
```

**모든 페이지가 `PageShell` 을 쓴다.** `HeaderAuth` 가 서버에서 `auth()`(쿠키 접근)를
호출하므로 Next 가 그 하위 전 라우트를 dynamic 으로 강등한다.

`npm run build` 실측이 이를 증명한다 — `force-dynamic` 이 **없는**
`/best` · `/login` · `/privacy` · `/terms` 까지 전부 `ƒ` 다.

```
ƒ /          ƒ /best      ƒ /login     ƒ /privacy   ƒ /terms
ƒ /magazine  ƒ /magazine/[slug]        ƒ /community/[boardSlug]  …
○ static : 0개
```

즉 **`export const revalidate = N` 을 추가해도 `auth()` 가 그것을 무효화한다.**
캐시는 생기지 않고 코드만 는다.

#### 페이지별 판정 (2026-08-26 실측)

| 페이지 | 판정 | 사유 |
|---|---|---|
| `/community/[boardSlug]` | 🔴 **절대 금지** | `getBlockedUserIds` 가 viewer별 차단 목록으로 결과를 필터링. 캐시하면 A가 차단한 글이 B에게 노출된다 (§6) |
| `/community/[boardSlug]/[postId]` | 🔴 **절대 금지** | 위와 동일 + `auth()` 직접 호출로 삭제/신고 버튼이 갈린다 |
| `/` (홈) | 🔴 **금지** | `getRecentDiscoveryPosts` 가 차단 필터를 쓰고, `HomeJoinCta` 가 로그인 여부로 HTML 자체를 다르게 낸다 |
| `/magazine` | 🔴 **금지** | `publishAt` **예약 공개 판정이 요청 시점에 일어나야 한다.** 코드 주석이 이미 경고한다 — "정적이 되면 예약 공개가 조용히 멈춘다" |
| `/magazine/[slug]` | 🔴 **금지** | 동일 |
| `/login` | 🟡 **구조적 불가** | `searchParams.callbackUrl` 을 읽는다 → dynamic 이 강제된다 |
| `/best` | 🟡 **무의미** | 모아보기 로직·데이터가 없는 의도적 빈 페이지(`noindex, follow`). 캐시할 내용이 없다 |
| `/privacy` · `/terms` | 🟡 **성격은 맞으나 효과 0** | DB·auth·searchParams 전부 0 인 순수 문서. 그러나 `HeaderAuth` 때문에 이미 `ƒ` 이고, `revalidate` 를 붙여도 그대로다 |

#### 결론 — **지금 자를 수 있는 안전한 `revalidate` 1차 PR 후보는 없다**

가정해서 `/privacy`·`/terms` 가 정적이 된다 해도 91~262ms → 30~50ms 인데,
둘 다 거의 방문되지 않는 약관 페이지라 체감 기여가 사실상 없다.

**시점 문제가 아니라 효과가 없어서 하지 않는다.** 붙이면 착시만 남는다.

### 다음 성능 후보 (2026-08-26 정정)

| 순위 | 후보 | 대상 | 기대 | 위험 |
|---|---|---|---|---|
| **1** | **Pretendard self-host 2단계** | `public/fonts/pretendard/` 에 woff2 + **OFL 라이선스**, `layout.tsx` href 로컬화 | 외부 도메인 연결 편차(41~383ms 실측) 제거 · FCP | 낮~중. 시각 확인 필수. 절차는 `public/fonts/pretendard/README.md` |
| **2** | **`HeaderAuth` 경계 재설계 감사** | 로그인 표시만 분리해 정적화 길을 여는 것이 가능한지 | 정적화의 **전제 조건** | 🔴 큼. 로그인 UX 전체를 건드린다. **별도 감사 먼저** |
| **3** | `revalidate` 재검토 | — | — | **2번이 정리된 뒤에만 의미가 있다** |

> 🔴 **2번은 원칙 판단이 먼저다.** `HeaderAuth` 주석이 "SessionProvider 를 두지 않고
> 서버에서 auth() 로 세션을 읽는다. 클라이언트 세션 훅을 쓰지 않는 현재 구조와 일관된다"
> 를 명시적 설계로 적어 뒀다. 이걸 바꾸는 것은 성능 튜닝이 아니라 아키텍처 변경이다.

P0(리전) 이후 **체감 개선은 이미 대부분 확보됐다.** 남은 후보는 전부 P0 대비 작다.

---

## 6. 🚫 금지 후보 — 유지

### 커뮤니티 목록/상세에 ISR(`revalidate`) 또는 `unstable_cache` 적용

**절대 하지 않는다.**

[`src/lib/queries/posts.ts`](../../src/lib/queries/posts.ts)의 `getBlockedUserIds`(`:33`)가
`auth()` + `prisma.userBlock.findMany`로 **viewer별 개인화 데이터**를 만들고,
`:58` `:83` `:98` 세 쿼리 함수가 이를 사용해 결과를 필터링한다.

이 결과를 캐시하면:
- A가 차단한 사용자의 글이 **B에게 캐시된 응답으로 노출**되거나
- 그 반대로 B에게 보여야 할 글이 사라진다

→ **visibility 정책이 붕괴한다.** viewer별 캐시 키 분리 없이는 어떤 형태로도 금지.

관련 가드: `npm run check:visibility`

### 기타 금지

| 후보 | 사유 |
|---|---|
| DB 리전을 미국으로 이전 | 유저가 한국이다. 방향이 반대 |
| `force-dynamic` 일괄 제거 | `auth()` 사용 페이지는 자동 dynamic이다. 효과 없고 예외만 유발 |
| Prisma Accelerate / edge runtime 도입 | 구조 변경 규모가 크다. 리전 수정으로 이미 해결됐다 |

---

## 7. 재측정 절차

성능 관련 변경 후에는 **같은 7경로 · 5회 평균**으로 §4 표를 갱신한다.

```bash
B=https://soransoran.com
H='-H x-bot-type:internal-audit'
for p in "/" "/community/menopause" "/community/free" "/magazine" "/best" "/login"; do
  T=0
  for i in 1 2 3 4 5; do
    R=$(curl -s -o /dev/null $H -w '%{time_starttransfer}' "$B$p")
    T=$(echo "$T $R" | awk '{print $1+$2}')
  done
  printf "%-40s %8sms\n" "$p" "$(echo $T | awk '{printf "%.0f", $1/5*1000}')"
done
```

리전 확인:
```bash
curl -sI -H 'x-bot-type:internal-audit' https://soransoran.com/ | grep -i x-vercel-id
# 기대: icn1::icn1::…    /  icn1::iad1::… 이면 regions 미적용
```

> ⚠️ Preview 배포는 Deployment Protection(SSO)이 걸려 302가 엣지에서 반환된다.
> 요청이 함수에 닿지 않아 `x-vercel-id` 두 번째 필드가 비므로 **Preview로는 리전 검증이 불가능하다.**
> 대시보드 Functions 탭이나 production 반영 후 확인할 것.
