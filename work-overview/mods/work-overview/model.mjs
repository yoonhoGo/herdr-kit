export const STATES = Object.freeze({
  planned: "예정", working: "진행 중", blocked: "막힘", done: "완료",
});
export const MEMO_KINDS = Object.freeze({
  progress: "진척", decision: "결정", next: "다음 할 일", note: "메모",
});
const legacyBlocks = {
  parents: ["상위 목표", "text"], subgoals: ["하위 목표", "text"],
  workflow: ["워크플로", "step"], milestones: ["마일스톤", "text"],
  memos: ["메모", "memo"], references: ["참조 링크", "link"], commands: ["제안 커맨드", "command"],
};

const MAX_BYTES = 128 * 1024;
const own = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
const fail = (path, requirement) => { throw new Error(`${path}: ${requirement}`); };

function record(value, path) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(path, "객체가 필요합니다");
  return value;
}

function text(value, path, max, multiline = false) {
  const controls = multiline ? /[\x00-\x09\x0b-\x1f\x7f-\x9f]/ : /[\x00-\x1f\x7f-\x9f]/;
  if (typeof value !== "string" || !value.trim() || value.length > max || controls.test(value)) {
    fail(path, `공백이 아닌 텍스트 ${max}자 이내가 필요합니다`);
  }
  return value.trim();
}

function id(value, path) {
  if (typeof value !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(value)) fail(path, "영문·숫자로 시작하는 ID가 필요합니다");
  return value;
}

function unique(items, path, key) {
  if (new Set(items.map(key)).size !== items.length) fail(path, "중복된 값이 있습니다");
  return items;
}

function list(value, path, parse, max = 50) {
  if (!Array.isArray(value) || value.length > max) fail(path, `배열(최대 ${max}개)이 필요합니다`);
  return value.map((item, i) => parse(item, `${path}[${i}]`));
}

function choice(value, path, options) {
  if (typeof value !== "string" || !own(options, value)) fail(path, `허용값: ${Object.keys(options).join(", ")}`);
  return value;
}

function date(value, path) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail(path, "날짜 형식은 YYYY-MM-DD입니다");
  const parsed = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) fail(path, "없는 날짜입니다");
  return value;
}

function goal(value, path) {
  const item = record(value, path);
  return {
    title: text(item.title, `${path}.title`, 160),
    ...(item.description === undefined ? {} : { description: text(item.description, `${path}.description`, 4000, true) }),
    ...(item.due === undefined ? {} : { due: date(item.due, `${path}.due`) }),
    ...(item.status === undefined ? {} : { status: choice(item.status, `${path}.status`, STATES) }),
  };
}

function memo(value, path) {
  const item = record(value, path);
  return { id: id(item.id, `${path}.id`), kind: choice(item.kind, `${path}.kind`, MEMO_KINDS), body: text(item.body, `${path}.body`, 4000, true) };
}

