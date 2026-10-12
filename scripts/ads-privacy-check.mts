#!/usr/bin/env tsx
/**
 * S-MON 개인정보 광고 고지 검사 — 개인정보처리방침 · S-MON 정본 · 광고 기본 OFF.
 * 정책: S-MON 정본(docs/operations/MONETIZATION-CANON.md) §7 · §11.
 *
 *   npx tsx --tsconfig tsconfig.ops.json scripts/ads-privacy-check.mts [--deploy-date YYYY-MM-DD]
 *
 * 🔴 문구의 법적 적합성을 판정하지 않는다. 창업자가 확정한 운영 결정이 방침에 빠짐없이,
 *    잘못된 표현 없이 들어 있는지만 본다.
 * 🔴 판정마다 일부러 망가뜨린 방침 문구를 같은 검사에 넣어 **실패하는지** 확인한다.
 * 🔴 `--deploy-date` 를 주면 시행일이 그 날짜와 같은지 본다 — 배포일보다 앞선 날짜로 소급하지 않는다.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { adSlotGate } from '../src/lib/ads/gate'

const ROOT = process.cwd()
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

let pass = 0
let fail = 0
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) pass++
  else fail++
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${!ok && detail ? ` — ${detail}` : ''}`)
}

/** JSX 를 사람이 읽는 문장으로 — 태그 · 중괄호 식 · 줄바꿈 공백을 걷어 낸다 */
function visibleText(tsx: string): string {
  return tsx
    .replace(/\{' '\}/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\{[^}]*\}/g, ' ')
    .replace(/\s+/g, ' ')
}

/**
 * 문단(<p>)·표 칸(<td>)마다 문장으로 나눈다. 페이지 전체를 이어 붙이면 표 머리글과 먼 문장이
 * 한 "문장" 으로 붙어 엉뚱한 조합이 생긴다.
 */
function sentences(tsx: string): string[] {
  const blocks = [...tsx.matchAll(/<(p|td)\b[^>]*>([\s\S]*?)<\/\1>/g)].map((m) => visibleText(m[2] ?? ''))
  return blocks.flatMap((b) => b.split(/(?<=[.다])\s+/)).filter((s) => s.trim() !== '')
}

/** 「N. 제목」 절 하나 — 다음 Article 전까지 */
function article(tsx: string, title: string): string {
  const at = tsx.indexOf(`title="${title}`)
  if (at < 0) return ''
  const end = tsx.indexOf('<Article title=', at + 1)
  return visibleText(tsx.slice(at, end < 0 ? tsx.length : end))
}

type Rule = { name: string; ok: (tsx: string) => boolean }

