#!/bin/sh
# 패키지 폴더(<패키지>/mods/*, <패키지>/layouts/*)를 herdr-app 홈에 복사한다.
#   ./install.sh                  모든 패키지
#   ./install.sh agent-dashboard  고른 패키지만
# 링크가 아니라 복사: herdr-app은 링크 너머의 변경을 보지 못해 다시 불러오지 않는다.
# mod는 덮어쓰고(이 레포의 것), 레이아웃은 이미 있으면 건너뛴다(손본 레이아웃을 지키려고).
set -e
cd "$(dirname "$0")"
home="${HERDR_APP_HOME:-$HOME/.config/herdr-app}"

if [ $# -gt 0 ]; then
  pkgs="$*"
else
  pkgs=$(for d in */; do d=${d%/}; if [ -d "$d/mods" ] || [ -d "$d/layouts" ]; then echo "$d"; fi; done)
fi

for p in $pkgs; do
  [ -d "$p" ] || { echo "없는 패키지: $p" >&2; exit 1; }
  for m in "$p"/mods/*/; do
    [ -d "$m" ] || continue
    dest="$home/mods/$(basename "$m")"
    mkdir -p "$dest"
    # 파일을 저장할 때마다 다시 불러오므로, main.js가 가져다 쓰는 것을 먼저 두고 main.js는 마지막에.
    (cd "$m" && find . -type f ! -name main.js) | while read -r f; do
      mkdir -p "$dest/$(dirname "$f")"
      cp "$m/$f" "$dest/$f"
    done
    if [ -f "$m/main.js" ]; then cp "$m/main.js" "$dest/main.js"; fi
    echo "mod: $dest"
  done
  for l in "$p"/layouts/*.json; do
    [ -f "$l" ] || continue
    dest="$home/layouts/$(basename "$l")"
    if [ -e "$dest" ]; then echo "레이아웃은 이미 있어 건너뜀: $dest"; else cp "$l" "$dest"; echo "layout: $dest"; fi
  done
done
