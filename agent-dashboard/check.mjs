// node agent-dashboard/check.mjs [저장소 폴더...]: lib.js·vcs.js 규칙과, 폴더를 주면 실제 저장소에서 PROBE를 확인한다.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { PROBE, parse } from "./mods/agent-dashboard/vcs.js";
import { clean, ago, alpha, sameName, terms, matches, groupLanes, laneKey, tally } from "./mods/agent-dashboard/lib.js";

assert.equal(tally(["zsh", "Neovim", "zsh"]), "zsh ×2, Neovim");
assert.equal(tally([]), "");

// 레인 묶기. 저장소가 아닌 폴더는 경로로 묶이고, 묶음마다 머리가 선다.
// 같은 경로(~/workspace)의 두 스페이스는 한 묶음, ops-notes는 따로. 순서는 저장소와 같은
// 규칙(급한 단계 먼저, 같은 단계에서는 묶음이 처음 나온 순서)이라 ~/workspace 묶음은 유휴 단계에서도 앞서고,
// 그래서 작업 중 레인 바로 뒤에 붙어 한 묶음이 된다(순서는 급한 순 그대로).
{
  const W = "/Users/me/workspace";
  const B = "/Users/me/workspace/ops-notes";
  const lane = (name, info, folder, rank, i) => ({ name, info, folder, rank, i, repo: laneKey(info, "local", folder, name) });
  const acct = { repo: "acct" };
  const groups = groupLanes([
    lane("workspace(작업 중)", null, W, 2, 0),
    lane("account-server", acct, "/a", 3, 1),
    lane("APP-1036", acct, "/a1", 3, 2),
    lane("APP-1038", acct, "/a2", 3, 3),
    lane("workspace", null, W, 3, 5),
    lane("ops-notes", null, B, 3, 6),
    lane("auth-service", { repo: "auth" }, "/b", 3, 7),
    lane("조회 중", undefined, "/c", 3, 8),
  ]);
  assert.deepEqual(groups.map((g) => [g.dir ?? g.info?.repo ?? "-", g.rows.map((r) => r.name)]), [
    [W, ["workspace(작업 중)", "workspace"]],
    ["acct", ["account-server", "APP-1036", "APP-1038"]],
    [B, ["ops-notes"]],
    ["auth", ["auth-service"]],
    ["-", ["조회 중"]],
  ]);
}

// 검색: 낱말을 모두 담아야 맞고(AND), 대소문자는 무시하고, 빈 필드는 건너뛴다.
assert.deepEqual(terms("  APP-1036  Account "), ["app-1036", "account"]);
assert.ok(matches([], "anything"));
assert.ok(matches(terms("app-1036 fix"), "APP-1036 account", null, "fix/APP-1036-name-check"));
assert.ok(!matches(terms("app-1036 build-box"), "APP-1036 account", "fix/APP-1036"));

// 제목 정리: 상태 글리프와 pi의 프롬프트 표시를 뗀다.
assert.equal(clean("π > 💬 CHAT: x"), "💬 CHAT: x");
assert.equal(clean("π ⠋ 📱 NATIVE: y"), "📱 NATIVE: y");
assert.equal(clean("✳ APP-1038 kakao"), "APP-1038 kakao");
assert.equal(clean("πthon"), "πthon");

// 시간: 분, 시간(+분), 일. coarse는 분을 버린다.
const now = 10 * 86400000;
assert.equal(ago(null, now), "");
assert.equal(ago(now - 30000, now), "방금");
assert.equal(ago(now - 5 * 60000, now), "5분");
assert.equal(ago(now - 125 * 60000, now), "2시간 5분");
assert.equal(ago(now - 125 * 60000, now, true), "2시간");
assert.equal(ago(now - 50 * 3600000, now), "2일");

// 투명도: 불투명 색은 덧붙이고, 반투명 색은 곱하고, 짧은 hex는 늘리고, 모르는 값은 그대로.
assert.equal(alpha("#8cc27d", 0.5), "#8cc27d80");
assert.equal(alpha("#ffffff26", 0.5), "#ffffff13");
assert.equal(alpha("#fff", 1), "#ffffffff");
assert.equal(alpha("red", 0.5), "red");

assert.ok(sameName("fix/APP-1036-name-check", "fix-APP-1036-name-check"));
assert.ok(!sameName("APP-588", "OPS-2619-monitor"));

assert.equal(parse(""), null);
assert.deepEqual(parse("vcs=jj\nrepo=charts\ntrunk=feat/x main\nwork=main perf/web \ntree=\nchange=wzqm\ndirty="), {
  vcs: "jj", repo: "charts", trunk: "main", work: "perf/web", tree: null, change: "wzqm", dirty: false,
});
// jj: 가장 가까운 bookmark가 trunk뿐이면 작업 bookmark 없음, workspace 이름에서 @를 뗀다.
assert.deepEqual(parse("vcs=jj\nrepo=auth\ntrunk=main\nwork=main \ntree=all-in-one@\nchange=ylpk\ndirty=1"), {
  vcs: "jj", repo: "auth", trunk: "main", work: null, tree: "all-in-one", change: "ylpk", dirty: true,
});
// git: origin/ 접두어를 떼고, trunk에서 작업 중이면 그대로 둔다.
assert.deepEqual(parse("vcs=git\nrepo=billing\ntrunk=origin/master\nwork=master\nchange=abc1234"), {
  vcs: "git", repo: "billing", trunk: "master", work: "master", tree: null, change: "abc1234", dirty: false,
});

for (const dir of process.argv.slice(2)) {
  const info = parse(execFileSync("sh", ["-c", PROBE], { cwd: dir, encoding: "utf8" }));
  assert.ok(info?.repo && info.trunk, `${dir}: ${JSON.stringify(info)}`);
  console.log(dir, info);
}
console.log("check ok");
