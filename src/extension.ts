import * as vscode from "vscode";
import { mkdirSync } from "node:fs";
import { SessionRadarProvider, STATUS_DIR } from "./ui/treeProvider";
import { registerCommands } from "./ui/commands";
import { CardViewProvider } from "./ui/cardView";
import { isSafeSessionName, attachCommand } from "./core/tmux";

export function activate(context: vscode.ExtensionContext) {
  const provider = new SessionRadarProvider();
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
      const term = vscode.window.createTerminal({ name });
      term.sendText(attachCommand(name)); // tmux new-session -A -s name (attach if exists, else create)
      term.show();
    }),
  );

  registerCommands(context, refreshAll);

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
