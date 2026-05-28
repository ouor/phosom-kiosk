# Phosom Kiosk

전시장 부스용 사진 키오스크 웹앱. 운영자가 미리 `.frame.preset` 파일을 골라두면
방문자가 프레임 선택 → 순차 촬영 → 합성 → 인쇄 요청까지 한 화면 안에서 수행한다.
별도 백엔드를 두지 않고 프론트만으로 동작하며, 인쇄만 외부 서버(`print-web`)에
요청한다.

## 구성

- **Vite 8 + React 19 + TypeScript 6** — `src/` (SPA)
- **Tailwind CSS 4**
- **react-router 7** — `/operator`, `/visitor`
- **상태 관리** — 없음. `useState` + IndexedDB (프리셋 캐시) + localStorage (진행 중인 인쇄 job)
- **백엔드** — 자체 백엔드는 없음. 외부 인쇄 서버 1곳만 호출
- **배포** — Cloudflare Pages (`phosom-kiosk` 프로젝트)

## 환경 변수

빌드 시 (Vite). 누락 시 런타임에 즉시 throw.

| 변수 | 설명 |
|------|------|
| `VITE_PRINT_API_BASE` | 인쇄 서버 base URL. 테스트 `http://localhost:8000`, 실제 `https://print.t.ouor.in` |

`.env.production` 은 커밋되어 있어 빌드 결과에 prod URL 이 박힌다. `.env.local` 은
gitignored 며 `npm run dev` 에서만 사용된다. mode 별 파일 우선순위가 더 높아서
`.env.local` 이 prod 빌드를 침범하지 않는다.

## 개발 워크플로

### UI HMR

```bash
npm install
npm run dev
```

`.env.local` 의 URL 로 인쇄 요청을 보낸다. 카메라는 `localhost` 에서만 동작
(secure context 규칙). LAN IP 로 접속하면 `navigator.mediaDevices` 가 `undefined`
가 되어 슬롯에 에러가 표시된다 — 태블릿 실기기 테스트는 항상 Pages 의 HTTPS
도메인에서 수행한다.

### 빌드 확인

```bash
npm run build
npm run preview
```

## 배포

### 처음 1회

```bash
npx wrangler login
npx wrangler pages project create phosom-kiosk --production-branch main
```

### 이후 매 배포

```bash
npm run deploy
```

`npm run build && wrangler pages deploy dist --project-name phosom-kiosk` 의 별칭.

**고정 production URL**: <https://phosom-kiosk.pages.dev>

SPA 라우팅은 `public/_redirects` (`/* /index.html 200`) 로 처리. `/operator`,
`/visitor` 같은 경로를 직접 새로고침해도 index.html 로 떨어진다.

## 사용 흐름

### 운영자 모드 (`/operator`)

1. 부스 세팅 단계에서 태블릿 브라우저로 한 번 접속.
2. **+ 프레임 파일 추가** 로 `.frame.preset` 파일 3~4개 선택. 썸네일이 zip 안에
   없으면 빈 카메라 슬롯 자리표시까지 포함해 즉석에서 생성된다.
3. IndexedDB 에 원본 zip + 썸네일 Blob 으로 저장 — 새로고침해도 유지.
4. **방문자 모드 시작 →** 클릭해 `/visitor` 로 이동.

### 방문자 모드 (`/visitor`)

상태 머신: `select → capture → preview → submitting → tracking`.

1. **select**: 캐시된 프레임 썸네일 그리드. 탭 시 capture 진입.
2. **capture**: 첫 카메라 슬롯이 자동 활성화. 큰 촬영 버튼을 누르면 슬롯이 채워지고
   다음 슬롯으로 자동 이동. 마지막 슬롯이 채워지면 합성 후 preview 로.
3. **preview**: 합성 결과 미리보기 + 이름 입력 + **인쇄 요청** 버튼.
4. **submitting**: 이미지 정규화 → `POST /api/jobs` (`crypto.randomUUID()` 멱등키).
5. **tracking**: 2.5s 주기 폴링. `DONE` 도달 시 **처음으로** 버튼. localStorage 의
   `photo-kiosk.active-job` 에 `{id, name}` 을 저장해 두므로 새로고침으로 진행 중인
   job 이 사라지지 않는다.

