import assert from "node:assert/strict";
import { changeMemos, locationForTerminal, parseMemos, parseSharedSpaces, parseSnapshot, paths, targetFor, visibleMemos } from "./mods/workboard/model.mjs";

const goal = { id: "demo", title: "Ship checkout" };
const note = { id: "handoff", kind: "next", body: "Check staging" };
const hero = { id: "current", type: "goal" };
const checkout = { title: "Checkout", status: "done" };
const legacy = parseSnapshot(JSON.stringify({ version: 1, goal, blocks: [
  { type: "subgoals", items: [checkout] },
  { type: "workflow", items: [checkout] },
  { type: "memos", items: [note] },
] }));
assert.deepEqual(legacy.sections.map((section) => [section.type, section.items?.[0].type]), [
  ["goal", undefined], ["list", "text"], ["progress", "step"], ["list", "memo"],
]);
assert.deepEqual(parseSnapshot(JSON.stringify(legacy)), legacy);

const parse = (sections) => parseSnapshot(JSON.stringify({ version: 2, goal, sections }));
const pr = { type: "link", title: "PR", url: "https://github.com/org/app/pull/1" };
const action = { type: "command", title: "Test", argv: ["npm", "test"] };
const combined = { id: "ci", title: "CI 실행", type: "list", localMemos: true,
  items: [{ type: "step", ...checkout }, pr, { type: "memo", ...note }, action] };
const progress = { id: "flow", title: "Workflow", type: "progress", items: [{ type: "text", ...checkout }] };
const custom = parse([combined, hero, progress]);
assert.deepEqual(custom.sections.map((section) => section.id), ["ci", "current", "flow"]);
assert.deepEqual(custom.sections[0].items.map((item) => item.type), ["step", "link", "memo", "command"]);
assert.equal(custom.sections[0].items[1].url, pr.url);
assert.deepEqual(custom.sections[0].items[3].argv, action.argv);

// A dismissed agent memo stays dismissed after moving it into a different section or migrating from v1.
let storage = changeMemos(null, goal.id, { remove: { id: note.id, source: "agent" } });
storage = changeMemos(storage, goal.id, { add: { id: "mine", kind: "decision", body: "Use staging" } });
for (const snapshot of [legacy, custom]) {
  assert.deepEqual(visibleMemos(snapshot, parseMemos(storage)).map((memo) => [memo.id, memo.source]), [["mine", "local"]]);
}
assert.throws(() => parse([combined]), /goal/);
assert.throws(() => parse([hero, { ...hero, id: "second" }]), /goal/);
assert.throws(() => parse([hero, progress, { ...progress }]), /중복/);
assert.throws(() => parse([hero, { ...progress, items: [pr] }]), /text 또는 step/);
assert.throws(() => parse([hero, combined, { ...combined, id: "second", localMemos: false }]), /memos.*중복/);
assert.throws(() => parse([hero, combined, { ...combined, id: "second", items: [] }]), /localMemos/);

const tab = (id) => ({ id, terminals: [{ terminal: `term-${id}` }] });
const state = { spaces: [{ id: "remote/project", tabs: [tab("a"), tab("b")] }, { id: "other", tabs: [tab("c")] }] };
const sharing = parseSharedSpaces('{"sharedSpaces":["remote/project"]}');
const storageFor = (terminal, config = sharing) =>
  paths("/herdr", targetFor(config, locationForTerminal(state, terminal)));
assert.deepEqual(storageFor("term-a"), storageFor("term-b"));
assert.equal(storageFor("term-b").snapshot, "/herdr/data/workboard/spaces/remote%2Fproject.snapshot.json");
assert.equal(storageFor("term-c").snapshot, "/herdr/data/workboard/c.snapshot.json");
assert.equal(storageFor("term-a", parseSharedSpaces(null)).snapshot, "/herdr/data/workboard/a.snapshot.json");
assert.throws(() => parseSharedSpaces('{"sharedSpaces":"remote/project"}'), /sharedSpaces/);
console.log("Workboard component contract passed");
