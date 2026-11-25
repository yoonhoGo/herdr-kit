// Kommand — 하나의 팔레트: 이동(탭·에이전트), 앱 명령, mod 열기와 mod 기능을 한 목록에서 찾는다.
// herdr TUI 플러그인 herdr-bar(github.com/jeffarese/herdr-bar, MIT)를 따라 herdr-app mod로 새로 만들었다.
// 기본 팔레트(frame/palette)에 picker의 장소와 mods/*/mod.json을 더했다.
// mod는 mod.json에 "overlay"가 있으면 "Open <title>"로 나오고, 자기 기능은
//   "palette": [{ "title": "jj: Graph", "props": { "run": "graph" } }]   // 그 props로 mod를 연다
//   "palette": [{ "title": "…", "command": "tab.new", "args": {} }]      // 앱 명령을 실행한다
// 로 올린다. keys.json에 묶인 "<mod>.<command>"도 나온다.
// 첫 글자 > @ $ ! 로 범위를 좁힌다(명령·에이전트·탭·대기). props { query }로 검색어를 채워 열 수 있다.
// 퍼지 검색, 비었을 때는 최근 → 장소 → mod → 명령. Enter 실행, ↑/↓ 이동, Esc 닫기.

import { View, div, svg, image } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import * as fs from "fs/promises";
import { commands, layouts, keys, run, theme, props, closeOverlay, openOverlay, shared, window as win, spaces, agents, appHome, layout } from "herdr";

// The list keeps one height while you move: rows and group titles have fixed
// heights, and the window shows as many as fit in LIST_H.
// 10 rows: with the search line it fits the popup (at most 85% of the
// window) down to ~580 px windows at zoom 1.3.
const SHOWN = 10;
const ROW_H = 32;
const HEAD_H = 26;
const LIST_H = SHOWN * ROW_H;
const GROUPS = ["Recent", "Go to", "Mod", "Tab", "Pane", "Space", "Layout", "Terminal", "Agent", "Window", "App"];

// The palette's names for commands: [command, args, group, title, keywords].
const NAMED = [
  ["tab.new", {}, "Tab", "New tab", "tab agent new task"],
  ["tab.rename", {}, "Tab", "Rename tab", "tab"],
  ["tab.close", {}, "Tab", "Close tab", "tab kill"],
  ["tab.next", {}, "Tab", "Next tab", "tab"],
  ["tab.prev", {}, "Tab", "Previous tab", "tab"],
  ["pane.split", { direction: "right" }, "Pane", "Split right", "vertical"],
  ["pane.split", { direction: "down" }, "Pane", "Split down", "horizontal"],
  ["pane.close", {}, "Pane", "Close pane", "kill"],
  ["pane.zoom", {}, "Pane", "Zoom pane", "maximize fullscreen"],
  ...["left", "right", "up", "down"].map((d) => ["pane.go", { direction: d }, "Pane", `Focus pane ${d}`, "move go"]),
  ...["left", "right", "up", "down"].map((d) => ["pane.swap", { direction: d }, "Pane", `Swap pane ${d}`, "move"]),
  ["space.new", {}, "Space", "New space", "workspace"],
  ["space.rename", {}, "Space", "Rename space", "workspace"],
  ["space.close", {}, "Space", "Close space", "workspace kill"],
  ["space.next", {}, "Space", "Next space", "workspace"],
  ["space.prev", {}, "Space", "Previous space", "workspace"],
  ["layout.switch", {}, "Layout", "Next layout", "look switch"],
  ["layout.reset", {}, "Layout", "Reset layout", "new version default restore herdr's"],
  ["layout.clone", {}, "Layout", "Duplicate layout", "clone copy customize"],
  ["mod.clone", {}, "Layout", "Duplicate mod", "clone copy customize"],
  ["terminal.open", {}, "Terminal", "New terminal", "shell"],
  ["terminal.copy", {}, "Terminal", "Copy", "clipboard"],
  ["terminal.paste", {}, "Terminal", "Paste", "clipboard"],
  ["agent.next", {}, "Agent", "Next agent", ""],
  ["agent.prev", {}, "Agent", "Previous agent", ""],
  ["window.minimize", {}, "Window", "Minimize window", ""],
  ["window.maximize", {}, "Window", "Maximize window", "restore"],
  ["window.close", {}, "Window", "Close window", "quit"],
  ["app.settings", {}, "App", "Settings", "preferences options config look font theme sound"],
  ["app.help", {}, "App", "Keys", "keybindings shortcuts help"],
  ["app.welcome", {}, "App", "Welcome", "intro start onboarding"],
  ["app.whats_new", {}, "App", "What's new", "release changes news update"],
  ["app.reset", {}, "App", "Reset to the default screen", "escape hatch broken restore"],
  ["app.zoom_in", {}, "App", "Zoom in", "bigger font size"],
  ["app.zoom_out", {}, "App", "Zoom out", "smaller font size"],
  ["app.zoom_reset", {}, "App", "Reset zoom", "font size"],
  ["app.quit", {}, "App", "Quit Herdr", "exit"],
  ...["graphite", "ink", "moss", "atom-one-dark"].map((n) => ["app.theme", { name: n }, "App", `Theme: ${n.replace(/-/g, " ")}`, "colors look"]),
];

