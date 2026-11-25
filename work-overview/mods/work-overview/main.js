import { View, div, svg } from "gpui-kit";
import { Button, Link, h_flex, v_flex, Textarea, TextareaState } from "gpui-base";
import { appHome, checking, focused, layout, nextCommand, notify, panes, props, readTextFile, run, spaces, theme, window, writeTextFile } from "herdr";
import { BLOCKS, MEMO_KINDS, STATES, changeMemos, parseMemos, parseSnapshot, paths, visibleMemos } from "./model.mjs";

const PANEL = "work-overview";
const ICONS = "mods/workspace-chrome/";
const activeTab = () => spaces().find((space) => space.active)?.tabs.find((tab) => tab.active) ?? null;
const stateColors = { planned: "muted", working: "working", blocked: "blocked", done: "done" };

function panel(node) {
  if (node?.id === PANEL) return node;
  for (const child of node?.children ?? []) {
    const found = panel(child);
    if (found) return found;
  }
  return null;
}

const icon = (name, color) => svg(`${ICONS}${name}.svg`).size(14).flex_none().text_color(color);
const label = (t, text) => div().text_size(11).font_semibold().text_color(t.muted).child(text);
const line = (text) => div().min_w(0).text_ellipsis().child(text);
const paragraph = (text) => v_flex().min_w(0).children(text.split("\n").map((row) =>
  div().min_w(0).whitespace_normal().child(row || "\u00a0")));
const button = (t, id, title, action) => Button.new(id).flex_none().px(8).py(4).rounded(5)
  .text_size(11).font_medium().text_color(t.accent).cursor_pointer().hover((s) => s.bg(t.hover))
  .child(title).on_click(action);
const card = (t) => v_flex().min_w(0).gap(8).p(12).rounded(8).border_1().border_color(t.border);
const tint = (t, status) => t[stateColors[status]] ?? t.muted;

function status(t, state) {
  return div().flex_none().text_size(11).text_color(tint(t, state)).child(STATES[state]);
}

