import * as vscode from "vscode";
import { findImageSpans, resolveImagePath } from "../core/imagePaths";
import { pickColumn } from "../core/imageColumns";

interface ImageLink extends vscode.TerminalLink {
  file: string;
}

/** 한 묶음(연속 클릭)으로 볼 시간 간격. 이보다 오래 쉬면 다시 첫 칸부터 채운다. */
const BATCH_GAP_MS = 30_000;

let lastClickAt = 0;
let batch: number[] = []; // 이번 묶음에서 쓴 칸 번호(왼쪽부터 순서대로)
let cycle = 0;            // 칸이 꽉 찼을 때 어느 칸을 재사용할지

/** 지금 열려 있는 편집기 칸들. tabGroups 를 못 쓰는 옛 버전은 1칸으로 친다. */
function groups(): readonly { tabs: readonly unknown[] }[] {
  try { return vscode.window.tabGroups.all as any; } catch { return [{ tabs: [] }]; }
}


export function registerImageLinks(context: vscode.ExtensionContext) {
  const cfg = () => vscode.workspace.getConfiguration("sessionRadar");
  const roots = () => (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath);
  let chain: Promise<void> = Promise.resolve(); // 클릭 처리를 한 줄로 세우는 대기줄

  const openOne = async (link: ImageLink): Promise<void> => {
    const max = Math.max(1, Math.min(5, cfg().get<number>("imageColumns", 3)));
    const now = Date.now();
    // 한동안 안 눌렀으면 새 묶음으로 보고 처음부터 다시 채운다.
    if (now - lastClickAt > BATCH_GAP_MS) { batch = []; cycle = 0; }
    lastClickAt = now;

    const counts = groups().map((g) => g.tabs.length);
    const picked = pickColumn(counts, batch, max, cycle);
    batch = picked.used;
    if (picked.reused) cycle++; // 실제로 재사용한 클릭에서만 올린다(칸을 채운 클릭에서 올리면 한 칸씩 밀린다)

    // preserveFocus: 터미널에 초점을 남겨 다음 링크를 바로 이어서 누를 수 있게.
    try {
      await vscode.commands.executeCommand("vscode.open", vscode.Uri.file(link.file), {
        viewColumn: picked.col,
        preserveFocus: true,
      });
    } catch (e) {
      vscode.window.showWarningMessage(`이미지를 열지 못했어요: ${link.file} (${e})`);
    }
  };

  const provider: vscode.TerminalLinkProvider<ImageLink> = {
    provideTerminalLinks(ctx) {
      if (!cfg().get<boolean>("imageSplitOnClick", true)) return [];
      const links: ImageLink[] = [];
      for (const span of findImageSpans(ctx.line)) {
        const file = resolveImagePath(span.raw, roots());
        if (!file) continue; // 실제로 없는 경로는 VS Code 기본 동작에 넘긴다
        links.push({
          startIndex: span.start,
          length: span.raw.length,
          tooltip: "옆 칸에 열기 (나란히 비교)",
          file,
        });
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
      batch = [];
      cycle = 0;
      lastClickAt = 0;
      vscode.window.showInformationMessage("다음 이미지는 첫 칸부터 다시 채웁니다.");
    }),
  );
}