// Commands that act on something you point at (ids, terminals): not for a list.
const HIDDEN = new Set([
  "space.move", "tab.move", "space.select", "tab.select", "pane.focus", "terminal.keep",
  "terminal.park", "terminal.kill", "terminal.show", "agent.focus", "layout.set", "layout.toggle",
  "layout.show", "layout.hide", "layout.resize", "layout.select", "mod.open", "overlay.close",
  "tab.settle", "tab.unsettle",
  "app.palette", "app.hide", "app.hide_others", "app.show_all", "app.theme", "app.settings",
]);

function titleOf(name) {
  const [noun, verb] = name.split(".");
  return { group: noun.charAt(0).toUpperCase() + noun.slice(1), title: `${verb.replace(/_/g, " ")} ${noun}`.replace(/^./, (c) => c.toUpperCase()) };
}

// 급한 것부터: 나를 기다리는 것, 끝난 것, 나머지. 지금 있는 곳은 맨 뒤(열고 Enter = alt-tab).
const URGENCY = { blocked: 0, done: 1 };

const isPlace = (e) => e.name === "tab.select" || e.name === "agent.focus";
// 맨 앞 픽토그램: 탭은 터미널, 에이전트는 그 프로그램의 아이콘, mod는 겹친 판, 나머지는 ⌘.
function icon(t, e) {
  const p = e.program;
  if (p?.icon && !p.tint) return image(p.icon).w(15).h(15).flex_none();
  const path = e.name === "tab.select" ? "mods/workspace-chrome/terminal.svg"
    : e.name === "agent.focus" ? (p?.icon ?? "icons/agent.svg")
    : e.group === "Mod" ? "mods/workspace-chrome/layers.svg"
    : "frame/palette/command.svg";
  return svg(path).size(15).flex_none().text_color(t.dim);
}

const SCOPES = {
  ">": (e) => !isPlace(e),
  "@": (e) => e.name === "agent.focus",
  "$": (e) => e.name === "tab.select",
  "!": (e) => isPlace(e) && e.status in URGENCY,
};

// 갈 수 있는 곳: 탭마다 한 줄, 에이전트마다 한 줄.
function places() {
  const all = agents();
  const tabs = spaces().flatMap((w) => w.tabs.map((tab) => {
    const mine = all.filter((a) => a.tab === tab.id);
    return {
      name: "tab.select", args: { id: tab.id }, group: "Go to", title: `${w.name} › ${tab.name}`, status: tab.status,
      words: [w.branch ?? "", ...mine.flatMap((a) => [a.program?.name ?? "", a.title])].join(" "),
      here: w.active && tab.active,
    };
  }));
  const rank = (e) => (e.here ? 9 : URGENCY[e.status] ?? 2);
  tabs.sort((a, b) => rank(a) - rank(b));
  const who = all.map((a) => ({
    name: "agent.focus", args: { terminal: a.address }, group: "Agent", status: a.status, program: a.program,
    title: `${a.program?.name ?? "agent"}: ${a.title || a.tab_name}`, words: `${a.space_name} ${a.tab_name} ${a.app ?? ""}`,
  }));
  return [...tabs, ...who];
}

