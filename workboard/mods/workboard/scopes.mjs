import { parseMemos, parseSnapshot, paths, scopeOrder } from "./model.mjs";

// Each publication replaces only the scopes it addresses. An empty fragment is
// meaningful: it clears that scope and suppresses its legacy snapshot.
export function projectSnapshot(snapshot, location) {
  const fragments = new Map();
  function fragment(scope) {
    if (!location[scope]) throw new Error(`${scope}: 발행할 Herdr ID를 찾을 수 없습니다`);
    if (!fragments.has(scope)) fragments.set(scope, { version: 3, goal: null, sections: [] });
    return fragments.get(scope);
  }
  for (const scope of snapshot.replaceScopes ?? []) fragment(scope);
  for (const section of snapshot.sections) {
    if (section.type === "goal") {
      const owner = fragment(section.scope);
      owner.goal = snapshot.goal;
      owner.sections.push(section);
      continue;
    }
    const { items, localMemos, ...heading } = section;
    const rows = new Map(location[section.scope] || !items.length ? [[section.scope, []]] : []);
    for (const item of items) {
      if (!rows.has(item.scope)) rows.set(item.scope, []);
      rows.get(item.scope).push(item);
    }
    for (const [scope, items] of rows) {
      // A wider item must not publish its private parent section's title.
      const title = scopeOrder.indexOf(scope) < scopeOrder.indexOf(section.scope) ? "공유 항목" : heading.title;
      fragment(scope).sections.push({ ...heading, title, items, ...(localMemos && scope === section.scope && { localMemos }) });
    }
  }
  return fragments;
}

function mergeSection(previous, incoming, ownsHeading) {
  if (!previous || (ownsHeading && previous.type !== incoming.type)) return incoming;
  if (previous.type !== incoming.type) return previous;
  const items = previous.items.slice();
  const indexes = new Map(items.flatMap((item, index) => item.id ? [[item.id, index]] : []));
  for (const item of incoming.items) {
    const index = indexes.get(item.id);
    if (index === undefined) items.push(item);
    else items[index] = item;
  }
  return { ...(ownsHeading ? incoming : previous), items };
}

function compose(layers) {
  const sections = new Map();
  let goal = null;
  let goalTarget = null;
  let memoSection;
  for (const { target, snapshot } of layers) {
    for (const source of snapshot.sections) {
      const section = source.scope ? source : {
        ...source, scope: target.scope,
        ...(source.items && { items: source.items.map((item) => ({ ...item, scope: target.scope })) }),
      };
      if (section.type === "goal") {
        goal = snapshot.goal;
        goalTarget = target;
        sections.set(null, section);
      } else {
        if (section.localMemos) memoSection = section.id;
        sections.set(section.id, mergeSection(sections.get(section.id), section, section.scope === target.scope));
      }
    }
  }
  const memoById = new Map();
  for (const section of sections.values()) {
    for (const item of section.items ?? []) {
      if (item.type !== "memo") continue;
      const previous = memoById.get(item.id);
      if (!previous || scopeOrder.indexOf(previous.scope) <= scopeOrder.indexOf(item.scope)) memoById.set(item.id, item);
    }
  }
  return { goalTarget, snapshot: { version: 3, goal, sections: Array.from(sections.values(), (section) => {
    if (section.type === "goal") return section;
    const { localMemos, items, ...heading } = section;
    return { ...heading, ...(localMemos && section.id === memoSection && { localMemos }),
      items: items.filter((item) => item.type !== "memo" || memoById.get(item.id) === item) };
  }) } };
}

export async function readBoard(home, location, legacyTarget, read, includeMemos, previous) {
  const targets = scopeOrder.filter((scope) => location[scope]).map((scope) => ({ scope, id: location[scope] }));
  const rawLayers = await Promise.all(targets.map(async (target) => {
    const scoped = await read(paths(home, target).scoped);
    if (scoped !== null) return { target, raw: scoped, scoped: true };
    if (target.scope === legacyTarget?.scope) return { target, raw: await read(paths(home, target).snapshot), scoped: false };
    return { target, raw: null, scoped: false };
  }));
  const signature = rawLayers.map(({ raw, scoped }) => [raw, scoped]);
  const unchanged = previous?.signature?.length === signature.length && signature.every(([raw, scoped], index) =>
    raw === previous.signature[index][0] && scoped === previous.signature[index][1]);
  let board;
  if (unchanged) board = { snapshot: previous.snapshot, goalTarget: previous.goalTarget };
  else {
    const layers = rawLayers.filter(({ raw }) => raw !== null).map(({ target, raw, scoped }) => ({
      target, snapshot: parseSnapshot(raw, { partial: scoped }),
    }));
    if (!rawLayers.some(({ scoped }) => scoped)) {
      board = { snapshot: layers[0]?.snapshot ?? null, goalTarget: layers[0]?.target ?? null };
    } else board = compose(layers);
  }
  const memoRaw = includeMemos && board.goalTarget ? await read(paths(home, board.goalTarget).memos) : null;
  const memos = memoRaw === previous?.memoRaw ? previous.memos : parseMemos(memoRaw);
  return { ...board, signature, memoRaw, memos };
}
