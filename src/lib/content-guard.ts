/**
 * 콘텐츠 가드 — **단어가 아니라 행동**을 막는다.
 *
 * 🔴 왜 영역(audience)을 나누는가
 *    한 배열을 회원 글·닉네임·공식 글·봇 글이 함께 쓰고 있었다. 그래서 회원의 말을 풀어
 *    주려고 단어를 지우면 **우리 이름으로 나가는 봇 글까지** 함께 풀렸다.
 *    푸는 곳과 조이는 곳이 다르므로 정책도 갈라야 한다.
 *
 * 🔴 왜 단어가 아니라 행동 조합인가
 *    실측(2026-09-10, 43문장): 단어 목록은 "카지노에서 돈을 잃은 가족 때문에 고민이에요",
 *    "리딩방 사기를 당했어요", "코인 리딩방에 속지 마세요" 같은 **피해·경고 글 11건을
 *    전부 막으면서**, "추천인 코드 ABC123 입력하시면 보너스", "수익보장 지금 충전하세요"
 *    같은 **실제 광고는 통과**시켰다. 단어는 우회가 쉽고 오탐이 크다.
 *    피해를 **이야기하는** 글은 허용하고, 피해자를 **모집하는** 글을 막는다 —
 *    모집은 언제나 "밖으로 데려갈 통로"(링크·전화·ID)를 함께 들고 온다.
 */

/** 서비스 표현 금지어 — 브랜드 규칙 (사용자 글에는 적용하지 않는다) */
export const BRAND_BANNED_WORDS = ['시니어', '어르신', '노인', '실버'] as const

/**
 * 검사 대상이 누구의 글인가.
 *
 *   user      회원·비회원이 직접 쓴 글·댓글·인사말 — 가장 넓게 허용한다
 *   nickname  비회원 닉네임 — 여러 화면에 반복 노출되므로 엄격을 유지한다
 *   official  어드민이 쓰는 공식 콘텐츠 — 서비스가 직접 말하는 글이다
 *   bot       Micro Seed·persona — 우리 이름으로 발행되므로 가장 엄격하다
 *
 * 🔴 기본값을 두지 않는다. 넘기지 않으면 컴파일이 깨진다 —
 *    한 곳이라도 빠뜨렸을 때 조용히 느슨해지는 쪽이 훨씬 나쁘다.
 */
export type GuardAudience = 'user' | 'nickname' | 'official' | 'bot'

/** 영역별로 거친 표현·도박/금융 단어를 단독으로 막는가 */
const BLOCKS_WORDS: Record<GuardAudience, boolean> = {
  user: false,
  nickname: true,
  official: true,
  bot: true,
}

/**
 * 단어 자체로 막는 표현 — **user 를 제외한 영역에서만** 본다.
 *
 * 🔴 `\s*` 를 쓰지 않는다. 그것이 공백과 **줄바꿈까지** 무제한 건너뛰어
 *    서로 다른 낱말과 문장을 하나의 욕설로 합쳤다. 실측으로 잡은 오탐:
 *      도시 발전 · 질병 신호 · 병 신경 · 시 팔월 · 이 시 발표회 ·
 *      신용 불량품 · 작업 대출계 · 대출 문의 없이 ·
 *      문단 끝 "도시" + 다음 문단 "발전" · "카지"+"노래방" · "먹"+"튀김"
 *    띄어쓰기 우회를 막아 얻는 것보다 일상어를 막아 잃는 것이 훨씬 컸다.
 *    이제 **붙어 있는 글자만** 본다.
 *
 * 🔴 한글에는 ASCII `\b` 를 쓰지 않는다. 한글은 낱말 경계가 아니라 음절 경계라
 *    `\b` 가 아무 데서나 참이 된다. 대신 **알려진 정상 낱말만** 앞을 내다보고 뺀다 —
 *    지금은 始發點·始發驛·始發車 하나뿐이고, 늘어나면 여기에 적는다.
 *    (lookbehind 는 쓰지 않는다. 구형 iOS Safari 가 지원하지 않는다)
 */
