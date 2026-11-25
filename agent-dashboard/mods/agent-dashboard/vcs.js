// 스페이스 폴더의 저장소 정보: jj가 깔려 있고 jj 저장소면 jj로, 아니면 git으로.
// sh로 한 번 실행해 key=value 줄을 받고 parse()로 { vcs, repo, trunk, work, tree, change, dirty }를 만든다.
// jj는 --ignore-working-copy: 주기적으로 물을 때마다 작업 사본을 스냅숏(op log 기록)하지 않게.
export const PROBE = `
if command -v jj >/dev/null 2>&1 && jj root --ignore-working-copy >/dev/null 2>&1; then
  j() { jj --ignore-working-copy --no-pager --color=never "$@" 2>/dev/null; }
  echo vcs=jj
  echo "repo=$(basename "$(j workspace root --name default || j root)")"
  echo "trunk=$(j log -r 'trunk()' --no-graph -T 'bookmarks.map(|b| b.name()).join(" ")')"
  echo "work=$(j log -r 'heads(::@ & bookmarks())' --no-graph -T 'local_bookmarks.map(|b| b.name()).join(" ") ++ " "')"
  echo "tree=$(j log -r @ --no-graph -T 'working_copies')"
  echo "change=$(j log -r @ --no-graph -T 'change_id.shortest(4)')"
  echo "dirty=$(j log -r @ --no-graph -T 'if(empty, "", "1")')"
elif top=$(git rev-parse --show-toplevel 2>/dev/null); then
  common=$(git rev-parse --path-format=absolute --git-common-dir)
  echo vcs=git
  echo "repo=$(basename "$(dirname "$common")")"
  echo "trunk=$(git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null)"
  echo "work=$(git branch --show-current 2>/dev/null)"
  [ "$(git rev-parse --path-format=absolute --git-dir)" != "$common" ] && echo "tree=$(basename "$top")"
  echo "change=$(git rev-parse --short HEAD 2>/dev/null)"
  # 저절로 도는 probe라 저장소 설정의 fsmonitor 명령을 실행하지 않게 끈다.
  [ -n "$(git -c core.fsmonitor=false status --porcelain 2>/dev/null | head -1)" ] && echo dirty=1
fi
exit 0
`;

const TRUNKS = /^(main|master|develop|trunk)$/;

export function parse(out) {
  const v = {};
  for (const line of (out ?? "").split("\n")) {
    const i = line.indexOf("=");
    if (i > 0) v[line.slice(0, i)] = line.slice(i + 1).trim();
  }
  if (!v.vcs) return null;
  const trunks = (v.trunk ?? "").replace(/^origin\//, "").split(/\s+/).filter(Boolean);
  const names = [...new Set((v.work ?? "").split(/\s+/).filter(Boolean))];
  // jj의 가장 가까운 bookmark가 trunk 자신이면 작업 bookmark가 아직 없는 것. git은 trunk에서 작업 중일 수 있다.
  const work = names.find((b) => !trunks.includes(b)) ?? (v.vcs === "git" ? names[0] : null) ?? null;
  const tree = (v.tree ?? "").split(/\s+/)[0].replace(/@$/, "");
  return {
    vcs: v.vcs,
    repo: v.repo || null,
    trunk: trunks.find((b) => TRUNKS.test(b)) ?? trunks[0] ?? null,
    work,
    tree: tree && tree !== "default" ? tree : null,
    change: v.change || null,
    dirty: v.dirty === "1",
  };
}
