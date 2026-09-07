# 리브랜딩 전환 runbook

> 이 문서는 **실행 절차**다. 무엇을 바꿔야 하는지의 목록은 `src/lib/rebrand-manifest.ts` 가 갖고 있고,
> `npm run rebrand:plan` 이 그 목록을 순서대로 출력한다. 여기서는 **왜 그 순서인지**와
> **각 단계에서 무엇이 잘못될 수 있는지**를 적는다.

## 전제

- 이 문서를 여는 시점에 B단계 가드가 전부 살아 있다: `check:tokens` · `check:brand` ·
  `check:brand-colors` · `check:contrast` · `check:brand-assets` · `check:rebrand-config`
- 옛 도메인은 **전환 후에도 최소 6개월 유지**한다. 301 redirect 의 근거이고 롤백 경로다.
- 🔴 비밀값(`KAKAO_CLIENT_SECRET` · `NEXTAUTH_SECRET` · `DATABASE_URL`)은 Vercel 환경변수 화면에서만 다룬다.
  터미널·PR·이 문서에 값을 붙여넣지 않는다.

### 환경값의 노출 범위 — 한 덩어리로 다루지 않는다

| 분류 | 예 | 브라우저 노출 | 리브랜딩 정책 |
|---|---|---|---|
| `client-public-env` | `NEXT_PUBLIC_APP_URL` | **값이 번들에 박힌다** | change |
| `server-non-secret-env` | `NEXTAUTH_URL` · `SORAN_ALLOW_INDEXING` | 안 된다 | change / review |
| `public-identifier` | `KAKAO_CLIENT_ID` | 노출돼도 그 자체로 사고가 아니다 | review |
| `secret-env` | `KAKAO_CLIENT_SECRET` · `NEXTAUTH_SECRET` | **절대 안 된다** | review / **keep** |

- 🔴 **"비밀이 아니다"와 "공개해도 된다"는 다른 말이다.** `NEXTAUTH_URL` 은 비밀이 아니지만
  서버에서만 읽는다 — `NEXT_PUBLIC_` 접두어를 붙이는 순간 성격이 바뀐다.
- 🔴 `KAKAO_CLIENT_ID` 는 **secret 이 아니다.** 앱을 식별할 뿐이고 실제 방어는
  카카오 콘솔의 Redirect URI·도메인 등록이 한다. 다만 secret 과 같은 화면에서 다루므로 취급은 조심한다.

### 🔴 `NEXTAUTH_SECRET` 은 리브랜딩으로 바꾸지 않는다 (`keep`)

- 이 값을 바꾸면 **기존 로그인 세션이 전부 무효가 되어 회원이 모두 로그아웃된다.**
- 도메인이 바뀌는 것과 세션 서명 키는 아무 관계가 없다.
- 보안 사고나 **별도의 키 회전 작업**에서만 다루고, 그때도 리브랜딩과 같은 날 하지 않는다 —
  로그인 문제가 생겼을 때 원인이 도메인인지 키인지 가릴 수 없게 된다.

### 카카오 앱 — 기존 앱을 쓰면 값을 유지한다 (`review`)

- 도메인만 바뀌는 경우: 기존 앱에 **Redirect URI 와 Web 사이트 도메인만 추가**한다.
  `KAKAO_CLIENT_ID` · `KAKAO_CLIENT_SECRET` 은 **그대로 둔다.**
- 새 앱을 만드는 경우에만 두 값을 함께 교체한다. 이때 기존 회원의 카카오 연결이
  새 앱으로 이어지지 않으므로 **로그인 영향 범위를 먼저 확인한다.**

---

## 🔴 0. 정본을 바꾸기 전에 기존 공개값을 `legacyValues` 로 옮긴다

**다른 어떤 것보다 먼저 한다.**

`src/lib/rebrand-manifest.ts` 의 각 항목에 있는 `legacyValues` 에 **지금 값**을 적는다.
대상은 서비스명 · 도메인/호스트 · 문의 이메일 · GA 측정 ID · 네이버 인증값 ·
필요하면 이전 공개 식별자다.

```
1) legacyValues 에 지금 값을 기록          ← 여기가 먼저다
2) 정본을 새 값으로 변경
3) 가드가 새 값의 중복과 옛 값의 잔존을 모두 검사
4) 의도적으로 남겨야 하는 옛 값만 legacyAllowed 에 경로와 이유를 적어 허용
```

**순서를 뒤집으면 옛 값이 무엇이었는지 아무 데도 남지 않는다.** 그러면 가드는
새 값의 중복만 보게 되고, 옛 도메인·옛 이름이 코드 어딘가 남아 있어도 통과한다 —
링크가 죽거나 화면에 옛 브랜드가 그대로 뜨는데 **에러는 나지 않는다.**

