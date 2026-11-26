# Workboard

지금 보고 있는 Herdr 탭의 목표와 진행 상황을 오른쪽에서 확인한다. 각 섹션과 항목은 탭 전용(기본), 스페이스 공유, 에이전트 세션 전용 중 하나로 발행할 수 있다. 패널을 접으면 하단에 목표·상태·완료 단계 수·기한이 남는다.

![Workboard](preview.png)

**What you see:**

- 오른쪽 396px 패널(드래그 범위 280–700px). 상단에 `Workboard`와 `접기`, 아래에 스크롤 가능한 카드. 목표 카드는 테마 강조색과 큰 제목으로 현재 목표를 구분한다.
- 에이전트가 섹션 제목과 배치 순서, 항목별 표시 타입을 정한다. mod는 목표·목록·진행 섹션, 그리고 글머리표·번호 단계·링크·메모·커맨드의 모양과 동작을 제공한다. 하위 목표와 워크플로가 같은 번호 단계 스타일을 공유할 수 있다.
- 접힌 상태에서는 하단 오른쪽 360px 칸에 목표 제목·상태·기한, 첫 번째 비어 있지 않은 진행 섹션의 완료 수와 미니 진행 막대가 표시된다. 없는 항목은 숨긴다.

**How it behaves:**

- 하단 요약을 누르면 패널이 열리고, 패널에서 `접기`를 누르면 요약이 돌아온다. 팔레트의 `Workboard: 업무 패널 여닫기`도 같은 동작이다.
- 같은 스페이스에서 탭을 전환하면 공유 항목은 남고 탭 전용 항목은 바뀐다. 한 탭에 에이전트가 여러 개라면, 포커스한 Herdr 터미널 주소에 해당하는 세션 전용 항목만 보인다.
- `메모 추가`로 직접 남기는 메모는 화면에 표시된 목표의 범위에 저장된다. 발행 JSON에 넣는 에이전트 메모는 다른 항목과 같이 `scope`를 지정할 수 있다. `삭제`로 에이전트 메모를 숨기면 현재 목표에만 적용된다.
- 목표와 일반·단계 항목에 `url`을 넣으면 패널에서 제목을 눌러 해당 페이지를 연다. PR 승인 대기에는 해당 PR, Actions 실패에는 실패한 실행, Jira 목표에는 해당 티켓을 연결한다. 상태와 진행 집계는 그대로 표시한다.
- 독립된 링크 항목은 제목 아래에 호스트를 표시하고, GitHub·Slack·Jira·Confluence는 번들 아이콘을 쓴다. 다른 호스트는 지구본 아이콘을 쓴다. 외부 파비콘을 내려받지 않는다. 링크를 가리키면 전체 URL이 표시되고 누르면 시스템 브라우저에서 연다.
- 제안 커맨드는 실행 파일·인자와 분할 방향을 먼저 보여준다. 클릭하면 현재 탭에서 포커스한 터미널(없으면 탭의 첫 터미널)을 나누고 그 터미널의 작업 디렉터리에서 지정한 `argv`를 실행한다. 터미널이 없는 탭에서는 실행하지 않는다.

## Built from

1. `./install.sh workboard` 후 팔레트에서 **Workboard: 업무 레이아웃 열기**를 선택한다. CLI는 `herdr-app do layout.switch '{"name":"workboard"}'`. 기존 레이아웃을 덮어쓰지 않는다.
2. 사용하는 에이전트가 `~/.agents/skills`를 읽는다면 [에이전트 스킬](skills/herdr-workboard/SKILL.md)을 설치한다. 다른 스킬 위치를 쓰는 에이전트에는 해당 위치에 넣거나 문서를 직접 읽힌다.

   ```sh
   mkdir -p ~/.agents/skills/herdr-workboard
   cp workboard/skills/herdr-workboard/SKILL.md ~/.agents/skills/herdr-workboard/
   ```

