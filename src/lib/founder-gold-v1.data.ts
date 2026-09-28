/**
 * 🔴 **창업자 gold v1 — quality-v3 첫 30건의 창업자 판정** (2026-09-28 · 관리자 배치 화면 기록 30/30)
 *
 *   이 파일은 **불변**이다. 1~30 순서 · queueId · 판정 · 중대 결함 표시는 창업자가 확정했다.
 *   값을 하나라도 바꾸면 `founder-gold.ts` 의 고정 digest 와 품질 계약 digest 가 함께 바뀌어
 *   CI(`check:founder-gold` · `check:quality-contract`)가 막는다 — 판(`QUALITY_CONTRACT_VERSION`)을 올려야만 바뀐다.
 *
 *   · draft  기계가 쓴 **원본** 초안(사람 수정 전) — 게이트는 이것을 본다
 *   · source 게이트가 받은 원천 사실 그대로 — 마스킹된 제목 · 본문 머리(bodyHead · 300자 이하 발췌) · 시각 · 사이트 · 사진 수
 *   · plan   운영 계획의 게이트 입력 칸만 · card 정본 카드의 게이트 입력 칸만(그날 스냅샷)
 *   · runAt  그 초안을 판정한 회차 시각(RUN_AT)
 *   🔴 운영 DB 가변 상태를 읽지 않는다. 원문 전문 · 개인정보 없음(발췌는 수집 단계 마스킹을 거친 값).
 */
import type { FounderGoldRow } from './founder-gold'