// 보이는 레이아웃의 스택에 든 패널(main의 Files, Changes): 탭 바 버튼처럼 고르고 펼치고, 보이는 중이면 접는다.
function panels(node = layout(), hideable = [], out = []) {
  if (!node || typeof node !== "object") return out;
  const up = "hidden" in node && node.id ? [...hideable, node] : hideable;
  if (node.type === "stack" && node.id) {
    for (const c of node.children ?? []) {
      if (!c?.id) continue;
      const on = node.active === c.id && up.every((n) => !n.hidden);
      const runs = on && up.length
        ? [["layout.hide", { id: up[up.length - 1].id }]]
        : [["layout.select", { stack: node.id, child: c.id }], ...up.map((n) => ["layout.show", { id: n.id }])];
      out.push({ name: `panel:${c.id}`, args: {}, group: "Mod", title: c.id.replace(/^./, (ch) => ch.toUpperCase()), words: `panel ${c.content?.mod ?? ""}`, runs });
    }
  }
  for (const c of node.children ?? []) panels(c, up, out);
  return out;
}

// mods/*/mod.json이 내놓은 것: 열 수 있는 mod와 그 mod의 기능.
async function readMods() {
  const dir = `${appHome()}/mods`;
  const out = [];
  for (const name of (await fs.readdir(dir)).sort()) {
    if (name === "kommand") continue;
    let m;
    try { m = JSON.parse(await fs.readFile(`${dir}/${name}/mod.json`, "utf8")); } catch { continue; }
    const label = m.title ?? name;
    if (m.overlay) out.push({ name: "mod.open", args: { name }, group: "Mod", title: `Open ${label}`, words: name });
    for (const p of Array.isArray(m.palette) ? m.palette : []) {
      if (typeof p?.title !== "string") continue;
      out.push(p.command
        ? { name: p.command, args: p.args ?? {}, group: "Mod", title: p.title, words: `${name} ${p.words ?? ""}` }
        : { name: `${name}:${p.title}`, args: {}, group: "Mod", title: p.title, words: `${name} ${p.words ?? ""}`, open: { ...m.overlay, mod: name, props: p.props ?? {} } });
    }
  }
  return out;
}

// Every entry for the state we're in now.
function entries(mods) {
  const known = new Set(commands().map((c) => c.name));
  const mac = win()?.platform === "macos";
  const list = NAMED.filter(([n]) => known.has(n))
    .filter(([n]) => !(mac && n.startsWith("window.")))
    .map(([name, args, group, title, words]) => ({ name, args, group, title, words }));
  for (const l of layouts()) {
    const t = { main: "Herdr", terminals: "Terminals", win98: "Herdr 98" }[l] ?? l.charAt(0).toUpperCase() + l.slice(1);
    list.push({ name: "layout.switch", args: { name: l }, group: "Layout", title: `Layout: ${t}`, words: `look ${l}` });
  }
  // Anything new in the app shows up too, until it gets a better name here.
  const named = new Set(NAMED.map(([n]) => n));
  for (const c of commands()) {
    if (named.has(c.name) || HIDDEN.has(c.name) || c.args.some((a) => a.required && a.name !== "name")) continue;
    list.push({ name: c.name, args: {}, ...titleOf(c.name), words: c.about });
  }
  // keys.json에 묶인 것 중 아직 없는 것 전부(전역과 지금 레이아웃): 키로 되는 건 여기서도 된다.
  // "name:value"의 value는 그 명령의 첫 인자, "<mod>.<command>"는 보이는 mod에만 닿는다.
  const app = new Map(commands().map((c) => [c.name, c]));
  const have = new Set(list.map(actionOf));
  for (const a of new Set(keys().filter((b) => sections().includes(b.section)).map((b) => b.action))) {
    if (typeof a !== "string" || have.has(a) || a.startsWith("send:")) continue;
    const i = a.indexOf(":");
    const name = i < 0 ? a : a.slice(0, i);
    const value = i < 0 ? undefined : a.slice(i + 1);
    const arg = app.get(name)?.args[0]?.name;
    if (app.has(name) && (value === undefined || arg)) {
      const { group, title } = titleOf(name);
      list.push({ name, args: value === undefined ? {} : { [arg]: /^\d+$/.test(value) ? Number(value) : value }, group, title: value === undefined ? title : `${title} ${value}`, words: app.get(name).about });
    } else if (/^[\w-]+\.[\w-]+$/.test(a)) list.push({ name: a, args: {}, group: "Mod", title: a.replace(".", ": "), words: "" });
  }
  list.unshift(...places(), ...panels(), ...mods);
  return list.map((e) => ({ ...e, id: `${e.name}:${JSON.stringify(e.args)}` }));
}

