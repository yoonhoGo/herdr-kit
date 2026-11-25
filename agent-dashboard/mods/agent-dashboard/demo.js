// 데모 데이터: props { demo: true }로 열면 실제 스페이스·에이전트 대신 이것을 그린다(미리보기 촬영용).
// herdr 함수(agents, terminals, spaces, panes, machines)와 같은 모양을 돌려주고, 저장소 정보는 vcs로 준다.
// 열 때의 시각(now)으로 상대 시간을 정해, 언제 찍어도 "12분째"처럼 보인다.

const PROGRAMS = {
  claude: { key: "claude", name: "Claude Code", icon: "icons/claude.svg", tint: false, agent: true, shell: false },
  codex: { key: "codex", name: "Codex", icon: "icons/codex.svg", tint: false, agent: true, shell: false },
  pi: { key: "pi", name: "pi", icon: "icons/pi.svg", tint: true, agent: true, shell: false },
  zsh: { key: "shell", name: "zsh", icon: null, tint: true, agent: false, shell: true },
};

// 스페이스 → 탭 → 터미널. agent가 없으면 셸(레인 머리의 '터미널 N').
// ago: 지금 상태가 몇 분째인지. kids: 패널 없는 하위 에이전트.
const SPACES = [
  { name: "shop-api", folder: "/home/dev/shop-api", tabs: [
    { name: "1", terminals: [{ program: "claude", status: "idle", title: "결제 웹훅 재시도 정책 정리", ago: 180, turn: 14 }] },
  ] },
  { name: "SHOP-412 쿠폰 적용 순서", folder: "/home/dev/.worktrees/shop-api/feat-SHOP-412-coupon", tabs: [
    { name: "claude", terminals: [{ program: "claude", status: "working", title: "할인 쿠폰 적용 순서 버그 수정", ago: 12, turn: 9,
      kids: [{ name: "테스트 실행", status: "working" }, { name: "린트", status: "done" }] }] },
  ] },
  { name: "SHOP-415 환불 API", folder: "/home/dev/.worktrees/shop-api/fix-SHOP-415-refund", tabs: [
    { name: "claude", terminals: [{ program: "claude", status: "blocked", title: "환불 API 권한 범위 확인 필요", ago: 4, turn: 6 }, { program: "zsh" }] },
  ] },
  { name: "docs-site", folder: "/home/dev/docs-site", tabs: [
    { name: "가이드", named: true, terminals: [{ program: "codex", status: "done", title: "설치 가이드 다시 쓰기", ago: 7, turn: 21 }] },
    { name: "2", terminals: [{ program: "claude", status: "idle", title: "릴리스 노트 초안", ago: 95, turn: 5 }] },
  ] },
  { name: "notes", folder: "/home/dev/notes", tabs: [
    { name: "1", terminals: [{ program: "claude", status: "idle", title: "주간 회의록 요약", ago: 300, turn: 3 }, { program: "zsh" }, { program: "zsh" }] },
  ] },
  { name: "ml-pipeline", machine: "build-box", folder: "/srv/ml-pipeline", tabs: [
    { name: "1", terminals: [{ program: "pi", status: "working", title: "데이터 증강 실험 3차", ago: 41, turn: 33 }] },
  ] },
];

export const vcs = {
  "|/home/dev/shop-api": { vcs: "git", repo: "shop-api", trunk: "main", work: "main", tree: null, change: "a1b2c3d", dirty: false },
  "|/home/dev/.worktrees/shop-api/feat-SHOP-412-coupon": { vcs: "git", repo: "shop-api", trunk: "main", work: "feat/SHOP-412-coupon", tree: "feat-SHOP-412-coupon", change: "e4f5a6b", dirty: true },
  "|/home/dev/.worktrees/shop-api/fix-SHOP-415-refund": { vcs: "git", repo: "shop-api", trunk: "main", work: "fix/SHOP-415-refund", tree: "fix-SHOP-415-refund", change: "c7d8e9f", dirty: false },
  "|/home/dev/docs-site": { vcs: "jj", repo: "docs-site", trunk: "main", work: "docs/install-guide", tree: null, change: "kqzv", dirty: true },
  "|/home/dev/notes": null,
  "build-box|/srv/ml-pipeline": { vcs: "git", repo: "ml-pipeline", trunk: "main", work: "exp/augment", tree: null, change: "0f1e2d3", dirty: false },
};

const RANK = { blocked: 4, done: 3, working: 2, idle: 1 };

export function demo(now) {
  const spaces = [], agents = [], terminals = [], panes = [];
  let n = 0;
  SPACES.forEach((sp, si) => {
    const sid = `demo-s${si}`;
    const tabs = sp.tabs.map((tb, ti) => {
      const tid = `${sid}-t${ti}`;
      let status = null, changed = null, since = null;
      tb.terminals.forEach((tm, pi) => {
        const address = `${sp.machine ? `${sp.machine}/` : ""}d${++n}`;
        const program = PROGRAMS[tm.program];
        const pane = `${tid}-p${pi}`;
        const at = tm.ago != null ? now - tm.ago * 60000 : null;
        terminals.push({ address, state: "live", status: tm.status ?? null, turn: tm.turn ?? 0, name: null, program, parent: null });
        panes.push({ pane, terminal: address, tab: tid, cwd: sp.folder, name: null, program, status: tm.status ?? null });
        if (!tm.status) return;
        agents.push({
          address, pane, space: sid, space_name: sp.name, tab: tid, tab_index: ti + 1, tab_name: tb.name, status: tm.status,
          app: program.key, program, title: tm.title, pane_name: null, seq: 1000 - (tm.ago ?? 0), pinned: false, focused: false,
        });
        (tm.kids ?? []).forEach((k, ki) => terminals.push({
          address: `${address}k${ki}`, state: "live", status: k.status, turn: 0, name: k.name, program: PROGRAMS.claude, parent: address,
        }));
        if (!status || RANK[tm.status] > RANK[status]) status = tm.status;
        changed = Math.max(changed ?? 0, at ?? 0) || null;
        if (tm.status === "working") since = at;
      });
      return { id: tid, index: ti + 1, name: tb.name, named: Boolean(tb.named), active: ti === 0, status, panes: tb.terminals.length,
        zoomed: false, settled: false, settled_at: null, changed_at: changed, working_since: since };
    });
    spaces.push({ id: sid, index: si + 1, name: sp.name, named: true, folder: sp.folder, machine: sp.machine ?? null, branch: null,
      active: si === 1, status: null, tabs });
  });
  return {
    agents: () => agents,
    terminals: () => terminals,
    spaces: () => spaces,
    panes: () => panes,
    machines: () => [{ name: null, layout: "ready" }, { name: "build-box", layout: "ready" }],
  };
}