- 🔴 현재 값을 `legacyValues` 에 중복해 넣지 않는다(가드가 막는다).
- 🔴 비밀값은 `legacyValues` 에 넣지 않는다(가드가 막는다).
- 🔴 `legacyAllowed` 는 **파일 경로 하나씩**, 이유와 함께 적는다. 디렉터리째 열지 않는다.
- 🔴 301 redirect 처럼 **외부 콘솔에만 남는 값은 코드 예외로 만들지 않는다.**
  코드에 없는 것을 allowlist 에 적으면 목록이 현실과 어긋난다.

---

## 순서와 그 이유

전환 실패의 대부분은 "순서를 바꿔서" 난다. 아래 순서는 **되돌릴 수 없는 것을 뒤로 미루는** 원칙으로 짰다.

### 1. 새 브랜드 값과 자산 확정

| 할 일 | 정본 |
|---|---|
| 서비스명 + **주제 조사(은/는)** 확정 | `src/lib/brand-name.ts` |
| 새 아이콘 2종 제작 (`icon.png` 32×32 · `apple-icon.png` 180×180) | 사람이 만든다 |
| 색 후보 확정 | `src/app/globals.css` + `src/lib/brand.ts` |

- 조사는 **자동 판별하지 않는다.** 영문·숫자 이름은 발음이 조사를 정하므로 사람이 정한다.
- 색 후보가 나오면 그 값으로 `npm run check:contrast:rebrand` 를 돌린다.
  이 모드는 현재 부채(`BASELINE_DEBT`)를 인정하지 않으므로 **새 색은 더 엄격한 기준을 통과해야 한다.**
- 아이콘은 글자가 없는 추상 심볼이라 모양은 재사용할 수 있다. 색만 다시 굽는다.

### 2. 이메일 수신 준비 — 🔴 코드보다 먼저

새 문의 주소로 **실제 메일이 도착하는 것**을 먼저 확인한다.
코드를 먼저 고치면 약관·개인정보처리방침에 적힌 주소로 메일이 오지만 아무도 받지 못한다.

- 옛 주소 수신은 **끄지 않는다.** 최소 6개월 병행한다.

### 3. 도메인·DNS·Vercel 준비

- DNS TTL 을 미리 낮춰 둔다(전환 며칠 전). 롤백 속도가 여기서 갈린다.
- Vercel 프로젝트에 새 도메인을 **추가만** 한다. primary 로 올리지 않는다.
- `curl -sI https://새도메인/` → 200 확인.

### 4. 카카오 redirect URI 등록 — 🔴 옛 것을 지우지 않는다

카카오 개발자 콘솔 > 카카오 로그인 > Redirect URI 에 **새 도메인을 추가**한다.

- 🔴 **옛 URI 를 먼저 지우면 전환 중 로그인이 전면 실패한다.** 둘 다 등록한 상태로 넘어간다.
- Web 사이트 도메인에도 새 도메인을 추가한다(카카오톡 공유 SDK 가 여기를 본다).
- 앱 자체는 그대로 둔다. 도메인만 바뀌면 `KAKAO_CLIENT_ID`/`SECRET` 은 교체하지 않는다.

### 5. GA stream/host 설정

- GA4 콘솔 > 데이터 스트림에 새 도메인을 등록한다.
- 코드의 `TRACKED_HOSTS`(`src/lib/public-site-config.ts`)에 새 호스트를 추가한다.
- 🔴 **둘은 짝이다.** 한쪽만 하면 수집이 0 이 되는데 에러도 로그도 없다.
- 전환 기간에는 **옛 호스트와 새 호스트를 모두 목록에 둔다.**
- 속성을 새로 팔지는 운영 판단이다 — 새로 파면 과거 지표와 끊긴다.

### 6. 네이버 인증과 검색 등록 — 🔴 유입의 대부분

- 네이버 Search Advisor 에 **새 사이트를 등록**하고 새 소유확인 값을 받는다.
- 그 값을 `NAVER_SITE_VERIFICATION`(`src/lib/public-site-config.ts`)에 넣는다.
- 🔴 **옛 사이트 등록을 지우지 않는다.**
- Google Search Console 도 새 속성을 만들고, 301 이 올라간 뒤 **주소 변경 도구**를 신청한다.
- sitemap 제출은 production 전환 **이후**에 한다. 그전에는 새 도메인이 색인되면 안 된다.

### 7. 코드 변경 및 preview QA

