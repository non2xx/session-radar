import * as vscode from "vscode";
import { mkdirSync, existsSync, statSync } from "node:fs";
import { SessionRadarProvider, STATUS_DIR, LAYOUT_FILE, OPEN_FILE } from "./ui/treeProvider";
import { registerCommands } from "./ui/commands";
import { CardViewProvider } from "./ui/cardView";
import { isSafeSessionName, attachCommand } from "./core/tmux";
import { loadLayout } from "./core/layoutStore";
import { loadOpen, saveOpen } from "./core/openStore";
import { sessionArg } from "./core/args";

export function activate(context: vscode.ExtensionContext) {
  const provider = new SessionRadarProvider();
  // open-list = sessions opened and not explicitly removed (removal only via hideSession).
  // Tab close does NOT shrink it → no shutdown wipe race. Union-on-add keeps multi-window safe.
  const markOpen = (name: string) => { saveOpen(OPEN_FILE, [...loadOpen(OPEN_FILE), name]); };

  // jump(일반)와 jumpSplit(분할)이 공유하는 열기 로직. split=true면 활성 터미널 옆에 분할.
  const openSession = (name: string, opts: { split: boolean }) => {
    const existing = vscode.window.terminals.filter((t) => t.name === name);
    // 분할이 아니고 이미 열려 있으면 → 그 탭으로 포커스(중복 attach/거울 방지).
    if (!opts.split && existing.length) { existing[0].show(); markOpen(name); return; }
    if (!isSafeSessionName(name)) {
      vscode.window.showWarningMessage(`'${name}' 이름이 안전하지 않아 자동으로 열 수 없어요 (영문/숫자/._- 만).`);
      return;
    }
    // 분할이면 기존 탭을 닫아(detach, tmux 세션·내용 보존) 에디터 영역 옆으로 다시 붙임 — 같은 세션 거울 방지.
    if (opts.split) for (const t of existing) t.dispose();
    let cwd: string | undefined = loadLayout(LAYOUT_FILE).paths[name];
    if (cwd) {
      let ok = false;
      try { ok = existsSync(cwd) && statSync(cwd).isDirectory(); } catch { ok = false; } // 권한/IO 예외도 폴백
      if (!ok) {
        vscode.window.showWarningMessage(`'${name}'의 저장된 경로가 없어졌어요: ${cwd} — 기본 위치에서 엽니다.`);
        cwd = undefined;
      }
    }
    // 분할은 항상 에디터 영역에 타일(안정적). 일반 열기 위치는 설정(panel 기본 / editor)에 따름.
    const loc = vscode.workspace.getConfiguration("sessionRadar").get<string>("terminalLocation", "panel");
    let options: vscode.TerminalOptions;
    if (opts.split) options = { name, location: { viewColumn: vscode.ViewColumn.Beside } };       // 옆 칸 타일
    else if (loc === "editor") options = { name, location: { viewColumn: vscode.ViewColumn.Active } }; // 메인 영역
    else options = { name };                                                                       // 하단 패널(기본)
    const term = vscode.window.createTerminal(options);
    term.sendText(attachCommand(name, cwd)); // new session → -c cwd, existing tmux → reattach (-c ignored)
    term.show();
    markOpen(name);
  };
  let card: CardViewProvider;
  const refreshAll = () => { provider.refresh(); card.refresh(); };
  card = new CardViewProvider(refreshAll);
  provider.onChanged = refreshAll; // tree drag refreshes both views

  mkdirSync(STATUS_DIR, { recursive: true }); // ensure dir exists before watching

  const view = vscode.window.createTreeView("sessionRadar.view", {
    treeDataProvider: provider,
    dragAndDropController: provider,
    showCollapseAll: true,
  });
  context.subscriptions.push(view);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("sessionRadar.cards", card)
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("sessionRadar.refresh", () => refreshAll()),
    vscode.commands.registerCommand("sessionRadar.jump", (name: string) => {
      openSession(name, { split: false });
    }),
    vscode.commands.registerCommand("sessionRadar.jumpSplit", (arg: any) => {
      const s = sessionArg(arg); if (!s) return; // 컨텍스트 메뉴 Item 또는 {name}
      openSession(s.name, { split: true });
    }),
    vscode.commands.registerCommand("sessionRadar.closeTerminal", (arg: any) => {
      const s = sessionArg(arg); if (!s) return;
      // VS Code 터미널만 닫음 → tmux는 detach(세션 보존). kill-session 호출 없음.
      for (const t of vscode.window.terminals.filter((t) => t.name === s.name)) t.dispose();
    }),
  );

  registerCommands(context, refreshAll);

  // 터미널이 열리거나 닫히면 두 뷰의 "열림(●)" 표시를 갱신.
  context.subscriptions.push(
    vscode.window.onDidOpenTerminal(() => refreshAll()),
    vscode.window.onDidCloseTerminal(() => refreshAll()),
  );

  // Auto-reconnect: reopen previously-open sessions on activation (incl. across Tunnel↔SSH).
  if (vscode.workspace.getConfiguration("sessionRadar").get<boolean>("autoReconnect", true)) {
    const pending = new Set(loadOpen(OPEN_FILE).filter(isSafeSessionName));
    for (const t of vscode.window.terminals) pending.delete(t.name); // already open → skip
    // VS Code may restore its own terminals; drop those from pending to avoid duplicate attach (mirroring).
    const sub = vscode.window.onDidOpenTerminal((t) => pending.delete(t.name));
    context.subscriptions.push(sub);
    setTimeout(() => {
      for (const name of pending) {
        if (!vscode.window.terminals.find((t) => t.name === name)) {
          vscode.commands.executeCommand("sessionRadar.jump", name);
        }
      }
      sub.dispose();
    }, 3500); // 느린 원격에서 VS Code 자체 터미널 복원을 기다릴 여유(중복 attach 방지)
  }

  const watcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(vscode.Uri.file(STATUS_DIR), "*.json")
  );
  watcher.onDidCreate(refreshAll);
  watcher.onDidChange(refreshAll);
  watcher.onDidDelete(refreshAll);
  context.subscriptions.push(watcher);

  const timer = setInterval(refreshAll, 5000); // backup poll for remote fs
  context.subscriptions.push({ dispose: () => clearInterval(timer) });
}
export function deactivate() {}