const WORD_PATTERNS: RegExp[] = [
  /시발(?!점|역|차)|씨발|시팔|병신|개새끼|좆|썅|지랄/i,
  /카지노|바카라|토토사이트|먹튀|조건만남/i,
  /대출문의|신용불량|작업대출|코인리딩|리딩방/i,
]

/**
 * 밖으로 데려가는 통로 — 어느 영역에서든 막는다.
 *
 * 🔴 전화번호와 ID 를 나눠 둔다. 사람에게 할 말이 다르기 때문이다 —
 *    "전화번호를 지워 주세요" 와 "외부 연락처 ID 는 넣을 수 없어요" 는 다른 안내다.
 * 🔴 여기서도 `\s*` 를 쓰지 않는다. 같은 이유다.
 *    여백은 언제나 `[ \t]` 다. `\s` 는 줄바꿈까지 건너뛰어 문단 끝 `텔레그램` 과
 *    **다음 줄의 영문**을 한 아이디로 합친다 —
 *    "어제 텔레그램⏎abc1234라는 노래를 들었어요" 가 그렇게 막혔다.
 *
 * 🔴 메신저 이름 뒤에 한글이 붙으면 아이디가 아니라 조사·합성어다 —
 *    `카톡으로`·`카카오톡이`·`텔레그램이`·`텔레비전`.
 *    lookahead 로 잘라낸다. (lookbehind 는 구형 iOS Safari 가 지원하지 않는다)
 *    긴 이름을 먼저 적어야 `카카오톡이` 가 `카톡` 으로, `텔레그램` 이 `텔레` 로
 *    잘못 쪼개지지 않는다.
 *
 * 🔴 아이디를 데려가는 꼴은 셋이다. 밝힌 정도가 다르므로 요구하는 것도 다르다.
 *
 *      명시형  `카톡 아이디 abc123` · `카톡ID: abc123` · `카톡아이디 abc123`
 *              '아이디' 라고 말로 밝혔다. 더 물을 것이 없으므로 **영문만이어도** 센다.
 *              라벨이 경계 노릇을 하므로 여기서는 한글 lookahead 를 쓰지 않는다
 *              (`카톡아이디` 는 `카톡` 뒤가 한글이지만 조사가 아니다).
 *
 *      핸들형  `텔레그램 @moneyking`
 *              `@` 가 붙으면 그 자체로 아이디 표식이다. 영문만이어도 센다.
 *
 *      콜론형  `카톡: abc123` · `텔레그램: moneyking`
 *              콜론이 "이게 아이디다" 라고 말해 준다. 영문만이어도 센다.
 *
 *      맨몸형  `카톡 abc123` · `텔레그램 abc1234` · `텔레 my_id`
 *              아무 표식이 없다. 숫자나 `_` 가 섞인 **아이디꼴**일 때만 센다.
 *
 * 🔴 맨몸형에 아이디꼴을 요구하는 이유는 일상 문장 때문이다 —
 *      `카톡 alarm 소리가 커요` · `텔레그램 update 됐어요`
 *    메신저 이름 뒤에 영문 낱말 하나가 뒤따른다고 아이디는 아니다.
 *    카톡과 텔레그램에 같은 기준을 쓴다. 한쪽만 느슨하면 그쪽으로 몰린다.
 */
const PHONE_PATTERN = /\b01[016789][-.\s]?\d{3,4}[-.\s]?\d{4}\b/
/** 메신저 이름 — 긴 것부터. 뒤에 한글이 오면 조사·합성어이므로 아이디가 아니다 */
const MESSENGER = /(?:카카오톡|카톡|텔레그램|텔레)(?![가-힣])/.source
/** 명시형용 — 라벨이 경계를 대신하므로 한글 lookahead 를 붙이지 않는다 */
const MESSENGER_BARE = /(?:카카오톡|카톡|텔레그램|텔레)/.source
/** 아이디 몸통 — 영문·숫자로 시작해 3자 이상 */
const ID_BODY = /@?[a-z0-9][a-z0-9_.-]{2,}/.source
/** 아이디꼴 — 3자 이상이면서 숫자나 `_` 가 섞여 있다 */
const ID_LIKE = /(?=[a-z0-9_.-]{3,})[a-z0-9.-]*[0-9_][a-z0-9_.-]*/.source