function reference(value, path) {
  const item = record(value, path);
  const url = text(item.url, `${path}.url`, 2048);
  if (!/^https?:\/\/[^\s/?#\\]+[^\s\\]*$/i.test(url)) fail(`${path}.url`, "HTTP(S) 주소가 필요합니다");
  return { title: text(item.title, `${path}.title`, 160), url, ...(item.kind === undefined ? {} : { kind: text(item.kind, `${path}.kind`, 40) }) };
}

function command(value, path) {
  const item = record(value, path);
  const argv = list(item.argv, `${path}.argv`, (arg, at) => {
    if (typeof arg !== "string" || arg.length > 4096 || /[\x00-\x1f\x7f-\x9f]/.test(arg)) fail(at, "제어 문자가 없는 인자가 필요합니다");
    return arg;
  }, 40);
  if (!argv[0]?.trim()) fail(`${path}.argv`, "실행 파일이 필요합니다");
  if (item.direction !== undefined && item.direction !== "right" && item.direction !== "down") fail(`${path}.direction`, "right 또는 down이 필요합니다");
  return { title: text(item.title, `${path}.title`, 160), argv, direction: item.direction ?? "down" };
}

const itemParsers = { text: goal, step: goal, memo, link: reference, command };
const sectionTypes = { goal: true, list: true, progress: true };

function legacySections(blocks) {
  const sections = unique(list(blocks, "blocks", (value, path) => {
    const block = record(value, path);
    const kind = choice(block.type, `${path}.type`, legacyBlocks);
    const [title, type] = legacyBlocks[kind];
    const items = list(block.items, `${path}.items`, (item, at) => ({ type, ...itemParsers[type](item, at) }));
    return { id: kind, title, type: kind === "workflow" ? "progress" : "list",
      ...(kind === "memos" ? { localMemos: true } : {}), items };
  }, Object.keys(legacyBlocks).length), "blocks", (section) => section.id);
  return [{ id: "current-goal", type: "goal" }, ...sections];
}

function parseSection(value, path) {
  const input = record(value, path);
  const type = choice(input.type, `${path}.type`, sectionTypes);
  const key = id(input.id, `${path}.id`);
  if (type === "goal") {
    if (input.items !== undefined || input.localMemos !== undefined) fail(path, "goal은 최상위 목표 데이터를 표시합니다");
    return { id: key, type, ...(input.title === undefined ? {} : { title: text(input.title, `${path}.title`, 160) }) };
  }
  if (input.localMemos !== undefined && (type !== "list" || typeof input.localMemos !== "boolean")) {
    fail(`${path}.localMemos`, "list에서만 참/거짓을 지정할 수 있습니다");
  }
  const title = text(input.title, `${path}.title`, 160);
  const items = list(input.items, `${path}.items`, (value, at) => {
    const item = record(value, at);
    const kind = choice(item.type, `${at}.type`, itemParsers);
    if (type === "progress" && kind !== "text" && kind !== "step") {
      fail(`${at}.type`, "progress는 text 또는 step만 받습니다");
    }
    return { type: kind, ...itemParsers[kind](item, at) };
  });
  return { id: key, title, type, ...(input.localMemos ? { localMemos: true } : {}), items };
}

function publishedMemos(sections) {
  return sections.flatMap((section) => section.items?.filter((item) => item.type === "memo") ?? []);
}

export function parseSnapshot(raw) {
  // Herdr reads at most 1 MiB; keep documents below it even at 4 bytes per character.
  if (raw.length > MAX_BYTES) fail("snapshot", "문서가 너무 큽니다");
  const value = record(JSON.parse(raw), "snapshot");
  if (value.version !== 1 && value.version !== 2) fail("version", "지원하는 버전은 1 또는 2입니다");
  const current = goal(value.goal, "goal");
  current.id = id(value.goal.id, "goal.id");
  const sections = value.version === 1 ? legacySections(value.blocks)
    : unique(list(value.sections, "sections", parseSection, 20), "sections", (section) => section.id);
  if (sections.filter((section) => section.type === "goal").length !== 1) fail("sections", "goal 섹션은 하나만 필요합니다");
  if (sections.filter((section) => section.localMemos).length > 1) fail("sections", "localMemos는 한 섹션에만 지정할 수 있습니다");
  unique(publishedMemos(sections), "memos", (item) => item.id);
  return { version: 2, goal: current, sections };
}

export function paths(home, tab) {
  if (typeof tab !== "string" || !/^[A-Za-z0-9][A-Za-z0-9./_-]{0,159}$/.test(tab)) fail("tab", "Herdr 탭 ID가 필요합니다");
  const base = `${home}/data/work-overview/${encodeURIComponent(tab)}`;
  return { snapshot: `${base}.snapshot.json`, memos: `${base}.memos.json` };
}

export function parseMemos(raw) {
  return raw === null ? [] : list(JSON.parse(raw), "local memos", (value, path) => {
    const entry = record(value, path);
    return {
      goal: id(entry.goal, `${path}.goal`),
      added: unique(list(entry.added, `${path}.added`, memo), `${path}.added`, (note) => note.id),
      hidden: list(entry.hidden, `${path}.hidden`, id, 1000),
    };
  }, 1000);
}

export function visibleMemos(snapshot, memos) {
  const local = memos.find((entry) => entry.goal === snapshot.goal.id);
  const published = publishedMemos(snapshot.sections);
  return [
    ...published.filter((note) => !local?.hidden.includes(note.id)).map((note) => ({ ...note, source: "agent" })),
    ...(local?.added ?? []).map((note) => ({ ...note, source: "local" })),
  ];
}

export function changeMemos(raw, goalId, action) {
  const memos = parseMemos(raw);
  let local = memos.find((entry) => entry.goal === goalId);
  if (!local) memos.push(local = { goal: goalId, added: [], hidden: [] });
  if (action.add) local.added.push(memo(action.add, "memo"));
  else if (action.remove.source === "local") local.added = local.added.filter((note) => note.id !== action.remove.id);
  else if (!local.hidden.includes(action.remove.id)) local.hidden.push(action.remove.id);
  const next = JSON.stringify(memos.filter((entry) => entry.added.length || entry.hidden.length));
  if (next.length > MAX_BYTES) fail("local memos", "저장 용량을 초과했습니다");
  parseMemos(next);
  return next;
}

export function tabForTerminal(state, terminal) {
  const matches = (state.spaces ?? []).flatMap((space) => (space.tabs ?? []).filter((tab) =>
    (tab.terminals ?? []).some((pane) => pane.terminal === terminal)));
  if (matches.length !== 1) fail("tab", "에이전트 터미널이 속한 탭을 찾지 못했습니다. --tab으로 지정하세요");
  return matches[0].id;
}
