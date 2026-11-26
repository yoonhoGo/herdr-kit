import assert from "node:assert/strict";
import { changeMemos, locationForTerminal, parseMemos, parseSharedSpaces, parseSnapshot, paths, targetFor, visibleMemos } from "./mods/workboard/model.mjs";
import { projectSnapshot, readBoard } from "./mods/workboard/scopes.mjs";

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

const publishing = { space: "remote/project", tab: "a", session: "term-a" };
const jiraUrl = "https://example.atlassian.net/browse/APP-42";
const runUrl = "https://github.com/org/app/actions/runs/123";
const rich = {
  description: ["Compare ", { text: "the PR", url: pr.url }, " with ", { text: "the failed run", url: runUrl }, "."],
  links: [{ title: "Failure log", url: runUrl, presentation: "card" },
    { title: "Open pull request", url: pr.url, presentation: "button" }],
};
const scoped = { version: 3, goal: { ...goal, url: jiraUrl, ...rich }, sections: [
  hero,
  { id: "release", type: "progress", title: "Release", scope: "space", items: [
    { type: "text", id: "ci", title: "CI", status: "blocked", url: runUrl, ...rich },
    { type: "step", id: "local-test", title: "Local test", scope: "tab", url: pr.url },
    { type: "step", id: "session-debug", title: "Debug trace", scope: "session" },
  ] },
  { id: "internal", type: "list", title: "Private heading", items: [
    { type: "text", title: "Shared incident note", scope: "space" },
  ] },
] };
const files = new Map();
const publishScoped = (snapshot, context = publishing) => {
  for (const [scope, fragment] of projectSnapshot(parseSnapshot(JSON.stringify(snapshot), { partial: true }), context)) {
    files.set(paths("/herdr", { scope, id: context[scope] }).scoped, JSON.stringify(fragment));
  }
};
const boardAt = (location) => readBoard("/herdr", location, targetFor(sharing, location), async (path) => files.get(path) ?? null, true);
const releaseRows = ({ snapshot }) => snapshot?.sections.find((section) => section.id === "release")?.items.map((item) => item.title);
publishScoped(scoped);
const sourceBoard = await boardAt(publishing);
assert.deepEqual(sourceBoard.snapshot.goal, scoped.goal);
assert.deepEqual(sourceBoard.snapshot.sections.find(({ id }) => id === "release").items.map(({ url }) => url),
  [runUrl, pr.url, undefined]);
assert.deepEqual(releaseRows(sourceBoard), ["CI", "Local test", "Debug trace"]);
assert.deepEqual(releaseRows(await boardAt({ ...publishing, session: "term-a2" })), ["CI", "Local test"]);
const neighboringTab = await boardAt({ ...publishing, tab: "b", session: "term-b" });
assert.deepEqual(releaseRows(neighboringTab), ["CI"]);
const sharedCi = neighboringTab.snapshot.sections.find(({ id }) => id === "release").items[0];
assert.equal(sharedCi.url, runUrl);
assert.deepEqual(sharedCi.description, rich.description);
assert.deepEqual(sharedCi.links, rich.links);
assert.equal(neighboringTab.snapshot.goal, null);
assert.equal(neighboringTab.snapshot.sections.find((section) => section.id === "internal").title, "공유 항목");
assert.equal((await boardAt({ space: "other", tab: "c", session: "term-c" })).snapshot, null);
const spaceOnly = { space: publishing.space };
const direct = await boardAt(spaceOnly);
publishScoped(direct.snapshot, spaceOnly);
assert.deepEqual(releaseRows(await boardAt(publishing)), ["CI", "Local test", "Debug trace"]);
publishScoped({ version: 3, goal: null, sections: [], replaceScopes: ["session"] });
assert.deepEqual(releaseRows(await boardAt(publishing)), ["CI", "Local test"]);
publishScoped({ ...scoped, sections: [hero] }, { ...publishing, tab: "b", session: "term-b" });
assert.deepEqual(releaseRows(await boardAt(publishing)), ["CI", "Local test"]);
assert.throws(() => parseSnapshot(JSON.stringify({ ...scoped, version: 2 })), /version 3/);
assert.throws(() => parseSnapshot(JSON.stringify({ ...scoped, goal: { ...goal, url: "file:///tmp/ticket" } })), /goal\.url.*HTTP/);
assert.throws(() => parse([hero, { ...progress, items: [{ ...progress.items[0], url: "javascript:alert(1)" }] }]),
  /items\[0\]\.url.*HTTP/);
const parseDescription = (fields) => parse([hero, { ...progress, items: [{ ...progress.items[0], ...fields }] }]);
assert.throws(() => parseDescription({ description: ["Open ", { text: "this", url: "file:///tmp/log" }] }),
  /description\[1\]\.url.*HTTP/);
assert.throws(() => parseDescription({ links: [{ ...rich.links[0], url: "javascript:alert(1)" }] }),
  /links\[0\]\.url.*HTTP/);
assert.throws(() => parseDescription({ links: [{ ...rich.links[0], presentation: "html" }] }),
  /links\[0\]\.presentation/);
console.log("Workboard component contract passed");