const EXTERNAL_ID_PATTERNS: RegExp[] = [
  /* 명시형 — '아이디'·'ID' 를 말로 밝혔다. 콜론은 있어도 없어도 된다 */
  new RegExp(`${MESSENGER_BARE}[ \\t]*(?:아이디|ID)[ \\t]*[:：]?[ \\t]*${ID_BODY}`, 'i'),
  /* 핸들형 — `@` 가 아이디 표식이다 */
  new RegExp(`${MESSENGER}[ \\t]*@[a-z0-9][a-z0-9_.-]{2,}`, 'i'),
  /* 콜론형 — 콜론이 아이디임을 밝혔으므로 영문만으로도 센다 */
  new RegExp(`${MESSENGER}[ \\t]*[:：][ \\t]*${ID_BODY}`, 'i'),
  /* 맨몸형 — 아이디꼴일 때만 센다. 카톡·텔레그램 같은 기준이다 */
  new RegExp(`${MESSENGER}[ \\t]+${ID_LIKE}`, 'i'),
]

/**
 * 오픈채팅 언급.
 *
 * 🔴 user 영역에서는 이것만으로 막지 않는다.
 *    "오픈카톡 사기 조심하세요" 같은 **경고 글**이 막히기 때문이다.
 *    대신 아래 광고 조합의 "밖으로 나가는 통로" 신호로 센다.
 *    엄격 영역(nickname·official·bot)에서는 지금까지처럼 단독으로 막는다.
 */
const OPEN_CHAT_PATTERN = /오픈카톡|오픈채팅/i

/** 본문에 넣을 수 있는 링크 수. 제목은 0개다 */
export const MAX_BODY_LINKS = 2