`FAILED` / `REJECTED` 는 사용자에게 모두 "대기중" 으로 표시되고 폴링을 계속한다
— 인쇄 서버 측 admin 의 존재(승인, 재시도, 거절)를 방문자에게 노출하지 않는다.

## 카메라 권한

- 안드로이드 브라우저는 `navigator.mediaDevices` 를 HTTPS 또는 `localhost` 에서만
  노출. LAN IP (`http://192.168.x.x:5173`) 로는 동작하지 않는다 — 항상 Pages
  도메인을 쓰자.
- 부스 세팅 시 운영자가 카메라 권한을 한 번 "허용" 으로 영구 저장해 두면 방문자는
  매번 묻지 않는다.
- 전면 카메라 캡쳐는 좌우 반전된 프리뷰와 결과가 일치하도록 캡쳐 시점에 한 번 더
  반전된다.

## 인쇄 서버 인터페이스

자세한 스펙은 `print-web` 백엔드를 참고. 키오스크가 사용하는 부분만:

- `POST /api/jobs` (multipart): `requester_name`, `idempotency_key`, `image`.
  이미지는 landscape/square JPEG/PNG/WEBP/HEIC, 15 MB 이하만 허용. portrait 는 422.
- `GET /api/jobs/{id}`: status 폴링. terminal 은 `DONE` 만.
- 클라이언트가 portrait 합성 결과를 `createImageBitmap` 으로 EXIF orientation 베이크
  → 90° CW 회전 → JPEG 0.92 재인코딩 후 전송. `src/lib/printApi.ts` 의
  `normalizeForPrint`.

배포 시 인쇄 서버의 CORS 화이트리스트에 `https://phosom-kiosk.pages.dev` 가
포함돼 있어야 한다.

## 파일 트리

```
src/
├── App.tsx                BrowserRouter + 라우트 (/operator, /visitor)
├── main.tsx               StrictMode + createRoot
├── env.ts                 VITE_PRINT_API_BASE 단일 진입점
├── index.css              Tailwind + viewport 잠금 (overflow: hidden)
├── lib/
│   ├── operations.ts      Operation 디스크리미네이티드 유니언 (web-editor 와 같은 스키마)
│   ├── preset.ts          loadPresetFromBlob — zip → resolvedOperations (blob URL)
│   ├── export.ts          exportPreviewImage — Canvas 2D 합성 → PNG Blob
│   ├── db.ts              IndexedDB CRUD (StoredPreset)
│   ├── printApi.ts        normalizeForPrint + createJob + getJob + userPhase
│   └── fonts/
│       ├── catalog.ts     커스텀 폰트 카탈로그 (Noto/BlackHanSans/Dongle/Jua)
│       └── fontLoader.ts  FontFace API 등록
├── components/
│   ├── FrameRenderer.tsx  미리보기 전용 렌더러 (드래그/리사이즈 없음)
│   └── WebcamSlot.tsx     forwardRef capture() — 전면 카메라 좌우 반전
└── pages/
    ├── OperatorPage.tsx   파일 추가 → IndexedDB → 썸네일 그리드 + 삭제
    └── VisitorPage.tsx    state machine (select/capture/preview/submitting/tracking)
```

## 코드 출처

- **프리셋 모델/렌더링**: `app/tools/web-editor` 의 `lib/operations.ts`, `lib/preset.ts`,
  `lib/export.ts`, `lib/fonts/*` 를 미러. RN 앱과도 동일한 스키마.
- **이미지 정규화 + 폴링 흐름**: `print-web/frontend/src/pages/UserPage.tsx` 의
  `normalizeForPrint` 와 폴링 의미론 (DONE 만 terminal, admin 은닉).

세 프로젝트는 별개 빌드/배포지만 preset 스키마와 인쇄 프로토콜을 공유한다. 한 쪽에서
변경이 생기면 수동으로 동기화한다.

## 알려진 한계

- 운영자 모드 잠금 없음. `/operator` URL 만 알면 누구나 진입. 부스에서 URL 공유를
  통제하는 식으로 운영.
- 카메라 접근이 차단된 상태면 슬롯에 에러 메시지만 표시. 파일 picker fallback 은
  미구현.
- 인쇄 서버의 CORS 화이트리스트가 따로 없으면 브라우저 콘솔에 CORS 에러가 뜬다.
  배포 시 함께 확인.