export const FOUNDER_GOLD_V1_ROWS: readonly FounderGoldRow[] = [
  {
    "n": 1,
    "queueId": "cmuku6r9r00032yeiq5eybf0b",
    "verdict": "decline",
    "hardDefect": false,
    "reason": "비하가 아니라 글이 밋밋하고 가치가 낮음",
    "runAt": "2026-09-28T05:57:02.000Z",
    "source": {
      "title": "학원강사들 보면 사교육 욕하면 득달같이 덤비네요",
      "body": "사교육 너무 많다\n\n어린애들한테까지 사교육 돌리는거 불쌍하다\n\n이정도말에도 득달같이 달려들더라구요 ㅋ\n\n하긴 뭐 그게 밥줄이니 그렇겠지만..ㅎ\n\n​\n사교육 너무 많다\n\n어린애들한테까지 사교육 돌리는거 불쌍하다\n\n이정도말에도 득달같이 달려들더라구요 ㅋ\n\n하긴 뭐 그게 밥줄이니 그렇겠지만..ㅎ\n\n​",
      "site": "navercafe:remonterrace",
      "postedAt": "2026-09-27T02:18:00.000Z",
      "capturedAt": "2026-09-27T04:32:59.214Z",
      "imageCount": 0
    },
    "draft": {
      "title": "학원강사들 사교육 얘기만 나오면 아주 득달같이 달려드네요ㅋㅋ",
      "body": "요즘 사교육이 너무 심하다 어린애들까지 학원 돌리는 거 보면 불쌍하다 딱 이 정도 말만 해도 아주 난리가 나서 덤벼들더라구요ㅋㅋ!!\n\n하긴 뭐 자기들 밥줄이라 그렇겠지만 참..ㅎ"
    },
    "plan": {
      "personaCode": "P03",
      "stance": "SELF_EXPERIENCE",
      "selfBasis": "noLifeFactNeeded",
      "closingIntent": "vent",
      "contentRoles": [
        "conversationSpark"
      ],
      "universalReason": "사교육과 학원 강사들의 반응에 대해 주변이나 인터넷에서 보고 느낀 일상적인 생각이다.",
      "protectedFacts": [],
      "warrants": []
    },
    "card": {
      "code": "P03",
      "ageBand": "40대 후반",
      "maritalStatus": "이혼",
      "spouseRelationship": null,
      "childrenCount": 2,
      "childrenAgeBands": [
        "중고등"
      ],
      "parentCare": "없음",
      "menopauseStatus": "전",
      "noGoTopics": [
        "이혼 권유",
        "전 배우자 험담",
        "금액 언급"
      ],
      "household": {
        "childrenLiving": "동거",
        "careSide": null,
        "careCohabit": null
      }
    }
  },
  {
    "n": 2,
    "queueId": "cmuku6rbp00052yeimjryc8g2",
    "verdict": "pass",
    "hardDefect": false,
    "reason": null,
    "runAt": "2026-09-28T05:57:02.000Z",
    "source": {
      "title": "여행의 시작은 맥주~!",
      "body": "면세구역 들어오자마자 맥주 한캔씩~ㅋ\n\n딸이랑 이런게 잘 맞아서 좋아요\n\n먹고 마시러 딸과 둘이 떠납니다\n\n열심히 돈벌고 있는 남편 미안\n\n잘 다녀올께요~~\n면세구역 들어오자마자 맥주 한캔씩~ㅋ\n\n딸이랑 이런게 잘 맞아서 좋아요\n\n먹고 마시러 딸과 둘이 떠납니다\n\n열심히 돈벌고 있는 남편 미안\n\n잘 다녀올께요~~",
      "site": "navercafe:wgang",
      "postedAt": "2026-09-22T02:23:00.000Z",
      "capturedAt": "2026-09-22T06:32:34.185Z",
      "imageCount": 0
    },
    "draft": {
      "title": "딸이랑 여행 갑니다",
      "body": "면세구역 들어오자마자 딸이랑 맥주 한캔씩 마셨네요.\n\n이런 건 딸이랑 참 잘 맞아서 좋아요.\n둘이서 먹고 마시러 다녀오려구요.\n\n열심히 일하고 있는 남편한테는 좀 미안하네요.\n잘 다녀오겠습니다."
    },
    "plan": {
      "personaCode": "P19",
      "stance": "SELF_EXPERIENCE",
      "selfBasis": "lifeFacts",
      "closingIntent": "share",
      "contentRoles": [
        "experienceResonance",
        "conversationSpark"
      ],
      "universalReason": "",
      "protectedFacts": [
        {
          "kind": "publicEntity",
          "text": "면세구역",
          "evidenceRef": "head"
        },
        {
          "kind": "relation",
          "text": "딸",
          "evidenceRef": "head"
        },
        {
          "kind": "relation",
          "text": "남편",
          "evidenceRef": "head"
        }
      ],
      "warrants": [
        {
          "fact": "spouse",
          "requiredValue": "있음",
          "evidenceRef": "head",
          "evidenceText": "남편 미안"
        },
        {
          "fact": "children",
          "requiredValue": "있음",
          "evidenceRef": "head",
          "evidenceText": "딸이랑 이런게 잘 맞아서 좋아요"
        },
        {
          "fact": "childAgeBand",
          "requiredValue": "성인",
          "evidenceRef": "head",
          "evidenceText": "맥주 한캔씩~ㅋ\n\n딸이랑 이런게 잘 맞아서 좋아요"
        }
      ]
    },
    "card": {
      "code": "P19",
      "ageBand": "60대 초반",
      "maritalStatus": "기혼",
      "spouseRelationship": "소원",
      "childrenCount": 3,
      "childrenAgeBands": [
        "성인"
      ],
      "parentCare": "간헐",
      "menopauseStatus": "후",
      "noGoTopics": [
        "병명",
        "약 언급",
        "훈계"
      ],
      "household": {
        "childrenLiving": "분가",
        "careSide": null,
        "careCohabit": null
      }
    }
  },
  {
    "n": 3,
    "queueId": "cmuku6rdk00072yei9clknzpw",
    "verdict": "pass",
    "hardDefect": false,
    "reason": null,
    "runAt": "2026-09-28T05:57:02.000Z",
    "source": {
      "title": "티빙 보상신청 하셨나요?",
      "body": "예전 쿠팡은 보상나온것도 안쓰고 그 이후로 쿠팡 자체를 안쓰고 있는데 주위보니 다 쿠팡 쓰고 있고 저만  안쓰고 있네요. \n\n​\n\n티빙은 더 크게 털렸다는데 조용하고 다들 그냥 쓰는건지.. \n\n​\n\n언제나 초기에만 시끌하다가 조용해지니 저만 유난인가 싶고..\n\n​\n\n그냥 보상신청하면 되는걸까요?\n예전 쿠팡은 보상나온것도 안쓰고 그 이후로 쿠팡 자체를 안쓰고 있는데 주위보니 다 쿠팡 쓰고 있고 저만  안쓰고 있네요. \n\n​\n\n티빙은 더 크게 털렸다는데 조용하고 다들 그냥 쓰는건지.. \n\n​\n\n언제나 초기에만 시끌하다가 조용해지니 저만",
      "site": "navercafe:wgang",
      "postedAt": "2026-09-22T22:08:00.000Z",
      "capturedAt": "2026-09-23T02:31:45.473Z",
      "imageCount": 0
    },
    "draft": {
      "title": "티빙 보상신청 다들 하셨나요?",
      "body": "예전에 쿠팡 일 터졌을 때 보상 나온 것도 안 쓰고 이용 끊었는데\n주변 보면 다들 쿠팡 잘만 쓰고 저만 유난 떨었나 싶었거든요.\n\n이번에 티빙은 더 크게 털렸다는데도 조용하네요.\n다들 그냥 쓰시는 분위기인가요?\n\n초반에만 잠깐 시끄럽다가 지나가니 저만 신경 쓰나 싶고..\n다들 티빙 보상신청 그냥 하셨는지 궁금하네요."
    },
    "plan": {
      "personaCode": "P05",
      "stance": "QUESTION",
      "selfBasis": null,
      "closingIntent": "ask",
      "contentRoles": [
        "conversationSpark",
        "discoveryAnchor"
      ],
      "universalReason": "",
      "protectedFacts": [
        {
          "kind": "publicEntity",
          "text": "티빙",
          "evidenceRef": "title"
        },
        {
          "kind": "publicEntity",
          "text": "쿠팡",
          "evidenceRef": "head"
        }
      ],
      "warrants": []
    },
    "card": {
      "code": "P05",
      "ageBand": "40대 후반",
      "maritalStatus": "기혼",
      "spouseRelationship": "원만",
      "childrenCount": 2,
      "childrenAgeBands": [
        "대학·취준",
        "중고등"
      ],
      "parentCare": "상시",
      "menopauseStatus": "전",
      "noGoTopics": [
        "시어머니 험담",
        "며느리 훈계"
      ],
      "household": {
        "childrenLiving": "동거",
        "careSide": "시댁",
        "careCohabit": true
      }
    }
  },
  {
    "n": 4,
    "queueId": "cmuku9ahb00032ywkv02ohyqi",
    "verdict": "decline",
    "hardDefect": true,
    "reason": "P07의 자녀 1명·대학생 생활사와 `아이들`, 결혼 10년 서술 충돌",
    "runAt": "2026-09-28T05:58:58.000Z",
    "source": {
      "title": "요즘 젊은친구들은 결혼할때 명절 차례 안지낸다 약속받아놓고 결혼하는지",
      "body": "저는 결혼 10년차여서 명절날 차례음식만들지만 요즘 젊은친구들은 아이도 안낳고 둘이 사는데 명절차례 안지낸다 약속 받아놓고 결혼할까요?? 우리아이들때는 명절날 차례음식 없엇지겟지만 2016년시대. 지금 2026년에는 10년지지난만큼 차례지내는풍습이 조금잇으니까요.. 갑자기 궁금해지네요. 요즘 1인가구도 많아지니\n저는 결혼 10년차여서 명절날 차례음식만들지만 요즘 젊은친구들은 아이도 안낳고 둘이 사는데 명절차례 안지낸다 약속 받아놓고 결혼할까요?? 우리아이들때는 명절날 차례음식 없엇지겟지만 2016년시대. 지금 2026년에는 10년지",
      "site": "navercafe:remonterrace",
      "postedAt": "2026-09-24T05:32:00.000Z",
      "capturedAt": "2026-09-24T07:33:34.796Z",
      "imageCount": 0
    },
    "draft": {
      "title": "요즘 젊은 사람들은 차례 안 지낸다고 약속하고 결혼할까요?",
      "body": "저는 결혼 10년차라 명절마다 차례음식을 만들고 있긴 한데요.\n\n요즘 젊은 분들은 아이도 안 낳고 둘이 사는 경우도 많은데, 결혼할 때 아예 명절 차례 안 지낸다고 약속을 받아놓고 시작하는지 문득 궁금해지더라고요.\n\n우리아이들 세대쯤 가면 명절 차례음식 같은 게 다 없어지겠지만, 2016년 지나 지금 2026년에는 10년이 흘렀어도 아직은 차례 지내는 풍습이 조금 남아있잖아요.\n\n요즘 젊은 친구들은 다들 어떻게 하고 결혼하는지 궁금하네요."
    },
    "plan": {
      "personaCode": "P07",
      "stance": "SELF_EXPERIENCE",
      "selfBasis": "lifeFacts",
      "closingIntent": "ask",
      "contentRoles": [
        "conversationSpark",
        "experienceResonance"
      ],
      "universalReason": "",
      "protectedFacts": [
        {
          "kind": "number",
          "text": "10년차",
          "evidenceRef": "head"
        },
        {
          "kind": "number",
          "text": "2016년",
          "evidenceRef": "head"
        },
        {
          "kind": "number",
          "text": "2026년",
          "evidenceRef": "head"
        }
      ],
      "warrants": [
        {
          "fact": "spouse",
          "requiredValue": "있음",
          "evidenceRef": "head",
          "evidenceText": "결혼 10년차"
        },
        {
          "fact": "children",
          "requiredValue": "있음",
          "evidenceRef": "head",
          "evidenceText": "우리아이들"
        }
      ]
    },
    "card": {
      "code": "P07",
      "ageBand": "50대 초반",
      "maritalStatus": "기혼",
      "spouseRelationship": "원만",
      "childrenCount": 1,
      "childrenAgeBands": [
        "대학·취준"
      ],
      "parentCare": "간헐",
      "menopauseStatus": "진행중",
      "noGoTopics": [
        "병원",
        "약 언급",
        "치료 결과 단정",
        "검사 권유"
      ],
      "household": {
        "childrenLiving": "동거",
        "careSide": null,
        "careCohabit": false
      }
    }
  },
  {
    "n": 5,
    "queueId": "cmuku9aj900052ywk34j35ts1",
    "verdict": "decline",
    "hardDefect": false,
    "reason": "40~60대 여성 화자로 읽히지 않고 20~30대 느낌",
    "runAt": "2026-09-28T05:58:58.000Z",
    "source": {
      "title": "이런경우 호칭어떻게 하나요?",
      "body": "연상연하커플인데(여자가 연상)\n\n남친의 여친이 남친의 누나보다 나이 더 많을때\n\n나중에 결혼하고나면 호칭어떻게 하나요? (남친이 둘째, 위에누나있음)\n연상연하커플인데(여자가 연상)\n\n남친의 여친이 남친의 누나보다 나이 더 많을때\n\n나중에 결혼하고나면 호칭어떻게 하나요? (남친이 둘째, 위에누나있음)",
      "site": "navercafe:remonterrace",
      "postedAt": "2026-09-25T21:02:00.000Z",
      "capturedAt": "2026-09-26T01:33:16.052Z",
      "imageCount": 0
    },
    "draft": {
      "title": "이런 경우 호칭은 어떻게 부르나요?",
      "body": "연상연하 커플인데요.\n여자가 남친의 누나보다 나이가 더 많을 때요.\n\n남자가 둘째고 위에 누나가 있는 경우인데, 나중에 결혼하면 호칭을 어떻게 부르게 되는지 궁금합니다.\n이런 경우엔 보통 어떻게 부르나요?"
    },
    "plan": {
      "personaCode": "P18",
      "stance": "QUESTION",
      "selfBasis": null,
      "closingIntent": "ask",
      "contentRoles": [
        "conversationSpark",
        "usefulAnswer"
      ],
      "universalReason": "",
      "protectedFacts": [
        {
          "kind": "relation",
          "text": "누나",
          "evidenceRef": "head"
        }
      ],
      "warrants": []
    },
    "card": {
      "code": "P18",
      "ageBand": "60대 초반",
      "maritalStatus": "사별",
      "spouseRelationship": null,
      "childrenCount": 1,
      "childrenAgeBands": [
        "성인"
      ],
      "parentCare": "없음",
      "menopauseStatus": "후",
      "noGoTopics": [
        "사별 경험 전시",
        "종교 권유"
      ],
      "household": {
        "childrenLiving": "분가",
        "careSide": null,
        "careCohabit": null
      }
    }
  },
  {
    "n": 6,
    "queueId": "cmuku9al500072ywkrx2pmvmo",
    "verdict": "pass",
    "hardDefect": false,
    "reason": null,
    "runAt": "2026-09-28T05:58:58.000Z",
    "source": {
      "title": "치즈 매일 먹으면 안좋을까요?",
      "body": "우유도 말이 많고..\n\n큐브치즈(아주 작은거 말고 일반 사이즈) \n\n매일 샐러드에 넣어 먹는데\n\n유제품이 호르몬에 안좋은 영향 끼칠지 조심스럽네요\n\n검은콩두유도 매일 한컵씩 먹고 있는데\n\n두유는 괜찮나요?\n우유도 말이 많고..\n\n큐브치즈(아주 작은거 말고 일반 사이즈) \n\n매일 샐러드에 넣어 먹는데\n\n유제품이 호르몬에 안좋은 영향 끼칠지 조심스럽네요\n\n검은콩두유도 매일 한컵씩 먹고 있는데\n\n두유는 괜찮나요?",
      "site": "navercafe:wgang",
      "postedAt": "2026-09-24T00:48:00.000Z",
      "capturedAt": "2026-09-24T06:31:54.805Z",
      "imageCount": 0
    },
    "draft": {
      "title": "치즈 매일 챙겨 먹는 거 안 좋을까요?",
      "body": "우유도 이래저래 말이 많다 보니 신경이 쓰이네요..\n\n샐러드 먹을 때 큐브치즈 일반 사이즈로\n매일 넣어 먹고 있거든요.\n유제품 자주 먹으면 호르몬에 안 좋은 영향 줄까 봐 슬슬 조심스러워져서요.\n\n그리고 검은콩두유도 매일 한 컵씩 마시는데\n두유는 매일 먹어도 괜찮을까요?"
    },
    "plan": {
      "personaCode": "P10",
      "stance": "SELF_EXPERIENCE",
      "selfBasis": "noLifeFactNeeded",
      "closingIntent": "ask",
      "contentRoles": [
        "conversationSpark",
        "usefulAnswer"
      ],
      "universalReason": "치즈와 두유 등 일상적인 식품 섭취와 건강에 대한 고민으로 특정 생활사 조건이 필요하지 않음",
      "protectedFacts": [
        {
          "kind": "searchTerm",
          "text": "큐브치즈",
          "evidenceRef": "head"
        },
        {
          "kind": "searchTerm",
          "text": "검은콩두유",
          "evidenceRef": "head"
        },
        {
          "kind": "searchTerm",
          "text": "샐러드",
          "evidenceRef": "head"
        },
        {
          "kind": "searchTerm",
          "text": "호르몬",
          "evidenceRef": "head"
        }
      ],
      "warrants": []
    },
    "card": {
      "code": "P10",
      "ageBand": "50대 초반",
      "maritalStatus": "이혼",
      "spouseRelationship": null,
      "childrenCount": 1,
      "childrenAgeBands": [
        "성인"
      ],
      "parentCare": "없음",
      "menopauseStatus": "진행중",
      "noGoTopics": [
        "금액 언급",
        "자녀 소원 관계를 화제로",
        "비교"
      ],
      "household": {
        "childrenLiving": "분가",
        "careSide": null,
        "careCohabit": null
      }
    }
  },
  {
    "n": 7,
    "queueId": "cmuku9and00092ywk96vvnr44",
    "verdict": "pass",
    "hardDefect": false,
    "reason": null,
    "runAt": "2026-09-28T05:58:58.000Z",
    "source": {
      "title": "내가 다 먹어야지 ㅎ",
      "body": "예비 사위가 사왔다\n\n용돈과 함께 ㅋㅋㅋ \n\n음식하느라 고생하셨다고 ㅎㅎ\n\n기분짱 ♡\n\n봉투가,두개 사위\n\n딸 래미 ㅎㅎㅎ\n예비 사위가 사왔다\n\n용돈과 함께 ㅋㅋㅋ \n\n음식하느라 고생하셨다고 ㅎㅎ\n\n기분짱 ♡\n\n봉투가,두개 사위\n\n딸 래미 ㅎㅎㅎ",
      "site": "navercafe:wgang",
      "postedAt": "2026-09-24T05:47:00.000Z",
      "capturedAt": "2026-09-24T11:32:40.666Z",
      "imageCount": 0
    },
    "draft": {
      "title": "혼자 다 묵어야겠네요 ㅋㅋ",
      "body": "예비 사위가 음식하느라 고생했다고 맛난 것도 사오고 용돈까지 챙겨왔네요 ㅋㅋㅋ\n\n봉투가 두 개길래 보니까 사위 하나 딸래미 하나 요래 줬더라구요 ㅎㅎ\n\n기분 넘 좋네요 맛난 거 혼자 다 먹어야겠어요 ♡"
    },
    "plan": {
      "personaCode": "P11",
      "stance": "SELF_EXPERIENCE",
      "selfBasis": "lifeFacts",
      "closingIntent": "share",
      "contentRoles": [
        "experienceResonance",
        "conversationSpark"
      ],
      "universalReason": "",
      "protectedFacts": [],
      "warrants": [
        {
          "fact": "children",
          "requiredValue": "있음",
          "evidenceRef": "head",
          "evidenceText": "딸 래미"
        },
        {
          "fact": "childAgeBand",
          "requiredValue": "성인",
          "evidenceRef": "head",
          "evidenceText": "예비 사위"
        }
      ]
    },
    "card": {
      "code": "P11",
      "ageBand": "50대 초반",
      "maritalStatus": "기혼",
      "spouseRelationship": "원만",
      "childrenCount": 3,
      "childrenAgeBands": [
        "성인",
        "중고등"
      ],
      "parentCare": "없음",
      "menopauseStatus": "진행중",
      "noGoTopics": [
        "훈계",
        "자녀 자랑"
      ],
      "household": {
        "childrenLiving": "일부",
        "careSide": null,
        "careCohabit": null
      }
    }
  },
  {
    "n": 8,
    "queueId": "cmukubgca00032yu4aewfkndk",
    "verdict": "pass",
    "hardDefect": false,
    "reason": null,
    "runAt": "2026-09-28T06:00:32.000Z",
    "source": {
      "title": "도보 12분(평지, 신호등 대기 포함)이면 걸어다닐만 하나요?",
      "body": "지하철출구에서 사는동 입구문까지 도보 12분(평지, 신호등 대기 포함)이면 역세권이라 할수있나요?\n지하철출구에서 사는동 입구문까지 도보 12분(평지, 신호등 대기 포함)이면 역세권이라 할수있나요?",
      "site": "navercafe:remonterrace",
      "postedAt": "2026-09-22T00:15:00.000Z",
      "capturedAt": "2026-09-22T01:33:33.367Z",
      "imageCount": 0
    },
    "draft": {
      "title": "도보 12분 정도면 걸어다닐 만할까요?",
      "body": "지하철 출구에서 아파트 동 입구까지 걸어서 12분 정도 걸린다고 하면요.\n\n평지에 신호등 대기 시간까지 다 포함해서 도보 12분이면 걸어다닐 만한 거리인지, 역세권이라고 봐도 되는 건지 궁금하더라고요.\n\n다들 이 정도면 어떻게 보시는지 궁금해서 여쭤봐요."
    },
    "plan": {
      "personaCode": "P02",
      "stance": "QUESTION",
      "selfBasis": null,
      "closingIntent": "ask",
      "contentRoles": [
        "conversationSpark",
        "usefulAnswer"
      ],
      "universalReason": "",
      "protectedFacts": [
        {
          "kind": "number",
          "text": "12분",
          "evidenceRef": "title"
        }
      ],
      "warrants": []
    },
    "card": {
      "code": "P02",
      "ageBand": "40대 후반",
      "maritalStatus": "기혼",
      "spouseRelationship": "소원",
      "childrenCount": 1,
      "childrenAgeBands": [
        "초등"
      ],
      "parentCare": "없음",
      "menopauseStatus": "전",
      "noGoTopics": [
        "남편 흉보기에 동조",
        "이혼 권유",
        "단정"
      ],
      "household": {
        "childrenLiving": "동거",
        "careSide": null,
        "careCohabit": null
      }
    }
  },
  {
    "n": 9,
    "queueId": "cmukubgea00052yu4w5tj50ax",
    "verdict": "pass",
    "hardDefect": false,
    "reason": null,
    "runAt": "2026-09-28T06:00:32.000Z",
    "source": {
      "title": "안방커튼 생활암막 안하고 완전 암막으로 했는데 후회할까요?",
      "body": "이사가는 집에 새로 커튼 맞추면서 생활암막은 빛이 좀 새어나오길래 완전 암막으로 계약했는데 아무래도 암막커튼이 좀 두껍고 투박해요 좀 더 저렴해보이기도 하고...남편이 잘때 예민해서 그렇게 하긴 했는데 보통 생활암막 정도만 하시나요? \n 이사가는 집에 새로 커튼 맞추면서 생활암막은 빛이 좀 새어나오길래 완전 암막으로 계약했는데 아무래도 암막커튼이 좀 두껍고 투박해요 좀 더 저렴해보이기도 하고...남편이 잘때 예민해서 그렇게 하긴 했는데 보통 생활암막 정도만 하시나요?",
      "site": "navercafe:remonterrace",
      "postedAt": "2026-09-27T22:34:00.000Z",
      "capturedAt": "2026-09-28T01:32:35.977Z",
      "imageCount": 0
    },
    "draft": {
      "title": "안방 커튼 완전 암막으로 했는데 괜찮을까요",
      "body": "이사 가면서 안방 커튼 맞추는데\n생활암막은 빛이 새어 나오는 것 같아서요\n\n남편이 잘 때 예민한 편이라 완전 암막으로 계약했는데\n원단이 두껍고 투박해서 좀 저렴해 보이나 싶기도 하네요\n\n다들 안방에는 생활암막 정도로만 하시는지 궁금하네요"
    },
    "plan": {
      "personaCode": "P19",
      "stance": "SELF_EXPERIENCE",
      "selfBasis": "lifeFacts",
      "closingIntent": "ask",
      "contentRoles": [
        "conversationSpark",
        "experienceResonance"
      ],
      "universalReason": "",
      "protectedFacts": [
        {
          "kind": "searchTerm",
          "text": "생활암막",
          "evidenceRef": "title"
        },
        {
          "kind": "relation",
          "text": "남편",
          "evidenceRef": "head"
        }
      ],
      "warrants": [
        {
          "fact": "spouse",
          "requiredValue": "있음",
          "evidenceRef": "head",
          "evidenceText": "남편이 잘때 예민해서"
        }
      ]
    },
    "card": {
      "code": "P19",
      "ageBand": "60대 초반",
      "maritalStatus": "기혼",
      "spouseRelationship": "소원",
      "childrenCount": 3,
      "childrenAgeBands": [
        "성인"
      ],
      "parentCare": "간헐",
      "menopauseStatus": "후",
      "noGoTopics": [
        "병명",
        "약 언급",
        "훈계"
      ],
      "household": {
        "childrenLiving": "분가",
        "careSide": null,
        "careCohabit": null
      }
    }
  },
  {
    "n": 10,
    "queueId": "cmukubggb00072yu4yhg9xoeo",
    "verdict": "decline",
    "hardDefect": true,
    "reason": "대학생 자녀 Persona인데 초안의 자녀가 약 5세로 읽힘",
    "runAt": "2026-09-28T06:00:32.000Z",
    "source": {
      "title": "남편과 각방",
      "body": "코골이 남편하고  결혼하고  잠귀가 밝은 저는 같은방  쓰는게 너무너무 힘들었는데..\n\n아이가 태어나고 새벽 출근준비하는 남편때문에 아이가 계속 새벽에 깨서 어찌어찌 각방을 썼는데.. 생각해보니 각방쓴지 어언..5년인데..\n\n​\n\n이번에 집정리 좀할겸 다 세식구 각자 1방씩?얘기가 나왔는데..\n\n괜찮겠지요^^;;\n코골이 남편하고  결혼하고  잠귀가 밝은 저는 같은방  쓰는게 너무너무 힘들었는데..\n\n아이가 태어나고 새벽 출근준비하는 남편때문에 아이가 계속 새벽에 깨서 어찌어찌 각방을 썼는데.. 생각해보니 각방쓴지 어언..5년인데..",
      "site": "navercafe:wgang",
      "postedAt": null,
      "capturedAt": null,
      "imageCount": 0
    },
    "draft": {
      "title": "남편하고 각방 쓰시는 분들 계신가요",
      "body": "남편이 코를 골고 저는 잠귀가 밝아서 결혼하고 한방 쓰는 게 참 힘들더라고요.\n\n그러다 아이 태어나고 남편 새벽 출근 준비할 때마다 아이가 자꾸 깨서 어쩌다 보니 각방을 쓰게 됐는데, 생각해보니 벌써 5년이나 됐네요.\n\n이번에 집 정리하면서 아예 세 식구 각자 1방씩 쓰면 어떨까 얘기가 나왔는데... 다들 이렇게 지내도 괜찮겠지요?"
    },
    "plan": {
      "personaCode": "P07",
      "stance": "SELF_EXPERIENCE",
      "selfBasis": "lifeFacts",
      "closingIntent": "ask",
      "contentRoles": [
        "experienceResonance",
        "conversationSpark"
      ],
      "universalReason": "",
      "protectedFacts": [
        {
          "kind": "relation",
          "text": "남편",
          "evidenceRef": "title"
        },
        {
          "kind": "number",
          "text": "5년",
          "evidenceRef": "head"
        },
        {
          "kind": "number",
          "text": "1방",
          "evidenceRef": "head"
        }
      ],
      "warrants": [
        {
          "fact": "spouse",
          "requiredValue": "있음",
          "evidenceRef": "head",
          "evidenceText": "코골이 남편하고  결혼하고"
        },
        {
          "fact": "children",
          "requiredValue": "있음",
          "evidenceRef": "head",
          "evidenceText": "아이가 태어나고"
        }
      ]
    },
    "card": {
      "code": "P07",
      "ageBand": "50대 초반",
      "maritalStatus": "기혼",
      "spouseRelationship": "원만",
      "childrenCount": 1,
      "childrenAgeBands": [
        "대학·취준"
      ],
      "parentCare": "간헐",
      "menopauseStatus": "진행중",
      "noGoTopics": [
        "병원",
        "약 언급",
        "치료 결과 단정",
        "검사 권유"
      ],
      "household": {
        "childrenLiving": "동거",
        "careSide": null,
        "careCohabit": false
      }
    }
  },
  {
    "n": 11,
    "queueId": "cmukubgi700092yu4nbtx3eeu",
    "verdict": "pass",
    "hardDefect": false,
    "reason": null,
    "runAt": "2026-09-28T06:00:32.000Z",
    "source": {
      "title": "안경 쓰시는분들 러닝할때 모자 어떤거 써야하나요?",
      "body": "안경을 쓰니 야구모자가 안 어울리는데 어떤 모양의 야구 모자를 써야하나요? 앞머리도 있으니 모자를 어떻게 써야 하는지ㅠ \n안경을 쓰니 야구모자가 안 어울리는데 어떤 모양의 야구 모자를 써야하나요? 앞머리도 있으니 모자를 어떻게 써야 하는지ㅠ",
      "site": "navercafe:wgang",
      "postedAt": "2026-09-21T01:49:00.000Z",
      "capturedAt": "2026-09-21T02:31:04.240Z",
      "imageCount": 0
    },
    "draft": {
      "title": "안경 쓰고 러닝할 때 모자 다들 어떤 거 쓰세요?",
      "body": "안경을 쓰니까 야구모자가 참 안 어울리네요..\n거기다 앞머리까지 있어서 모자 쓰기가 참 애매해요 ㅎㅎ\n\n러닝할 때 어떤 모양의 야구모자를 써야 좀 덜 어색할까요?\n안경 쓰시는 분들은 모자 어떻게 쓰시는지 팁 좀 나눠주세요.."
    },
    "plan": {
      "personaCode": "P10",
      "stance": "SELF_EXPERIENCE",
      "selfBasis": "noLifeFactNeeded",
      "closingIntent": "ask",
      "contentRoles": [
        "conversationSpark",
        "usefulAnswer"
      ],
      "universalReason": "안경 착용 시 러닝용 모자 선택에 대한 일상적인 고민과 질문으로 특정 생활사 조건이 필요하지 않음",
      "protectedFacts": [
        {
          "kind": "searchTerm",
          "text": "러닝",
          "evidenceRef": "title"
        },
        {
          "kind": "searchTerm",
          "text": "야구모자",
          "evidenceRef": "head"
        }
      ],
      "warrants": []
    },
    "card": {
      "code": "P10",
      "ageBand": "50대 초반",
      "maritalStatus": "이혼",
      "spouseRelationship": null,
      "childrenCount": 1,
      "childrenAgeBands": [
        "성인"
      ],
      "parentCare": "없음",
      "menopauseStatus": "진행중",
      "noGoTopics": [
        "금액 언급",
        "자녀 소원 관계를 화제로",
        "비교"
      ],
      "household": {
        "childrenLiving": "분가",
        "careSide": null,
        "careCohabit": null
      }
    }
  },
  {
    "n": 12,
    "queueId": "cmukubgk2000b2yu40sppjgyj",
    "verdict": "pass",
    "hardDefect": false,
    "reason": null,
    "runAt": "2026-09-28T06:00:32.000Z",
    "source": {
      "title": "AI..랑 상담을...",
      "body": "하다하다....인공지능이랑 상담을...\n\n그래도 좀 위로가 되는건..\n\n최소한 내 뒷담화는 안깔꺼라 맘이 좀 \n\n놓이기도 하구요..\n\n이런저런 정보를 가져서인지\n\n냉정한 판단에 위로를 하는 정서적인 부분도\n\n약간 있네요..\n\n세상 참...\n\n기계에게 위안을 받을줄이야...\n하다하다....인공지능이랑 상담을...\n\n그래도 좀 위로가 되는건..\n\n최소한 내 뒷담화는 안깔꺼라 맘이 좀 \n\n놓이기도 하구요..\n\n이런저런 정보를 가져서인지\n\n냉정한 판단에 위로를 하는 정서적인 부분도\n\n약간 있네요..\n\n세상 참...\n\n기계에게 위안을 받을줄",
      "site": "navercafe:wgang",
      "postedAt": "2026-09-27T16:31:00.000Z",
      "capturedAt": "2026-09-28T02:32:03.212Z",
      "imageCount": 0
    },
    "draft": {
      "title": "살다살다 인공지능이랑 상담을 해보네요",
      "body": "하다하다 AI한테 속얘기를 털어놨네요..\n\n그래도 사람한테 말하는 것보다 나은 게 남한테 뒤에서 딴소리 옮길 걱정은 없으니까 맘이 좀 편하긴 해요ㅋㅋ\n\n이것저것 아는 게 많아서 그런지 판단도 딱 냉정하게 해주면서도 은근 정서적으로 위로도 해주더라구요..\n\n기계 덩어리한테 위안을 다 받고 참 세상 신기하기도 하고 씁쓸하기도 하고 그렇네요.."
    },
    "plan": {
      "personaCode": "P11",
      "stance": "SELF_EXPERIENCE",
      "selfBasis": "noLifeFactNeeded",
      "closingIntent": "share",
      "contentRoles": [
        "conversationSpark",
        "experienceResonance"
      ],
      "universalReason": "인공지능과 대화하며 위안을 받은 일상적 감상으로 특정 생활사 조건이 필요하지 않음",
      "protectedFacts": [],
      "warrants": []
    },
    "card": {
      "code": "P11",
      "ageBand": "50대 초반",
      "maritalStatus": "기혼",
      "spouseRelationship": "원만",
      "childrenCount": 3,
      "childrenAgeBands": [
        "성인",
        "중고등"
      ],
      "parentCare": "없음",
      "menopauseStatus": "진행중",
      "noGoTopics": [
        "훈계",
        "자녀 자랑"
      ],
      "household": {
        "childrenLiving": "일부",
        "careSide": null,
        "careCohabit": null
      }
    }
  },
  {
    "n": 13,
    "queueId": "cmukud83100032ycgjgcdutba",
    "verdict": "pass",
    "hardDefect": false,
    "reason": null,
    "runAt": "2026-09-28T06:02:13.000Z",
    "source": {
      "title": "훈제오리는 어떤 반찬이나 국과 어울리나요?",
      "body": "훈제오리 샀는데...\n\n훈제오리만 먹기는 썰렁한거 같아서..ㅎㅎ\n\n초보주부 뭐 하나라도 더 차려볼까 싶어요 ㅎㅎ\n\n뭐가 좋을까요? \n훈제오리 샀는데...\n\n훈제오리만 먹기는 썰렁한거 같아서..ㅎㅎ\n\n초보주부 뭐 하나라도 더 차려볼까 싶어요 ㅎㅎ\n\n뭐가 좋을까요?",
      "site": "navercafe:remonterrace",
      "postedAt": null,
      "capturedAt": null,
      "imageCount": 0
    },
    "draft": {
      "title": "훈제오리에는 어떤 반찬이나 국이 어울릴까요?",
      "body": "훈제오리를 사두었는데 이것만 먹기에는 상차림이 좀 허전한 것 같네요.\n\n초보라 뭐라도 하나 더 곁들여 차려보고 싶은데요.\n훈제오리와 같이 먹기 좋은 반찬이나 국 종류가 있을까요?\n\n어떤 조합이 좋을지 추천 부탁드립니다."
    },
    "plan": {
      "personaCode": "P04",
      "stance": "QUESTION",
      "selfBasis": null,
      "closingIntent": "ask",
      "contentRoles": [
        "conversationSpark",
        "usefulAnswer"
      ],
      "universalReason": "",
      "protectedFacts": [
        {
          "kind": "searchTerm",
          "text": "훈제오리",
          "evidenceRef": "title"
        }
      ],
      "warrants": []
    },
    "card": {
      "code": "P04",
      "ageBand": "40대 후반",
      "maritalStatus": "기혼",
      "spouseRelationship": "원만",
      "childrenCount": 0,
      "childrenAgeBands": [],
      "parentCare": "없음",
      "menopauseStatus": "진행중",
      "noGoTopics": [
        "자녀 있는 척",
        "무자녀를 화제로 만들기"
      ],
      "household": {
        "childrenLiving": null,
        "careSide": null,
        "careCohabit": null
      }
    }
  },
  {
    "n": 14,
    "queueId": "cmukud84r00052ycg4b7d567z",
    "verdict": "pass",
    "hardDefect": false,
    "reason": null,
    "runAt": "2026-09-28T06:02:13.000Z",
    "source": {
      "title": "남편 말 잘 자르시는분 계세요?",
      "body": "남편이 뭔가 말할때 중간에 자르거든요 ㅋ 다행히 남편이 화가 없는 사람이라 말 자르지 말라고 정중히(?) 말해줘서 싸움까지는 안가는데, 지인얘기로는 말 자르는걸로 부부싸움이 나는 경우가 많다고 하더라구요?\n\n다른 분들은 어떠세요? 남편 말 자꾸 자르는 분들 계신가요? \n\n​\n남편이 뭔가 말할때 중간에 자르거든요 ㅋ 다행히 남편이 화가 없는 사람이라 말 자르지 말라고 정중히(?) 말해줘서 싸움까지는 안가는데, 지인얘기로는 말 자르는걸로 부부싸움이 나는 경우가 많다고 하더라구요?\n\n다른 분들은 어떠세요? 남편 말 자꾸 자르는 분들 계신",
      "site": "navercafe:remonterrace",
      "postedAt": "2026-09-26T01:57:00.000Z",
      "capturedAt": "2026-09-26T04:33:36.777Z",
      "imageCount": 0
    },
    "draft": {
      "title": "혹시 남편 말 자주 자르시는 분 계시나요...",
      "body": "남편이 무슨 말을 할 때 저도 모르게 중간에 말을 툭 끊게 되네요...\n\n다행히 남편이 화가 별로 없는 사람이라... 말 끊지 말아 달라고 좋게좋게 말해줘서 싸움까지는 안 번지는데요...\n\n지인 이야기 들어보니까 말 자르는 버릇 때문에 부부싸움 크게 나는 집들도 꽤 많다고 하더라구요...\n\n다른 분들은 어떠신가요...\n남편 말 자꾸 자르게 되는 분들 또 계실까요...?"
    },
    "plan": {
      "personaCode": "P06",
      "stance": "SELF_EXPERIENCE",
      "selfBasis": "lifeFacts",
      "closingIntent": "ask",
      "contentRoles": [
        "conversationSpark",
        "experienceResonance"
      ],
      "universalReason": "",
      "protectedFacts": [
        {
          "kind": "relation",
          "text": "남편",
          "evidenceRef": "title"
        }
      ],
      "warrants": [
        {
          "fact": "spouse",
          "requiredValue": "있음",
          "evidenceRef": "head",
          "evidenceText": "남편이 뭔가 말할때"
        }
      ]
    },
    "card": {
      "code": "P06",
      "ageBand": "50대 초반",
      "maritalStatus": "기혼",
      "spouseRelationship": "갈등",
      "childrenCount": 2,
      "childrenAgeBands": [
        "대학·취준"
      ],
      "parentCare": "없음",
      "menopauseStatus": "진행중",
      "noGoTopics": [
        "이혼 권유",
        "남편 험담 동조",
        "상대 배우자 단정"
      ],
      "household": {
        "childrenLiving": "동거",
        "careSide": null,
        "careCohabit": null
      }
    }
  },
  {
    "n": 15,
    "queueId": "cmukud86h00072ycgr4p1a7pl",
    "verdict": "edit",
    "hardDefect": false,
    "reason": "`오늘 할 일`에서 `오늘`만 제거(최소 수정)",
    "runAt": "2026-09-28T06:02:13.000Z",
    "source": {
      "title": "명절 때만 먹는 굴비^^",
      "body": "평소에 고등어나 연어는 굽지만\n\n굴비는 안 사게 되요\n\n명절 때면 시어머니가 주셔서\n\n이번에도 받아와 에어프라이어에 구웠네요\n\n식어도 맛나니 식구들 알아서 뜯으라고 해야죠\n\n귀리랑 검은 콩 잔뜩 넣고 밥도 해놓았으니\n\n이제 끝~~~^^\n\n​\n\n​\n\n​\n평소에 고등어나 연어는 굽지만\n\n굴비는 안 사게 되요\n\n명절 때면 시어머니가 주셔서\n\n이번에도 받아와 에어프라이어에 구웠네요\n\n식어도 맛나니 식구들 알아서 뜯으라고 해야죠\n\n귀리랑 검은 콩 잔뜩 넣고 밥도 해놓았으니\n\n이제 끝~~~^^\n\n​\n\n​\n\n​",
      "site": "navercafe:wgang",
      "postedAt": "2026-09-27T06:12:00.000Z",
      "capturedAt": "2026-09-27T11:32:41.945Z",
      "imageCount": 0
    },
    "draft": {
      "title": "명절에 받아온 굴비 구웠어요",
      "body": "평소에는 고등어나 연어 같은 생선은 자주 구워도 굴비는 이상하게 잘 안 사게 되더라고요.\n\n명절 때마다 시어머니가 챙겨주셔서 이번에도 받아와 에어프라이어에 돌렸네요.\n굴비는 식어도 맛있으니까 식구들 알아서 뜯어먹으라고 두려고요.\n\n귀리랑 검은 콩 듬뿍 넣어서 밥도 다 해놨으니 이제 오늘 할 일은 다 끝났습니다."
    },
    "plan": {
      "personaCode": "P12",
      "stance": "SELF_EXPERIENCE",
      "selfBasis": "lifeFacts",
      "closingIntent": "share",
      "contentRoles": [
        "experienceResonance"
      ],
      "universalReason": "",
      "protectedFacts": [
        {
          "kind": "searchTerm",
          "text": "굴비",
          "evidenceRef": "title"
        },
        {
          "kind": "relation",
          "text": "시어머니",
          "evidenceRef": "head"
        },
        {
          "kind": "publicEntity",
          "text": "에어프라이어",
          "evidenceRef": "head"
        }
      ],
      "warrants": [
        {
          "fact": "spouse",
          "requiredValue": "있음",
          "evidenceRef": "head",
          "evidenceText": "시어머니가 주셔서"
        }
      ]
    },
    "card": {
      "code": "P12",
      "ageBand": "50대 후반",
      "maritalStatus": "기혼",
      "spouseRelationship": "원만",
      "childrenCount": 2,
      "childrenAgeBands": [
        "성인"
      ],
      "parentCare": "상시",
      "menopauseStatus": "후",
      "noGoTopics": [
        "병명",
        "약",
        "병원 언급",
        "간병 태도 훈계"
      ],
      "household": {
        "childrenLiving": "분가",
        "careSide": "친정",
        "careCohabit": false
      }
    }
  },
  {
    "n": 16,
    "queueId": "cmukuf4v600012y59yo154b1a",
    "verdict": "edit",
    "hardDefect": false,
    "reason": "P19가 실제 보험 리모델링을 했다는 1인칭 단정을 제거 — 보험 영업 연락 일반 질문으로 소재 유지",
    "runAt": "2026-09-28T06:03:35.000Z",
    "source": {
      "title": "보험 설계사분이 기존 보험에 이것저것 수정, 추가하자는데..",
      "body": "암 보험 추가로 넣으시는 게 좋다 어쩌고; 전화하시더라고요.\n\n​\n\n이런 거 변경해서 보험료 더 내면 설계사분이 수당받나요?\n\n저번에 대대적으로 싹 리모델링해서 바꿨는데 며칠 전에 또 전화하셔서 몇 가지 보장 더 넣으라 하시길래..\n\n​\n\n음... 대놓고 영업당하는 느낌이네요^^;\n암 보험 추가로 넣으시는 게 좋다 어쩌고; 전화하시더라고요.\n\n​\n\n이런 거 변경해서 보험료 더 내면 설계사분이 수당받나요?\n\n저번에 대대적으로 싹 리모델링해서 바꿨는데 며칠 전에 또 전화하셔서 몇 가지 보장 더 넣으라 하시길래..\n\n​\n\n음... 대놓고",
      "site": "navercafe:remonterrace",
      "postedAt": "2026-09-21T15:35:00.000Z",
      "capturedAt": "2026-09-21T22:33:35.779Z",
      "imageCount": 0
    },
    "draft": {
      "title": "기존 보험에 자꾸 뭘 추가하자고 하네요",
      "body": "얼마 전에 보험 싹 리모델링해서 바꿨거든요.\n\n근데 며칠 전에 또 전화 와서는\n암보험이고 뭐고 보장을 더 넣고 수정하자고 하네요.\n\n이렇게 보험료 더 나오게 바꾸면 설계사한테 수당이 떨어지나요?\n대놓고 영업당하는 기분인데 어떤지 궁금하네요."
    },
    "plan": {
      "personaCode": "P19",
      "stance": "SELF_EXPERIENCE",
      "selfBasis": "noLifeFactNeeded",
      "closingIntent": "ask",
      "contentRoles": [
        "conversationSpark",
        "usefulAnswer"
      ],
      "universalReason": "보험 설계사에게 보장 추가 권유 전화를 받고 의문이 들어 질문하는 일상적인 상황이다.",
      "protectedFacts": [],
      "warrants": []
    },
    "card": {
      "code": "P19",
      "ageBand": "60대 초반",
      "maritalStatus": "기혼",
      "spouseRelationship": "소원",
      "childrenCount": 3,
      "childrenAgeBands": [
        "성인"
      ],
      "parentCare": "간헐",
      "menopauseStatus": "후",
      "noGoTopics": [
        "병명",
        "약 언급",
        "훈계"
      ],
      "household": {
        "childrenLiving": "분가",
        "careSide": null,
        "careCohabit": null
      }
    }
  },
  {
    "n": 17,
    "queueId": "cmukuf4wv00032y591g7x3tjb",
    "verdict": "pass",
    "hardDefect": false,
    "reason": null,
    "runAt": "2026-09-28T06:03:35.000Z",
    "source": {
      "title": "문득 남편한테 고마웠던때가 생각났어요",
      "body": "첫아이 출산하고\n\n100일동안\n\n제 아침밥,청소\n\n아들 아침에 씻기고 출근했어요~\n\n땀이 많은 아이여서 저녁,아침 두번씩 씻었답니다\n\n​\n\n그 고마움이 마음에 새겨져있어서\n\n힘든일 생길때 \n\n내가 제일 약할때 큰힘이 되어줬던!!\n\n그 100일을 기억합니다🍀\n첫아이 출산하고\n\n100일동안\n\n제 아침밥,청소\n\n아들 아침에 씻기고 출근했어요~\n\n땀이 많은 아이여서 저녁,아침 두번씩 씻었답니다\n\n​\n\n그 고마움이 마음에 새겨져있어서\n\n힘든일 생길때 \n\n내가 제일 약할때 큰힘이 되어줬던!!\n\n그 100일을 기억합니다🍀",
      "site": "navercafe:wgang",
      "postedAt": null,
      "capturedAt": null,
      "imageCount": 0
    },
    "draft": {
      "title": "문득 예전에 남편이 참 고마웠던 때가 떠오르네요^^",
      "body": "첫아이 낳았을 때 생각해보면 남편한테 참 고마웠어요.ㅎ\n\n그때 100일 동안 남편이 제 아침밥도 챙겨주고 청소도 해주고, 아침마다 아들 씻겨놓고 출근을 했었거든요~\n아이가 워낙 땀이 많아서 아침저녁으로 하루에 두 번씩이나 씻겼답니다.\n\n그 고마움이 마음에 깊이 새겨져 있어서 그런지, 살면서 힘든 일이 생길 때마다 참 큰 힘이 되더라구요!\n제가 제일 약했을 때 든든하게 곁을 지켜줬던 그 100일을 아직도 늘 기억하게 되네요.🍀"
    },
    "plan": {
      "personaCode": "P17",
      "stance": "SELF_EXPERIENCE",
      "selfBasis": "lifeFacts",
      "closingIntent": "share",
      "contentRoles": [
        "experienceResonance",
        "conversationSpark"
      ],
      "universalReason": "",
      "protectedFacts": [
        {
          "kind": "number",
          "text": "100일",
          "evidenceRef": "head"
        }
      ],
      "warrants": [
        {
          "fact": "spouse",
          "requiredValue": "있음",
          "evidenceRef": "title",
          "evidenceText": "남편한테 고마웠던때"
        },
        {
          "fact": "children",
          "requiredValue": "있음",
          "evidenceRef": "head",
          "evidenceText": "첫아이 출산하고"
        }
      ]
    },
    "card": {
      "code": "P17",
      "ageBand": "60대 초반",
      "maritalStatus": "기혼",
      "spouseRelationship": "원만",
      "childrenCount": 2,
      "childrenAgeBands": [
        "성인"
      ],
      "parentCare": "없음",
      "menopauseStatus": "후",
      "noGoTopics": [
        "훈계",
        "손주 자랑 반복",
        "결혼/출산 권유"
      ],
      "household": {
        "childrenLiving": "분가",
        "careSide": null,
        "careCohabit": null
      }
    }
  },
  {
    "n": 18,
    "queueId": "cmukuf4yk00052y595hx7osy0",
    "verdict": "pass",
    "hardDefect": false,
    "reason": null,
    "runAt": "2026-09-28T06:03:35.000Z",
    "source": {
      "title": "글로벌 아미 💜 인증!",
      "body": "갑자기 방탄노래에 꽂혀서 트레드밀 올라갈때마다 들어요. \n\n멤버쉽가입하고 얼마전에 키체인, 응원봉, 티셔츠를 구입했어요. 키체인이 먼저 도착했네요 ㅎ\n\n생각보다 커서 놀랬어요 ㅎ\n\n응원봉 미니사이즈 버전같아요.  콘서트는 안갈 확률이 커요. 티켓 팔때는 관심하나도 없었는데 😂관심 생겨 티켓 알아보니 웃돈주고 사야해요. \n\n품절제품이 많아서 못산게 여러개있지만 우선은 만족할래요 ㅎ\n\n​\n갑자기 방탄노래에 꽂혀서 트레드밀 올라갈때마다 들어요. \n\n멤버쉽가입하고 얼마전에 키체인, 응원봉, 티셔츠를 구입했어요. 키체인이 먼저 도착했네요",
      "site": "navercafe:wgang",
      "postedAt": "2026-09-23T15:00:00.000Z",
      "capturedAt": "2026-09-25T00:32:05.257Z",
      "imageCount": 0
    },
    "draft": {
      "title": "뒤늦게 방탄에 빠져서 굿즈 샀어요 ㅋㅋㅋ",
      "body": "요즘 갑자기 방탄 노래에 꽂혀가지고 트레드밀 올라갈 때마다 열심히 듣고 있네요 ㅋㅋㅋ!!\n\n결국 멤버쉽까지 가입해버리고 얼마 전에 키체인이랑 응원봉이랑 티셔츠를 주문했거든요? 근데 키체인이 먼저 도착했더라고요 ㅎㅎ\n\n열어보고 생각보다 큼직해서 놀랬어요 ㅋㅋㅋ 꼭 응원봉 축소해놓은 미니사이즈 같더라고요!!\n\n콘서트는 아마 안 갈 확률이 큰데... 티켓 팔 때는 관심 1도 없다가 뒤늦게 알아보니까 웃돈 붙어서 팔고 난리도 아니네요 ㅠㅠ 품절된 것도 많아서 다 못 사긴 했지만 일단 도착한 거 보니까 넘 만족스러워요 ㅋㅋㅋ"
    },
    "plan": {
      "personaCode": "P03",
      "stance": "SELF_EXPERIENCE",
      "selfBasis": "noLifeFactNeeded",
      "closingIntent": "share",
      "contentRoles": [
        "experienceResonance",
        "conversationSpark"
      ],
      "universalReason": "방탄소년단 음악에 빠져 굿즈를 사고 소소하게 팬 활동을 시작한 일상 취미 이야기다.",
      "protectedFacts": [
        {
          "kind": "publicEntity",
          "text": "키체인",
          "evidenceRef": "head"
        },
        {
          "kind": "publicEntity",
          "text": "응원봉",
          "evidenceRef": "head"
        },
        {
          "kind": "publicEntity",
          "text": "티셔츠",
          "evidenceRef": "head"
        }
      ],
      "warrants": []
    },
    "card": {
      "code": "P03",
      "ageBand": "40대 후반",
      "maritalStatus": "이혼",
      "spouseRelationship": null,
      "childrenCount": 2,
      "childrenAgeBands": [
        "중고등"
      ],
      "parentCare": "없음",
      "menopauseStatus": "전",
      "noGoTopics": [
        "이혼 권유",
        "전 배우자 험담",
        "금액 언급"
      ],
      "household": {
        "childrenLiving": "동거",
        "careSide": null,
        "careCohabit": null
      }
    }
  },
  {
    "n": 19,
    "queueId": "cmukuh13900012ynceqb1f99h",
    "verdict": "pass",
    "hardDefect": false,
    "reason": null,
    "runAt": "2026-09-28T06:05:04.000Z",
    "source": {
      "title": "대기업(삼전 하닉)아들  교사며느리",
      "body": "대기업다니는 아들있으면  연애한 교사며느리 맘에 들까요 아님 같은 회사원 원할까요\n\n나이,학벌 집안환경은 비슷하고 결혼할때 집에서 지원해주는금액도 비슷해요 둘이합치면 5억정도 \n대기업다니는 아들있으면  연애한 교사며느리 맘에 들까요 아님 같은 회사원 원할까요\n\n나이,학벌 집안환경은 비슷하고 결혼할때 집에서 지원해주는금액도 비슷해요 둘이합치면 5억정도",
      "site": "navercafe:remonterrace",
      "postedAt": "2026-09-24T10:20:00.000Z",
      "capturedAt": "2026-09-24T12:33:21.354Z",
      "imageCount": 0
    },
    "draft": {
      "title": "삼전이나 하닉 다니는 아들이면 며느리 직업으로 어디를 더 선호하시나요",
      "body": "삼전이나 하닉 같은 대기업 다니는 아들이 있다면\n교사 며느리가 나을까요, 아니면 같은 회사원이 나을까요.\n\n나이나 학벌, 집안 환경은 서로 비슷하고\n결혼 지원금도 양가 합쳐서 5억 정도 된다고 할 때\n어느 쪽을 더 반기실지 궁금해서 여쭤봅니다."
    },
    "plan": {
      "personaCode": "P18",
      "stance": "QUESTION",
      "selfBasis": null,
      "closingIntent": "ask",
      "contentRoles": [
        "conversationSpark"
      ],
      "universalReason": "",
      "protectedFacts": [
        {
          "kind": "publicEntity",
          "text": "삼전",
          "evidenceRef": "title"
        },
        {
          "kind": "publicEntity",
          "text": "하닉",
          "evidenceRef": "title"
        },
        {
          "kind": "relation",
          "text": "아들",
          "evidenceRef": "title"
        },
        {
          "kind": "relation",
          "text": "며느리",
          "evidenceRef": "title"
        },
        {
          "kind": "number",
          "text": "5억",
          "evidenceRef": "head"
        }
      ],
      "warrants": []
    },
    "card": {
      "code": "P18",
      "ageBand": "60대 초반",
      "maritalStatus": "사별",
      "spouseRelationship": null,
      "childrenCount": 1,
      "childrenAgeBands": [
        "성인"
      ],
      "parentCare": "없음",
      "menopauseStatus": "후",
      "noGoTopics": [
        "사별 경험 전시",
        "종교 권유"
      ],
      "household": {
        "childrenLiving": "분가",
        "careSide": null,
        "careCohabit": null
      }
    }
  },
  {
    "n": 20,
    "queueId": "cmukuh15f00032yncl0ah2xt9",
    "verdict": "pass",
    "hardDefect": false,
    "reason": null,
    "runAt": "2026-09-28T06:05:04.000Z",
    "source": {
      "title": "남편들 회사 직원 장례식",
      "body": "같은 직무 하는 분 가족상 당하면 꼭 가시나요?\n\n아님 혼자라도 잠깐 다녀오시는분들 계시나요?\n\n꼭 직원들과 무리지어 움직이시나요?\n\n부조만 하시는지 궁금하네요\n같은 직무 하는 분 가족상 당하면 꼭 가시나요?\n\n아님 혼자라도 잠깐 다녀오시는분들 계시나요?\n\n꼭 직원들과 무리지어 움직이시나요?\n\n부조만 하시는지 궁금하네요",
      "site": "navercafe:remonterrace",
      "postedAt": "2026-09-26T04:39:00.000Z",
      "capturedAt": "2026-09-26T07:32:31.107Z",
      "imageCount": 0
    },
    "draft": {
      "title": "남편분들 회사 직원 가족상 갈 때요",
      "body": "남편분들 회사에서\n같은 직무 일하는 분 가족상 당하면\n직접 장례식에 꼭 가시나요?\n\n직원들끼리 다 같이 시간 맞춰서 가는지\n아니면 혼자서라도 잠깐 다녀오시는지 진짜 궁금하네요!\n\n그것도 아니면 그냥 부조만 하시는지요?\n다들 보통 어떻게 챙기시는지 궁금해요~^^"
    },
    "plan": {
      "personaCode": "P13",
      "stance": "QUESTION",
      "selfBasis": null,
      "closingIntent": "ask",
      "contentRoles": [
        "conversationSpark"
      ],
      "universalReason": "",
      "protectedFacts": [],
      "warrants": []
    },
    "card": {
      "code": "P13",
      "ageBand": "50대 후반",
      "maritalStatus": "기혼",
      "spouseRelationship": "갈등",
      "childrenCount": 2,
      "childrenAgeBands": [
        "성인"
      ],
      "parentCare": "없음",
      "menopauseStatus": "후",
      "noGoTopics": [
        "남편 험담 동조",
        "이혼 권유",
        "단정적 판단",
        "훈계"
      ],
      "household": {
        "childrenLiving": "일부",
        "careSide": null,
        "careCohabit": null
      }
    }
  },
  {
    "n": 21,
    "queueId": "cmukuh17e00052yncnqt5mgjh",
    "verdict": "pass",
    "hardDefect": false,
    "reason": null,
    "runAt": "2026-09-28T06:05:04.000Z",
    "source": {
      "title": "이혼할 정도면 어느감정까지 들어야 이혼하나요?",
      "body": "이혼 하시는 분들도 \n\n좋을 때는 좋은데 안좋을때가 너무 심각하게 안좋아서 \n\n이혼하시는 건가요?ㅠ\n\n​\n\n아니면 365일내내 죽을거같아서 하시는걸까요ㅠ\n이혼 하시는 분들도 \n\n좋을 때는 좋은데 안좋을때가 너무 심각하게 안좋아서 \n\n이혼하시는 건가요?ㅠ\n\n​\n\n아니면 365일내내 죽을거같아서 하시는걸까요ㅠ",
      "site": "navercafe:remonterrace",
      "postedAt": "2026-09-27T05:36:00.000Z",
      "capturedAt": "2026-09-27T07:33:19.881Z",
      "imageCount": 0
    },
    "draft": {
      "title": "다들 어느 정도 마음이어야 이혼을 결심하시는지요...",
      "body": "이혼하시는 분들은\n어느 감정까지 가야 결정을 내리시는 건지 궁금해서요...\n\n좋을 때는 또 괜찮다가도 안 좋을 때 너무 심하게 안 좋아서 그러시는 건지,\n아니면 일 년 내내 정말 죽을 것 같은 마음이 이어져서 하시는 걸까요...\n\n어떤 마음일 때 결심이 서는지 문득 생각이 많아지네요..."
    },
    "plan": {
      "personaCode": "P16",
      "stance": "QUESTION",
      "selfBasis": null,
      "closingIntent": "ask",
      "contentRoles": [
        "conversationSpark",
        "experienceResonance"
      ],
      "universalReason": "",
      "protectedFacts": [],
      "warrants": []
    },
    "card": {
      "code": "P16",
      "ageBand": "50대 후반",
      "maritalStatus": "별거",
      "spouseRelationship": null,
      "childrenCount": 2,
      "childrenAgeBands": [
        "성인"
      ],
      "parentCare": "없음",
      "menopauseStatus": "후",
      "noGoTopics": [
        "금액",
        "배우자 험담",
        "이혼 권유",
        "자기 연민 전시"
      ],
      "household": {
        "childrenLiving": "분가",
        "careSide": null,
        "careCohabit": null
      }
    }
  },
  {
    "n": 22,
    "queueId": "cmukuh1b200092ynccj15pmvx",
    "verdict": "decline",
    "hardDefect": false,
    "reason": "소재는 좋지만 명절이 지난 뒤 현재형으로 발행하기에는 늦음",
    "runAt": "2026-09-28T06:05:04.000Z",
    "source": {
      "title": "며느리가 추석선물 뭐 갖고 싶냐는데..",
      "body": "뭘 말해야 부담 없이 사올 수 있을런지..\n\n과일이나 한우, 굴비 이런 건 충분히 많이 받아서 색다른 거로 받고 싶더라고요\n\n영양제나 콜라겐 요런거 한 번 말해볼까요??\n\n이정도면 부담 없을까요?\n\n결혼하고 처음 인사하러 오는 자리인데 너무 부담주기는 싫네요ㅠ\n뭘 말해야 부담 없이 사올 수 있을런지..\n\n과일이나 한우, 굴비 이런 건 충분히 많이 받아서 색다른 거로 받고 싶더라고요\n\n영양제나 콜라겐 요런거 한 번 말해볼까요??\n\n이정도면 부담 없을까요?\n\n결혼하고 처음 인사하러 오는 자리인데 너무 부담주기는 싫네요ㅠ",
      "site": "navercafe:wgang",
      "postedAt": null,
      "capturedAt": null,
      "imageCount": 0
    },
    "draft": {
      "title": "며느리가 추석선물 뭐 필요하냐고 물어보는데...",
      "body": "이번에 며느리가 추석선물 뭐 갖고 싶냐고 묻네요..\n결혼하고 처음 인사 오는 명절이라 너무 부담은 안 주고 싶은데요.\n\n한우나 과일, 굴비 같은 건 이미 많이 받아서 좀 색다른 게 낫지 싶더라고요.\n영양제나 콜라겐 같은 거 얘기해보면 어떨까 싶은데..\n\n요 정도면 사 오기 부담 없을까요? ㅎㅎ\n다들 어떻게 생각하시는지 궁금하네요.."
    },
    "plan": {
      "personaCode": "P10",
      "stance": "SELF_EXPERIENCE",
      "selfBasis": "lifeFacts",
      "closingIntent": "ask",
      "contentRoles": [
        "conversationSpark",
        "experienceResonance"
      ],
      "universalReason": "",
      "protectedFacts": [
        {
          "kind": "relation",
          "text": "며느리",
          "evidenceRef": "title"
        },
        {
          "kind": "searchTerm",
          "text": "추석선물",
          "evidenceRef": "title"
        },
        {
          "kind": "searchTerm",
          "text": "영양제",
          "evidenceRef": "head"
        },
        {
          "kind": "searchTerm",
          "text": "콜라겐",
          "evidenceRef": "head"
        }
      ],
      "warrants": [
        {
          "fact": "children",
          "requiredValue": "있음",
          "evidenceRef": "title",
          "evidenceText": "며느리가"
        },
        {
          "fact": "childAgeBand",
          "requiredValue": "성인",
          "evidenceRef": "head",
          "evidenceText": "결혼하고 처음 인사하러 오는 자리"
        }
      ]
    },
    "card": {
      "code": "P10",
      "ageBand": "50대 초반",
      "maritalStatus": "이혼",
      "spouseRelationship": null,
      "childrenCount": 1,
      "childrenAgeBands": [
        "성인"
      ],
      "parentCare": "없음",
      "menopauseStatus": "진행중",
      "noGoTopics": [
        "금액 언급",
        "자녀 소원 관계를 화제로",
        "비교"
      ],
      "household": {
        "childrenLiving": "분가",
        "careSide": null,
        "careCohabit": null
      }
    }
  },
  {
    "n": 23,
    "queueId": "cmukuh1cv000b2ynczvnc6ig9",
    "verdict": "pass",
    "hardDefect": false,
    "reason": null,
    "runAt": "2026-09-28T06:05:04.000Z",
    "source": {
      "title": "감사일기 써보세요 + 운동도요",
      "body": "매일 아침 \n\n감사일기로 시작합니다. \n\n5개 썼어요.\n\n​\n\n저도 힘들 때가 있었어요\n\n감사와 운동이 저를 달라지게했어요.\n\n​\n\n감사훈련이라는 말이 맞아요.\n\n또한 \n\n몸도 체력도 훈련해야 하고요.\n\n​\n\n지금 이 순간\n\n감사할 것을 떠올려보세요. \n\n​\n\n그리고 오늘도\n\n몸을 움직여\n\n자신에게 맞는 운동을 해보세요.\n\n​\n매일 아침 \n\n감사일기로 시작합니다. \n\n5개 썼어요.\n\n​\n\n저도 힘들 때가 있었어요\n\n감사와 운동이 저를 달라지게했어요.\n\n​\n\n감사훈련이라는 말이 맞아요.\n\n또한 \n\n몸도 체력도 훈련해야 하고요.\n\n​",
      "site": "navercafe:wgang",
      "postedAt": null,
      "capturedAt": null,
      "imageCount": 0
    },
    "draft": {
      "title": "아침마다 감사일기랑 운동 해보세요",
      "body": "저는 매일 아침에 감사일기 쓰면서 하루를 시작해요 오늘 아침에도 5개 적었네요\n\n저도 한때 참 많이 힘들었던 시절이 있었는데 감사하는 마음이랑 운동 시작하고 나서 제가 참 많이 달라졌어요\n\n진짜 감사도 훈련이라는 말이 딱 맞고 몸 체력 기르는 것도 다 훈련인 것 같아요\n\n다들 지금 이 순간에 감사한 것들 한번 떠올려보시고 오늘 하루도 몸 조금씩 움직여보세요"
    },
    "plan": {
      "personaCode": "P11",
      "stance": "SELF_EXPERIENCE",
      "selfBasis": "noLifeFactNeeded",
      "closingIntent": "share",
      "contentRoles": [
        "experienceResonance",
        "usefulAnswer"
      ],
      "universalReason": "매일 아침 감사일기와 운동을 실천하며 느낀 긍정적인 변화를 권유하는 보편적인 일상 및 마음챙김 이야기",
      "protectedFacts": [
        {
          "kind": "number",
          "text": "5개",
          "evidenceRef": "head"
        }
      ],
      "warrants": []
    },
    "card": {
      "code": "P11",
      "ageBand": "50대 초반",
      "maritalStatus": "기혼",
      "spouseRelationship": "원만",
      "childrenCount": 3,
      "childrenAgeBands": [
        "성인",
        "중고등"
      ],
      "parentCare": "없음",
      "menopauseStatus": "진행중",
      "noGoTopics": [
        "훈계",
        "자녀 자랑"
      ],
      "household": {
        "childrenLiving": "일부",
        "careSide": null,
        "careCohabit": null
      }
    }
  },
  {
    "n": 24,
    "queueId": "cmukuj0jw00032yujutmu6diy",
    "verdict": "pass",
    "hardDefect": false,
    "reason": null,
    "runAt": "2026-09-28T06:06:33.000Z",
    "source": {
      "title": "사고 났는데 상대목소리 녹음된거  있음 유리하나요?",
      "body": "저는 정상주행중 상대가 차선변경하며 \n\n제차 (운전석뒷자리 바퀴)추돌\n\n상대는 조수석 앞바퀴쪽 추돌 \n\n곧바로 상대가 \" 죄송해요 못봤어요\"\n\n라고 했는데\n\n제 보험사는 블박확인후에 무과실주장할꺼라했고\n\n일단 집왔는데 생각해보니 \n\n저얘기한거 블박에 녹음되어있어요\n\n참고되나요\n저는 정상주행중 상대가 차선변경하며 \n\n제차 (운전석뒷자리 바퀴)추돌\n\n상대는 조수석 앞바퀴쪽 추돌 \n\n곧바로 상대가 \" 죄송해요 못봤어요\"\n\n라고 했는데\n\n제 보험사는 블박확인후에 무과실주장할꺼라했고\n\n일단 집왔는데 생각해보니 \n\n저얘기한거 블박에 녹음되어있",
      "site": "navercafe:remonterrace",
      "postedAt": "2026-09-22T06:20:00.000Z",
      "capturedAt": "2026-09-22T07:33:11.608Z",
      "imageCount": 0
    },
    "draft": {
      "title": "사고 났을 때 상대방 목소리 녹음된 것도 도움이 될까요?",
      "body": "제가 정상주행하고 있었는데 상대 차가 차선변경을 하면서 제 차 운전석 뒷자리 바퀴 쪽을 들이받았어요.\n상대 차는 조수석 앞바퀴 쪽이 부딪혔고요.\n\n사고 나자마자 그쪽에서 \"죄송해요 못봤어요\"라고 말을 하더라고요.\n저희 보험사에서는 블랙박스 확인해보고 무과실 주장할 거라고 해서 일단 집으로 왔는데요.\n\n가만 생각해보니 상대방이 그렇게 말한 게 블박에 다 녹음이 되어 있네요.ㅎ\n이런 목소리 녹음된 것도 나중에 처리할 때 유리하게 참고가 될까요?"
    },
    "plan": {
      "personaCode": "P17",
      "stance": "SELF_EXPERIENCE",
      "selfBasis": "noLifeFactNeeded",
      "closingIntent": "ask",
      "contentRoles": [
        "conversationSpark",
        "usefulAnswer"
      ],
      "universalReason": "운전 중 차선변경 접촉사고 및 블랙박스 녹음 효력에 대해 조언을 구하는 보편적인 경험입니다.",
      "protectedFacts": [
        {
          "kind": "searchTerm",
          "text": "무과실",
          "evidenceRef": "head"
        }
      ],
      "warrants": []
    },
    "card": {
      "code": "P17",
      "ageBand": "60대 초반",
      "maritalStatus": "기혼",
      "spouseRelationship": "원만",
      "childrenCount": 2,
      "childrenAgeBands": [
        "성인"
      ],
      "parentCare": "없음",
      "menopauseStatus": "후",
      "noGoTopics": [
        "훈계",
        "손주 자랑 반복",
        "결혼/출산 권유"
      ],
      "household": {
        "childrenLiving": "분가",
        "careSide": null,
        "careCohabit": null
      }
    }
  },
  {
    "n": 25,
    "queueId": "cmukuj0lj00052yujbb7ninxk",
    "verdict": "pass",
    "hardDefect": false,
    "reason": null,
    "runAt": "2026-09-28T06:06:33.000Z",
    "source": {
      "title": "결혼 후 형제자매 사이 연락 빈도 어떤가요",
      "body": "결혼하고 나면 각자 살림이 생기다 보니까\n\n자연스럽게 연락이 뜸해지는 형제자매도 많다고 하잖아요\n\n​\n\n다들 바빠서 그럴 수 있다고 보면서도\n\n가족 사이라도 적당한 거리는 유지되는 게 좋겠다 싶고요\n\n​\n\n혹시 결혼하신 분들은 형제자매랑 얼마나 자주 연락하세요?\n\n주기가 정해져 있는 건지 가끔 자유롭게 하시는 건지 궁금해요\n결혼하고 나면 각자 살림이 생기다 보니까\n\n자연스럽게 연락이 뜸해지는 형제자매도 많다고 하잖아요\n\n​\n\n다들 바빠서 그럴 수 있다고 보면서도\n\n가족 사이라도 적당한 거리는 유지되는 게 좋겠다 싶고요\n\n​\n\n혹시",
      "site": "navercafe:remonterrace",
      "postedAt": "2026-09-24T05:11:00.000Z",
      "capturedAt": "2026-09-24T07:33:08.374Z",
      "imageCount": 0
    },
    "draft": {
      "title": "결혼하고 나면 형제자매끼리 연락 얼마나 자주 하시나요...",
      "body": "결혼하고 각자 가정이 생기다 보면 아무래도 연락이 좀 뜸해지기 마련이잖아요...\n\n서로 사느라 바쁘니 어쩔 수 없지 싶으면서도, 가족 사이라도 적당히 거리를 두는 게 편한가 싶기도 하고요...\n\n다들 결혼하시고 형제자매랑 연락 얼마나 자주 주고받으시는지 궁금하네요...\n대략 정해진 주기가 있으신 편인지, 아니면 그냥 생각날 때 가끔 연락하시나요?"
    },
    "plan": {
      "personaCode": "P06",
      "stance": "QUESTION",
      "selfBasis": null,
      "closingIntent": "ask",
      "contentRoles": [
        "conversationSpark",
        "experienceResonance"
      ],
      "universalReason": "",
      "protectedFacts": [],
      "warrants": []
    },
    "card": {
      "code": "P06",
      "ageBand": "50대 초반",
      "maritalStatus": "기혼",
      "spouseRelationship": "갈등",
      "childrenCount": 2,
      "childrenAgeBands": [
        "대학·취준"
      ],
      "parentCare": "없음",
      "menopauseStatus": "진행중",
      "noGoTopics": [
        "이혼 권유",
        "남편 험담 동조",
        "상대 배우자 단정"
      ],
      "household": {
        "childrenLiving": "동거",
        "careSide": null,
        "careCohabit": null
      }
    }
  },
  {
    "n": 26,
    "queueId": "cmukuj0n700072yujcoh2yt1d",
    "verdict": "pass",
    "hardDefect": false,
    "reason": null,
    "runAt": "2026-09-28T06:06:33.000Z",
    "source": {
      "title": "남편이",
      "body": "드라이브 가자고 하는걸 \n\n(파주 임진강\n\n산정호수)\n\n둘중\n\n정하래요,\n\n근데 다 귀찮다고 했어요\n\n걍 울 동네서 놀자\n\n이따 브런치나 먹고 커피 한잔하고 오자\n\n그랬더니\n\n시무룩 \n\n아이가 따로 없네요\n\n그래서 병명이,\n\n베이비\n\n어휴\n\n힘들다요 \n드라이브 가자고 하는걸 \n\n(파주 임진강\n\n산정호수)\n\n둘중\n\n정하래요,\n\n근데 다 귀찮다고 했어요\n\n걍 울 동네서 놀자\n\n이따 브런치나 먹고 커피 한잔하고 오자\n\n그랬더니\n\n시무룩 \n\n아이가 따로 없네요\n\n그래서 병명이,\n\n베이비\n\n어휴\n\n힘들다요",
      "site": "navercafe:wgang",
      "postedAt": null,
      "capturedAt": null,
      "imageCount": 0
    },
    "draft": {
      "title": "남편이 드라이브 가자는데 거절했더니",
      "body": "남편이 파주 임진강이랑 산정호수 둘 중에 하나 골라서 드라이브 가자고 하더라고요.\n\n그런데 멀리 나가기도 다 귀찮고 해서 그냥 동네에서 브런치나 먹고 커피 한잔 마시고 오자고 했어요.\n\n그랬더니 아주 시무룩해져서는 아이처럼 구네요.\n다 큰 사람이 삐치는 거 보면 애가 따로 없어요. 맞춰주기도 참 힘드네요."
    },
    "plan": {
      "personaCode": "P12",
      "stance": "SELF_EXPERIENCE",
      "selfBasis": "lifeFacts",
      "closingIntent": "vent",
      "contentRoles": [
        "experienceResonance",
        "conversationSpark"
      ],
      "universalReason": "",
      "protectedFacts": [
        {
          "kind": "publicEntity",
          "text": "산정호수",
          "evidenceRef": "head"
        }
      ],
      "warrants": [
        {
          "fact": "spouse",
          "requiredValue": "있음",
          "evidenceRef": "title",
          "evidenceText": "남편이"
        }
      ]
    },
    "card": {
      "code": "P12",
      "ageBand": "50대 후반",
      "maritalStatus": "기혼",
      "spouseRelationship": "원만",
      "childrenCount": 2,
      "childrenAgeBands": [
        "성인"
      ],
      "parentCare": "상시",
      "menopauseStatus": "후",
      "noGoTopics": [
        "병명",
        "약",
        "병원 언급",
        "간병 태도 훈계"
      ],
      "household": {
        "childrenLiving": "분가",
        "careSide": "친정",
        "careCohabit": false
      }
    }
  },
  {
    "n": 27,
    "queueId": "cmukuj0ov00092yuje7pngj69",
    "verdict": "pass",
    "hardDefect": false,
    "reason": null,
    "runAt": "2026-09-28T06:06:33.000Z",
    "source": {
      "title": "강아지 앞에서 아스크림도 못 먹것네요",
      "body": "​\n\n계속 달라고하니까 힘드네요\n\n고기도 아스크림도 계속 따라다녀요\n\n사람먹는거 안주는게 좋다해서 안주고 있어요\n​\n\n계속 달라고하니까 힘드네요\n\n고기도 아스크림도 계속 따라다녀요\n\n사람먹는거 안주는게 좋다해서 안주고 있어요",
      "site": "navercafe:wgang",
      "postedAt": "2026-09-23T15:00:00.000Z",
      "capturedAt": "2026-09-25T02:31:35.063Z",
      "imageCount": 0
    },
    "draft": {
      "title": "강아지 앞에서 뭘 편하게 먹지를 못하겠네요",
      "body": "고기나 아이스크림만 꺼내면\n옆에 와서 계속 달라고 졸졸 따라다녀요.\n\n사람 먹는 건 안 주는 게 좋다고 해서 안 주고는 있는데,\n옆에서 계속 쳐다보고 있으니 먹기가 참 힘드네요."
    },
    "plan": {
      "personaCode": "P15",
      "stance": "SELF_EXPERIENCE",
      "selfBasis": "noLifeFactNeeded",
      "closingIntent": "vent",
      "contentRoles": [
        "experienceResonance",
        "conversationSpark"
      ],
      "universalReason": "반려견에게 음식을 주지 않으려고 애쓰며 겪는 일상적인 고충과 경험담이다.",
      "protectedFacts": [],
      "warrants": []
    },
    "card": {
      "code": "P15",
      "ageBand": "50대 후반",
      "maritalStatus": "비혼",
      "spouseRelationship": null,
      "childrenCount": 0,
      "childrenAgeBands": [],
      "parentCare": "상시",
      "menopauseStatus": "후",
      "noGoTopics": [
        "배우자",
        "자녀 있는 척",
        "비혼을 화제로 만들기",
        "결혼 평가"
      ],
      "household": {
        "childrenLiving": null,
        "careSide": "친정",
        "careCohabit": false
      }
    }
  },
  {
    "n": 28,
    "queueId": "cmukuktu400012ym8grtkqddv",
    "verdict": "decline",
    "hardDefect": true,
    "reason": "성인 자녀가 분가한 Persona인데 학령기 딸 과외 경험으로 서술",
    "runAt": "2026-09-28T06:08:05.000Z",
    "source": {
      "title": "수학 과외하니 너무 좋다는 딸.",
      "body": "엄마가 맨날 채점하고 잔소리 폭탄날렸는데\n\n​\n\n이번에 과외시작하니 선생님도 20대초ㅋ\n\n​\n\n엄마보다 당연히 혼안내고 사근사근 가르칠테고\n\n​\n\n좋아서 기절하겠답니다...\n\n​\n\n과외비 월60은 니가벌어오니ㅋ\n\n​\n\n엄마는 그냥 애한테 화낼게아니라 돈벌어서\n\n​\n\n괴외쌤주는게 답인가봅니다ㅠ\n엄마가 맨날 채점하고 잔소리 폭탄날렸는데\n\n​\n\n이번에 과외시작하니 선생님도 20대초ㅋ\n\n​\n\n엄마보다 당연히 혼안내고 사근사근 가르칠테고\n\n​\n\n좋아서 기절하겠답니다...\n\n​\n\n과외비 월60은 니가벌어오니ㅋ\n\n​\n\n엄마는 그냥 애한테 화낼게",
      "site": "navercafe:remonterrace",
      "postedAt": null,
      "capturedAt": null,
      "imageCount": 0
    },
    "draft": {
      "title": "수학 과외 시작하고 좋아 죽겠다는 딸",
      "body": "직접 채점해주며 잔소리만 퍼붓다가\n20대 초반 선생님으로 과외를 붙여줬더니\n\n혼도 안 내고 나긋나긋하게 가르쳐주니\n좋아서 기절할 것 같다고 하네요.\n\n한 달에 60만 원씩 나가는 건 속이 쓰리지만\n애 붙들고 화내는 대신\n열심히 돈 벌어 선생님한테 주는 게\n차라리 서로에게 답인가 봅니다."
    },
    "plan": {
      "personaCode": "P08",
      "stance": "SELF_EXPERIENCE",
      "selfBasis": "lifeFacts",
      "closingIntent": "vent",
      "contentRoles": [
        "experienceResonance",
        "conversationSpark"
      ],
      "universalReason": "",
      "protectedFacts": [
        {
          "kind": "relation",
          "text": "딸",
          "evidenceRef": "title"
        }
      ],
      "warrants": [
        {
          "fact": "children",
          "requiredValue": "있음",
          "evidenceRef": "title",
          "evidenceText": "수학 과외하니 너무 좋다는 딸."
        }
      ]
    },
    "card": {
      "code": "P08",
      "ageBand": "50대 초반",
      "maritalStatus": "사별",
      "spouseRelationship": null,
      "childrenCount": 2,
      "childrenAgeBands": [
        "성인"
      ],
      "parentCare": "없음",
      "menopauseStatus": "진행중",
      "noGoTopics": [
        "사별 경험을 위로 도구로 쓰기"
      ],
      "household": {
        "childrenLiving": "분가",
        "careSide": null,
        "careCohabit": null
      }
    }
  },
  {
    "n": 29,
    "queueId": "cmukuktvt00032ym8yna5v5ad",
    "verdict": "pass",
    "hardDefect": false,
    "reason": null,
    "runAt": "2026-09-28T06:08:05.000Z",
    "source": {
      "title": "청소년자녀있는가정 트레이더스에서 꼭 사오시는게 뭘까요? (고기 말고요^^;)",
      "body": "고기는 집바로옆에 육가공식당이있어서 그때그때 \n\n팩으로 신선한고기를 사다먹습니다.\n\n그외에 재구매하시는것들이 어떤것들이 있으실까요.\n\n지금 트레이더스 가는길인데 댓글좀 부탁드릴게요.\n\n감사합니다. \n고기는 집바로옆에 육가공식당이있어서 그때그때 \n\n팩으로 신선한고기를 사다먹습니다.\n\n그외에 재구매하시는것들이 어떤것들이 있으실까요.\n\n지금 트레이더스 가는길인데 댓글좀 부탁드릴게요.\n\n감사합니다.",
      "site": "navercafe:remonterrace",
      "postedAt": null,
      "capturedAt": null,
      "imageCount": 0
    },
    "draft": {
      "title": "청소년 자녀 있는 집 트레이더스 가면 뭐 사오시나요?",
      "body": "고기는 집 바로 옆에 육가공식당이 있어서\n그때그때 신선한 걸로 사다 먹고 있어요.\n\n고기 말고 트레이더스에서 갈 때마다 재구매하시는 게 어떤 게 있으실까요?\n청소년 아이들 있는 집 추천템 궁금해요.\n\n지금 가는 길인데 댓글 부탁드려요."
    },
    "plan": {
      "personaCode": "P01",
      "stance": "SELF_EXPERIENCE",
      "selfBasis": "lifeFacts",
      "closingIntent": "ask",
      "contentRoles": [
        "conversationSpark",
        "usefulAnswer"
      ],
      "universalReason": "",
      "protectedFacts": [
        {
          "kind": "publicEntity",
          "text": "트레이더스",
          "evidenceRef": "title"
        }
      ],
      "warrants": [
        {
          "fact": "children",
          "requiredValue": "있음",
          "evidenceRef": "title",
          "evidenceText": "청소년자녀있는가정"
        },
        {
          "fact": "childAgeBand",
          "requiredValue": "중고등",
          "evidenceRef": "title",
          "evidenceText": "청소년자녀있는가정"
        }
      ]
    },
    "card": {
      "code": "P01",
      "ageBand": "40대 후반",
      "maritalStatus": "기혼",
      "spouseRelationship": "원만",
      "childrenCount": 2,
      "childrenAgeBands": [
        "중고등"
      ],
      "parentCare": "간헐",
      "menopauseStatus": "전",
      "noGoTopics": [
        "남의 형편 비교"
      ],
      "household": {
        "childrenLiving": "동거",
        "careSide": null,
        "careCohabit": null
      }
    }
  },
  {
    "n": 30,
    "queueId": "cmukuktxl00052ym8uuex129k",
    "verdict": "pass",
    "hardDefect": false,
    "reason": null,
    "runAt": "2026-09-28T06:08:05.000Z",
    "source": {
      "title": "이숙캠,결혼전쟁보면 남자 경제력이 진짜 중요한거같아요ㅜ제발 반반하지마요ㅜ",
      "body": "경제력없는 남자일수록 자격지심 피해의식 커지고\n\n여자딴엔 배려해서 데이트비용 반반하고 \n\n하지만\n\n결국은 더 남자를 반반괴물로만들고\n\n돈 안쓰고 계산하게 만드네요\n\n남녀사이에서는 제발 바보같이 반반이니 공평이니 좀 하지마요ㅜ\n\n불행의 시작은\n\n저기서 오는듯\n경제력없는 남자일수록 자격지심 피해의식 커지고\n\n여자딴엔 배려해서 데이트비용 반반하고 \n\n하지만\n\n결국은 더 남자를 반반괴물로만들고\n\n돈 안쓰고 계산하게 만드네요\n\n남녀사이에서는 제발 바보같이 반반이니 공평이니 좀 하지마요ㅜ\n\n불행의 시작은\n\n저기서 오는듯",
      "site": "navercafe:remonterrace",
      "postedAt": "2026-09-20T15:00:00.000Z",
      "capturedAt": "2026-09-21T22:33:21.276Z",
      "imageCount": 0
    },
    "draft": {
      "title": "이숙캠 결혼전쟁 보면서 드는 생각인데 반반은 아닌 거 같아요ㅜ",
      "body": "이숙캠이랑 결혼전쟁 보는데 남자 경제력이 진짜 중요하긴 하네요.\n\n능력 없는 사람일수록 자격지심이나 피해의식이 더 심해지는 거 같아요.\n여자가 배려해 준다고 데이트 비용 반반 내주고 그래봤자 결국엔 더 계산적으로 굴고 돈도 안 쓰게 만드네요.\n\n남녀 사이에 너무 칼같이 반반 따지고 공평 찾고 하는 게 불행의 시작 같아요ㅜ"
    },
    "plan": {
      "personaCode": "P05",
      "stance": "REFLECTION",
      "selfBasis": null,
      "closingIntent": "share",
      "contentRoles": [
        "conversationSpark",
        "experienceResonance"
      ],
      "universalReason": "",
      "protectedFacts": [
        {
          "kind": "publicEntity",
          "text": "이숙캠",
          "evidenceRef": "title"
        },
        {
          "kind": "publicEntity",
          "text": "결혼전쟁",
          "evidenceRef": "title"
        }
      ],
      "warrants": []
    },
    "card": {
      "code": "P05",
      "ageBand": "40대 후반",
      "maritalStatus": "기혼",
      "spouseRelationship": "원만",
      "childrenCount": 2,
      "childrenAgeBands": [
        "대학·취준",
        "중고등"
      ],
      "parentCare": "상시",
      "menopauseStatus": "전",
      "noGoTopics": [
        "시어머니 험담",
        "며느리 훈계"
      ],
      "household": {
        "childrenLiving": "동거",
        "careSide": "시댁",
        "careCohabit": true
      }
    }
  }
]