/**
 * 광고 조합 — 세 가지가 **모두** 있을 때만 막는다.
 *
 *   ① 밖으로 나가는 통로   링크 · 전화번호 · 외부 ID · 오픈채팅
 *   ② 모집·수익 유도       충전 · 추천인 · 수익 보장 · 입금 · 첫충 · 꽁머니 · 모집 · 총판 ·
 *                          콜센터, 그리고 **위험 서비스에 직접 붙은** `가입`
 *   ③ 도박·투자·대출 판    카지노 · 바카라 · 토토 · 먹튀 · 리딩방 · 코인리딩 · 작업대출 …
 *
 * 🔴 하나만으로는 절대 막지 않는다. 그래야 이런 글이 살아남는다.
 *      "리딩방 사기를 당했어요"            ③만 있다
 *      "코인 리딩방에 속지 마세요"          ③만 있다 (경고 글)
 *      "카지노에서 돈을 잃은 가족 때문에"   ③만 있다
 *      "대출 문의 전화가 계속 와서 무서워요" ③만 있다
 *      "동호회 가입하려면 https://…"        ①②만 있다 (도박 판이 아니다)
 *
 * 🔴 ③ 에 **맨몸 낱말**을 넣지 않는다.
 *    `코인` 과 `대출` 을 그대로 넣었더니 ③ 이 도박판이 아닌 곳에서 켜졌다.
 *      "코인노래방 회원 가입 https://music.example"   코인 ← 노래방이다
 *      "코인세탁소 가입 https://laundry.example"      코인 ← 빨래방이다
 *      "도서관 가입 후 책 대출 https://library.example" 대출 ← 책을 빌리는 일이다
 *    ①②는 동호회·도서관·동네 가게 안내에도 흔히 함께 선다. 그래서 ③ 이 헐거우면
 *    조합 규칙 전체가 "링크 달린 가입 안내 금지" 로 변한다.
 *    남기는 것은 **광고 맥락이 낱말 안에 이미 들어 있는 것**뿐이다 —
 *    `코인리딩`·`리딩방`·`작업대출`·`대출문의` 처럼.
 *
 * 🔴 ② 는 **낱말이 있느냐**가 아니라 **읽는 사람에게 하라고 말하느냐**를 본다.
 *    낱말만 세던 때 피해·기사·상담 글이 광고가 됐다. 같은 낱말을 쓰기 때문이다 —
 *      "카지노에 입금했다가 피해를 봤어요"          입금 ← 겪은 일이다
 *      "카지노 충전 피해 상담"                      충전 ← 상담의 주제다
 *      "리딩방에서 수익 보장이라며 속였다는 기사"    수익 보장 ← 남이 한 말의 인용이다
 *      "추천인 코드 사기를 조심하세요"              추천인 ← 조심하라는 대상이다
 *    광고는 같은 낱말을 **명령·약속의 꼴**로 쓴다 —
 *      "카지노에 지금 입금하세요" · "충전하세요" · "수익 보장합니다" · "모집합니다"
 *
 *    그래서 ② 를 세 갈래로 나눈다.
 *
 *      권유형  고위험 낱말 + 권유·약속 어미가 **붙어 있는** 꼴 (충전하세요·보장합니다)
 *              → 면제 없이 센다. 광고가 '피해' 같은 낱말을 섞어도 빠져나가지 못한다.
 *      가입형  위험 서비스 + **광고 수식어** + 가입 (리딩방 지금 가입)
 *      맨몸형  고위험 낱말만 덩그러니 (카지노 충전 https://…)
 *              → 같은 글에 피해·경고·보도 신호가 있으면 세지 않는다.
 *
 * 🔴 가입형의 사이 낱말은 **적어 둔 광고 수식어**뿐이다. 길이로 재지 않는다.
 *    `[가-힣]{1,3}` 로 쟀더니 `상담소`·`피해자`·`모임` 이 전부 걸려
 *    "카지노 상담소 가입"·"리딩방 피해자 가입" 이 광고가 됐다. 길이는 뜻을 모른다.
 *    반대로 `오늘부터` 는 네 글자라 "리딩방 오늘부터 가입" 이 새어 나갔다.
 *    이제 목록에 적힌 것만 통과시킨다 — 늘어나면 여기에 적는다.
 *
 * 🔴 면제 신호는 **맨몸형에만** 건다. 권유형·가입형까지 풀면
 *    "피해 없는 카지노 충전하세요" 같은 글이 면제 낱말 하나로 빠져나간다.
 *
 * 🔴 문맥을 AI 로 판정하지 않는다. 왜 막혔는지 사람이 설명할 수 있어야 하고,
 *    같은 입력이면 언제나 같은 답이 나와야 한다.
 */
/**
 * ③ 판 — 도박·투자·대출, 그리고 `추천인 코드`.
 *
 * 🔴 `추천인 코드` 를 여기 두는 이유: 그 자체가 사람을 실어 나르는 판이다.
 *    "추천인 코드를 입력하세요 + 링크" 는 도박 낱말이 하나도 없어도 광고다.
 *    ②의 면제가 그대로 걸리므로 "추천인 코드 사기를 조심하세요" 는 통과한다.
 */
const AD_DOMAIN_PATTERN =
  /카지노|바카라|토토|먹튀|조건만남|리딩방|코인리딩|작업대출|대출문의|신용불량|배팅|베팅|슬롯|홀덤|선물거래|추천인[ \t]*코드/i

/** 광고에도 피해 글에도 나오는 고위험 낱말. 이것만으로는 아직 아무것도 정하지 않는다 */
const AD_RISK_WORD = /충전|입금|추천인|수익[ \t]*보장|보장[ \t]*수익|첫[ \t]*충|꽁[ \t]*머니|모집|총판|콜센터/

/**
 * 읽는 사람에게 "하라"고 말하는 어미.
 *
 * 🔴 겪은 일·인용의 어미(`했다가`·`이라며`·`했었는데`)는 넣지 않는다.
 *    그것이 피해 글과 광고를 가르는 자리다.
 */
const AD_SOLICIT_TAIL =
  /하세요|하십시오|해주세요|해[ \t]*주세요|합니다|해요|하시면|하실|가능합니다|가능해요|드립니다|드려요|받습니다|받아요|중입니다|중이에요|중이니/

