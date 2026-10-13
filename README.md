# Simple Mouse Gestures

마우스 입력을 기기 안에서만 일시적으로 처리하며 저장하거나 추적하지 않는 Chrome 제스처 확장프로그램입니다.

A small Chrome extension for mouse gesture navigation. Gesture input is processed temporarily in your browser, without input storage, tracking, analytics, or external transmission.

## Gestures | 제스처

| Gesture | Action |
|---------|--------|
| Right-click + drag ← | Go back / 뒤로가기 |
| Right-click + drag → | Go forward / 앞으로가기 |
| Right-click + drag ↓→ | Close the current tab / 현재 탭 닫기 |
| Double right-click in the same spot | Native context menu / 기본 컨텍스트 메뉴 |

Hold the right mouse button, draw the gesture, then release. A single right-click is reserved for gesture input. To open the normal context menu, right-click twice within 300 ms, moving less than 10 pixels between clicks. Press Escape to cancel a gesture.

A gesture cancels after 3 seconds without movement, or after 30 seconds in total. This prevents a missed release event from leaving an active gesture behind.

마우스 오른쪽 버튼을 누른 채 방향을 그린 뒤 놓으면 실행됩니다. 일반 우클릭 1회는 제스처 입력용입니다. 기본 메뉴는 같은 위치에서 300 ms 이내로 2번 우클릭하면 열립니다. 두 클릭 사이 이동 거리는 10픽셀 미만이어야 합니다. 진행 중인 제스처는 Escape로 취소할 수 있습니다.

3초간 움직임이 없거나 시작 후 30초가 지나면 제스처가 취소됩니다. 버튼을 놓는 이벤트를 놓쳐도 제스처가 계속 남지 않도록 합니다.

## Privacy and permissions | 개인정보와 권한

- **Local input handling:** Gesture-related mouse coordinates, timing, and directions, plus Escape cancellation input, are processed temporarily in memory for navigation and the double-right-click menu. This is local user-activity handling. Input is not logged or written to persistent storage, and the extension has no browsing-history storage, tracking, analytics, or telemetry.
- **No external data transmission:** There are no extension requests to external servers, remote scripts, or third-party dependencies. Back/forward navigation may load websites normally, just like browser navigation buttons.
- **Page access:** The content script runs on permitted websites and matching frames (`<all_urls>`) so it can receive mouse input and draw the trail and feedback in the page DOM. Chrome may warn that the extension can read and change website data. An empty API `permissions` list does not remove this website access.
- **No `tabs` permission:** Closing the sending tab uses `chrome.tabs.remove()` without requesting access to sensitive tab metadata. No storage, cookies, history, or network interception API permissions are requested.

제스처용 마우스 위치·시간·방향과 Escape 취소 입력은 탐색과 더블 우클릭 메뉴를 위해 메모리에서 일시적으로 처리합니다. 이 로컬 사용자 활동 처리는 입력 기록을 저장하거나 외부로 보내지 않습니다. 웹 페이지의 입력을 감지하고 궤적을 표시하기 위해 사이트 접근 권한을 사용하므로 Chrome의 사이트 데이터 접근 경고가 표시될 수 있습니다. 탭을 닫는 데 `tabs` 권한은 필요하지 않으며 요청하지 않습니다. 뒤로가기·앞으로가기에 따른 웹사이트 자체의 통신은 일반 브라우저 탐색과 같습니다.

Review the source: [content.js](content.js), [recognizer.js](recognizer.js), [background.js](background.js), [manifest.json](manifest.json). See the [privacy policy](store/privacy-policy.html).

## Install | 설치

Install from the [Chrome Web Store](https://chromewebstore.google.com/detail/simple-mouse-gestures/pnimhhmghnmbojphkpmpcfdenoffphjn).

Chrome 웹 스토어에서 설치하거나 아래 방법으로 직접 설치할 수 있습니다.

1. Download the [source ZIP](https://github.com/leemuluck/simple-mouse-gestures/archive/refs/heads/main.zip) and extract it.
2. Open `chrome://extensions` in Chrome and enable **Developer mode / 개발자 모드**.
3. Choose **Load unpacked / 압축해제된 확장 프로그램을 로드합니다**.
4. Select the extracted repository root containing `manifest.json` (not the `store` folder).
5. Reload an ordinary web page, then try a gesture.

For the packaged build, extract `store/mouse.zip` into a separate folder and load that folder instead. The archive is generated from the current source; do not manually assemble the upload files.

## Supported pages and limits | 지원 범위와 제한

Gestures work on ordinary web pages where Chrome permits content scripts, including matching embedded frames and supported `about:blank`/`about:srcdoc` frames. They do not run on Chrome internal pages such as `chrome://settings`, Chrome Web Store pages, other extensions' pages, or Chrome's built-in PDF viewer. `data:` and `blob:` frames are not enabled. Local file URLs and incognito windows require their separate Chrome extension settings to be enabled.

Chrome 내부 페이지, 웹 스토어, 다른 확장프로그램의 페이지, 내장 PDF 뷰어에서는 동작하지 않습니다. 로컬 파일과 시크릿 모드는 Chrome 확장프로그램 설정에서 별도로 허용해야 합니다. 사이트 접근을 제한하면 허용한 사이트에서만 동작합니다.

Mouse/context-menu event timing varies by operating system and input device. Test native mouse and trackpad input on your target platform before publishing; automatic tests do not exercise Chrome's native context menu. Pages can style or remove DOM feedback, and sites with their own right-button controls may conflict with gestures. Use Chrome's site access settings to disable the extension on such sites.

English, 한국어, 简体中文, and 繁體中文 are supported.

## Development and release checks

Unit and packaging checks require no npm dependencies. Use Node.js 22+ and Python 3.10+:

```sh
node --test tests/*.test.cjs
python3 scripts/package.py
python3 -m unittest discover -s tests -p '*_test.py'
python3 scripts/package.py --check
```

The Python packaging script includes only runtime files, icons, locale catalogs, and the license. It fixes ZIP metadata and file ordering so the upload is reproducible across platforms. CI rejects an archive whose files, version, locales, or bytes no longer match the source. Rebuild the ZIP after changing any packaged file.

The optional browser suite uses a separately available Playwright module and Chromium or Chrome:

```sh
node scripts/browser-tests.cjs
```

Set `PLAYWRIGHT_MODULE` to an absolute module path if Playwright is installed outside the repository, and `CHROME_EXECUTABLE_PATH` to select a browser executable. Current branded Chrome also requires `CHROME_LOAD_VIA_CDP=1` to load the extension for testing. Tests use a fresh temporary profile, leaving your normal browser profile untouched. The 27 integration checks were exercised with Chrome 155; they cover real browser gesture input, navigation, tab closing, synthetic-event rejection, embedded frames, and context-menu event handling. Automated input does not verify the appearance or behavior of every platform's native context menu.

Before release, manually check the three gestures, double-right-click menu, Escape cancellation, switching tabs/windows mid-gesture, embedded frames, long drags, zoom/HiDPI display, and Chrome's restricted pages on Windows, macOS, and Linux. Test an update as well as a clean installation.

The icon master and generation prompt are in `assets/`; only the four resized runtime icons are packaged.

## License and attribution

[MIT](LICENSE), copyright leemuluck. The project was originally made using another reference; that source has not yet been identified in the repository. Preserve and add the original attribution and license notices once the source is identified.
