import * as vscode from "vscode";
import {
  findImageSpans, findTruncatedSpan, resolveSpanPath, resolveByRecentDirs, MAX_RECENT_DIRS,
} from "../core/imagePaths";
import { dirname } from "node:path";
import { capturePane } from "../core/tmux";
import { resolveJoined, underlineRange } from "../core/wrappedLines";
import { planGrid, planBase, baseGroupCount, MAX_IMAGES } from "../core/imageGrid";

interface ImageLink extends vscode.TerminalLink {
  file: string;
  session: string;
}

/**
 * 사진은 **세션 것**이다.
 *
 * 한 세션에서 사진을 펴 두고 다른 세션으로 옮기면, 남의 사진이 화면을 차지한 채 남는다.
 * 그래서 떠날 때 그 세션 앞으로 접어 두고(stash), 돌아오면 그대로 다시 편다.
 * 접기 전에 "실제로 아직 열려 있는 것"만 추린다 — 사용자가 손으로 닫은 건 안 되살린다.
 */
let shown: { session: string; files: string[] } | undefined; // 지금 화면에 편 것
const stash = new Map<string, string[]>();                   // 세션별로 접어 둔 것
let cycle = 0;      // 다 찼을 때 어느 칸을 다시 쓸지
let baseGroups = 0; // 사진에 안 쓰고 그대로 둘 왼쪽 칸 수(펴기 시작할 때 한 번 잰다)

function resetBatch(): void {
  shown = undefined;
  stash.clear();
  cycle = 0;
}

/**
 * 잘린 경로 조회 결과를 잠깐 기억해 둔다.
 *
 * provideTerminalLinks 는 **마우스가 줄 위를 스칠 때마다** 불리는데, 잘린 경로 조회는
 * 폴더를 실제로 읽는다. 같은 줄을 몇 번이고 다시 읽으면 /mnt/c 같은 느린 폴더에서
 * 화면이 끊긴다. 찾은 것도 못 찾은 것도(null) 같이 기억해야 헛수고가 안 줄어든다.
 */
const TRUNC_TTL_MS = 5_000;
const TRUNC_MAX = 200;
type Trunc = ReturnType<typeof findTruncatedSpan>;
const truncCache = new Map<string, { at: number; v: Trunc }>();

function truncatedCached(line: string): Trunc {
  const hit = truncCache.get(line);
  const now = Date.now();
  if (hit && now - hit.at < TRUNC_TTL_MS) return hit.v;
  const v = findTruncatedSpan(line);
  if (truncCache.size >= TRUNC_MAX) truncCache.clear(); // 가장 단순한 비우기로 충분한 크기
  truncCache.set(line, { at: now, v });
  return v;
}

/**
 * 최근에 링크로 이어진 사진들의 폴더(새것부터).
 *
 * 접힌 뒷조각을 살리는 유일한 단서다. 창이 좁아지기 전에 연 첫 장이 폴더를 알려 주고,
 * 그 뒤로 접힌 줄들이 그 폴더에 기대 풀린다. 세션 안에서만 산다.
 */
let recentDirs: string[] = [];
function remember(file: string): void {
  const d = dirname(file);
  recentDirs = [d, ...recentDirs.filter((x) => x !== d)].slice(0, MAX_RECENT_DIRS);
}

/**
 * tmux 화면 글자를 잠깐 붙들어 둔다. 마우스가 줄을 스칠 때마다 tmux 를 부르면 안 되고,
 * 화면은 어차피 자주 안 바뀐다.
 */
const PANE_TTL_MS = 2_000;
const paneCache = new Map<string, { at: number; lines: string[] }>();
function paneLines(session: string): string[] {
  const hit = paneCache.get(session);
  const now = Date.now();
  if (hit && now - hit.at < PANE_TTL_MS) return hit.lines;
  const lines = capturePane(session);
  paneCache.set(session, { at: now, lines });
  return lines;
}

/** 지금 열려 있는 편집기 칸들. tabGroups 를 못 쓰는 옛 버전은 1칸으로 친다. */
function groups(): readonly { tabs: readonly unknown[] }[] {
  try { return vscode.window.tabGroups.all as any; } catch { return [{ tabs: [] }]; }
}

/** 지금 편집기에 열려 있는 파일 경로들. */
function openPaths(): Set<string> {
  const out = new Set<string>();
  try {
    for (const g of vscode.window.tabGroups.all) {
      for (const t of g.tabs) {
        const uri = (t.input as { uri?: vscode.Uri } | undefined)?.uri;
        if (uri) out.add(uri.fsPath);
      }
    }
  } catch { /* 옛 VS Code 면 빈 채로 둔다 */ }
  return out;
}

