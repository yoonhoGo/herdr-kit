import { Background, PathBuilder, View, div, svg } from "gpui-kit";
import { Button, Link, h_flex, v_flex, Textarea, TextareaState, TextView } from "gpui-base";
import { appHome, checking, focused, layout, nextCommand, notify, panes, props, readTextFile, run, spaces, theme, window as appWindow, writeTextFile } from "herdr";
import { MEMO_KINDS, STATES, changeMemos, configPath, parseSharedSpaces, paths, targetFor, visibleMemos } from "./model.mjs";
import { readBoard } from "./scopes.mjs";
import { referenceSite } from "./reference.mjs";

const PANEL = "workboard";
const ICONS = "mods/workspace-chrome/";
function activeLocation() {
  const space = spaces().find((space) => space.active);
  const tab = space?.tabs.find((tab) => tab.active)?.id;
  const focus = focused();
  const session = focus?.space === space?.id && focus?.tab === tab ? focus?.terminal : null;
  return { space: space?.id, tab, session };
}
const sameLocation = (a, b) => a?.space === b.space && a?.tab === b.tab && a?.session === b.session;
const sameTarget = (a, b) => a && b && a.scope === b.scope && a.id === b.id;
const scopeLabels = { space: "스페이스 공유", tab: "탭 전용", session: "세션 전용" };
const stateColors = { planned: "muted", working: "working", blocked: "blocked", done: "done" };
const sectionIcons = { list: "layers", progress: "git-compare" };
const noteIcons = { progress: "check", decision: "pin", next: "chevron-right", note: "square-pen" };

function panel(node) {
  if (node?.id === PANEL) return node;
  for (const child of node?.children ?? []) {
    const found = panel(child);
    if (found) return found;
  }
  return null;
}

const icon = (name, color) => svg(`${ICONS}${name}.svg`).size(14).flex_none().text_color(color);
const siteIcon = (name, color) => svg(`mods/workboard/icons/${name}.svg`).size(15).flex_none().text_color(color);
function wash(color, opacity) {
  let hex = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(color)?.[1];
  if (!hex) return "#00000000";
  if (hex.length === 3) hex = Array.from(hex, (c) => c + c).join("");
  const base = hex.length === 8 ? parseInt(hex.slice(6), 16) : 255;
  return `#${hex.slice(0, 6)}${Math.round(base * opacity).toString(16).padStart(2, "0")}`;
}

function glow(t) {
  const rect = PathBuilder.fill().move_to("0%", "0%").line_to("100%", "0%")
    .line_to("100%", "100%").line_to("0%", "100%").close().build();
  return window.paint_path(rect, Background.linear_gradient(140, wash(t.accent, 0.17), wash(t.accent, 0)))
    .absolute().top(0).left(0).size_full();
}
const label = (t, text) => div().text_size(11).font_semibold().text_color(t.muted).child(text);
const line = (text) => div().min_w(0).text_ellipsis().child(text);
const paragraph = (text) => v_flex().min_w(0).children(text.split("\n").map((row) =>
  div().min_w(0).whitespace_normal().child(row || "\u00a0")));
const actionStyle = (el, t) => el.cursor_pointer().hover((s) => s.bg(t.hover)).active((s) => s.bg(t.selected));
const button = (t, id, title, action) => actionStyle(Button.new(id).flex_none().h(26).px(8).gap(5).rounded(6), t)
  .text_size(11).font_medium().text_color(t.accent).child(title).on_click(action);
const card = (t) => v_flex().min_w(0).gap(9).p(12).rounded(10).bg(wash(t.foreground, 0.025)).border_1().border_color(t.border);
const tile = (t, contents, color = t.accent) => h_flex().size(28).flex_none().items_center().justify_center()
  .rounded(7).bg(wash(color, 0.12)).child(contents);
const dot = (color, size = 6) => div().size(size).flex_none().rounded(size).bg(color);
const tint = (t, status) => t[stateColors[status]] ?? t.muted;

function status(t, state, compact = false) {
  const color = tint(t, state);
  const badge = h_flex().flex_none().items_center().gap(5).text_size(11).font_medium().text_color(color)
    .child(dot(color, 5)).child(STATES[state]);
  return compact ? badge : badge.px(7).h(20).rounded(10).bg(wash(color, 0.12));
}

