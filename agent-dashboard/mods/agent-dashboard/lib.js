// 화면과 상관없는 작은 규칙들: 제목 정리, 시간 표시, 테마 색 투명도, 이름 비교.

// agents 기본 mod와 같은 정리: 제목 앞의 상태 글리프·스피너를 뗀다.
const strip = (s) => (s ?? "").replace(/^(?:\[ [!.] \] |[✋⏳]️?(?=\s)|(?!(?:\p{Emoji}️|[#*]⃣))[^\p{L}\p{N}\p{Ps}\p{Pi}\p{Emoji_Presentation}])+/u, "").trim();

// pi는 제목 앞에 "π > "나 "π ⠋ "를 붙인다: π를 떼고 한 번 더 정리한다.
export function clean(s) {
  const c = strip(s);
  return /^π\s/u.test(c) ? strip(c.slice(1)) : c;
}

// 패널 없는 하위 에이전트는 hc의 날 단어: error는 대기, done은 부모가 알리니 유휴.
export const kidStatus = (s) => (s === "error" ? "blocked" : s === "done" ? "idle" : s);

// 지난 시간. coarse면 시간 단위에서 분을 버린다(유휴처럼 오래된 것).
export function ago(ms, now, coarse = false) {
  if (ms == null) return "";
  const m = Math.floor((now - ms) / 60000);
  if (m < 1) return "방금";
  if (m < 60) return `${m}분`;
  const h = Math.floor(m / 60);
  if (h >= 24) return `${Math.floor(h / 24)}일`;
  return coarse || m % 60 === 0 ? `${h}시간` : `${h}시간 ${m % 60}분`;
}

// 테마 색(#rgb, #rrggbb, #rrggbbaa)에 투명도를 곱한다. 반투명 테마(herdr-glass)에서도
// 뒤에 두 자리를 덧붙여 색이 깨지지 않게.
export function alpha(c, a) {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(c ?? "");
  if (!m) return c;
  let h = m[1];
  if (h.length === 3) h = [...h].map((x) => x + x).join("");
  const base = h.length === 8 ? parseInt(h.slice(6), 16) / 255 : 1;
  const v = Math.round(Math.min(1, Math.max(0, base * a)) * 255);
  return `#${h.slice(0, 6)}${v.toString(16).padStart(2, "0")}`;
}

// 검색어를 낱말로: 대소문자 무시, 빈칸으로 나눈다.
export const terms = (query) => (query ?? "").toLowerCase().split(/\s+/).filter(Boolean);

// 낱말이 모두 들어 있으면 맞다(AND). 낱말이 없으면 모두 맞다.
export function matches(words, ...fields) {
  if (!words.length) return true;
  const hay = fields.filter(Boolean).join(" ").toLowerCase();
  return words.every((w) => hay.includes(w));
}

// 이름 목록을 "zsh ×2, Neovim"처럼: 처음 나온 순서, 둘 이상이면 개수.
export function tally(names) {
  const n = new Map();
  for (const x of names) n.set(x, (n.get(x) ?? 0) + 1);
  return [...n].map(([x, k]) => (k > 1 ? `${x} ×${k}` : x)).join(", ");
}

// 워크트리 폴더 이름이 브랜치에서 온 것인지(fix/APP-1 ↔ fix-APP-1): 같으면 한 줄로 줄인다.
export const sameName = (a, b) => Boolean(a && b) && a.replace(/[/_.]/g, "-").toLowerCase() === b.replace(/[/_.]/g, "-").toLowerCase();

// 레인의 묶음 열쇠: 저장소면 머신|저장소, 저장소가 아니면 머신|dir:경로, 아직 모르면 레인 혼자(머리 없음).
export function laneKey(info, machine, folder, space) {
  if (info?.repo) return `${machine}|${info.repo}`;
  return info === null ? `${machine}|dir:${folder}` : `space:${space}`;
}

// 레인을 세우고 묶는다. 레인은 { repo, rank, i, info, folder }: repo는 laneKey, rank는 가장 급한
// 상태(작을수록 급함), i는 원래 순서. 급한 단계가 먼저, 같은 단계에서는 묶음이 처음 나온 순서로 붙인다.
// 저장소가 아닌 폴더는 경로로 묶여 묶음(dir)마다 머리가 선다. 단계가 갈리면 한 묶음이 두 번 나올 수 있다.
export function groupLanes(lanes) {
  const firstSeen = new Map();
  for (const l of [...lanes].sort((a, b) => a.i - b.i)) if (!firstSeen.has(l.repo)) firstSeen.set(l.repo, l.i);
  const order = (a, b) => a.rank - b.rank || firstSeen.get(a.repo) - firstSeen.get(b.repo) || a.i - b.i;
  const groups = [];
  for (const l of [...lanes].sort(order)) {
    const last = groups[groups.length - 1];
    if (last?.repo === l.repo) last.rows.push(l);
    else groups.push({ repo: l.repo, info: l.info?.repo ? l.info : null, dir: l.repo.includes("|dir:") ? l.folder : null, rows: [l] });
  }
  return groups;
}