const RULES: Rule[] = [
  // 5조 위탁 — 분석과 광고를 나눈다
  { name: '5조: Google Analytics 와 Google AdSense 를 따로 적는다', ok: (t) => {
    const a = article(t, '5. 개인정보 처리의 위탁')
    return /Google LLC \(Google Analytics\)[^·]*통계 분석/.test(a) && /Google LLC \(Google AdSense\)/.test(a)
  } },
  { name: '5조: AdSense 목적 네 가지(문맥 광고 · 빈도 · 성과 · 무효 트래픽)', ok: (t) => {
    const a = article(t, '5. 개인정보 처리의 위탁')
    return ['비맞춤형·문맥 기반 광고 제공', '광고 빈도 관리', '광고 성과 집계', '무효 트래픽 방지'].every((k) => a.includes(k))
  } },
  // 7조 국외 이전
  { name: '7조: AdSense 를 별도 이전 대상으로 적는다', ok: (t) => article(t, '7. 개인정보의 국외 이전').includes('Google LLC (Google AdSense)') },
  { name: '7조: AdSense 이전 항목 여섯 가지', ok: (t) => {
    const a = article(t, '7. 개인정보의 국외 이전')
    return ['IP 주소', '브라우저·기기 정보', '접속 일시', '방문 페이지 URL', '광고 표시·상호작용', '쿠키 또는 유사 식별자']
      .every((k) => a.includes(k))
  } },
  { name: '7조: 이전 시점·방법에 AdSense 직접 전송을 적는다', ok: (t) => /Google AdSense 는 광고가 표시되는 페이지를 이용하는 시점에/.test(article(t, '7. 개인정보의 국외 이전')) },
  { name: '7조: AdSense 보유기간을 지어내지 않고 Google 정책을 따른다고 적는다', ok: (t) => {
    const a = article(t, '7. 개인정보의 국외 이전')
    return /Google AdSense 관련 정보는 Google 의 개인정보처리방침과 광고 관련 정책/.test(a)
      && !/AdSense[^.]{0,60}\d+\s*(일|개월|년)/.test(a)
  } },
  { name: '7조: Analytics 는 브라우저 쿠키·개인정보 설정으로 제한한다고 따로 적는다', ok: (t) =>
    /Google Analytics 관련 쿠키 사용은 브라우저의 쿠키·개인정보 설정을 통해 제한할 수 있습니다/.test(article(t, '7. 개인정보의 국외 이전')) },
  { name: '7조: AdSense 는 쿠키 설정 · Google 광고 설정 · 지역 CMP 로 관리한다고 따로 적는다', ok: (t) =>
    /Google AdSense 관련 처리는 브라우저 쿠키 설정, Google 광고 설정 및 적용 지역의 Google 동의 관리 화면에서 관리할 수 있습니다/.test(article(t, '7. 개인정보의 국외 이전')) },
  { name: '7조: 광고 설정·CMP 선택 변경은 기본 서비스를 제한하지 않는다고 좁혀 쓴다', ok: (t) =>
    /Google 광고 설정이나 적용 지역의 Google 동의 관리 화면에서 광고 관련 선택을 바꾸더라도 글 읽기 등 기본 서비스 이용은 제한되지 않으며/.test(article(t, '7. 개인정보의 국외 이전')) },
  { name: '7조: 모든 쿠키 차단은 로그인 등 일부 기능을 제한할 수 있다고 구분해 적는다', ok: (t) =>
    /다만 브라우저에서 모든 쿠키를 차단하면 9항 2호와 같이 로그인 등 일부 기능의 이용이 제한될 수 있고/.test(article(t, '7. 개인정보의 국외 이전')) },
  { name: '9조 표: 광고 선택 변경과 모든 쿠키 차단의 영향을 구분한다', ok: (t) => {
    const a = article(t, '9. 쿠키')
    return /광고 관련 선택을 바꾸더라도 글 읽기 등 기본 서비스 이용은 제한되지 않으며/.test(a)
      && /다만 브라우저에서 모든 쿠키를 차단하면 로그인 등 일부 기능의 이용이 제한될 수 있습니다/.test(a)
  } },
  { name: '브라우저 쿠키 설정에도 기본 서비스가 그대로라는 포괄 보장이 없다', ok: (t) =>
    sentences(t).every((s) => !/(브라우저[^.]*쿠키|이러한 설정|이 설정)[^.]*(그대로 이용할 수 있|제한되지 않)/.test(s)) },
  { name: '광고 관련 선택 변경만으로 기본 서비스가 제한된다고 쓰지 않는다', ok: (t) =>
    sentences(t).every((s) => !/광고 (관련 )?선택을 (바꾸면|변경하면|거부하면)[^.]*(기본 서비스|글 읽기)[^.]*제한(됩니다|될 수)/.test(s)) },
  { name: '모든 쿠키를 막아도 로그인 등 모든 기능이 그대로라고 쓰지 않는다', ok: (t) =>
    sentences(t).every((s) => !/모든 쿠키를 차단(해도|하더라도)[^.]*(그대로|제한되지 않)/.test(s)) },
  { name: 'Google 광고 설정이 Analytics 까지 관리한다고 묶어 쓰지 않는다', ok: (t) =>
    sentences(t).every((s) => !(s.includes('Google Analytics') && s.includes('Google 광고 설정'))) },
  { name: '거부·설정 효과를 "완전히 차단" 처럼 보장하지 않는다', ok: (t) => !/완전히 (차단|막|거부)/.test(visibleText(t)) },
  // 9조 쿠키
  { name: '9조: 옛 "광고 목적 쿠키 미사용" 문장이 없다', ok: (t) => !/광고 목적의 추적을 위해 쿠키를 사용하지 않습니다/.test(t) },
  { name: '9조: AdSense 사용 가능성을 알린다', ok: (t) => /광고 게재를 위해 Google AdSense 를 사용할 수 있습니다/.test(article(t, '9. 쿠키')) },
  { name: '9조: 최초 운영은 비맞춤형 광고(NPA) 우선', ok: (t) => /최초 광고 운영에서 모든 지역에 비맞춤형 광고를 우선 요청합니다/.test(article(t, '9. 쿠키')) },
  { name: '9조: NPA 도 쿠키·유사 기술을 쓸 수 있다고 적는다', ok: (t) => /비맞춤형 광고도[^.]*쿠키 또는 유사 기술을 사용할 수 있습니다/.test(article(t, '9. 쿠키')) },
  { name: '9조: EEA·영국·스위스 Google CMP 선택', ok: (t) => /유럽경제지역\(EEA\)·영국·스위스[^.]*Google 이 제공하는 인증된 동의 관리 도구\(CMP\)/.test(article(t, '9. 쿠키')) },
  { name: '9조: 브라우저 쿠키 설정 · Google 광고 설정으로 거부·관리', ok: (t) => {
    const a = article(t, '9. 쿠키')
    return /브라우저 설정의 쿠키·개인정보 메뉴/.test(a) && /Google 광고 설정\(myadcenter\.google\.com\)/.test(a)
  } },
  { name: '9조: 행태정보 일곱 항목(주체·항목·방법·목적·보유·거부·영향)', ok: (t) => {
    const a = article(t, '9. 쿠키')
    return ['수집·처리 주체', '항목', '수집 방법', '이용 목적', '보유·처리 기준', '거부 방법', '거부 시 영향'].every((k) => a.includes(k))
  } },
  { name: '맞춤형 광고를 지금 운영 중인 것처럼 쓰지 않는다', ok: (t) => !/(?<!비)맞춤형 광고를 (제공합니다|제공하고 있습니다|운영합니다)/.test(visibleText(t)) },
  { name: 'NPA 를 쿠키·개인정보 처리·CMP 가 없는 광고로 쓰지 않는다', ok: (t) => !/비맞춤형 광고(는|도)?[^.]{0,40}(쿠키를 (전혀 )?사용하지 않|개인정보를 (전혀 )?처리하지 않|CMP[가 ]*필요 없|동의가 필요 없)/.test(visibleText(t)) },
  // 12조 변경
  { name: '12조: 고정 7일 사전 공지 약속이 없다', ok: (t) => !/최소 7일 전|7일 전에 알려/.test(t) },
  { name: '12조: 변경 내용·시행일 공개 · 법령상 사전 고지는 법령을 따른다', ok: (t) => /방침이 변경되는 경우 변경 내용과 시행일을 이 방침을 통해 공개합니다\. 법령상 사전 고지가 필요한 경우에는 해당 법령에서 정한 기간과 방법에 따라 안내합니다\./.test(article(t, '12. 개인정보처리방침의 변경')) },
  { name: '과거에 사전 공지했다고 쓰지 않는다', ok: (t) => !/(사전|미리) (공지|고지|안내)(했|하였|드렸)/.test(visibleText(t)) },
  // 개인정보 페이지는 광고를 켜지 않는다
  { name: '개인정보 페이지가 광고 모듈을 import 하지 않는다', ok: (t) => !/@\/(components|lib)\/ads\//.test(t) },
]

function failures(tsx: string): string[] {
  return RULES.filter((r) => !r.ok(tsx)).map((r) => r.name)
}

const PRIVACY = 'src/app/privacy/page.tsx'
const privacy = read(PRIVACY)

console.log('\n■ 1. 개인정보처리방침 광고 고지')
for (const r of RULES) check(r.name, r.ok(privacy))

console.log('\n■ 2. 시행일')
const dateMatch = /const EFFECTIVE_DATE = '(\d{4})년 (\d{1,2})월 (\d{1,2})일'/.exec(privacy)
const effective = dateMatch
  ? `${dateMatch[1]}-${dateMatch[2]!.padStart(2, '0')}-${dateMatch[3]!.padStart(2, '0')}`
  : ''
check('시행일 형식이 맞다', effective !== '')
check('시행일이 이번 개정 이전 날짜로 돌아가지 않았다(≥ 2026-10-12)', effective >= '2026-10-12', effective)
const deployAt = process.argv.indexOf('--deploy-date')
if (deployAt > 0) {
  const deployDate = process.argv[deployAt + 1] ?? ''
  check(`시행일이 실제 배포일(${deployDate})과 같다`, effective === deployDate, effective)
}

console.log('\n■ 3. 변이 — 망가뜨린 방침은 떨어져야 한다')
const MUTANTS: Array<[string, (t: string) => string]> = [
  ['옛 광고 쿠키 미사용 문장 복귀', (t) => t.replace('</Article>', '<p>4. 서비스는 광고 목적의 추적을 위해 쿠키를 사용하지 않습니다.</p></Article>')],
  ['7일 사전 공지 약속 복귀', (t) => t.replace('공개합니다. 법령상', '공개합니다. 중요한 변경이 있는 경우에는 최소 7일 전에 알려드립니다. 법령상')],
  ['NPA 쿠키 사용 문장 삭제', (t) => t.replace(/다만 비맞춤형\s+광고도[\s\S]*?사용할 수 있습니다\./, '')],
  ['NPA 를 쿠키 없는 광고로 오기', (t) => t.replace('맞춤형 광고를 사용하게 되는 경우', '비맞춤형 광고는 쿠키를 전혀 사용하지 않습니다. 맞춤형 광고를 사용하게 되는 경우')],
  ['CMP 고지 삭제', (t) => t.replace(/6\. 유럽경제지역[\s\S]*?있습니다\.\s*<\/p>/, '</p>')],
  ['AdSense 위탁 줄 삭제', (t) => t.replace(/<p>\s*· Google LLC \(Google AdSense\)[\s\S]*?<\/p>/, '')],
  ['맞춤형 광고 운영 중이라고 오기', (t) => t.replace('</main>', '<p>서비스는 맞춤형 광고를 제공합니다.</p></main>')],
  ['보유기간 임의 숫자', (t) => t.replace('Google AdSense 관련 정보는 Google 의', 'Google AdSense 관련 정보는 13개월 보관하며 Google 의')],
  ['행태정보 거부 방법 칸 삭제', (t) => t.replace('거부 방법</td>', '</td>')],
  ['Analytics·AdSense 를 Google 광고 설정으로 묶은 옛 문장 복귀', (t) => t.replace(
    /Google Analytics 관련 쿠키 사용은[\s\S]*?관리할 수 있습니다\(9항\)\./,
    'Google Analytics 와 Google AdSense 로의 이전은 브라우저 쿠키 설정과 Google 광고 설정으로 거부하거나 관리할 수 있습니다.')],
  ['Analytics 를 Google 광고 설정으로 거부한다고 추가', (t) => t.replace('</main>',
    '<p>Google Analytics 수집은 Google 광고 설정에서 거부할 수 있습니다.</p></main>')],
  ['"완전히 차단" 보장 문구', (t) => t.replace('제한할 수\n            있습니다.', '완전히 차단할 수 있습니다.')],
  ['7조 두 문장을 옛 포괄 보장 하나로 다시 합침', (t) => t.replace(
    /Google 광고 설정이나 적용 지역의 Google\s+동의 관리 화면에서[\s\S]*?이용 통계의 정확도가\s+달라질 수 있습니다\./,
    '이러한 설정을 하더라도 글 읽기와 커뮤니티 이용 등 기본 서비스는 그대로 이용할 수 있으며, 이용 통계의 정확도나 광고 표시 방식·빈도가 달라질 수 있습니다.')],
  ['9조 표를 포괄 보장으로 되돌림', (t) => t.replace(
    /Google 광고 설정이나 Google 동의 관리 화면에서 광고 관련 선택을[\s\S]*?\(9항\s+2호\)\./,
    '브라우저 쿠키 설정을 바꿔도 글 읽기와 커뮤니티 이용 등 기본 서비스는 그대로 이용할 수 있습니다.')],
  ['광고 선택 변경만으로 기본 서비스가 제한된다고 추가', (t) => t.replace('</main>',
    '<p>광고 관련 선택을 바꾸면 글 읽기 등 기본 서비스 이용이 제한될 수 있습니다.</p></main>')],
  ['모든 쿠키 차단에도 모든 기능이 그대로라고 추가', (t) => t.replace('</main>',
    '<p>브라우저에서 모든 쿠키를 차단해도 로그인 등 모든 기능을 그대로 이용할 수 있습니다.</p></main>')],
  ['7조 쿠키 차단 제한 문장 삭제', (t) => t.replace(/다만 브라우저에서 모든 쿠키를\s+차단하면 9항 2호와[\s\S]*?달라질 수 있습니다\./, '')],
]
check('실제 방침은 규칙을 전부 통과한다', failures(privacy).length === 0, failures(privacy).join(', '))
for (const [name, mutate] of MUTANTS) {
  const mutated = mutate(privacy)
  check(`변이 "${name}" 를 잡는다`, mutated !== privacy && failures(mutated).length > 0,
    mutated === privacy ? '변이가 적용되지 않음' : '')
}

console.log('\n■ 4. S-MON 정본')
const canon = read('docs/operations/MONETIZATION-CANON.md')
check('정본이 v1.2 다', canon.includes('> 버전: **v1.2**'))
check('"구현이 아직 하나도 없다" 류의 낡은 현행 문장이 없다', !/아직 하나도 하지 않았다/.test(canon.split('## 16.')[0] ?? ''))
check('MON-2A 운영 반영을 기록한다',
  canon.includes('PR #697') && canon.includes('b3942f22ccdd4407d0b86f35fae2d7290ad55437') && canon.includes('`/ads.txt` 404'))
check('방침 배포가 광고 요청보다 먼저라는 조건을 유지한다', canon.includes('개정 배포가 광고\n  요청보다 먼저다') || canon.includes('개정 배포가 광고 요청보다 먼저다'))
check('7일 사전 공지를 운영 gate 로 두지 않는다',
  canon.includes('7일 대기는 광고 운영 gate 가 아니다') && !/7일[^\n]{0,20}(대기|공지)[^\n]{0,20}(뒤에|후에) (광고|활성화)/.test(canon))
check('2026-10-17 을 광고 gate 로 되살리지 않는다',
  !/10-17[^\n]{0,40}(전에는|확정되기 전에는)[^\n]{0,20}MON-[23][^\n]{0,10}(들어가지 않는다|하지 않는다)/.test(canon))
const mon3 = canon.split('\n').find((l) => l.startsWith('| MON-3 ')) ?? ''
check('MON-3 활성화 조건을 유지한다',
  ['AdSense 승인', '실제 광고 단위', '방침 개정 배포', 'CMP', '`ads.txt`', '기본 OFF', 'kill switch', 'failure-open', '레이아웃 검사 PASS']
    .every((k) => mon3.includes(k)), mon3)
check('광고 활성화 시각을 전환 관측에 기록하고 기존 수치를 고치지 않는다',
  canon.includes('광고를 처음 켠 KST 시각·deployment·페이지·슬롯을 회원가입 전환 관측 기록에 남긴다')
  && canon.includes('기존 ①~⑤ 수치를 삭제·보정·임의 차감하지 않고 수집 시작일도 다시 잡지 않는다'))

console.log('\n■ 5. 광고는 계속 OFF')
check('env 가 없으면 홈 슬롯 gate 가 닫혀 있다', adSlotGate({}, 'home-bottom').active === false)
check('Production 이어도 스위치가 없으면 닫혀 있다', adSlotGate({ VERCEL_ENV: 'production' }, 'home-bottom').active === false)

console.log(`\n개인정보 광고 고지 검사: ${pass} pass, ${fail} fail`)
if (fail > 0) process.exit(1)
