# Pretendard

소란소란은 Pretendard Variable 을 사용한다.

## 현재 상태 (scaffold)

`src/app/layout.tsx` 에서 **공개 CDN** 을 참조한다.
다른 서비스의 폰트 subset 파일을 가져오지 않았다.

## D-day 전 전환 권장

self-host 로 전환하면 외부 의존과 FOUT 이 줄어든다.

1. https://github.com/orioncactus/pretendard 에서 dynamic subset 배포본을 받는다
2. 이 디렉터리에 `woff2` 와 `pretendardvariable-dynamic-subset.css` 를 넣는다
3. `layout.tsx` 의 CDN link 를 로컬 경로로 교체한다
4. **OFL 라이선스 파일(`LICENSE.txt`)을 반드시 함께 둔다**

> 폰트 파일만 두고 라이선스를 빠뜨린 사례를 여러 번 봤다. 같은 누락을 반복하지 않는다.