// keys.json 식 이름: `name` 또는 `name:value`.
function actionOf(e) {
  const v = Object.values(e.args)[0];
  return v === undefined ? e.name : `${e.name}:${v}`;
}
// 지금 통하는 keys.json 구역.
const sections = () => ["global", `layout:${shared("layout") ?? "main"}`];

// The key bound to an entry: `name` or `name:value` in keys.json.
function keyOf(e, bound) {
  const want = actionOf(e);
  const k = bound.find((b) => sections().includes(b.section) && b.action === want);
  return k ? k.keys : null;
}

// "ctrl-shift-p" -> ["ctrl", "shift", "p"]; "ctrl--" -> ["ctrl", "-"].
function keyParts(k) {
  return k.endsWith("--") ? [...k.slice(0, -2).split("-"), "-"] : k.split("-");
}

// Fuzzy score of `q` in `text`, with the matched positions; null: no match.
function fuzzy(q, text) {
  const t = text.toLowerCase();
  let score = 0;
  let at = 0;
  let run = 0;
  const hits = [];
  for (const ch of q) {
    const i = t.indexOf(ch, at);
    if (i < 0) return null;
    const start = i === 0 || /[\s:.\-_/]/.test(t[i - 1]);
    run = i === at && hits.length ? run + 1 : 0;
    score += 1 + (start ? 6 : 0) + run * 3 - Math.min(i - at, 6) * 0.3;
    hits.push(i);
    at = i + 1;
  }
  return { score: score - text.length * 0.02, hits };
}

export default class Palette extends View {
  init(_props, cx) {
    this.query = "";
    this.input = InputState.new({ placeholder: "Search…   > commands   @ agents   $ tabs   ! needs you" });
    this.input.on("change", (_e, cx) => { this.query = this.input.value(); this.at = 0; cx.notify(); });
    // props { query }: 검색어를 채운 채로 연다(예: ">"로 명령만).
    if (typeof props()?.query === "string") { this.input.set_value(props().query); this.query = props().query; }
    this.input.on("submit", () => this.go(this.rows()[this.at]?.e));
    this.input.focus();
    cx.timer.after(600, () => this.input.focus());
    this.at = 0;
    // How far the list is scrolled, px.
    this.scroll = 0;
    this.recent = JSON.parse(localStorage.getItem("recent") ?? "[]");
    this.handle = cx.focus_handle();
    this.mods = [];
    cx.spawn(async (cx) => {
      try { this.mods = await readMods(); } catch (e) { console.log(`kommand: ${e}`); }
      cx.notify();
    });
  }

  close() {
    closeOverlay(props().overlay);
  }

  go(e) {
    if (!e) return;
    this.recent = [e.id, ...this.recent.filter((r) => r !== e.id)].slice(0, 20);
    localStorage.setItem("recent", JSON.stringify(this.recent));
    this.close();
    if (e.runs) e.runs.forEach(([n, a]) => run(n, a));
    else if (e.open) openOverlay(e.open);
    else if (e.name === "mod.clone") {
      openOverlay({ mod: "prompt", kind: "dialog", width: 380, props: {
        title: "Duplicate mod", hint: "Mod to copy; creates <name>-copy",
        command: { name: "mod.clone", args: {} },
      } });
    } else {
      run(e.name, e.name === "layout.clone" ? { name: shared("layout") ?? "main" } : e.args);
    }
  }

