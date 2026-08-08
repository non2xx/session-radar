import * as vscode from "vscode";
import { dirname, basename } from "node:path";
import { extractImagePaths } from "../core/imagePaths";

let panel: vscode.WebviewPanel | undefined;
let current: string[] = [];

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function html(webview: vscode.Webview, paths: string[]): string {
  const cards = paths
    .map((p, i) => {
      const src = webview.asWebviewUri(vscode.Uri.file(p));
      return `<figure class="card" data-i="${i}">
  <img src="${src}" alt="${esc(basename(p))}" loading="lazy">
  <figcaption title="${esc(p)}">${esc(basename(p))}</figcaption>
</figure>`;
    })
    .join("\n");

  return `<!DOCTYPE html>
<html lang="ko"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy"
      content="default-src 'none'; img-src ${webview.cspSource}; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
<style>
  body { margin:0; padding:10px; background:var(--vscode-editor-background); color:var(--vscode-editor-foreground);
         font-family:var(--vscode-font-family); font-size:12px; }
  .bar { display:flex; align-items:center; gap:10px; padding:0 2px 8px; opacity:.75; }
  .bar label { display:flex; align-items:center; gap:4px; cursor:pointer; }
  #grid { display:grid; gap:10px; grid-template-columns:repeat(var(--cols,2), minmax(0,1fr)); }
  .card { margin:0; display:flex; flex-direction:column; gap:4px; min-width:0; }
  .card img { width:100%; height:auto; display:block; border:1px solid var(--vscode-panel-border);
              border-radius:4px; background:#00000022; cursor:zoom-in; }
  .card figcaption { opacity:.65; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .card.zoom { grid-column:1 / -1; }
  .card.zoom img { cursor:zoom-out; }
  .empty { opacity:.6; padding:20px; }
</style></head><body>
<div class="bar">
  <span>${paths.length}장</span>
  <label>열 <input id="cols" type="range" min="1" max="4" value="2"></label>
  <span>클릭하면 크게, 다시 클릭하면 작게</span>
</div>
<div id="grid">${cards || '<div class="empty">이미지가 없습니다.</div>'}</div>
<script>
  const grid = document.getElementById('grid');
  document.getElementById('cols').addEventListener('input', (e) => {
    grid.style.setProperty('--cols', e.target.value);
  });
  grid.addEventListener('click', (e) => {
    const card = e.target.closest('.card');
    if (card) card.classList.toggle('zoom');
  });
</script>
</body></html>`;
}

/** 패널을 (다시) 만들어 보여준다. 웹뷰가 읽을 수 있는 폴더는 만들 때 고정이라 매번 새로 만든다. */
function show(paths: string[]) {
  current = paths;
  const roots = [...new Set(paths.map((p) => dirname(p)))].map((d) => vscode.Uri.file(d));
  panel?.dispose();
  panel = vscode.window.createWebviewPanel(
    "sessionRadar.images",
    `이미지 비교 (${paths.length})`,
    { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
    { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: roots },
  );
  panel.onDidDispose(() => { panel = undefined; current = []; });
  panel.webview.html = html(panel.webview, paths);
}

export function registerImageCompare(context: vscode.ExtensionContext) {
  const workspaceRoots = () =>
    (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath);

  const run = async (append: boolean) => {
    // 1순위: 복사해 둔 글에서 경로를 찾는다(터미널에서 링크 줄을 긁어 복사하는 흐름).
    let found: string[] = [];
    try { found = extractImagePaths(await vscode.env.clipboard.readText(), workspaceRoots()); } catch { found = []; }
    // 없으면 파일 고르기로 넘어간다.
    if (!found.length) {
      const picked = await vscode.window.showOpenDialog({
        canSelectMany: true, canSelectFiles: true, canSelectFolders: false,
        filters: { "이미지": ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "avif"] },
        openLabel: "나란히 보기",
        title: append ? "비교에 추가할 이미지" : "나란히 볼 이미지 고르기",
      });
      if (!picked || !picked.length) return;
      found = picked.map((u) => u.fsPath);
    }
    const next = append ? [...new Set([...current, ...found])] : found;
    show(next);
  };

  context.subscriptions.push(
    vscode.commands.registerCommand("sessionRadar.compareImages", () => run(false)),
    vscode.commands.registerCommand("sessionRadar.compareImagesAdd", () => run(true)),
  );
}