function section(t, { type, title }, count) {
  return card(t).child(h_flex().items_center().gap(8)
    .child(tile(t, icon(sectionIcons[type], t.accent)))
    .child(paragraph(title).min_w(0).flex_1().font_semibold())
    .child(label(t, String(count)).flex_none().px(6).py(2).rounded(5).bg(wash(t.foreground, 0.06))));
}

function progress(t, { id, items: steps }, compact = false) {
  const done = steps.reduce((count, step) => count + (step.status === "done" ? 1 : 0), 0);
  const color = done === steps.length ? t.done : steps.some((step) => step.status === "blocked") ? t.blocked : t.accent;
  const track = div().h(compact ? 3 : 4).rounded(3).overflow_hidden().bg(wash(t.foreground, 0.11))
    .child(div().id(`progress-${id}`).h_full().w(`${done / steps.length * 100}%`).rounded(3).bg(color).transition("width", 180));
  if (compact) {
    return h_flex().flex_none().gap(5).items_center().child(track.w(22)).child(label(t, `${done}/${steps.length}`));
  }
  return h_flex().gap(9).items_center().child(track.flex_1()).child(label(t, `${done}/${steps.length} 완료`).flex_none());
}

const externalLink = (t, key, { url }, title) => actionStyle(Link.new(key).href(url).min_w(0), t)
  .tooltip(url).accessibility_label(title);
