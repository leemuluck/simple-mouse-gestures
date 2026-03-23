# Simple Mouse Gestures

간단하고 안전한 마우스 제스처 Chrome 확장프로그램

A simple and privacy-friendly mouse gesture extension for Chrome.

## Gestures | 제스처

| Gesture | Action |
|---------|--------|
| Right-click + drag ← | Go back / 뒤로가기 |
| Right-click + drag → | Go forward / 앞으로가기 |
| Right-click + drag ↓→ | Close tab / 탭닫기 |

## Privacy | 개인정보

**This extension does NOT collect any data. Zero. None.**

일부 마우스 제스처 확장프로그램은 사용자의 브라우징 데이터를 수집하여 외부 서버로 전송하는 것이 알려져 있습니다.

Simple Mouse Gestures는 다릅니다:

- **외부 서버 통신 없음** — `fetch`, `XMLHttpRequest`, `WebSocket` 등 네트워크 코드가 전혀 없습니다
- **데이터 저장 없음** — `localStorage`, `chrome.storage`, 쿠키 등 어떤 저장소도 사용하지 않습니다
- **전체 코드 공개** — 코드가 150줄 수준이라 누구나 직접 확인할 수 있습니다
- **최소 권한** — `tabs` 권한 1개만 사용 (탭 닫기 용도)

직접 확인하세요: [`content.js`](content.js) | [`background.js`](background.js) | [`manifest.json`](manifest.json)

## Install | 설치

### Chrome Web Store
*심사 중 (Coming soon)*

### Manual Install | 직접 설치
1. [Download ZIP](https://github.com/leemuluck/simple-mouse-gestures/archive/refs/heads/main.zip) 다운로드 후 압축 해제
2. Chrome에서 `chrome://extensions` 접속
3. 우측 상단 **개발자 모드** 활성화
4. **압축해제된 확장 프로그램을 로드합니다** 클릭
5. 압축 해제한 폴더 선택 (store 폴더 아님)
6. 아무 웹 페이지에서 우클릭 드래그로 테스트

## Languages | 지원 언어

English, 한국어, 简体中文, 繁體中文

## License

MIT
