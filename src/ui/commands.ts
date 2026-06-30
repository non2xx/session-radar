import * as vscode from "vscode";
import { loadLayout, saveLayout } from "../core/layoutStore";
import * as M from "../core/mutations";
import { LAYOUT_FILE, OPEN_FILE } from "./treeProvider";
import { isSafeSessionName, invalidateSessionCache } from "../core/tmux";
import { sessionArg, groupArg } from "../core/args";
import { loadOpen, saveOpen } from "../core/openStore";
import { homedir } from "node:os";
import { join } from "node:path";

const save = (l: ReturnType<typeof loadLayout>) => saveLayout(LAYOUT_FILE, l);
const newId = () => "g" + Math.random().toString(36).slice(2, 9);

export function registerCommands(context: vscode.ExtensionContext, refresh: () => void) {
  const reg = (id: string, fn: (...a: any[]) => any) =>
    context.subscriptions.push(vscode.commands.registerCommand(id, fn));

  reg("sessionRadar.addGroup", async () => {
    const name = await vscode.window.showInputBox({ prompt: "새 그룹 이름" });
    if (!name) return;
    save(M.addGroup(loadLayout(LAYOUT_FILE), name, newId()));
    refresh();
  });
  reg("sessionRadar.renameGroup", async (arg: any) => {
    const g = groupArg(arg); if (!g) return;
    const name = await vscode.window.showInputBox({ prompt: "그룹 새 이름", value: g.name });
    if (!name) return;
    save(M.renameGroup(loadLayout(LAYOUT_FILE), g.id, name));
    refresh();
  });
  reg("sessionRadar.deleteGroup", (arg: any) => {
    const g = groupArg(arg); if (!g) return;
    save(M.deleteGroup(loadLayout(LAYOUT_FILE), g.id));
    refresh();
  });
  reg("sessionRadar.renameSession", async (arg: any) => {
    const s = sessionArg(arg); if (!s) return;
    const alias = await vscode.window.showInputBox({
      prompt: `'${s.name}' 표시 이름(별명). 비우면 원래 이름`, value: s.label ?? s.name,
    });
    save(M.setAlias(loadLayout(LAYOUT_FILE), s.name, alias ?? ""));
    refresh();
  });
  reg("sessionRadar.hideSession", (arg: any) => {
    const s = sessionArg(arg); if (!s) return;
    save(M.hideSession(loadLayout(LAYOUT_FILE), s.name));
    saveOpen(OPEN_FILE, loadOpen(OPEN_FILE).filter((n) => n !== s.name)); // 자동연결 목록에서도 제거(유일한 제거 경로)
    refresh();
  });
  reg("sessionRadar.setPath", async (arg: any) => {
    const s = sessionArg(arg); if (!s) return;
    const layout = loadLayout(LAYOUT_FILE);
    const current = layout.paths[s.name]; // 현재 저장된 경로(있으면 거기서 창을 연다)
    const picked = await vscode.window.showOpenDialog({
      canSelectFolders: true, canSelectFiles: false, canSelectMany: false,
      defaultUri: vscode.Uri.file(current || join(homedir(), "projects")),
      openLabel: "이 폴더로 지정",
      title: current ? `'${s.name}' 프로젝트 경로 (현재: ${current})` : `'${s.name}' 프로젝트 경로 지정`,
    });
    if (!picked || !picked.length) return;
    save(M.setPath(layout, s.name, picked[0].fsPath));
    refresh();
    vscode.window.showInformationMessage(`'${s.name}' 경로 저장됨: ${picked[0].fsPath}`);
  });
  reg("sessionRadar.clearPath", (arg: any) => {
    const s = sessionArg(arg); if (!s) return;
    const layout = loadLayout(LAYOUT_FILE);
    if (!layout.paths[s.name]) { vscode.window.showInformationMessage(`'${s.name}'에 저장된 경로가 없어요.`); return; }
    save(M.clearPath(layout, s.name));
    refresh();
    vscode.window.showInformationMessage(`'${s.name}' 경로를 지웠어요.`);
  });
  reg("sessionRadar.addSession", async () => {
    const l = loadLayout(LAYOUT_FILE);
    const MANUAL = "$(edit) 새 세션 직접 입력…";
    const pick = l.hidden.length
      ? await vscode.window.showQuickPick([...l.hidden, MANUAL], { placeHolder: "다시 추가할 세션(숨김) 또는 새로 만들기" })
      : MANUAL;
    if (!pick) return;
    let name: string | undefined = pick;
    if (pick === MANUAL) name = await vscode.window.showInputBox({ prompt: "새 세션 이름 (영문/숫자/._- ) — 이 이름으로 tmux 세션을 만들어 엽니다" });
    if (!name) return;
    if (!isSafeSessionName(name)) { vscode.window.showWarningMessage("이름은 영문/숫자/._- 만 가능해요."); return; }
    save(M.unhideSession(l, name));
    await vscode.commands.executeCommand("sessionRadar.jump", name);
    setTimeout(() => { invalidateSessionCache(); refresh(); }, 800);
  });
}
