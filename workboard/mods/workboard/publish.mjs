import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { configPath, locationForTerminal, parseMemos, parseSharedSpaces, parseSnapshot, paths, targetFor, visibleMemos } from "./model.mjs";

const usage = "node publish.mjs [--tab HERDR_TAB_ID | --space HERDR_SPACE_ID] show | publish [JSON_FILE|-]";
const args = process.argv.slice(2);
const selector = args[0] === "--tab" || args[0] === "--space" ? args.shift().slice(2) : null;
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

try {
  if (action === "--help" || action === "-h") {
    console.log(usage);
  } else {
    if ((selector && !explicitId) || extra.length || (action !== "publish" && !(action === "show" && input === undefined))) {
      throw new Error(usage);
    }
    const home = process.env.HERDR_APP_HOME || join(homedir(), ".config", "herdr-app");
    const sharedSpaces = parseSharedSpaces(await readOptional(configPath(home)));
    let target;
    if (selector === "tab") {
      target = { scope: "tab", id: explicitId };
    } else if (selector === "space") {
      if (!sharedSpaces.has(explicitId)) throw new Error("설정에서 공유를 켠 스페이스만 --space로 지정할 수 있습니다");
      target = { scope: "space", id: explicitId };
    } else {
      const terminal = process.env.HC_TERMINAL_ID;
      if (!terminal) throw new Error("Herdr 에이전트 터미널에서 실행하거나 --tab 또는 --space를 지정하세요");
      const state = execFileSync("herdr-app", ["ls"], { encoding: "utf8", timeout: 5000 });
      target = targetFor(sharedSpaces, locationForTerminal(JSON.parse(state), terminal));
    }
    const files = paths(home, target);
    const destination = { [target.scope]: target.id };
    if (action === "show") {
      const raw = await readOptional(files.snapshot);
      const snapshot = raw === null ? null : parseSnapshot(raw);
      const memos = snapshot ? visibleMemos(snapshot, parseMemos(await readOptional(files.memos))) : [];
      console.log(JSON.stringify({ ...destination, snapshot, memos }, null, 2));
    } else {
      const raw = !input || input === "-" ? await readStdin() : await readFile(input, "utf8");
      const snapshot = parseSnapshot(raw);
      const temp = join(dirname(files.snapshot), `.${randomUUID()}.tmp`);
      await mkdir(dirname(temp), { recursive: true, mode: 0o700 });
      try {
        await writeFile(temp, raw, { flag: "wx", mode: 0o600 });
        await rename(temp, files.snapshot);
      } catch (error) {
        await unlink(temp).catch(() => {});
        throw error;
      }
      console.log(JSON.stringify({ ...destination, goal: snapshot.goal.id }));
    }
  }
} catch (error) {
  console.error(`workboard: ${error.message}`);
  process.exitCode = 1;
}