function goalRow(t, item, index) {
  const row = h_flex().min_w(0).items_center().gap(8);
  if (index !== undefined) row.child(label(t, String(index + 1)).flex_none());
  row.child(paragraph(item.title).flex_1().font_medium());
  if (item.status) row.child(status(t, item.status));
  const body = v_flex().min_w(0).gap(3).child(row);
  if (item.due) body.child(label(t, `기한 ${item.due}`));
  if (item.description) body.child(paragraph(item.description).text_color(t.muted).text_size(12));
  return body;
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
    cx.timer.every(1500, (cx) => this.refresh(cx));
  }

  toggle() {
    const block = panel(layout());
    if (!block) return;
    if (!block.hidden) this.draft?.input.blur();
    run(block.hidden ? "layout.show" : "layout.hide", { id: PANEL });
  }

  refresh(cx) {
    const tab = activeTab()?.id;
    const block = panel(layout());
    if (!tab || !block || (this.role === "panel") !== !block.hidden || window()?.visible === false) return;
    if (this.request?.tab === tab) return;
    const request = { tab };
    this.request = request;
    cx.spawn(async (cx) => {
      let next;
      try {
        const files = paths(appHome(), tab);
        const raw = await readTextFile(files.snapshot);
        const previous = this.entry?.tab === tab ? this.entry : null;
        const snapshot = raw === null ? null : raw === previous?.raw ? previous.snapshot : parseSnapshot(raw);
        const memoRaw = snapshot && this.role === "panel" ? await readTextFile(files.memos) : null;
        const memos = memoRaw === previous?.memoRaw ? previous.memos : parseMemos(memoRaw);
        next = { tab, raw, snapshot, memoRaw, memos };
      } catch (error) {
        next = { tab, error: String(error.message ?? error) };
      }
      if (this.request !== request) return;
      this.request = null;
      if (activeTab()?.id !== tab) return;
      const last = this.entry;
      if (last?.tab === tab && last.raw === next.raw && last.memoRaw === next.memoRaw && last.error === next.error) return;
      this.entry = next;
      cx.notify();
    });
  }

  current(entry) {
    return activeTab()?.id === entry.tab && this.entry === entry;
  }

  beginMemo(cx, entry) {
    if (!this.current(entry)) return;
    if (this.draft?.tab === entry.tab && this.draft.goal === entry.snapshot.goal.id) {
      this.draft.input.focus();
      return;
    }
    this.clearDraft();
    const input = TextareaState.new({ placeholder: "진척, 결정 사항, 다음 할 일…", rows: 3 });
    this.draft = { tab: entry.tab, goal: entry.snapshot.goal.id, input };
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
    if (!this.current(entry) || this.saving) return;
    let next;
    try { next = changeMemos(entry.memoRaw, entry.snapshot.goal.id, action); }
    catch (error) { notify({ title: "메모를 저장하지 못했습니다", body: error.message, level: "warning" }); return; }
    const draft = this.draft;
    this.saving = entry;
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        await writeTextFile(paths(appHome(), entry.tab).memos, next, entry.memoRaw);
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
    const terminals = panes().filter((pane) => pane.tab === entry.tab && pane.terminal);
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
    const steps = snapshot?.blocks.find((block) => block.type === "workflow")?.items ?? [];
    const goal = snapshot?.goal;
    const row = Button.new("open-work-overview").h_flex().size_full().min_w(0).px(10).gap(8).items_center()
      .text_size(11).hover((s) => s.bg(t.hover)).cursor_pointer().on_click(() => this.toggle())
      .accessibility_label(goal ? `업무 패널 열기: ${goal.title}` : "업무 패널 열기")
      .child(icon("panel-right", t.accent)).child(line(goal?.title ?? (entry?.error ? "업무 현황 읽기 실패" : "업무 현황")).flex_1());
    if (goal?.status) row.child(status(t, goal.status));
    if (steps.length) row.child(label(t, `${steps.filter((step) => step.status === "done").length}/${steps.length}`).flex_none());
    if (goal?.due) row.child(label(t, goal.due).flex_none());
    else if (!goal && tab) row.child(label(t, entry ? "발행 없음" : "…").flex_none());
    return row;
  }

  renderMemo(t, entry, notes, draft) {
    const section = card(t).child(label(t, BLOCKS.memos));
    if (!notes.length && !draft) section.child(div().text_size(12).text_color(t.muted).child("남긴 메모가 없습니다."));
    for (const note of notes) {
      section.child(v_flex().gap(3)
        .child(h_flex().items_center().justify_between()
          .child(label(t, `${MEMO_KINDS[note.kind]} · ${note.source === "local" ? "내 메모" : "에이전트"}`))
          .child(button(t, `delete-${note.source}-${note.id}`, "삭제", (_e, cx) => this.saveMemo(cx, entry, { remove: note }))))
        .child(paragraph(note.body).text_size(12)));
    }
    if (draft) {
      section.child(Textarea.new(draft.input).w_full().px(8).py(5).border_1().border_color(t.border).rounded(5).text_color(t.foreground))
        .child(h_flex().gap(6)
          .child(button(t, "save-work-memo", this.saving ? "저장 중…" : "저장", (_e, cx) => this.saveMemo(cx, entry, { add: {
            id: `user-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
            kind: "note", body: draft.input.value(),
          } })))
          .child(button(t, "cancel-work-memo", "취소", (_e, cx) => { this.clearDraft(); cx.notify(); })));
    }
    return section;
  }

  renderBlock(t, block, entry) {
    const cardBody = card(t).child(label(t, BLOCKS[block.type]));
    for (const [i, item] of block.items.entries()) {
      if (block.type === "references") {
        cardBody.child(Link.new(`reference-${i}`).href(item.url).v_flex().min_w(0).gap(2).cursor_pointer().text_color(t.accent)
          .hover((s) => s.bg(t.hover))
          .child(paragraph(item.kind ? `${item.title} · ${item.kind}` : item.title).font_medium())
          .child(line(item.url).text_color(t.muted).text_size(11)));
      } else if (block.type === "commands") {
        cardBody.child(Button.new(`run-${i}`).v_flex().min_w(0).gap(4).p(8).rounded(5).bg(t.raised)
          .cursor_pointer().hover((s) => s.bg(t.hover)).on_click(() => this.split(entry, item))
          .child(h_flex().gap(6).items_center().child(icon("terminal", t.accent))
            .child(paragraph(item.title).flex_1().font_medium()).child(label(t, item.direction === "right" ? "오른쪽 분할" : "아래 분할").flex_none()))
          .child(paragraph(item.argv.map((arg) => /^[\w./:@=+-]+$/.test(arg) ? arg : JSON.stringify(arg)).join(" ")).text_color(t.muted).text_size(11)));
      } else cardBody.child(goalRow(t, item, block.type === "workflow" ? i : undefined));
    }
    return cardBody;
  }

  render(cx) {
    const t = theme();
    const tab = activeTab();
    const entry = this.entry?.tab === tab?.id ? this.entry : null;
    if (!checking() && tab && !entry) this.refresh(cx);
    if (this.role === "status") return this.renderStrip(t, tab, entry);

    const title = h_flex().flex_none().px(14).h(44).gap(8).items_center().border_b(1).border_color(t.border)
      .child(icon("panel-right", t.accent)).child(div().font_semibold().flex_1().child("업무 현황"))
      .child(button(t, "close-work-overview", "접기", () => this.toggle()));
    const body = v_flex().gap(10).p(12);
    if (entry?.snapshot) {
      const { goal, blocks } = entry.snapshot;
      const draft = this.draft?.tab === tab.id && this.draft.goal === goal.id ? this.draft : null;
      const notes = visibleMemos(entry.snapshot, entry.memos);
      body.child(card(t)
        .child(h_flex().items_center().justify_between().child(label(t, "현재 목표"))
          .child(button(t, "add-work-memo", "메모 추가", (_e, cx) => this.beginMemo(cx, entry))))
        .child(goalRow(t, goal).text_size(15)));
      for (const block of blocks) {
        if (block.type === "memos") body.child(this.renderMemo(t, entry, notes, draft));
        else if (block.items.length) body.child(this.renderBlock(t, block, entry));
      }
      if (!blocks.some((block) => block.type === "memos") && (notes.length || draft)) body.child(this.renderMemo(t, entry, notes, draft));
    } else {
      body.child(card(t)
        .child(div().font_semibold().child(entry?.error ? "업무 현황을 읽을 수 없습니다" : !tab ? "선택한 탭이 없습니다" : entry ? "발행된 목표가 없습니다" : "업무 현황을 읽는 중…"))
        .child(paragraph(entry?.error ?? (entry ? "이 탭의 에이전트에게 현재 업무를 발행해 달라고 요청하세요." : "")).text_size(12).text_color(t.muted)));
    }
    return v_flex().size_full().min_w(0).text_color(t.foreground).text_size(13)
      .child(title).child(div().id(`work-scroll-${tab?.id ?? "empty"}`).flex_1().min_h(0).overflow_y_scrollbar().child(body));
  }
}