  // The rows to show: grouped when empty, ranked while typing.
  rows() {
    // 첫 글자가 범위를 좁힌다: > 명령과 mod, @ 에이전트, $ 탭, ! 나를 기다리거나 끝난 것.
    const raw = this.query.trim();
    const scope = SCOPES[raw[0]];
    const all = scope ? entries(this.mods).filter(scope) : entries(this.mods);
    const q = (scope ? raw.slice(1) : raw).toLowerCase().replace(/\s+/g, "");
    this.typed = Boolean(q);
    if (!q) {
      const recent = this.recent.map((id) => all.find((e) => e.id === id)).filter(Boolean).slice(0, 5);
      const rest = GROUPS.slice(1).flatMap((g) => all.filter((e) => e.group === g && !recent.includes(e)));
      const others = all.filter((e) => !GROUPS.includes(e.group) && !recent.includes(e));
      return [...recent.map((e) => ({ e, head: "Recent" })), ...[...rest, ...others].map((e) => ({ e, head: e.group }))];
    }
    const rank = (e) => this.recent.indexOf(e.id);
    return all
      .map((e) => {
        const title = fuzzy(q, e.title);
        const more = fuzzy(q, `${e.group} ${e.title} ${e.name} ${e.words}`);
        const best = title ?? (more && { score: more.score - 4, hits: [] });
        return best && { e, score: best.score, hits: best.hits };
      })
      .filter(Boolean)
      .sort((a, b) => b.score - a.score || (rank(a.e) < 0 ? 99 : rank(a.e)) - (rank(b.e) < 0 ? 99 : rank(b.e)));
  }

  title(t, text, hits, on) {
    if (!hits?.length) return div().text_color(on ? t.foreground : t.muted).child(text);
    const parts = [];
    let cur = "";
    let lit = false;
    [...text].forEach((ch, i) => {
      const h = hits.includes(i);
      if (h !== lit && cur) {
        parts.push([cur, lit]);
        cur = "";
      }
      lit = h;
      cur += ch;
    });
    if (cur) parts.push([cur, lit]);
    return h_flex().children(parts.map(([s, h]) => div().text_color(h ? t.accent : on ? t.foreground : t.muted).when(h, (d) => d.font_semibold()).child(s.replace(/ /g, "\u00a0"))));
  }

