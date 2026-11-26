import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { configPath, locationForTerminal, parseSharedSpaces, parseSnapshot, paths, scopeOrder, targetFor, visibleMemos } from "./model.mjs";
import { projectSnapshot, readBoard } from "./scopes.mjs";

const usage = "node publish.mjs [--tab ID | --space ID | --session ADDRESS] show | publish [JSON_FILE|-]";
const args = process.argv.slice(2);
const selector = scopeOrder.find((scope) => args[0] === `--${scope}`);
if (selector) args.shift();
const explicitId = selector ? args.shift() : null;
const [action, input, ...extra] = args;

async function readOptional(path) {
  try { return await readFile(path, "utf8"); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

async function writeSnapshot(path, raw) {
  const temp = join(dirname(path), `.${randomUUID()}.tmp`);
  await mkdir(dirname(temp), { recursive: true, mode: 0o700 });
  try {
    await writeFile(temp, raw, { flag: "wx", mode: 0o600 });
    await rename(temp, path);
  } catch (error) {
    await unlink(temp).catch(() => {});
    throw error;
  }
}

try {
  if (action === "--help" || action === "-h") {
    console.log(usage);
  } else {
    if ((selector && !explicitId) || extra.length || (action !== "publish" && !(action === "show" && input === undefined))) {
      throw new Error(usage);
    }
    const home = process.env.HERDR_APP_HOME || join(homedir(), ".config", "herdr-app");
    const sharedSpaces = parseSharedSpaces(await readOptional(configPath(home)));
    let location;
    if (selector) location = { [selector]: explicitId };
    else {
      const terminal = process.env.HC_TERMINAL_ID;
      if (!terminal) throw new Error(`Herdr 에이전트 터미널에서 실행하거나 범위를 지정하세요: ${usage}`);
      const state = execFileSync("herdr-app", ["ls"], { encoding: "utf8", timeout: 5000 });
      location = locationForTerminal(JSON.parse(state), terminal);
    }
    const legacyTarget = selector ? { scope: selector, id: explicitId } : targetFor(sharedSpaces, location);
    const destination = { [legacyTarget.scope]: legacyTarget.id };
    if (action === "show") {
      const { snapshot, memos } = await readBoard(home, location, legacyTarget, readOptional, true);
      console.log(JSON.stringify({ ...destination, snapshot, memos: snapshot ? visibleMemos(snapshot, memos) : [] }, null, 2));
    } else {
      const raw = !input || input === "-" ? await readStdin() : await readFile(input, "utf8");
      const snapshot = parseSnapshot(raw, { partial: true });
      if (snapshot.version === 3) {
        const fragments = projectSnapshot(snapshot, location);
        if (!fragments.size) throw new Error("발행할 범위를 scope 또는 replaceScopes로 지정하세요");
        const writes = Array.from(fragments, ([scope, fragment]) => {
          const output = JSON.stringify(fragment);
          parseSnapshot(output, { partial: true });
          return [paths(home, { scope, id: location[scope] }).scoped, output];
        });
        for (const [path, output] of writes) await writeSnapshot(path, output);
        console.log(JSON.stringify({ scopes: Object.fromEntries(Array.from(fragments.keys(), (scope) => [scope, location[scope]])),
          goal: snapshot.goal?.id ?? null }));
      } else {
        if (selector === "session" || (selector === "space" && !sharedSpaces.has(explicitId))) {
          throw new Error("이 범위에 발행하려면 스냅숏 version 3을 사용하세요");
        }
        await writeSnapshot(paths(home, legacyTarget).snapshot, raw);
        console.log(JSON.stringify({ ...destination, goal: snapshot.goal.id }));
      }
    }
  }
} catch (error) {
  console.error(`workboard: ${error.message}`);
  process.exitCode = 1;
}