```bash
npm run check:rebrand-config   # 새 값 중복 0 + 옛 값 잔존 0
npm run check:brand            # 새 이름 중복 0 + 옛 이름 잔존 0
npm run check:tokens
npm run check:brand-colors
npm run check:contrast
npm run check:brand-assets     # 아이콘 교체 확인
npm run typecheck && npm run lint && npm run build
```

- preview 환경에서는 `SORAN_ALLOW_INDEXING` 을 **비워 둔다**(전체 disallow).
  새 도메인 preview 가 색인되면 중복 콘텐츠가 된다.
- preview URL 로 실제 화면을 본다: 로고 · OG 이미지 · 로그인 왕복 · mailto 링크.

### 8. production 전환

순서대로 한다.

1. Vercel 환경변수 `NEXT_PUBLIC_APP_URL` · `NEXTAUTH_URL` 을 새 도메인으로
2. 배포
3. Vercel 에서 새 도메인을 primary 로
4. `SORAN_ALLOW_INDEXING` 을 켠다
5. 검색엔진에 sitemap 제출

- 🔴 `NEXTAUTH_SECRET` 은 **바꾸지 않는다**(`keep`). 리브랜딩과 무관한 값이고,
  바꾸면 전 회원의 세션이 무효가 되어 로그아웃된다. 위 전제 절을 참조.

### 9. 기존 도메인 redirect

Vercel > Domains 에서 옛 도메인 → 새 도메인 **301**.

- 🔴 검색 순위 이전의 핵심이다. 켜지 않으면 두 도메인이 중복 콘텐츠로 경쟁한다.
- `curl -sI https://옛도메인/` → 301 + `Location` 이 새 도메인인지 확인.

### 10. 운영 검증과 롤백 판단

전환 당일:

```bash
curl -sI https://새도메인/                      # 200
curl -s  https://새도메인/ | grep -E 'og:url|canonical|naver-site-verification'
curl -s  https://새도메인/sitemap.xml | grep -c 옛호스트   # 0
curl -sI https://옛도메인/                      # 301
```

- 카카오 로그인 왕복 (실기기)
- GA 실시간 보고서에 방문이 잡히는지
- 문의 메일 실제 수신

이후 며칠:

- 네이버 Search Advisor 색인 수 추이 — 🔴 **가장 중요한 지표**
- GSC 주소 변경 진행 상태
- GA 세션 수가 전환 전 수준을 회복하는지

---

## 롤백

`npm run rebrand:plan` 이 역순 롤백을 출력한다. 원칙은 하나다:

> 🔴 **옛 것을 먼저 지우지 않았다면, 되돌리는 길은 항상 열려 있다.**

| 되돌리는 것 | 방법 | 걸리는 시간 |
|---|---|---|
| 코드 정본 | `git revert` | 배포 1회 |
| Vercel 환경변수 | 옛 값으로 되돌리고 재배포 | 배포 1회 |
| primary 도메인 | Vercel 에서 옛 도메인을 primary 로 | 즉시 |
| DNS | 레코드 되돌리기 | **TTL 만큼** (그래서 미리 낮춘다) |
| 카카오 redirect URI | 새 URI 를 지운다(옛 것은 그대로 있다) | 즉시 |
| 검색엔진 | 옛 등록이 살아 있다 | 색인 회복은 수일~수주 |

**되돌릴 수 없는 것**

- 이미 발행된 글 본문의 옛 브랜드 호칭(`소란님들` 등) — 코드로 되돌아가지 않는다
- 검색 순위 — 301 로 이전되지만 완전 복구가 보장되지 않는다
- `NEXTAUTH_SECRET` 을 바꿨다면 로그아웃된 세션 — 그래서 `keep` 이다. 애초에 바꾸지 않는다

---

## 이 시스템이 보장하지 못하는 것

- `rebrand-manifest.ts` 에 적지 않은 전환 대상은 어디에도 나타나지 않는다. **사람이 적은 목록이다.**
- 가드는 저장소 안만 본다. 외부 콘솔(카카오·GA·네이버·Vercel·DNS)의 실제 설정 상태는 읽지 못한다.
- 발행 프롬프트와 `SORANSORAN_REGISTER_TERMS`(`scripts/lib/voice-style-signals.mts`)는
  이번 가드 범위 밖이다. AI 글의 호칭은 별도 판단이 필요하다.
- `SORAN_*` 환경변수 이름은 옛 브랜드에 묶여 있지만 **바꾸지 않아도 동작한다.**
  이름을 바꾸면 Vercel·GitHub Actions 양쪽을 동시에 고쳐야 하므로 전환과 분리한다.