/** 권유형 — 고위험 낱말에 권유 어미가 바로 붙었다. 면제 없이 센다 */
const AD_SOLICIT_PATTERN = new RegExp(
  `(?:${AD_RISK_WORD.source})[ \\t]*(?:${AD_SOLICIT_TAIL.source})`,
  'i',
)

/**
 * 위험 서비스와 `가입` 사이에 끼어도 광고로 읽히는 수식어.
 * 🔴 길이가 아니라 목록이다. `상담소`·`피해자`·`모임` 은 여기에 없다.
 */
const AD_JOIN_MODIFIER = /지금|바로|무료|신규|즉시|간편|오늘부터|회원/

/** 가입형 자리 찾기 — 위험 서비스 + 광고 수식어 0~2개 + 가입 */
const AD_JOIN_PATTERN = new RegExp(
  `(?:${AD_DOMAIN_PATTERN.source})[ \\t]*(?:(?:${AD_JOIN_MODIFIER.source})[ \\t]*){0,2}가입`,
  'gi',
)

/**
 * 피해·경고·보도 신호 — 사람이 겪은 일을 말하고 있다는 표시.
 *
 * 🔴 이 목록을 늘려서 오탐을 막으려 하지 마라. 그 길은 끝이 없다.
 *    오탐이 나오면 먼저 권유형·가입형을 더 정확하게 만든다.
 */
const VICTIM_CONTEXT =
  /피해|사기|속았|속인|속여|속였|속지|당했|당한|조심|주의|경고|기사|뉴스|신고|중독|상담|예방|후기/

/**
 * `가입` **바로 뒤**에 붙는 권유 어미.
 *
 * 🔴 "바로 뒤" 가 핵심이다. 문장 어디에나 있는 `하세요` 를 보면
 *    "가입 사기를 조심**하세요**" 가 광고가 된다. 붙어 있는 것만 본다.
 */
const JOIN_SOLICIT_AFTER = new RegExp(
  `^[ \\t]*(?:${AD_SOLICIT_TAIL.source}|하러|하시고|하시길|고고)`,
  'i',
)

/**
 * 가입형 판정 — `가입` 을 찾은 다음 **그 뒤에 무슨 말이 오는지**까지 본다.
 *
 * 🔴 `가입` 을 찾자마자 광고로 확정하면 피해 글이 통째로 막힌다.
 *      "리딩방 가입했다가 피해를 봤어요"   겪은 일이다
 *      "리딩방 가입 사기를 조심하세요"      경고다
 *      "카지노 가입 피해 후기"             보도·경험담이다
 *    셋 다 `위험 서비스 + 가입` 이라는 점에서 광고와 똑같이 생겼다.
 *    다른 것은 **가입 다음에 이어지는 말**이다.
 *
 * 판정 순서 —
 *   ① 위험 서비스에 직접 붙은 `가입` 자리를 찾는다
 *   ② 그 바로 뒤가 명령·권유면 **차단**한다.
 *      뒤에 무슨 말이 오든 상관없다. "가입하세요, 피해 없습니다" 는 광고다.
 *   ③ 뒤에 피해·사기·경고·보도 문맥이 있으면 **허용**한다. 사람의 이야기다.
 *   ④ 그 밖의 "가입 안내 + 링크" 는 **차단**한다.
 *
 * 🔴 ③ 은 `가입` **뒤**만 본다. 앞은 보지 않는다 —
 *    "피해 없는 리딩방 가입 안내" 처럼 피해 낱말을 앞에 심어 두는 우회를 막는다.
 *
 * 🔴 `가입` 이 여러 번 나오면 **하나라도 광고면 광고다.**
 *    "리딩방 가입 사기 조심하세요. 리딩방 가입하세요" 로 앞에 경고를
 *    깔아 두는 우회를 막는다.
 */
function hasAdJoin(value: string): boolean {
  for (const m of value.matchAll(AD_JOIN_PATTERN)) {
    const after = value.slice((m.index ?? 0) + m[0].length)
    if (JOIN_SOLICIT_AFTER.test(after)) return true // ② 명령·권유
    if (VICTIM_CONTEXT.test(after)) continue // ③ 겪은 일·경고·보도
    return true // ④ 그 밖의 가입 안내
  }
  return false
}