const htmlEntities = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
const escapeHtml = (value) => value.replace(/[&<>"]/g, (char) => htmlEntities[char]);

function itemDescription(t, value, key) {
  if (typeof value === "string") return paragraph(value).text_color(t.muted).text_size(12);
  const html = value.map((part) => typeof part === "string"
    ? escapeHtml(part).replace(/\n/g, "<br>")
    : `<a href="${escapeHtml(part.url)}">${escapeHtml(part.text)}</a>`).join("");
  return TextView.html(`description-${key}`, `<p>${html}</p>`).min_w(0).text_color(t.muted).text_size(12);
}

function referenceLink(t, item, key) {
  const link = externalLink(t, key, item, item.title).h_flex().items_center().gap(6).rounded(7);
  if (item.presentation === "button") {
    return h_flex().child(link.px(8).py(4).border_1().border_color(t.border)
      .child(paragraph(item.title).text_size(11).font_medium().text_color(t.accent))
      .child(siteIcon("external", t.accent)));
  }
  const site = referenceSite(item.url);
  const color = site.icon === "github" ? t.foreground : t.accent;
  return link.gap(9).px(6).py(5)
    .child(tile(t, siteIcon(site.icon, color), color))
    .child(v_flex().flex_1().min_w(0).gap(2)
      .child(line(item.title).font_medium().text_color(t.foreground))
      .child(line(item.kind ? `${site.host} · ${item.kind}` : site.host).text_size(11).text_color(t.muted)))
    .child(siteIcon("external", t.muted));
}

function appendItemLinks(t, body, item, key) {
  item.links?.forEach((link, index) => body.child(referenceLink(t, link, `attached-${key}:${index}`)));
}

function linkedTitle(t, item, key, goal = false) {
  const text = paragraph(item.title);
  const title = goal ? text.font_semibold().text_size(19) : text.font_medium();
  if (!item.url) return title;
  return externalLink(t, `item-link-${key}`, item, item.title).h_flex().items_center().gap(6).rounded(4)
    .child(title.text_color(t.accent))
    .child(siteIcon("external", t.accent));
}

function textRow(t, item, key, index) {
  const color = item.status ? tint(t, item.status) : t.muted;
  const marker = index === undefined ? dot(color, 5) : h_flex().size(19).flex_none().items_center().justify_center()
    .rounded(6).bg(wash(color, 0.12)).text_color(color).text_size(10).font_semibold().child(String(index + 1));
  const row = h_flex().min_w(0).items_center().gap(8)
    .child(linkedTitle(t, item, key).flex_1());
  if (item.status) row.child(status(t, item.status, true));
  const body = v_flex().min_w(0).flex_1().gap(4).child(row);
  if (item.due) body.child(label(t, `기한 ${item.due}`));
  if (item.description) body.child(itemDescription(t, item.description, key));
  appendItemLinks(t, body, item, key);
  const bullet = h_flex().w(19).h(19).flex_none().justify_center().items_center().child(marker);
  return h_flex().items_start().gap(8).px(4).py(5).child(bullet).child(body);
}

export default class WorkOverview extends View {
  init(_props, cx) {
    this.role = props()?.role === "status" ? "status" : "panel";
    this.entry = null;
    this.request = null;
    this.draft = null;
    this.saving = null;
    if (checking()) return;
    if (this.role === "status") cx.spawn(async () => {
      for (;;) {
        if (await nextCommand() === "toggle") this.toggle();
      }
    });
    cx.timer.every(1500, (cx) => {
      // Keep loading newly selected work even if the window is covered.
      if (appWindow()?.visible !== false || !sameLocation(this.entry?.location, activeLocation())) this.refresh(cx);
    });
  }

  toggle() {
    const block = panel(layout());
    if (!block) return;
    if (!block.hidden) this.draft?.input.blur();
    run(block.hidden ? "layout.show" : "layout.hide", { id: PANEL });
  }

  refresh(cx) {
    const location = activeLocation();
    const block = panel(layout());
    if (!location.space || !block || (this.role === "panel") !== !block.hidden) return;
    if (sameLocation(this.request, location)) return;
    this.request = location;
    cx.spawn(async (cx) => {
      let next;
      const last = this.entry;
      const previous = sameLocation(last?.location, location) ? last : null;
      try {
        const home = appHome();
        const sharedSpaces = parseSharedSpaces(await readTextFile(configPath(home)));
        const board = await readBoard(home, location, targetFor(sharedSpaces, location), readTextFile, this.role === "panel", previous);
        next = { location, ...board };
      } catch (error) {
        next = { location, error: String(error.message ?? error) };
      }
      if (this.request !== location) return;
      this.request = null;
      if (!sameLocation(location, activeLocation())) return;
      if (previous && previous.snapshot === next.snapshot && previous.memoRaw === next.memoRaw && previous.error === next.error) return;
      this.entry = next;
      cx.notify();
    });
  }

  current(entry) {
    return sameLocation(entry.location, activeLocation()) && this.entry === entry;
  }

  beginMemo(cx, entry) {
    if (!this.current(entry)) return;
    if (sameTarget(this.draft?.target, entry.goalTarget) && this.draft.goal === entry.snapshot.goal.id) {
      this.draft.input.focus();
      return;
    }
    this.clearDraft();
    const input = TextareaState.new({ placeholder: "진척, 결정 사항, 다음 할 일…", rows: 3 });
    input.on("change", (_e, cx) => cx.notify());
    this.draft = { target: entry.goalTarget, goal: entry.snapshot.goal.id, input };
    input.focus();
    cx.notify();
  }

  clearDraft() {
    if (!this.draft) return;
    this.draft.input.blur();
    this.draft.input.release();
    this.draft = null;
  }

  async close() { this.clearDraft(); }

  saveMemo(cx, entry, action) {
    if (!this.current(entry) || !entry.goalTarget || this.saving) return;
    let next;
    try { next = changeMemos(entry.memoRaw, entry.snapshot.goal.id, action); }
    catch (error) { notify({ title: "메모를 저장하지 못했습니다", body: error.message, level: "warning" }); return; }
    const draft = this.draft;
    this.saving = entry;
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        await writeTextFile(paths(appHome(), entry.goalTarget).memos, next, entry.memoRaw);
        if (action.add && this.draft === draft) this.clearDraft();
      } catch {
        notify({ title: "메모를 저장하지 못했습니다", body: "다른 창에서 메모를 바꿨거나 파일에 쓸 수 없습니다. 다시 시도하세요.", level: "warning" });
      } finally {
        this.saving = null;
        this.refresh(cx);
        cx.notify();
      }
    });
  }

  split(entry, command) {
    if (!this.current(entry)) return;
    const focus = focused();
    const tab = activeLocation().tab;
    const terminals = panes().filter((pane) => pane.tab === tab && pane.terminal);
    const target = terminals.find((pane) => pane.pane === focus?.pane) ?? terminals[0];
    if (!target) {
      notify({ title: "이 탭에 분할할 터미널이 없습니다", level: "warning" });
      return;
    }
    run("pane.split", { pane: target.pane, direction: command.direction, argv: command.argv });
  }

  renderStrip(t, tab, entry) {
    const block = panel(layout());
    if (!block?.hidden) return div();
    const snapshot = entry?.snapshot;
    const summary = snapshot?.sections.find((section) => section.type === "progress" && section.items.length);
    const goal = snapshot?.goal;
    const title = goal?.title ?? (entry?.error ? "업무 현황 읽기 실패" : "업무 현황");
    const row = actionStyle(Button.new("open-workboard").h_flex().size_full().min_w(0).px(10).gap(8).items_center(), t)
      .text_size(11).on_click(() => this.toggle()).tooltip(title)
      .accessibility_label(`업무 패널 열기: ${title}`)
      .child(icon("panel-right", t.accent)).child(line(title).font_semibold().flex_1());
    if (goal?.status) row.child(status(t, goal.status, true));
    if (summary) row.child(progress(t, summary, true));
    if (goal?.due) row.child(label(t, goal.due).flex_none());
    else if (!goal && tab && !entry) row.child(icon("spinner", t.accent).spin(900));
    row.child(icon("chevron-right", t.muted));
    return row;
  }

  renderMemo(t, entry, note) {
    return v_flex().gap(4).px(8).py(5).rounded(7).bg(wash(t.foreground, 0.045))
      .child(h_flex().items_center().gap(6)
        .child(icon(noteIcons[note.kind], t.accent))
        .child(label(t, `${MEMO_KINDS[note.kind]} · ${note.source === "local" ? "나" : "에이전트"}`).flex_1())
        .children(entry.goalTarget ? [button(t, `delete-${note.source}-${note.id}`, "삭제", (_e, cx) => this.saveMemo(cx, entry, { remove: note }))
          .text_color(t.muted).disabled(Boolean(this.saving))] : []))
      .child(paragraph(note.body).text_size(12));
  }

  renderComposer(t, entry, draft) {
    const busy = Boolean(this.saving);
    return card(t).border_color(t.accent)
      .child(div().font_semibold().child("새 메모"))
      .child(Textarea.new(draft.input).w_full().px(8).py(5).border_1().border_color(t.border).rounded(6).text_color(t.foreground))
      .child(h_flex().justify_end().gap(6)
        .child(button(t, "cancel-work-memo", "취소", (_e, cx) => { this.clearDraft(); cx.notify(); }).text_color(t.muted).disabled(busy))
        .child(button(t, "save-work-memo", busy ? "저장 중…" : "저장", (_e, cx) => this.saveMemo(cx, entry, { add: {
          id: `user-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
          kind: "note", body: draft.input.value(),
        } })).bg(wash(t.accent, 0.13)).disabled(busy || !draft.input.value().trim())));
  }

  renderSection(t, block, items, entry) {
    const cardBody = section(t, block, items.length);
    if (block.scope && block.scope !== "tab") cardBody.child(label(t, scopeLabels[block.scope]));
    if (!items.length) return cardBody.child(div().text_size(12).text_color(t.muted).child("남긴 메모가 없습니다."));
    if (block.type === "progress") cardBody.child(progress(t, block));
    let step = 0;
    for (const [i, item] of items.entries()) {
      const key = `${block.id}:${i}`;
      if (item.scope && item.scope !== block.scope) cardBody.child(label(t, scopeLabels[item.scope]));
      if (item.type === "link") {
        cardBody.child(referenceLink(t, item, `reference-${key}`));
      } else if (item.type === "command") {
        const argv = item.argv.map((arg) => /^[\w./:@=+-]+$/.test(arg) ? arg : JSON.stringify(arg)).join(" ");
        cardBody.child(actionStyle(Button.new(`run-${key}`).v_flex().items_start().min_w(0).gap(7).p(8).rounded(8)
          .bg(wash(t.foreground, 0.045)).border_1().border_color(t.border), t)
          .on_click(() => this.split(entry, item))
          .child(h_flex().w_full().gap(7).items_center().child(tile(t, icon("terminal", t.accent)))
            .child(paragraph(item.title).flex_1().font_medium())
            .child(label(t, item.direction === "right" ? "오른쪽 분할" : "아래 분할").flex_none()))
          .child(div().w_full().px(7).py(5).rounded(5).bg(wash(t.foreground, 0.06))
            .child(paragraph(argv).text_color(t.muted).text_size(11))));
      } else if (item.type === "memo") {
        cardBody.child(this.renderMemo(t, entry, item));
      } else cardBody.child(textRow(t, item, key, item.type === "step" ? step++ : undefined));
    }
    return cardBody;
  }

  renderGoal(t, entry, block) {
    const { goal } = entry.snapshot;
    const hero = card(t).p(14).relative().overflow_hidden().child(glow(t))
      .child(h_flex().items_center().gap(8)
        .child(paragraph(block.title ?? "현재 목표").flex_1().text_size(11).font_semibold().text_color(t.accent))
        .children(block.scope && block.scope !== "tab" ? [label(t, scopeLabels[block.scope])] : [])
        .child(button(t, "add-work-memo", "메모 추가", (_e, cx) => this.beginMemo(cx, entry))
          .bg(wash(t.accent, 0.1)).child(icon("plus", t.accent))))
      .child(linkedTitle(t, goal, "current-goal", true));
    if (goal.description) hero.child(itemDescription(t, goal.description, "current-goal"));
    if (goal.status || goal.due) {
      const meta = h_flex().gap(9).items_center();
      if (goal.status) meta.child(status(t, goal.status));
      if (goal.due) meta.child(h_flex().gap(5).items_center().child(icon("clock", t.muted)).child(label(t, `기한 ${goal.due}`)));
      hero.child(meta);
    }
    appendItemLinks(t, hero, goal, "current-goal");
    return hero;
  }

  render(cx) {
    const t = theme();
    const location = activeLocation();
    const tab = location.tab;
    const entry = sameLocation(this.entry?.location, location) ? this.entry : null;
    if (!checking() && location.space && !entry) this.refresh(cx);
    if (this.role === "status") return this.renderStrip(t, tab, entry);

    const title = h_flex().flex_none().px(14).h(48).gap(8).items_center().border_b(1).border_color(t.border)
      .child(tile(t, icon("panel-right", t.accent))).child(h_flex().flex_1().items_center().gap(8)
        .child(div().font_semibold().child("Workboard"))
        .children(entry?.snapshot?.version === 2 && entry.goalTarget?.scope === "space" ? [label(t, scopeLabels.space)] : []))
      .child(button(t, "close-workboard", "접기", () => this.toggle()).child(icon("chevron-right", t.accent)));
    const body = v_flex().gap(10).p(12);
    if (entry?.snapshot?.sections.length) {
      const { goal, sections } = entry.snapshot;
      const draft = sameTarget(this.draft?.target, entry.goalTarget) && this.draft.goal === goal?.id ? this.draft : null;
      const agentMemos = new Map();
      const localMemos = [];
      for (const note of visibleMemos(entry.snapshot, entry.memos)) {
        if (note.source === "local") localMemos.push({ type: "memo", ...note });
        else agentMemos.set(note.id, note);
      }
      for (const block of sections) {
        if (block.type === "goal") {
          body.child(this.renderGoal(t, entry, block));
          if (draft) body.child(this.renderComposer(t, entry, draft));
          continue;
        }
        const items = block.items.flatMap((item) => {
          if (item.type !== "memo") return [item];
          const visible = agentMemos.get(item.id);
          return visible ? [visible] : [];
        });
        if (block.localMemos) items.push(...localMemos);
        if (items.length || block.localMemos) body.child(this.renderSection(t, block, items, entry));
      }
      if (localMemos.length && !sections.some((section) => section.localMemos)) {
        body.child(this.renderSection(t, { id: "local-memos", type: "list", title: "메모" }, localMemos, entry));
      }
    } else {
      const loading = tab && !entry;
      const emblem = icon(loading ? "spinner" : "layers", entry?.error ? t.blocked : t.accent);
      body.child(card(t).p(16)
        .child(tile(t, loading ? emblem.spin(900) : emblem))
        .child(div().font_semibold().child(entry?.error ? "업무 현황을 읽을 수 없습니다" : loading ? "업무 현황을 읽는 중…" : entry ? "발행된 목표가 없습니다" : "선택한 탭이 없습니다"))
        .child(paragraph(entry?.error ?? (entry ? "에이전트에게 현재 업무 발행을 요청하세요." : "")).text_size(12).text_color(t.muted)));
    }
    return v_flex().size_full().min_w(0).text_color(t.foreground).text_size(13)
      .child(title).child(div().id(`work-scroll-${tab ?? location.space ?? "empty"}`).flex_1().min_h(0).overflow_y_scrollbar().child(body));
  }
}
