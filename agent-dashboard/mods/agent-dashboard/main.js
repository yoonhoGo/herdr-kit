// 에이전트 실행 현황 매트릭스: 열은 상태(응답 대기·완료·작업 중·유휴), 행(레인)은 스페이스.
// 레인은 가장 급한 상태 순으로 서고, 같은 저장소끼리 묶여 기본 브랜치를 보인다. 스페이스마다
// 작업 브랜치와 워크트리(jj면 bookmark와 workspace)를 보인다.
// 카드 클릭: 그 에이전트를 겹쳐 띄워 바로 답하거나 다음 채팅을 친다(terminal.peek).
// 카드 우클릭이나 ↗: 그 세션으로 간다(agent.focus). Dock 배지에 확인할 개수를 띄운다.

import { View, div, image, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { agents, terminals, spaces, panes, machines, run, theme, settings, setBadge, checking, exec, home, layout, nextCommand, props, shared, setShared, window as win } from "herdr";
import { PROBE, parse } from "./vcs.js";
import { demo, vcs as demoVcs } from "./demo.js";
import { clean, kidStatus, ago, alpha, sameName, terms, matches, groupLanes, laneKey, tally } from "./lib.js";

const STATUSES = ["blocked", "done", "working", "idle"];
const LABEL = { blocked: "응답 대기", done: "완료", working: "작업 중", idle: "유휴" };
const I = {
  alert: "mods/agent-dashboard/icons/alert-circle.svg",
  go: "mods/agent-dashboard/icons/arrow-up-right.svg",
  bookmark: "mods/agent-dashboard/icons/bookmark.svg",
  mouse: "mods/agent-dashboard/icons/mouse.svg",
  check: "mods/workspace-chrome/circle-check.svg",
  spinner: "mods/workspace-chrome/spinner.svg",
  branch: "mods/workspace-chrome/git-branch.svg",
  folder: "mods/workspace-chrome/folder.svg",
  layers: "mods/workspace-chrome/layers.svg",
  server: "mods/workspace-chrome/server.svg",
  clock: "mods/workspace-chrome/clock.svg",
  chevron: "mods/workspace-chrome/chevron-right.svg",
  search: "mods/workspace-chrome/search.svg",
  x: "mods/workspace-chrome/x.svg",
  monitor: "mods/workspace-chrome/monitor.svg",
  terminal: "mods/workspace-chrome/terminal.svg",
  panelRight: "mods/workspace-chrome/panel-right.svg",
  turns: "frame/welcome/messages.svg",
  bot: "frame/welcome/bot.svg",
};
const FRESH_MS = 60000;
const VCS_MS = 60000;
// 이보다 좁으면(디자인 px) 여백·왼쪽 머리·빈 열·아이콘을 줄인다.
const COMPACT_W = 1000;
// 한 줄의 자리: 첫 줄(아이콘·제목)은 높이 LINE에 가운데. 카드는 외곽선 1 + 안쪽 여백(왼 10, 위 9),
// 매트릭스 칸은 여백 CELL. 레인 이름·카드 제목·유휴 제목이 모두 칸 위에서 BASE 높이에 가운데가 오고,
// 열 머리·카드·유휴 항목의 아이콘이 모두 칸 왼쪽에서 CELL + INSET_L에 선다.
const LINE = 20;
const CELL = 10;
const INSET_L = 11;
const IDLE_H = 28;
const BASE = CELL + 1 + 9 + LINE / 2;
// 이보다 좁으면(오른쪽 패널) 상태 열을 접고, 레인마다 에이전트를 위아래로 쌓는다.
const NARROW_W = 760;
// 레이아웃의 오른쪽 패널 블록과 하단 상태 줄 칸(layouts/herdr-glass.json). 하나만 보인다.
const PANEL = "agent-dashboard";
const STRIP = "agent-dashboard-status";
// 패널·상태 줄이 지금 스페이스의 저장소(경로)로 좁혀 보는지. 둘이 같이 쓰므로 shared.
const SCOPE_KEY = "agent-dashboard.scoped";

function findNode(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = findNode(child, id);
    if (found) return found;
  }
  return null;
}

const ico = (path, size, color) => svg(path).size(size).flex_none().text_color(color);

function programIcon(p, size, color) {
  if (!p?.icon) return null;
  return p.tint ? ico(p.icon, size, color) : image(p.icon).w(size).h(size).flex_none();
}

// 살아 있는 상태 아이콘: 작업 중은 도는 고리, 응답 대기는 숨 쉬는 경고, 완료는 체크, 유휴는 빈 고리.
function statusIcon(t, status, size = 14) {
  if (status === "working") return ico(I.spinner, size, t.working).spin(900);
  if (status === "blocked") return ico(I.alert, size, t.blocked).loop("opacity", { from: 0.4, to: 1, period: 1400 });
  if (status === "done") return ico(I.check, size, t.done);
  return div().size(size - 4).mx(2).flex_none().rounded(size).border(1.5).border_color(t.idle ?? t.dim);
}

// 열 머리처럼 멈춰 있는 아이콘: 그 상태가 없으면 흐리게.
function staticIcon(t, status, on, size = 13) {
  const color = on ? t[status] ?? t.dim : t.dim;
  if (status === "idle") return div().size(size - 4).mx(2).flex_none().rounded(size).border(1.5).border_color(color);
  return ico({ blocked: I.alert, done: I.check, working: I.spinner }[status], size, color);
}

const pill = (t, text, color) =>
  div().px(6).h(18).flex_none().rounded(9).flex().items_center().text_size(11).font_medium()
    .bg(alpha(color, 0.16)).text_color(color).child(text);

// 클릭은 겹쳐 띄워 답하기, 우클릭은 세션으로 이동. 카드·칩·버튼이 모두 같은 규칙을 쓴다.
function clicks(el, address) {
  return el
    .on_click((_e, cx) => { cx.stop_propagation(); run("terminal.peek", { terminal: address }); })
    .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); run("agent.focus", { terminal: address }); });
}