/** ② 모집·수익 유도 */
function hasAdIntent(value: string): boolean {
  if (AD_SOLICIT_PATTERN.test(value)) return true // 권유형 — 면제 없음
  if (hasAdJoin(value)) return true // 가입형 — 가입 뒤 문맥까지 본다
  if (VICTIM_CONTEXT.test(value)) return false // 겪은 일·경고·보도를 말하는 글이다
  return AD_RISK_WORD.test(value) // 맨몸형
}

export type ContentGuardIssue =
  | {
      code: 'BLOCKED_EXPRESSION'
      /** 실제로 걸린 문자열 */
      matchedText: string
      /** 넘겨받은 원본 문자열 기준 위치 */
      start: number
      end: number
    }
  /** 🔴 걸린 번호를 싣지 않는다. 지우라고 하면서 한 번 더 노출하는 일이 된다 */
  | { code: 'CONTACT_PHONE' }
  /** 🔴 걸린 아이디를 싣지 않는다. 같은 이유다 */
  | { code: 'CONTACT_EXTERNAL_ID' }
  | { code: 'TOO_MANY_LINKS'; count: number; allowed: number }
  | { code: 'EXCESSIVE_REPEAT'; start: number; end: number }
  /** 🔴 걸린 문구를 싣지 않는다. 광고 원문을 화면에 되풀이할 이유가 없다 */
  | { code: 'AD_COMBO' }

/**
 * 🔴 issue 는 optional 이다.
 *    micro-seed-guard 처럼 `{ ok:false, reason }` 만 만들어 돌려주는 소비자가 있다.
 */
export type GuardResult =
  | { ok: true }
  | { ok: false; reason: string; issue?: ContentGuardIssue }

const OK: GuardResult = { ok: true }

/** URL 개수 — 링크 도배 판정용 */
function countUrls(text: string): number {
  return (text.match(/https?:\/\/|www\./gi) ?? []).length
}

/**
 * 정규식이 **실제로 문 문자열**과 그 위치를 돌려준다.
 *
 * 🔴 test() 로 거른 뒤 indexOf 로 다시 찾지 않는다. exec() 가 이미 답을 들고 있다.
 * 🔴 패턴에 /g 를 붙이지 않는다. lastIndex 가 호출 사이에 남아
 *    같은 입력이 한 번은 걸리고 한 번은 통과하는 상태가 생긴다.
 */
function firstMatch(patterns: RegExp[], value: string): RegExpExecArray | null {
  for (const pattern of patterns) {
    const m = pattern.exec(value)
    if (m) return m
  }
  return null
}

/**
 * 밖으로 나가는 통로가 있는가 — 링크·오픈채팅.
 *
 * 🔴 전화번호·외부 ID 는 여기서 세지 않는다. 그것들은 조합을 기다리지 않고
 *    ②에서 이미 단독으로 막히기 때문이다. 여기까지 왔다면 남은 통로는 이 둘뿐이다.
 */
export function hasOutboundChannel(text: string): boolean {
  return countUrls(text) > 0 || OPEN_CHAT_PATTERN.test(text)
}

/**
 * 광고 조합이 성립하는가 — ①통로 + ②모집 + ③판이 **모두** 있을 때만 true.
 *
 * 🔴 이 판정을 함수로 뽑아 둔 이유: 글쓰기는 제목과 본문을 **이어 붙여** 한 번 더 본다.
 *    칸마다 따로 보면 세 신호가 한 번도 같이 서지 않아 조합이 그대로 새어 나간다
 *    (제목 "리딩방 가입 안내" + 본문 "https://…"). 규칙이 두 벌이 되지 않도록
 *    checkContent 도 이 함수를 부른다 — 판정은 언제나 한 곳에서 나온다.
 */
export function hasAdCombo(text: string): boolean {
  const value = text.trim()
  if (!value) return false
  return hasOutboundChannel(value) && hasAdIntent(value) && AD_DOMAIN_PATTERN.test(value)
}