  render() {
    const t = theme();
    const rows = this.rows();
    const bound = keys();
    this.at = Math.min(this.at, Math.max(0, rows.length - 1));
    // One continuous strip: each row (and the group title before it) at a
    // fixed y. Scrolling moves the strip in pixels, only as far as it takes to
    // keep the selected row (and its group's title, if it opens one) in view.
    const tops = [];
    let y = 0;
    rows.forEach((r, i) => {
      const head = !this.typed && (i === 0 || r.head !== rows[i - 1].head);
      tops.push({ head, title: y, row: y + (head ? HEAD_H : 0) });
      y += (head ? HEAD_H : 0) + ROW_H;
    });
    const total = y;
    const fixed = total > LIST_H;
    this.maxScroll = Math.max(0, total - LIST_H);
    const sel = tops[this.at];
    if (sel) {
      const from = sel.head ? sel.title : sel.row;
      if (from < this.scroll) this.scroll = from;
      if (sel.row + ROW_H > this.scroll + LIST_H) this.scroll = sel.row + ROW_H - LIST_H;
    }
    this.scroll = Math.max(0, Math.min(this.scroll, this.maxScroll));
    const key = (k) =>
      h_flex().gap(3).children(keyParts(k).map((p) => div().px(5).rounded(4).border_1().border_color(t.border).bg(t.raised).text_size(11).text_color(t.dim).child(p)));
    // In a scrolling list each item is placed at its edges from the model
    // above, not stacked: GPUI rounds every height to whole pixels, and a
    // stack of rounded heights drifts away from the model (19 px at zoom 1.3
    // by row 40, cutting the selection off). Edges from the model can't add up.
    const place = (el, start, end) =>
      fixed
        ? el.absolute().left(0).right(0).top(start - this.scroll).bottom(LIST_H - (end - this.scroll))
        : el.flex_none().h(end - start);
    const visible = (start, end) => !fixed || (end > this.scroll && start < this.scroll + LIST_H);
    const list = [];
    rows.forEach((r, i) => {
      const { head, title, row } = tops[i];
      if (head && visible(title, row)) list.push(place(h_flex(), title, row).px(14).pb(4).items_end().text_size(11).font_semibold().text_color(t.dim).child(r.head));
      if (!visible(row, row + ROW_H)) return;
      const on = i === this.at;
      const k = keyOf(r.e, bound);
      list.push(
        place(h_flex(), row, row + ROW_H)
          .id(`pl-${i}`)
          .mx(6)
          .px(10)
          .gap(10)
          .items_center()
          .rounded(7)
          .cursor_pointer()
          .text_size(12.8)
          .when(on, (el) => el.bg(t.selected))
          .hover((s) => s.bg(t.hover))
          .on_click(() => this.go(r.e))
          .child(icon(t, r.e))
          .when(Boolean(r.e.status), (el) => el.child(div().flex_none().text_size(10).text_color(t[r.e.status] ?? t.dim).child("●")))
          .child(div().flex_1().min_w(0).truncate().child(this.title(t, r.e.title, r.hits, on)))
          .when(this.typed, (el) => el.child(div().text_size(11.5).text_color(t.dim).child(r.e.group)))
          .when(Boolean(k), (el) => el.child(key(k))),
      );
    });
    return v_flex()
      .id("palette")
      .track_focus(this.handle)
      .w_full()
      .min_h(0)
      .p(18)
      .gap(10)
      .bg(t.popover)
      .on_key_down((e, cx) => {
        const k = e.key;
        if (k === "escape") return this.close();
        // Stops at the ends: wrapping jumps out of sight.
        if (k === "down") this.at = Math.min(this.at + 1, rows.length - 1);
        else if (k === "up") this.at = Math.max(this.at - 1, 0);
        else if (k === "pagedown") this.at = Math.min(this.at + SHOWN, rows.length - 1);
        else if (k === "pageup") this.at = Math.max(this.at - SHOWN, 0);
        else return;
        cx.stop_propagation();
        cx.notify();
      })
      .child(
        h_flex()
          .h(36)
          .flex_none()
          .px(10)
          .gap(10)
          .items_center()
          .rounded(9)
          .border_1()
          .border_color(t.accent)
          .bg(t.background)
          .child(svg("mods/workspace-chrome/search.svg").size(16).text_color(t.dim))
          .child(Input.new(this.input).flex_1().h_full().text_size(12.8).text_color(t.foreground))
          .child(div().text_size(11).text_color(t.dim).child("Esc")),
      )
      .child(
        rows.length
          ? div()
              .id("palette-rows")
              .relative()
              .mb(6)
              .when(fixed, (el) => el.h(LIST_H).overflow_hidden())
              .on_scroll_wheel((e, cx) => {
                // The event bridge converts both wheel and touchpad deltas to pixels.
                this.scroll = Math.max(0, Math.min(this.scroll - e.delta.y, this.maxScroll));
                // The selection stays on screen, so the next frame doesn't scroll back to it.
                // A row that opens a group is shown with its title, so the title counts.
                while (this.at < rows.length - 1 && (tops[this.at].head ? tops[this.at].title : tops[this.at].row) < this.scroll) this.at++;
                while (this.at > 0 && tops[this.at].row + ROW_H > this.scroll + LIST_H) this.at--;
                cx.notify();
              })
              .children(fixed ? list : [v_flex().children(list)])
          : div().px(16).py(14).text_size(13).text_color(t.dim).child(`Nothing matches "${this.query}".`),
      );
  }
}