async function closeFiles(files: string[]): Promise<void> {
  if (!files.length) return;
  try {
    const want = new Set(files);
    const tabs = vscode.window.tabGroups.all.flatMap((g) => g.tabs).filter((t) => {
      const uri = (t.input as { uri?: vscode.Uri } | undefined)?.uri;
      return !!uri && want.has(uri.fsPath);
    });
    if (tabs.length) await vscode.window.tabGroups.close(tabs, true);
  } catch { /* 못 닫아도 다음 배치가 덮어쓴다 */ }
}


export function registerImageLinks(context: vscode.ExtensionContext) {
  const cfg = () => vscode.workspace.getConfiguration("sessionRadar");
  const roots = () => (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath);
  let chain: Promise<void> = Promise.resolve(); // 클릭 처리를 한 줄로 세우는 대기줄

  const maxOpen = () => Math.max(1, Math.min(MAX_IMAGES, cfg().get<number>("imageMaxOpen", 4)));

  /** 배치를 먼저 바꾸고 나서 연다. 순서가 반대면 아직 없는 칸 번호로 열게 되어 빈 칸이 생긴다. */
  const layout = async (plan: unknown): Promise<void> => {
    try { await vscode.commands.executeCommand("vscode.setEditorLayout", plan); } catch { /* 옛 버전 */ }
  };

  const openAt = async (file: string, col: number): Promise<void> => {
    // preserveFocus: 터미널에 초점을 남겨 다음 링크를 바로 이어서 누를 수 있게.
    try {
      await vscode.commands.executeCommand("vscode.open", vscode.Uri.file(file), {
        viewColumn: col, preserveFocus: true,
      });
    } catch (e) {
      vscode.window.showWarningMessage(`이미지를 열지 못했어요: ${file} (${e})`);
    }
  };

  const openOne = async (link: ImageLink): Promise<void> => {
    const max = maxOpen();
    // 다른 세션 것이 펴져 있으면 먼저 접는다(그 세션으로 돌아가면 다시 펴진다).
    if (shown && shown.session !== link.session) await stashShown();
    if (!shown) {
      // "왼쪽에 남겨 둘 칸"은 사진을 펴기 **전에** 잰다. 사진 칸이 생긴 뒤에 재면
      // 그 칸까지 왼쪽으로 세어 격자가 오른쪽으로 계속 밀린다.
      baseGroups = baseGroupCount(groups().map((g) => g.tabs.length));
      cycle = 0;
      shown = { session: link.session, files: [] };
    }

    let slot: number;
    if (shown.files.length < max) {
      slot = shown.files.length;      // 자리가 남았으면 다음 자리를 새로 편다
      shown.files.push(link.file);
    } else {
      slot = cycle % max;             // 다 찼으면 왼쪽 위부터 돌아가며 다시 쓴다
      cycle++;
      shown.files[slot] = link.file;  // 화면과 기억을 같이 바꾼다
    }

    const plan = planGrid(baseGroups, shown.files.length);
    await layout(plan.layout);
    await openAt(link.file, plan.columns[slot] ?? vscode.ViewColumn.Beside);
  };

  /** 지금 펴 둔 사진을 그 세션 앞으로 접는다. 손으로 닫은 것은 빼고 기억한다. */
  const stashShown = async (): Promise<void> => {
    if (!shown) return;
    const alive = openPaths();
    const keep = shown.files.filter((f) => alive.has(f));
    if (keep.length) stash.set(shown.session, keep);
    else stash.delete(shown.session);
    await closeFiles(shown.files);
    shown = undefined;
  };

  /** 그 세션 앞으로 접어 둔 사진을 다시 편다. 없으면 원래 칸만 남긴다. */
  const restoreFor = async (session: string): Promise<void> => {
    const files = (stash.get(session) ?? []).slice(0, maxOpen());
    baseGroups = baseGroupCount(groups().map((g) => g.tabs.length));
    if (!files.length) {
      // 사진을 닫으면 그 자리가 빈 칸으로 남는다. 원래 칸만 남기는 배치로 되돌린다.
      await layout(planBase(baseGroups));
      return;
    }
    const plan = planGrid(baseGroups, files.length);
    await layout(plan.layout);
    for (let i = 0; i < files.length; i++) await openAt(files[i], plan.columns[i]);
    cycle = 0;
    shown = { session, files };
  };

  // 세션을 옮기면 사진도 따라 바뀐다. 사진 탭을 클릭한 경우(활성 터미널 없음)는 건드리지 않는다.
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTerminal((t) => {
      if (!t || !cfg().get<boolean>("imageSplitOnClick", true)) return;
      const to = t.name;
      if (shown?.session === to) return;
      // 사진을 한 번도 안 쓴 창에서는 배치를 건드리지 않는다(시작할 때 터미널이 붙는 것만으로
      // 사용자가 짜 둔 칸 배치가 흔들리면 안 된다).
      if (!shown && !stash.has(to)) return;
      chain = chain.catch(() => {}).then(async () => {
        await stashShown();
        await restoreFor(to);
      });
    }),
  );

  /** 화면에서 위/아래 줄을 붙여 진짜 파일을 찾는다. 답이 갈리면 아무것도 안 한다. */
  const joinFromPane = (session: string, line: string) => {
    const lines = paneLines(session);
    if (!lines.length) return undefined;
    const hit = resolveJoined(lines, line, (text) => {
      for (const span of findImageSpans(text)) {
        const r = resolveSpanPath(span.raw, roots());
        if (r) return r.file;
      }
      return undefined;
    });
    return hit ? { file: hit.file, range: toRange(underlineRange(line, hit.side)) } : undefined;
  };

  const provider: vscode.TerminalLinkProvider<ImageLink> = {
    provideTerminalLinks(ctx) {
      if (!cfg().get<boolean>("imageSplitOnClick", true)) return [];
      const session = ctx.terminal.name;
      const links: ImageLink[] = [];
      for (const span of findImageSpans(ctx.line)) {
        const hit = resolveSpanPath(span.raw, roots());
        if (hit) {
          // offset: 앞에 딴 글자가 붙어 있었으면 그만큼 밑줄을 밀어 진짜 경로에만 긋는다.
          remember(hit.file);
          links.push({
            startIndex: span.start + hit.offset,
            length: span.raw.length - hit.offset,
            tooltip: "격자로 열기 (나란히 비교)",
            file: hit.file,
            session,
          });
          continue;
        }
        // 접힌 뒷조각(폴더가 잘려 나간 조각)은 최근에 연 사진의 폴더에 비춰 본다.
        const byRecent = resolveByRecentDirs(span.raw, recentDirs);
        if (!byRecent) continue; // 그래도 못 찾으면 VS Code 기본 동작에 넘긴다
        links.push({
          startIndex: span.start,
          length: span.raw.length,
          tooltip: `격자로 열기 (줄바꿈으로 잘린 뒷조각): ${byRecent}`,
          file: byRecent,
          session,
        });
      }
      // 아무것도 못 찾았으면, 두 줄로 접힌 경우로 보고 **원본 화면에서 이웃 줄을 붙여** 본다.
      // 이게 가장 확실한 길이다 — 추측이 아니라 tmux 가 들고 있는 진짜 글자를 읽는다.
      if (links.length === 0) {
        const joined = joinFromPane(session, ctx.line);
        if (joined) {
          remember(joined.file);
          links.push({ ...joined.range, tooltip: `격자로 열기 (접힌 경로): ${joined.file}`, file: joined.file, session });
          return links;
        }
      }

      // 터미널이 좁아 경로가 두 줄로 접힌 경우. 접힌 앞조각은 확장자가 없어 위에서 안 잡힌다.
      // 줄 끝을 이미 링크로 덮었으면 건드리지 않는다.
      const end = ctx.line.replace(/\s+$/, "").length;
      const covered = links.some((l) => l.startIndex + l.length >= end);
      if (!covered) {
        const t = truncatedCached(ctx.line);
        if (t) {
          remember(t.file);
          links.push({
            startIndex: t.start,
            length: t.raw.length,
            tooltip: `격자로 열기 (줄바꿈으로 잘린 경로): ${t.file}`,
            file: t.file,
            session,
          });
        }
      }
      return links;
    },
    // 클릭 처리를 확장 안에서 한 줄로 세운다.
    // 앞 클릭의 칸이 실제로 만들어진 뒤에 다음 클릭이 칸 수를 세야 한다. VS Code 가 핸들러 호출을
    // 줄 세워 준다는 보장이 API 에 없어서, 안 세우면 느린 원격에서 한 칸에 탭으로 쌓인다
    // (연속 클릭이 이 기능의 핵심 동선이라 그러면 없애려던 불편으로 되돌아간다).
    // catch 를 먼저 거는 게 핵심 — 약속(promise) 사슬은 한 번 실패하면 뒤에 붙는 일이
    // 아예 실행되지 않는다. 없으면 클릭 한 번이 예외로 끝난 뒤 그 창에서는 이후 클릭이
    // 조용히 전부 무시되고, Reload 전에는 안 돌아온다.
    handleTerminalLink(link) {
      chain = chain.catch(() => {}).then(() => openOne(link));
      return chain;
    },
  };

  context.subscriptions.push(vscode.window.registerTerminalLinkProvider(provider));

  // 칸 배치를 처음부터 다시 시작하고 싶을 때.
  context.subscriptions.push(
    vscode.commands.registerCommand("sessionRadar.resetImageColumns", () => {
      resetBatch();
      vscode.window.showInformationMessage("다음 이미지는 격자 첫 칸부터 다시 채웁니다.");
    }),
  );
}

/** core 의 밑줄 범위를 VS Code 링크 필드 이름으로 바꾼다. */
function toRange(r: { start: number; length: number }) {
  return { startIndex: r.start, length: r.length };
}