3. 탭 안의 에이전트에게 **“지금 업무를 Herdr Workboard에 발행해 줘”**라고 요청한다. 자동 transcript 수집이나 별도 서비스는 없다. 에이전트가 [스냅숏 형식](skills/herdr-workboard/SKILL.md#snapshot-version-3)에 맞춰 섹션과 항목을 구성한다.

   ```sh
   publisher="${HERDR_APP_HOME:-$HOME/.config/herdr-app}/mods/workboard/publish.mjs"
   node "$publisher" show
   node "$publisher" publish /path/to/snapshot.json  # 파일 대신 -로 표준 입력도 가능
   ```

- `main.js`는 Herdr의 `gpui-base` `Button`, `Link`, `Textarea`, `h_flex`, `v_flex`와 기본 아이콘을 재사용한다. 레이아웃에는 오른쪽 `workboard` 블록(`role: "panel"`)과 하단 `workboard-status` 블록(`role: "status"`)을 둔다. 기존 개인 레이아웃에 넣으려면 [동봉 레이아웃](layouts/workboard.json)의 두 블록을 같은 ID로 복사하고, 상태 칸은 기존 statusbar 블록과 `row`로 묶는다. 상태 칸 자체는 숨기지 않는다. 패널이 열린 동안엔 내용을 그리지 않아도 팔레트 명령을 받는다.
- UI와 CLI는 `model.mjs`의 형식 검증과 `scopes.mjs`의 범위 합성 규칙을 공유한다. CLI는 `herdr-app ls`와 `HC_TERMINAL_ID`로 발행한 에이전트의 스페이스·탭·터미널을 알아낸다. 범위별 `.scoped.json`은 Herdr 홈의 `data/workboard/`(탭), `data/workboard/spaces/`, `data/workboard/sessions/` 아래에 저장된다. 각 파일은 원자 교체되며, 사용자 메모는 별도의 `.memos.json`에 저장한다.

## 섹션·항목별 공유

예를 들어 에이전트에게 **“릴리스 체크리스트는 스페이스에 공유하고, 로컬 테스트는 이 탭에, 디버그 메모는 이 세션에만 발행해 줘”**라고 요청한다. CLI로 직접 발행할 때는 스냅숏 `version: 3`의 섹션 또는 항목에 `scope`를 넣는다.

| `scope` | 표시 범위 |
|---|---|
| `tab` (기본) | 현재 탭의 모든 에이전트 |
| `space` | 같은 스페이스의 모든 탭 |
| `session` | 해당 Herdr 터미널 주소를 포커스한 경우. 에이전트 앱의 대화 ID와는 별개 |

항목의 `scope`를 생략하면 섹션 범위를 따른다. 같은 섹션 ID는 타입이 같으면 합쳐지고, 같은 항목 ID 또는 목표가 겹치면 `session` → `tab` → `space` 순으로 우선한다. 섹션보다 넓게 공유한 항목은 원래 섹션을 볼 수 없는 곳에서 제목 대신 `공유 항목` 아래에 표시된다.

발행은 지정한 범위의 내용을 **통째로 교체**하고 다른 범위는 건드리지 않는다. 범위에서 마지막 항목을 지우거나 다른 범위로 옮길 때는 기존 범위도 `replaceScopes`에 넣는다. 터미널 밖에서는 `--tab ID`, `--space ID`, `--session ADDRESS`로 해당 범위에 직접 접근할 수 있다. 범위 지정 없이 `show`를 실행하면 발행한 에이전트의 관점에서 세 범위를 합쳐 보여 준다.

v1/v2 파일과 `data/workboard/config.json`의 `sharedSpaces` 설정은 기존 보드에만 적용된다. v3에 별도 설정은 필요 없고 기본 범위는 항상 `tab`이다. 같은 범위에 v3 발행본이 있으면 이전 파일보다 우선하지만 이전 파일을 옮기거나 지우지 않는다.

## Watch out

- 발행에는 Node.js 18 이상이 필요하다. SSH 등의 원격 에이전트는 Herdr 앱이 있는 컴퓨터에서 명시적으로 범위를 지정해 발행한다.
- 현재 목표 ID와 메모 ID를 갱신마다 유지한다. 보드나 목표가 바뀌면 이전 메모를 현재 목표에 섞지 않는다. 같은 보드를 여러 에이전트가 갱신한다면 마지막으로 발행한 스냅숏을 표시한다.
- 링크는 HTTP(S)만 받는다. 커맨드는 암묵적으로 셸에 넘기지 않으며, 발행·새로고침·탭 전환으로는 실행되지 않는다.
- 이전 `work-overview`에서 업그레이드할 때는 Herdr 홈의 `data/work-overview`를 `data/workboard`로 옮기고, 개인 레이아웃의 블록 ID·mod 이름 및 단축키를 `workboard`로 바꾼다. 이미 `data/workboard`가 있으면 덮어쓰지 말고 탭별 파일을 확인해 병합한다.

## Done when

- 설치 후 `herdr-app check "${HERDR_APP_HOME:-$HOME/.config/herdr-app}/mods/workboard"`가 통과한다.
- `node workboard/check.mjs`가 기존 v1/v2 호환성, v3 범위 혼합, 목표·항목 링크 보존 및 HTTP(S) 검증을 확인한다.
- 같은 탭의 두 터미널 사이에서 세션 전용 항목만 바뀌고, 같은 스페이스의 다른 탭에는 스페이스 공유 항목만 이어서 표시된다. 다른 스페이스에는 공유 항목이 노출되지 않는다.
- 내 메모를 저장하면 CLI `show`에도 보인다. 삭제하면 사라지고, 에이전트 메모를 숨긴 다음 다시 발행해도 그 메모는 돌아오지 않는다.
- 무해한 `pwd`를 제안해 실행한다. 탭 안에 새 터미널이 생기고 기존 터미널의 디렉터리가 출력된다.