/** 같은 문자가 과도하게 반복되는 자리 (ㅋㅋㅋㅋ… 같은 정상 표현은 허용 범위를 넉넉히 둔다) */
const EXCESSIVE_REPEAT = /(.)\1{19,}/

/** 사람에게 할 말. 화면이 문구를 파싱하지 않도록 code 와 짝으로만 쓴다 */
function reasonFor(issue: ContentGuardIssue): string {
  switch (issue.code) {
    case 'BLOCKED_EXPRESSION':
      return '사용할 수 없는 표현이 있습니다. 다시 적어주세요.'
    case 'CONTACT_PHONE':
      return '전화번호는 남길 수 없어요. 전화번호를 지워 주세요.'
    case 'CONTACT_EXTERNAL_ID':
      return '외부 연락처 ID는 입력할 수 없어요.'
    case 'TOO_MANY_LINKS':
      return issue.allowed === 0
        ? '링크를 넣을 수 없어요. 링크를 지워 주세요.'
        : `링크는 ${issue.allowed}개까지만 넣을 수 있어요. 링크를 줄여 주세요.`
    case 'EXCESSIVE_REPEAT':
      return '같은 글자가 너무 많이 반복돼요. 그 부분을 줄여 주세요.'
    case 'AD_COMBO':
      return '광고성 가입·충전 안내와 외부 링크·연락처를 함께 넣을 수 없어요.'
  }
}

function fail(issue: ContentGuardIssue): GuardResult {
  return { ok: false, reason: reasonFor(issue), issue }
}

/**
 * 글 하나를 잰다.
 *
 * 🔴 audience 는 필수다. 넘기지 않으면 컴파일이 깨진다 — §GuardAudience 참조.
 * 🔴 위치는 **넘겨받은 원본** 기준으로 돌려준다. 내부 trim 기준으로 재면
 *    앞 공백만큼 어긋나 제목 구간 선택이 밀린다.
 */
export function checkContent(
  text: string,
  { isTitle = false, audience }: { isTitle?: boolean; audience: GuardAudience },
): GuardResult {
  const value = text.trim()
  if (!value) return OK

  const offset = text.indexOf(value)

  // ① 단어 — user 를 제외한 영역에서만 본다
  if (BLOCKS_WORDS[audience]) {
    const blocked = firstMatch(WORD_PATTERNS, value)
    if (blocked) {
      return fail({
        code: 'BLOCKED_EXPRESSION',
        matchedText: blocked[0],
        start: offset + blocked.index,
        end: offset + blocked.index + blocked[0].length,
      })
    }
    // 오픈채팅 단독 차단도 엄격 영역에만 남긴다 (user 는 아래 광고 조합이 본다)
    if (OPEN_CHAT_PATTERN.test(value)) return fail({ code: 'CONTACT_EXTERNAL_ID' })
  }

  // ② 밖으로 데려가는 통로 — 어느 영역에서든 막는다
  if (PHONE_PATTERN.test(value)) return fail({ code: 'CONTACT_PHONE' })
  if (firstMatch(EXTERNAL_ID_PATTERNS, value)) return fail({ code: 'CONTACT_EXTERNAL_ID' })

  // ③ 링크 개수
  const allowed = isTitle ? 0 : MAX_BODY_LINKS
  const count = countUrls(value)
  if (count > allowed) return fail({ code: 'TOO_MANY_LINKS', count, allowed })

  // ④ 광고 조합 — 통로 + 모집 유도 + 도박·투자 판이 **모두** 있을 때만
  //    댓글·닉네임·인사말처럼 칸이 하나뿐인 곳은 이 판정이 끝이다.
  //    글쓰기는 여기에 더해 제목+본문을 이어 붙여 한 번 더 본다 (post-guard-check).
  if (hasAdCombo(value)) return fail({ code: 'AD_COMBO' })

  // ⑤ 도배
  const repeat = EXCESSIVE_REPEAT.exec(value)
  if (repeat) {
    return fail({
      code: 'EXCESSIVE_REPEAT',
      start: offset + repeat.index,
      end: offset + repeat.index + repeat[0].length,
    })
  }

  return OK
}
