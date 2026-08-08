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
    handleTerminalLink(link) {
      const max = Math.max(1, Math.min(5, cfg().get<number>("imageColumns", 3)));
      const now = Date.now();
      // 한동안 안 눌렀으면 새 묶음으로 보고 처음부터 다시 채운다.
      if (now - lastClickAt > BATCH_GAP_MS) { batch = []; cycle = 0; }
      lastClickAt = now;

      const counts = groups().map((g) => g.tabs.length);
      const picked = pickColumn(counts, batch, max, cycle);
      batch = picked.used;
      if (batch.length >= max) cycle++;

      // preserveFocus: 터미널에 초점을 남겨 다음 링크를 바로 이어서 누를 수 있게.
      vscode.commands.executeCommand("vscode.open", vscode.Uri.file(link.file), {
        viewColumn: picked.col,
        preserveFocus: true,
      });
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
