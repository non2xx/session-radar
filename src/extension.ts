import * as vscode from "vscode";
import { mkdirSync, existsSync, statSync } from "node:fs";
import { SessionRadarProvider, STATUS_DIR, LAYOUT_FILE, OPEN_FILE } from "./ui/treeProvider";
import { registerCommands } from "./ui/commands";
import { CardViewProvider } from "./ui/cardView";
import { isSafeSessionName, attachCommand } from "./core/tmux";
import { loadLayout } from "./core/layoutStore";
import { loadOpen, saveOpen } from "./core/openStore";

export function activate(context: vscode.ExtensionContext) {
  const provider = new SessionRadarProvider();
  // open-list = sessions opened and not explicitly removed (removal only via hideSession).
  // Tab close does NOT shrink it → no shutdown wipe race. Union-on-add keeps multi-window safe.
  const markOpen = (name: string) => { saveOpen(OPEN_FILE, [...loadOpen(OPEN_FILE), name]); };
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
      const existing = vscode.window.terminals.find((t) => t.name === name);
      if (existing) { existing.show(); return; } // already open → focus (avoid duplicate attach/mirroring)
      if (!isSafeSessionName(name)) {
        vscode.window.showWarningMessage(`'${name}' 이름이 안전하지 않아 자동으로 열 수 없어요 (영문/숫자/._- 만).`);
        return;
      }
      let cwd: string | undefined = loadLayout(LAYOUT_FILE).paths[name];
      if (cwd) {
        let ok = false;
        try { ok = existsSync(cwd) && statSync(cwd).isDirectory(); } catch { ok = false; } // 권한/IO 예외도 폴백
        if (!ok) {
          vscode.window.showWarningMessage(`'${name}'의 저장된 경로가 없어졌어요: ${cwd} — 기본 위치에서 엽니다.`);
          cwd = undefined;
        }
      }
      const term = vscode.window.createTerminal({ name });
      term.sendText(attachCommand(name, cwd)); // new session → -c cwd, existing → reattach (-c ignored)
      term.show();
      markOpen(name);
    }),
  );

  registerCommands(context, refreshAll);

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
