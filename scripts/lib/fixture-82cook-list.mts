/**
 * 🔴 **82cook 목록 페이지 — 실제 구조 fixture** (2026-09-30 Lane B)
 *
 *   2026-09-30 실제 목록 페이지(`enti.php?bn=15&page=1`)의 **마크업 구조를 그대로** 옮겼다 — 공지 줄
 *   (`tr.noticeList` · `a.bbs_title_word` · 날짜 칸에 `title` 없음) · 일반 줄(번호 칸의 photolink ·
 *   제목 칸 · 닉네임 칸 · `td.regdate.numbers[title="YYYY-MM-DD HH:MM:SS"]` · 조회 칸) 순서와 공백까지.
 *   🔴 제목 · 닉네임 · 글 번호는 합성이다 — 원문 제목 · 사용자 식별자를 싣지 않는다.
 *
 *   날짜 속성은 **KST 벽시계**다(페이지 시각 21:00 대 = 수집 로그 12:0x UTC). 조회 칸은 천 단위 쉼표가 붙는다.
 *   마지막 일반 줄은 날짜 속성이 없다 — 속성 없는 줄을 추측으로 읽지 않는지 본다(→ 게시 시각 null).
 */

/** 합성 일반 줄 — id · KST 게시 시각(없으면 null) · 댓글(0 이면 `<em>` 없음) · 조회 */
export type Fixture82Row = { id: string; kst: string | null; label: string; comments: number; views: number }

const notice = (id: string, date: string, views: string): string => `
		<tr class="noticeList">
                        <td><i class="icon-bell"></i></td><td class="title">
				<a class="bbs_title_word" href="read.php?bn=15&num=${id}&page=1"><b>공지 합성 제목</b></a>

			</td>
			<td class="user_function">운영<a rel="1">82cook</a></td>
			<td class="regdate numbers">${date}</td>
			<td class="numbers">${views}</td>
		</tr>
		`

const row = (r: Fixture82Row, seq: number): string => `
		<tr>
			<td class="numbers"><a href="read.php?bn=15&num=${r.id}&page=1" class="photolink">${1843000 + seq}</a></td>
			<td class="title"><a  href="read.php?bn=15&num=${r.id}&page=1">합성 제목 ${seq}</a> ${r.comments > 0 ? `<em>${r.comments}</em>` : ''}</td>
			<td class="user_function">합성닉네임${seq}</td>
            <td class="regdate numbers"${r.kst === null ? '' : ` title="${r.kst}"`}> ${r.label}</td>
			<td class="numbers">${r.views.toLocaleString('en-US')}</td>
		</tr>`

/** 🔴 실제 페이지와 같은 머리 · 공지 두 줄 · 일반 줄들 */
export function fixture82cookListHtml(rows: readonly Fixture82Row[]): string {
  return `<table class="bbs_list">
		<thead>
		<tr>
			<th scope="col" class="numbers">번호</th>
			<th scope="col" class="title">제목</th>
			<th scope="col" class="user_function">글쓴이</th>
			<th scope="col" class="date">날짜</th>
			<th scope="col" class="a_count">조회</th>
		</tr>
	</thead>
	<tbody>${notice('4060855', '2025.07.24', '169,952')}${notice('3414957', '2022.03.13', '486,586')}
		    ${rows.map((r, i) => row(r, i + 1)).join('')}
	</tbody>
</table>`
}

/** 🔴 기본 fixture — 2026-09-30 밤 회차 모양(최신 글이 위) */
export const FIXTURE_82COOK_ROWS: readonly Fixture82Row[] = [
  { id: '9244772', kst: '2026-09-30 21:00:56', label: '21:00:56', comments: 0, views: 4 },
  { id: '9244771', kst: '2026-09-30 20:57:56', label: '20:57:56', comments: 2, views: 68 },
  { id: '9244770', kst: '2026-09-30 20:56:51', label: '20:56:51', comments: 2, views: 114 },
  { id: '9244769', kst: '2026-09-30 20:49:45', label: '20:49:45', comments: 0, views: 103 },
  { id: '9244768', kst: '2026-09-30 20:41:10', label: '20:41:10', comments: 17, views: 1234 },
  { id: '9244767', kst: null, label: '09.29', comments: 5, views: 88 },
]
