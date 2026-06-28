import * as vscode from "vscode";
import { loadLayout, saveLayout } from "../core/layoutStore";
import * as M from "../core/mutations";
import { LAYOUT_FILE } from "./treeProvider";
import { isSafeSessionName, invalidateSessionCache } from "../core/tmux";
import { sessionArg, groupArg } from "../core/args";

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
    refresh();
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