export default class Dashboard extends View {
  init(_props, cx) {
    // 이 복사본의 자리: 레이아웃이 { role: "panel" | "status" }를 주고, 탭·분할 창은 "tab".
    this.role = ["panel", "status"].includes(props()?.role) ? props().role : "tab";
    // props { demo: true }: 실제 스페이스·에이전트 대신 demo.js의 가짜 데이터(미리보기 촬영용).
    this.isDemo = Boolean(props()?.demo);
    this.src = this.isDemo ? demo(Date.now()) : { agents, terminals, spaces, panes, machines };
    this.width = 0;
    this.badge = undefined;
    // 필터: 검색어, 보일 상태, 머신("" = 모두, "local" = 이 컴퓨터). 상태와 머신은 기억한다.
    this.query = "";
    this.searchFocused = false;
    this.input = InputState.new({ placeholder: "스페이스, 에이전트, 브랜치 검색" });
    this.input.on("change", (_e, cx) => { this.query = this.input.value(); cx.notify(); });
    this.input.on("focus", (_e, cx) => { this.searchFocused = true; cx.notify(); });
    this.input.on("blur", (_e, cx) => { this.searchFocused = false; cx.notify(); });
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem("statuses") ?? "null"); } catch {}
    // 예전의 "활성만" 보기는 유휴를 끈 것과 같다.
    const legacy = localStorage.getItem("mode") === "active" ? STATUSES.filter((s) => s !== "idle") : STATUSES;
    this.statuses = new Set(Array.isArray(saved) && saved.some((s) => STATUSES.includes(s)) ? saved.filter((s) => STATUSES.includes(s)) : legacy);
    this.machine = localStorage.getItem("machine") ?? "";
    // 폴더(머신|경로)마다 저장소 정보. 키가 있고 값이 undefined면 묻는 중.
    this.vcs = this.isDemo ? { ...demoVcs } : {};
    this.places = [];
    // 폴더마다 마지막으로 물은 시각: 답이 오지 않은 채 오래되면 다시 묻는다.
    this.asked = {};
    // 에이전트마다 지금 상태가 언제 시작됐는지(ms). 다시 불러와도 남게 저장한다.
    try { this.changed = JSON.parse(localStorage.getItem("changed") ?? "{}") ?? {}; } catch { this.changed = {}; }
    // 경과 시간 표시만 갱신한다(상태 변화는 herdr가 알아서 다시 그린다).
    cx.timer.every(30000, (cx) => cx.notify());
    // 브랜치는 herdr가 알려주지 않으니 가끔 다시 묻는다. 창이 안 보이면 쉰다.
    cx.timer.every(VCS_MS, (cx) => { if (win()?.visible !== false) this.refreshVcs(cx, true); });
    // agent-dashboard.toggle(팔레트·키): 보이는 쪽(패널이나 상태 줄 칸)이 받는다. 탭은 받지 않는다(두 번 뒤집지 않게).
    if (this.role !== "tab" && !checking()) cx.spawn(async (cx) => {
      for (;;) {
        if ((await nextCommand()) === "toggle") this.togglePanel();
        cx.notify();
      }
    });
  }

  panelShown() {
    const n = findNode(layout(), PANEL);
    return Boolean(n) && !n.hidden;
  }

  // 패널을 열면 상태 줄 칸을 숨기고, 접으면 상태 줄 칸을 보인다.
  togglePanel() {
    if (!findNode(layout(), PANEL)) return;
    const open = !this.panelShown();
    run(open ? "layout.show" : "layout.hide", { id: PANEL });
    if (findNode(layout(), STRIP)) run(open ? "layout.hide" : "layout.show", { id: STRIP });
  }

  // 패널이 다른 길(layout.show 등)로 열려 둘 다 보이면 상태 줄 칸을 숨긴다.
  syncStrip() {
    const strip = findNode(layout(), STRIP);
    if (strip && !strip.hidden && this.panelShown()) run("layout.hide", { id: STRIP });
  }

  shortPath(dir, machine) {
    return !machine && dir.startsWith(home()) ? `~${dir.slice(home().length)}` : dir;
  }

  async close() {
    if (this.badge) setBadge(null);
  }

  // 아직 모르거나, 물었는데 10초가 지나도 답이 없는 폴더(숨은 복사본에서 시작한 조회가 버려지는 일이 있다).
  needsVcs(key, now) {
    return !(key in this.vcs) || (this.vcs[key] === undefined && now - (this.asked[key] ?? 0) > 10000);
  }

  refreshVcs(cx, all) {
    if (checking() || this.isDemo) return;
    const now = Date.now();
    const todo = this.places.filter((p) => all || this.needsVcs(p.key, now));
    if (!todo.length) return;
    for (const p of todo) {
      if (!(p.key in this.vcs)) this.vcs[p.key] = undefined;
      this.asked[p.key] = now;
    }
    const probe = (p) => exec("sh", ["-c", PROBE], { cwd: p.folder || undefined, on: p.machine, timeout: 15000 })
      .then((r) => parse(r.stdout), () => null)
      .then((info) => [p.key, info]);
    // 끝나는 대로 하나씩 그린다: 느린 원격 머신 하나가 나머지를 붙잡지 않게.
    // cx는 이 작업 본문에서만 쓴다(안쪽 콜백에서 쓰면 작업이 끊긴다).
    cx.spawn(async (cx) => {
      const pending = new Map(todo.map((p) => [p.key, probe(p)]));
      while (pending.size) {
        const [key, info] = await Promise.race(pending.values());
        pending.delete(key);
        this.vcs[key] = info;
        cx.notify();
      }
    });
  }

  // 완료와 유휴는 한 단계로 본다: 완료를 보면 유휴가 되지만 에이전트가 한 일은 없다.
  // 처음 보는 에이전트는 탭이 아는 시각을, 그 뒤로는 바뀐 순간을 쓴다.
  track(list, tabs, now) {
    let dirty = false;
    for (const a of list) {
      const s = a.status === "done" ? "idle" : a.status;
      const c = this.changed[a.address];
      if (c?.s === s) continue;
      const tab = tabs.get(a.tab);
      this.changed[a.address] = { s, at: c ? now : (s === "working" ? tab?.working_since : tab?.changed_at) ?? null };
      dirty = true;
    }
    if (!dirty) return;
    const listed = new Set(list.map((a) => a.address));
    for (const [k, c] of Object.entries(this.changed)) if (!listed.has(k) && !(now - c.at < 86400000)) delete this.changed[k];
    localStorage.setItem("changed", JSON.stringify(this.changed));
  }

  since(a) {
    return this.changed[a.address]?.at ?? null;
  }

  // 제목이 프로그램 이름·주소·경로뿐이면 탭 이름이 더 낫다.
  title(a) {
    const t = clean(a.title);
    return !t || t === a.program?.name || t === a.address || /^[~/]/.test(t) || t.includes("@") ? a.tab_name : t;
  }

  timeText(a, now) {
    const d = ago(this.since(a), now, a.status === "idle");
    if (!d) return "";
    if (d === "방금") return a.status === "done" ? "방금 완료" : "방금";
    return { blocked: `${d}째 대기`, done: `${d} 전 완료`, working: `${d}째`, idle: `${d} 전` }[a.status];
  }

  meta(t, path, text, color) {
    return h_flex().gap(4).items_center().flex_none()
      .child(ico(path, 11, color ?? t.dim))
      .child(div().text_size(11).text_color(color ?? t.dim).child(text));
  }

  goButton(t, address) {
    return div()
      .id(`go-${address}`)
      .size(22)
      .flex_none()
      .rounded(6)
      .flex()
      .items_center()
      .justify_center()
      .cursor_pointer()
      .hover((s) => s.bg(t.hover))
      .tooltip("세션으로 이동")
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => { cx.stop_propagation(); run("agent.focus", { terminal: address }); })
      .child(ico(I.go, 13, t.dim));
  }

  card(t, a, ctx) {
    const title = this.title(a);
    const since = this.since(a);
    const term = ctx.byAddr.get(a.address);
    const kids = ctx.all.filter((k) => k.parent === a.address && k.state === "live");
    const machine = a.address.includes("/") ? a.address.split("/")[0] : null;
    const tab = ctx.tabs.get(a.tab);
    // 탭 이름이 제목을 되풀이하면("3 · agent › <제목>") 감춘다.
    const tabName = tab?.named && !a.tab_name.includes(title) && !title.includes(a.tab_name) ? a.tab_name : null;
    const color = t[a.status] ?? t.dim;
    const blocked = a.status === "blocked";
    const fresh = since != null && ctx.now - since < FRESH_MS && a.status !== "working";
    const time = this.timeText(a, ctx.now);
    // 첫 줄은 세션 아이콘(Claude Code, pi, codex…)과 제목. 아이콘이 없는 프로그램이면 상태 아이콘이 그 자리에.
    const pic = programIcon(a.program, 14, t.foreground);
    // 상태(작업 중은 도는 고리, 응답 대기는 숨 쉬는 경고)는 아랫줄 맨 앞에서 시간과 함께.
    const state = h_flex().gap(4).items_center().flex_none()
      .when(Boolean(pic), (el) => el.child(statusIcon(t, a.status, 11)))
      .child(div().text_size(11).text_color(blocked ? color : t.dim).child(time || LABEL[a.status]));
    return clicks(v_flex()
      .id(`card-${a.address}`)
      .w_full()
      // 넓은 열에서도 한 줄이 읽기 좋은 길이를 넘지 않게.
      .max_w(480)
      .min_w(0)
      .pl(10)
      .pr(6)
      .py(9)
      .gap(6)
      .rounded(10)
      .border_1()
      .border_color(blocked ? alpha(color, 0.55) : fresh ? alpha(t.accent, 0.65) : t.border)
      .bg(blocked ? alpha(color, 0.09) : alpha(t.foreground, 0.035))
      .cursor_pointer()
      .hover((s) => s.border_color(alpha(color, 0.75)).bg(blocked ? alpha(color, 0.14) : alpha(t.foreground, 0.065))), a.address)
      .child(h_flex().gap(8).items_start()
        .child(div().pt((LINE - 14) / 2).flex_none().child(pic ?? statusIcon(t, a.status, 14)))
        // 열이 좁아도 읽히게 자르지 않고 줄바꿈한다.
        .child(div().flex_1().min_w(0).text_size(13).line_height(`${LINE}px`).font_medium().text_color(t.foreground).child(title))
        .child(this.goButton(t, a.address).mt((LINE - 22) / 2)))
      // 아랫줄은 제목 첫 글자에 맞춘다(아이콘 14 + 간격 8).
      .child(h_flex().pl(22).pr(4).gap(10).items_center().flex_wrap()
        .child(state)
        .when(Boolean(term?.turn), (el) => el.child(this.meta(t, I.turns, `${term.turn}턴`)))
        .when(kids.length > 0, (el) => el.child(this.meta(t, I.bot, `하위 ${kids.length}`)))
        .when(Boolean(machine), (el) => el.child(this.meta(t, I.server, machine)))
        .when(Boolean(tabName), (el) => el.child(div().min_w(0).truncate().text_size(11).text_color(t.dim).child(tabName))))
      .when(kids.length > 0, (el) => el.child(
        h_flex().pl(22).pr(4).flex_wrap().gap(4).children(kids.map((k) => clicks(h_flex()
          .id(`kid-${k.address}`)
          .h(22)
          .px(7)
          .gap(5)
          .items_center()
          .rounded(6)
          .border_1()
          .border_color(t.border)
          .bg(alpha(t.foreground, 0.04))
          .text_size(11)
          .text_color(t.muted)
          .hover((s) => s.bg(t.hover)), k.address)
          .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
          .child(statusIcon(t, kidStatus(k.status), 10))
          .child(div().max_w(140).truncate().child(k.name || k.template || k.program?.name || k.address)))),
      ));
  }

  // 유휴는 한 줄. 오래 쉰 것은 흐리게.
  idleItem(t, a, ctx) {
    const since = this.since(a);
    const stale = since != null && ctx.now - since > 3 * 3600000;
    const pic = programIcon(a.program, 14, t.dim);
    return clicks(h_flex()
      .id(`idle-${a.address}`)
      .h(IDLE_H)
      // 카드 안쪽과 같은 자리: 왼쪽은 외곽선 1 + 여백 10, 오른쪽은 외곽선 1 + 여백 6(↗ 버튼 끝).
      // 아이콘(14)과 간격(8)도 카드와 같아 아이콘·제목이 위 카드와 한 줄로 선다.
      .pl(11)
      .pr(7)
      .gap(8)
      .items_center()
      .rounded(7)
      .opacity(stale ? 0.55 : 1)
      .cursor_pointer()
      .hover((s) => s.bg(alpha(t.foreground, 0.06))), a.address)
      .when(Boolean(pic), (el) => el.child(pic))
      .child(div().flex_1().min_w(0).truncate().text_size(12).line_height(`${LINE}px`).text_color(t.muted).child(this.title(a)))
      // 일을 마치고 다음 지시를 기다리는 세션: herdr는 본 완료를 유휴로 바꾸지만 끝난 건 끝난 것이라 흐린 완료 체크를 둔다.
      // (아직 안 본 완료는 카드에서 밝은 체크로 보인다.)
      .child(h_flex().id(`idle-done-${a.address}`).flex_none().gap(4).items_center().tooltip("완료 · 확인함")
        .child(ico(I.check, 11, alpha(t.done, 0.6)))
        .child(div().text_size(11).text_color(t.dim).child(this.timeText(a, ctx.now))));
  }

  // 레인 머리: 스페이스 이름, 작업 브랜치(jj: bookmark), 워크트리(jj: workspace), 머신.
  // 저장소가 아닌 폴더의 경로는 묶음 머리에 있다.
  // plain: 이 스페이스에서 에이전트로 보이지 않는 터미널(셸·nvim 등)의 이름들.
  // inline: 좁은 폭(패널). 왼쪽 열 대신 레인 맨 위에, 칩은 이름 아래 한 줄로 흘린다.
  rowHead(t, s, info, w, plain = [], inline = false) {
    const jj = info?.vcs === "jj";
    const work = info?.work ?? (info?.change ? `@ ${info.change}` : null);
    const tree = info?.tree;
    const treeLabel = `${jj ? "workspace" : "워크트리"} ${tree}`;
    // 워크트리 폴더 이름이 브랜치에서 온 것이면 따로 줄을 두지 않고 브랜치 옆 표시로 줄인다.
    const folded = Boolean(tree) && sameName(info?.work, tree);
    const chip = (path, text, extras = []) => h_flex().gap(6).items_center().min_w(0)
      .child(ico(path, 12, t.dim))
      .child(div().min_w(0).truncate().text_size(11.5).text_color(t.muted).child(text))
      .children(extras.filter(Boolean));
    const dirty = info?.dirty && div().id(`dirty-${s.id}`).size(6).flex_none().rounded(6).bg(t.working).tooltip("커밋 안 된 변경");
    const treeMark = folded && div().id(`tree-${s.id}`).flex_none().tooltip(treeLabel).child(ico(I.layers, 11, t.dim));
    const chips = [
      work && chip(jj ? I.bookmark : I.branch, work, [treeMark, dirty]),
      tree && !folded && chip(I.layers, tree),
      s.machine && chip(I.server, s.machine),
      plain.length > 0 && chip(I.terminal, `터미널 ${plain.length}`).id(`plain-${s.id}`).tooltip(tally(plain)),
      info === undefined && div().h(8).w(96).rounded(4).bg(alpha(t.foreground, 0.08)).loop("opacity", { from: 0.35, to: 1, period: 1200 }),
    ].filter(Boolean);
    const name = div().truncate().text_size(13).line_height(`${LINE}px`).font_semibold().text_color(t.foreground).child(s.name);
    if (inline) return v_flex().w_full().min_w(0).gap(5).child(name).when(chips.length > 0, (el) => el.child(h_flex().flex_wrap().gap_x(14).gap_y(4).children(chips)));
    // 이름이 옆 칸의 첫 줄(카드 제목·유휴 제목)과 같은 높이에 오게.
    return v_flex().w(w).flex_none().px(16).pt(BASE - LINE / 2).pb(12).gap(6).child(name).children(chips);
  }

  // 묶음 머리: 저장소면 이름·vcs·기본 브랜치, 저장소가 아니면 그 경로(dir, 이 컴퓨터면 ~로 줄인다).
  groupHead(t, info, dir, local) {
    const head = h_flex().h(34).flex_none().px(16).gap(8).items_center()
      .bg(alpha(t.foreground, 0.025))
      .border_b_1()
      .border_color(t.border)
      .child(ico(I.folder, 13, t.dim));
    if (!info) {
      return head
        .child(div().min_w(0).truncate().text_size(12).font_semibold().text_color(t.foreground).child(local && dir.startsWith(home()) ? `~${dir.slice(home().length)}` : dir))
        .child(div().px(5).h(16).flex_none().rounded(4).border_1().border_color(t.border).flex().items_center().text_size(10).text_color(t.dim).child("폴더"));
    }
    return head
      .child(div().text_size(12).font_semibold().text_color(t.foreground).child(info.repo))
      .child(div().px(5).h(16).rounded(4).border_1().border_color(t.border).flex().items_center().text_size(10).text_color(t.dim).child(info.vcs))
      .when(Boolean(info.trunk), (el) => el.child(h_flex().gap(4).items_center()
        .child(ico(I.branch, 11, t.dim))
        .child(div().text_size(11).text_color(t.dim).child(`기본 ${info.trunk}`))));
  }

  // 필터 바: 검색, 상태 칩(개수), 머신 칩(둘 이상일 때), 초기화.
  toolbar(t, counts, machineList, machine, filtering, compact, narrow = false) {
    const sep = () => div().w(1).h(18).mx(4).flex_none().bg(t.border);
    const search = h_flex()
      .id("search")
      .h(30)
      .when(narrow, (el) => el.w_full())
      .when(!narrow, (el) => el.w(compact ? 200 : 280))
      .flex_none()
      .px(10)
      .gap(8)
      .items_center()
      .rounded(8)
      .border_1()
      .border_color(this.searchFocused ? alpha(t.accent, 0.8) : t.border)
      .bg(alpha(t.foreground, 0.04))
      .on_key_down((e, cx) => {
        if (e.key !== "escape" || !this.query) return;
        this.clearQuery();
        cx.stop_propagation();
        cx.notify();
      })
      .child(ico(I.search, 13, this.searchFocused ? t.muted : t.dim))
      .child(Input.new(this.input).flex_1().min_w(0).h_full().text_size(12).text_color(t.foreground))
      .when(Boolean(this.query), (el) => el.child(div()
        .id("search-clear")
        .size(18)
        .flex_none()
        .rounded(5)
        .flex()
        .items_center()
        .justify_center()
        .cursor_pointer()
        .hover((s) => s.bg(t.hover))
        .tooltip("검색어 지우기 (Esc)")
        .on_click((_e, cx) => { this.clearQuery(); cx.notify(); })
        .child(ico(I.x, 11, t.dim))));

    const statusChip = (s) => {
      const on = this.statuses.has(s);
      // 켜져 있어도 0개면 상태 색을 입히지 않는다: 빈 상태가 눈을 끌지 않게.
      const color = s === "idle" || !counts[s] ? t.muted : t[s] ?? t.muted;
      return h_flex()
        .id(`f-${s}`)
        .h(30)
        .flex_none()
        .px(10)
        .gap(6)
        .items_center()
        .rounded(8)
        .border_1()
        .border_color(on ? alpha(color, 0.45) : t.border)
        .when(on, (el) => el.bg(alpha(color, 0.12)))
        .cursor_pointer()
        .hover((st) => st.bg(on ? alpha(color, 0.18) : t.hover))
        .tooltip(on ? `${LABEL[s]} 숨기기` : `${LABEL[s]} 보기`)
        .on_click((_e, cx) => this.toggleStatus(s, cx))
        .child(staticIcon(t, s, on && counts[s] > 0, 12))
        .child(div().text_size(12).font_medium().text_color(on ? t.foreground : t.dim).child(LABEL[s]))
        .child(div().text_size(11).text_color(on ? t.muted : t.dim).child(String(counts[s])));
    };

    const machineSeg = machineList.length > 1 && h_flex().h(30).flex_none().p(2).gap(2).items_center().rounded(8)
      .bg(alpha(t.foreground, 0.05)).border_1().border_color(t.border)
      .children([{ key: "", label: "모든 머신" }, ...machineList].map((m) => h_flex()
        .id(`m-${m.key || "all"}`)
        .h_full()
        .px(10)
        .gap(6)
        .items_center()
        .rounded(6)
        .text_size(12)
        .font_medium()
        .text_color(machine === m.key ? t.foreground : t.dim)
        .when(machine === m.key, (el) => el.bg(t.selected).shadow_xs())
        .cursor_pointer()
        .hover((s) => s.text_color(t.foreground))
        .on_click((_e, cx) => this.setMachine(m.key, cx))
        .when(Boolean(m.key), (el) => el.child(ico(m.local ? I.monitor : I.server, 12, machine === m.key ? t.muted : t.dim)))
        .child(m.label)));

    return h_flex().flex_none().gap(8).items_center().flex_wrap()
      .child(search)
      .when(!narrow, (el) => el.child(sep()))
      .children(STATUSES.map(statusChip))
      .when(Boolean(machineSeg), (el) => el.when(!narrow, (e) => e.child(sep())).child(machineSeg))
      .child(div().flex_1())
      .when(filtering, (el) => el.child(this.resetButton(t)));
  }

  resetButton(t) {
    return h_flex()
      .id("reset")
      .h(30)
      .px(10)
      .gap(6)
      .items_center()
      .rounded(8)
      .text_size(12)
      .text_color(t.muted)
      .cursor_pointer()
      .hover((s) => s.bg(t.hover).text_color(t.foreground))
      .on_click((_e, cx) => this.resetFilters(cx))
      .child(ico(I.x, 11, t.dim))
      .child("필터 초기화");
  }

  clearQuery() {
    this.input.set_value("");
    this.query = "";
  }

  toggleStatus(s, cx) {
    // 마지막 하나는 끄지 않는다: 아무것도 안 보이는 표는 쓸모가 없다.
    if (this.statuses.has(s) && this.statuses.size === 1) return;
    if (this.statuses.has(s)) this.statuses.delete(s);
    else this.statuses.add(s);
    localStorage.setItem("statuses", JSON.stringify([...this.statuses]));
    cx.notify();
  }

  setMachine(key, cx) {
    this.machine = key;
    localStorage.setItem("machine", key);
    cx.notify();
  }

  resetFilters(cx) {
    this.clearQuery();
    this.statuses = new Set(STATUSES);
    this.machine = "";
    localStorage.setItem("statuses", JSON.stringify(STATUSES));
    localStorage.setItem("machine", "");
    cx.notify();
  }

  // 매트릭스 왼쪽 위 모서리: 이 표가 어느 머신인지, 몇 개가 보이는지.
  machineCorner(t, m, w, lanes, shown) {
    return v_flex().w(w).flex_none().h_full().px(16).gap(2).justify_center()
      .child(h_flex().gap(7).items_center().min_w(0)
        .child(ico(m.local ? I.monitor : I.server, 14, t.muted))
        .child(div().min_w(0).truncate().text_size(13).font_semibold().text_color(t.foreground).child(m.label)))
      .child(m.down
        ? h_flex().gap(5).items_center().child(div().size(6).flex_none().rounded(6).bg(t.blocked)).child(div().text_size(11).text_color(t.blocked).child("연결 끊김"))
        : div().truncate().text_size(11).text_color(t.dim).child(`스페이스 ${lanes} · 에이전트 ${shown}`));
  }

  nextButton(t, next, count, compact, full = false) {
    if (!next) {
      return h_flex().h(30).flex_none().when(full, (el) => el.w_full()).px(10).gap(6).items_center().rounded(8).border_1().border_color(t.border)
        .child(ico(I.check, 13, t.done))
        .child(div().text_size(12).text_color(t.muted).child("확인할 것 없음"));
    }
    const color = t[next.status] ?? t.accent;
    return clicks(h_flex()
      .id("next")
      .h(30)
      .flex_none()
      .when(full, (el) => el.w_full())
      .pl(10)
      .pr(8)
      .gap(8)
      .items_center()
      .rounded(8)
      .bg(alpha(color, 0.13))
      .border_1()
      .border_color(alpha(color, 0.4))
      .cursor_pointer()
      .hover((s) => s.bg(alpha(color, 0.22))), next.address)
      .child(statusIcon(t, next.status, 13))
      .child(div().text_size(12).font_semibold().text_color(t.foreground).child("다음 확인"))
      .when(full, (el) => el.child(div().flex_1().min_w(0).truncate().text_size(12).text_color(t.muted).child(this.title(next))))
      .when(!compact && !full, (el) => el.child(div().max_w(220).truncate().text_size(12).text_color(t.muted).child(this.title(next))))
      .child(pill(t, String(count), color))
      .child(ico(I.chevron, 13, t.muted));
  }

  empty(t, path, color, title, sub, action) {
    return v_flex().w_full().py(72).items_center().justify_center().gap(8)
      .child(ico(path, 28, color))
      .child(div().text_size(14).font_medium().text_color(t.muted).child(title))
      .child(div().text_size(12).text_color(t.dim).child(sub))
      .when(Boolean(action), (el) => el.child(div().mt(6).child(action)));
  }

  // 범위 칩(패널): 지금 스페이스의 저장소(경로)로 좁혀 보는 중이면 그 이름과 ✕, 아니면 다시 좁히는 버튼.
  scopeChip(t, scope, scoped) {
    if (!scoped) {
      return h_flex().id("scope-on").h(26).flex_none().px(9).gap(6).items_center().rounded(7).border_1().border_color(t.border)
        .cursor_pointer().hover((s) => s.bg(t.hover)).tooltip(`${scope.label}의 스페이스만 보기`)
        .on_click(() => setShared(SCOPE_KEY, true))
        .child(ico(scope.dir ? I.folder : I.branch, 12, t.dim))
        .child(div().text_size(12).text_color(t.muted).child("현재 저장소만"));
    }
    return h_flex().h(26).min_w(0).pl(9).pr(3).gap(6).items_center().rounded(7)
      .bg(alpha(t.accent, 0.12)).border_1().border_color(alpha(t.accent, 0.35))
      .child(ico(scope.dir ? I.folder : I.branch, 12, t.accent))
      .child(div().min_w(0).truncate().text_size(12).font_medium().text_color(t.foreground).child(scope.label))
      .child(div().id("scope-off").size(20).flex_none().rounded(5).flex().items_center().justify_center()
        .cursor_pointer().hover((s) => s.bg(t.hover)).tooltip("모든 스페이스 보기")
        .on_click(() => setShared(SCOPE_KEY, false))
        .child(ico(I.x, 10, t.muted)));
  }

  collapseButton(t) {
    return div().id("collapse").size(28).flex_none().rounded(7).flex().items_center().justify_center()
      .cursor_pointer().hover((s) => s.bg(t.hover)).tooltip("접기: 하단 상태 줄에 요약")
      .on_click(() => this.togglePanel())
      .child(ico(I.panelRight, 15, t.muted));
  }

  // 하단 상태 줄 칸: 패널이 접혀 있을 때 그 자리를 대신한다. 범위의 상태별 개수와 다음 확인, 누르면 패널을 연다.
  strip(t, scope, scoped, counts, next) {
    const total = STATUSES.reduce((n, s) => n + counts[s], 0);
    return h_flex()
      .id("strip")
      .size_full()
      .px(12)
      .gap(10)
      .items_center()
      .bg(t.chrome)
      .text_size(12)
      .text_color(t.foreground)
      .cursor_pointer()
      .hover((s) => s.bg(alpha(t.foreground, 0.05)))
      .tooltip("에이전트 대시보드 열기")
      .on_click(() => this.togglePanel())
      .child(ico(I.bot, 13, t.muted))
      .child(div().flex_none().max_w(150).truncate().text_color(t.muted).child(scoped && scope ? scope.label : "모든 에이전트"))
      .children(STATUSES.filter((s) => counts[s]).map((s) => h_flex().gap(4).items_center().flex_none()
        .child(statusIcon(t, s, 11))
        .child(div().text_color(s === "idle" ? t.dim : t.foreground).child(String(counts[s])))))
      .when(!total, (el) => el.child(div().text_color(t.dim).child("에이전트 없음")))
      .when(Boolean(next), (el) => el.child(div().min_w(0).truncate().text_color(t.dim).child(`· 다음 ${this.title(next)}`)))
      .child(div().flex_1())
      .child(ico(I.panelRight, 13, t.dim));
  }

  render(cx) {
    const t = theme();
    const now = Date.now();
    const all = this.src.terminals();
    const list = this.src.agents();
    const spaceList = this.src.spaces();
    const tabs = new Map(spaceList.flatMap((s) => s.tabs.map((tab) => [tab.id, tab])));
    this.track(list, tabs, now);
    const listed = new Set(list.map((a) => a.address));
    // 패널을 받은 하위 에이전트는 부모 카드 안에 있으니 따로 세우지 않는다.
    const nested = new Set(all.filter((k) => k.parent && listed.has(k.parent)).map((k) => k.address));
    const top = list.filter((a) => !nested.has(a.address));
    // on_size_change는 창 px: 줌으로 나눠 디자인 px로 비교한다.
    const designW = this.width / (Number(settings().zoom) || 1);
    const compact = this.width > 0 && designW < COMPACT_W;
    const narrow = this.width > 0 && designW < NARROW_W;
    const ctx = { now, all, tabs, compact, byAddr: new Map(all.map((k) => [k.address, k])) };
    if (this.role !== "tab") this.syncStrip();

    // 스페이스의 저장소는 첫 터미널이 지금 있는 폴더로 본다(기본 mod들과 같게).
    const cwdOfTab = new Map();
    // 탭마다 에이전트로 보이지 않는 터미널: 매트릭스엔 없지만 떠 있다는 것만 레인 머리에 센다.
    const plainOfTab = new Map();
    for (const p of this.src.panes()) {
      if (p.cwd && !cwdOfTab.has(p.tab)) cwdOfTab.set(p.tab, p.cwd);
      if (p.terminal && !listed.has(p.terminal)) plainOfTab.set(p.tab, [...(plainOfTab.get(p.tab) ?? []), p.name || p.program?.name || p.terminal]);
    }
    const place = (s) => {
      const folder = s.tabs.map((tab) => cwdOfTab.get(tab.id)).find(Boolean) ?? s.folder;
      const key = `${s.machine ?? ""}|${folder}`;
      const mkey = s.machine ?? "local";
      const info = this.vcs[key];
      return { folder, key, mkey, info, repo: laneKey(info, mkey, folder, s.id) };
    };
    const allRows = spaceList
      .map((s) => ({ s, mine: top.filter((a) => a.space === s.id), plain: s.tabs.flatMap((tab) => plainOfTab.get(tab.id) ?? []), ...place(s) }))
      .filter((r) => r.mine.length);

    // 패널과 상태 줄은 지금 보고 있는 스페이스의 저장소(아니면 경로)에 속한 스페이스만 본다(칩으로 끈다).
    const here = this.role !== "tab" ? spaceList.find((s) => s.active) : null;
    const hereAt = here ? place(here) : null;
    const scope = hereAt && {
      label: hereAt.info?.repo ?? (hereAt.info === null ? this.shortPath(hereAt.folder, here.machine) : here.name),
      dir: !hereAt.info?.repo,
      repo: hereAt.repo,
      // 범위를 걸면 묶음 머리를 그리지 않으므로, 머리에만 있던 vcs와 기본 브랜치를 범위 옆에 보인다.
      about: hereAt.info?.repo ? [hereAt.info.vcs, hereAt.info.trunk && `기본 ${hereAt.info.trunk}`].filter(Boolean).join(" · ") : "",
    };
    const scoped = Boolean(scope) && shared(SCOPE_KEY) !== false;
    const rows = scoped ? allRows.filter((r) => r.repo === scope.repo) : allRows;
    // 범위를 정하려면 모든 레인의 저장소를 알아야 한다: 지금 스페이스(에이전트가 없어도)까지 묻는다.
    this.places = [...allRows.map((r) => ({ key: r.key, folder: r.folder, machine: r.s.machine })),
      ...(hereAt ? [{ key: hereAt.key, folder: hereAt.folder, machine: here.machine }] : [])];
    if (this.places.some((p) => this.needsVcs(p.key, now))) this.refreshVcs(cx, false);

    const scopeAgents = rows.flatMap((r) => r.mine);
    // 시각을 모르면 앱이 켜지기 전부터 그 상태였던 것: 가장 오래된 것으로 친다.
    const oldest = (a, b) => (this.since(a) ?? 0) - (this.since(b) ?? 0);
    const sorters = { blocked: oldest, done: oldest, working: oldest, idle: (a, b) => b.seq - a.seq };
    // 응답 대기가 먼저, 그 안에서는 오래 기다린 것부터.
    const queue = (xs) => [...xs.filter((a) => a.status === "blocked").sort(oldest), ...xs.filter((a) => a.status === "done").sort(oldest)];
    const attention = queue(scopeAgents);
    // Dock 배지는 범위와 상관없이 전부.
    const allAttention = queue(top).length;
    const badge = !checking() && allAttention ? String(allAttention) : null;
    // 데모는 배지를 건드리지 않는다: 가짜 개수를 띄우거나 실제 배지를 지우지 않게.
    if (!this.isDemo && badge !== this.badge) { this.badge = badge; setBadge(badge); }
    const totals = Object.fromEntries(STATUSES.map((s) => [s, scopeAgents.filter((a) => a.status === s).length]));

    if (this.role === "status") return this.strip(t, scope, scoped, totals, attention[0]);

    // 머신: 이 컴퓨터가 먼저, 나머지는 이름순. 연결 상태는 machines()에서.
    const states = new Map(this.src.machines().map((m) => [m.name ?? "local", m.layout]));
    const machineList = [...new Set(rows.map((r) => r.mkey))]
      .sort((a, b) => (a === "local" ? -1 : b === "local" ? 1 : a.localeCompare(b)))
      .map((key) => ({ key, local: key === "local", label: key === "local" ? "이 컴퓨터" : key, down: states.get(key) === "unavailable" }));
    // 기억한 머신에 에이전트가 없어졌으면 모두 보인다.
    const machine = machineList.some((m) => m.key === this.machine) ? this.machine : "";

    // 필터: 머신 → 검색어 → 상태. 검색은 레인(스페이스·저장소·브랜치·폴더·머신)과
    // 에이전트(제목·탭·프로그램)를 함께 본다: 레인이 맞으면 그 레인의 에이전트가 모두 맞는다.
    const words = terms(this.query);
    const found = rows
      .filter((r) => !machine || r.mkey === machine)
      .map((r) => {
        const i = r.info;
        const lane = [r.s.name, i?.repo, i?.work, i?.tree, i?.trunk, i?.change, r.folder, r.s.machine ?? "이 컴퓨터 local"];
        return { ...r, found: r.mine.filter((a) => matches(words, ...lane, this.title(a), a.tab_name, a.program?.name, a.app, a.address)) };
      })
      .filter((r) => r.found.length);
    const counts = Object.fromEntries(STATUSES.map((s) => [s, found.reduce((n, r) => n + r.found.filter((a) => a.status === s).length, 0)]));
    const columns = STATUSES.filter((s) => this.statuses.has(s));
    const filtering = words.length > 0 || columns.length < STATUSES.length || Boolean(machine);

    // 레인은 가장 급한 에이전트 상태 순(응답 대기 → 완료 → 작업 중 → 유휴), 같은 저장소·경로끼리 묶는다(groupLanes).
    const lanes = found
      .map((r, i) => {
        const shown = r.found.filter((a) => this.statuses.has(a.status));
        return { ...r, shown, i, rank: Math.min(...shown.map((a) => STATUSES.indexOf(a.status))) };
      })
      .filter((l) => l.shown.length);
    // 머신마다 한 표. 그 안에서 같은 저장소가 이어지면 한 묶음.
    const sections = machineList
      .map((m) => {
        const mine = lanes.filter((l) => l.mkey === m.key);
        return { m, lanes: mine, groups: groupLanes(mine) };
      })
      .filter((sec) => sec.lanes.length);
    const shownCount = lanes.reduce((n, l) => n + l.shown.length, 0);

    const pad = narrow ? 16 : compact ? 16 : 24;
    const headW = compact ? 150 : 236;
    // 비어 있는 상태 열은 좁혀, 카드가 있는 열이 자리를 나눠 갖게 한다. 모든 머신의 표가 같은 폭을 쓴다.
    const size = (el, status) => (counts[status] ? el.flex_1().min_w(0) : el.w(compact ? 64 : 112).flex_none());
    const line = alpha(t.border, 0.6);
    // 범위를 걸면 모든 레인이 한 저장소(경로)라 묶음 머리는 범위 칩을 되풀이할 뿐이다.
    const groupHeads = (g, m) => (!scoped && (g.info || g.dir) ? [this.groupHead(t, g.info, g.dir, m.local)] : []);
    const perStatus = (ls) => (s) => ls.reduce((k, l) => k + l.shown.filter((a) => a.status === s).length, 0);

    const columnHead = (status, n) => size(h_flex(), status)
      .h_full()
      // 아이콘을 그 아래 카드·유휴 항목의 아이콘과 같은 세로줄에.
      .pl(CELL + INSET_L)
      .pr(12)
      .gap(8)
      .items_center()
      .border_l_1()
      .border_color(line)
      .child(staticIcon(t, status, n > 0))
      .when(n > 0 || !compact, (el) => el.child(div().min_w(0).truncate().text_size(12).font_medium()
        .text_color(n ? t.foreground : t.dim).child(LABEL[status])))
      .when(n > 0, (el) => el.child(pill(t, String(n), status === "idle" ? t.muted : t[status] ?? t.muted)));

    const laneRow = (r) => h_flex()
      .id(`lane-${r.s.id}`)
      .items_stretch()
      .border_b_1()
      .border_color(line)
      .hover((s) => s.bg(alpha(t.foreground, 0.015)))
      .child(this.rowHead(t, r.s, r.info, headW, r.plain))
      .children(columns.map((st) => {
        const mine = r.shown.filter((a) => a.status === st).sort(sorters[st]);
        return size(v_flex(), st)
          .px(CELL)
          .pb(CELL)
          // 유휴 첫 줄도 카드 제목과 같은 높이에 가운데가 오게.
          .pt(st === "idle" ? BASE - IDLE_H / 2 : CELL)
          .gap(st === "idle" ? 2 : 8)
          .border_l_1()
          .border_color(line)
          .when(st === "blocked" && mine.length > 0, (el) => el.bg(alpha(t.blocked, 0.045)))
          .children(mine.map((a) => (st === "idle" ? this.idleItem(t, a, ctx) : this.card(t, a, ctx))));
      }));

    // 좁은 폭: 상태 열 대신 레인마다 급한 순으로 쌓는다(카드의 상태 아이콘이 열을 대신한다).
    const stackLane = (r) => {
      const ordered = [...r.shown].sort((a, b) => STATUSES.indexOf(a.status) - STATUSES.indexOf(b.status) || sorters[a.status](a, b));
      const busy = ordered.filter((a) => a.status !== "idle");
      const idle = ordered.filter((a) => a.status === "idle");
      return v_flex()
        .id(`lane-${r.s.id}`)
        .px(14)
        .py(12)
        .gap(9)
        .border_b_1()
        .border_color(line)
        .child(this.rowHead(t, r.s, r.info, 0, r.plain, true))
        .when(busy.length > 0, (el) => el.child(v_flex().gap(8).children(busy.map((a) => this.card(t, a, ctx)))))
        .when(idle.length > 0, (el) => el.child(v_flex().children(idle.map((a) => this.idleItem(t, a, ctx)))));
    };

    const frame = (m) => v_flex()
      .flex_none()
      .rounded(12)
      .border_1()
      .border_color(m.down ? alpha(t.blocked, 0.45) : t.border)
      .bg(alpha(t.foreground, 0.015))
      .overflow_hidden();

    const section = ({ m, lanes: ls, groups }) => frame(m)
      .child(h_flex().h(52).flex_none().items_stretch().bg(alpha(t.foreground, 0.03)).border_b_1().border_color(t.border)
        .child(this.machineCorner(t, m, headW, ls.length, ls.reduce((k, l) => k + l.shown.length, 0)))
        .children(columns.map((s) => columnHead(s, perStatus(ls)(s)))))
      .children(groups.flatMap((g) => [...groupHeads(g, m), ...g.rows.map(laneRow)]));

    // 좁은 폭의 머신 머리: 머신이 하나뿐이고 이 컴퓨터면 생략한다.
    const stackSection = ({ m, lanes: ls, groups }) => {
      const n = perStatus(ls);
      return frame(m)
        .when(sections.length > 1 || !m.local, (el) => el.child(h_flex().h(40).flex_none().px(14).gap(8).items_center()
          .bg(alpha(t.foreground, 0.03)).border_b_1().border_color(t.border)
          .child(ico(m.local ? I.monitor : I.server, 14, t.muted))
          .child(div().min_w(0).truncate().text_size(13).font_semibold().text_color(t.foreground).child(m.label))
          .when(m.down, (e) => e.child(div().text_size(11).text_color(t.blocked).child("연결 끊김")))
          .child(div().flex_1())
          .children(STATUSES.filter((s) => n(s)).map((s) => h_flex().gap(4).items_center().flex_none()
            .child(staticIcon(t, s, true, 11)).child(div().text_size(11.5).text_color(t.muted).child(String(n(s))))))))
        .children(groups.flatMap((g) => [...groupHeads(g, m), ...g.rows.map(stackLane)]));
    };

    // 상태 비율: 지금 일이 어디에 몰려 있는지 한눈에(범위 안 전부, 필터와 상관없이).
    const bar = h_flex().h(6).w_full().flex_none().rounded(3).overflow_hidden().gap(2)
      .children(STATUSES.filter((s) => totals[s]).map((s) =>
        div().h_full().flex_basis(0).flex_grow(totals[s]).bg(s === "idle" ? alpha(t.foreground, 0.16) : t[s] ?? t.dim)));

    const body = !top.length
      ? this.empty(t, I.bot, t.dim, "실행 중인 에이전트가 없어요", "에이전트를 시작하면 여기에 나타나요")
      : !rows.length
        ? this.empty(t, scope?.dir ? I.folder : I.branch, t.dim, `${scope.label}에서 실행 중인 에이전트가 없어요`,
          `다른 스페이스에 에이전트 ${top.length}개가 있어요`, this.scopeChip(t, scope, false))
        : !sections.length
          ? this.empty(t, I.search, t.dim, "조건에 맞는 에이전트가 없어요",
            words.length ? `"${this.query.trim()}"에 맞는 스페이스나 에이전트가 없어요` : "보이는 상태나 머신을 바꿔 보세요", this.resetButton(t))
          : v_flex().gap(narrow ? 12 : 16).pb(4).children(sections.map(narrow ? stackSection : section));

    const hint = (path, text) => h_flex().gap(5).items_center().flex_none().child(ico(path, 12, t.dim)).child(text);
    const subtitle = filtering
      ? `에이전트 ${rows.reduce((n, r) => n + r.mine.length, 0)}개 중 ${shownCount}개 표시 · 스페이스 ${lanes.length}개`
      : `${scoped && scope.about ? `${scope.about} · ` : ""}스페이스 ${rows.length}개 · 에이전트 ${scopeAgents.length}개${narrow ? "" : ` · 머신 ${machineList.length}대`}`;
    const title = h_flex().gap(8).items_center().min_w(0)
      .child(div().text_size(narrow ? 16 : 18).font_semibold().text_color(t.foreground).child("에이전트 현황"))
      .child(div().size(7).flex_none().rounded(7).bg(t.done).loop("opacity", { from: 0.3, to: 1, period: 2000 }));
    const panel = this.role === "panel";

    // 좁으면: 제목(과 접기) / 범위 칩과 요약 / 다음 확인(한 줄 전체). 넓으면: 제목·요약 왼쪽, 범위 칩·다음 확인·접기 오른쪽.
    const header = narrow
      ? v_flex().flex_none().gap(10)
        .child(h_flex().items_center().gap(8).child(title).child(div().flex_1()).when(panel, (el) => el.child(this.collapseButton(t))))
        .child(h_flex().items_center().gap(10).min_w(0)
          .when(Boolean(scope), (el) => el.child(this.scopeChip(t, scope, scoped)))
          .child(div().min_w(0).truncate().text_size(12).text_color(t.dim).child(subtitle)))
        .child(this.nextButton(t, attention[0], attention.length, compact, true))
      : h_flex().flex_none().items_center().gap(12)
        .child(v_flex().flex_1().min_w(0).gap(4).child(title).child(div().truncate().text_size(12).text_color(t.dim).child(subtitle)))
        .when(Boolean(scope), (el) => el.child(this.scopeChip(t, scope, scoped)))
        .child(this.nextButton(t, attention[0], attention.length, compact))
        .when(panel, (el) => el.child(this.collapseButton(t)));

    return v_flex()
      .id("root")
      .size_full()
      // 탭은 터미널 탭과 같은 배경(t.background: 반투명 테마면 창 배경이 비친다), 패널·상태 줄은 레이아웃 블록이 그린다.
      .bg(this.role === "tab" ? t.background : t.chrome)
      .px(pad)
      .pt(narrow ? 16 : 20)
      .pb(12)
      .gap(narrow ? 12 : 14)
      .on_size_change((size, cx) => { this.width = size.width; cx.notify(); })
      .child(header)
      .when(scopeAgents.length > 0, (el) => el.child(bar).child(this.toolbar(t, counts, machineList, machine, filtering, compact, narrow)))
      .child(div().id("matrix").flex_1().min_h(0).overflow_y_scrollbar().child(body))
      .child(h_flex().flex_none().gap(narrow ? 12 : 16).items_center().text_size(11).text_color(t.dim)
        .child(hint(I.mouse, narrow ? "클릭: 응답" : "클릭: 여기서 바로 응답"))
        .child(hint(I.go, narrow ? "우클릭·↗: 이동" : "우클릭 또는 ↗: 세션으로 이동"))
        .child(div().flex_1())
        .when(!compact, (el) => el.child(hint(I.branch, "브랜치 정보는 1분마다 갱신"))));
  }
}
