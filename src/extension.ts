import * as vscode from "vscode";
import { existsSync, statSync } from "node:fs";
import { SessionRadarProvider, LAYOUT_FILE, OPEN_FILE, subagentsEnabled } from "./ui/treeProvider";
import { invalidateAgentsIndex, refreshClaudeSessions } from "./core/agentsSource";
import { registerCommands } from "./ui/commands";
import { registerImageCompare } from "./ui/imageCompare";
import { registerImageLinks } from "./ui/imageLinks";
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
  // 두 뷰가 같은 시작 조건을 쓴다. 실제 구현은 아래에서 채운다(뷰보다 뒤에 만들어져서).
  let startViewWork: () => void = () => {};
  // 새로고침 버튼이 에이전트 목록도 함께 당기게 한다(같은 이유로 아래에서 채운다).
  let pullAgentsNow: () => void = () => {};
  card = new CardViewProvider(refreshAll, () => startViewWork());
  provider.onChanged = refreshAll; // tree drag refreshes both views

  const view = vscode.window.createTreeView("sessionRadar.view", {
    treeDataProvider: provider,
    dragAndDropController: provider,
    showCollapseAll: true,
  });
  context.subscriptions.push(view);
  // 사용자가 접거나 편 것을 기억해 둔다 — 3초마다 다시 그려도 그 선택이 유지되게.
  context.subscriptions.push(
    view.onDidCollapseElement((e) => provider.noteExpansion(e.element, false)),
    view.onDidExpandElement((e) => provider.noteExpansion(e.element, true)),
  );
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("sessionRadar.cards", card)
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("sessionRadar.refresh", () => { pullAgentsNow(); refreshAll(); }),
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
  registerImageCompare(context);
  registerImageLinks(context);

  // 터미널이 열리거나 닫히면 두 뷰의 "열림(●)" 표시를 갱신.
  context.subscriptions.push(
    vscode.window.onDidOpenTerminal(() => refreshAll()),
    vscode.window.onDidCloseTerminal(() => refreshAll()),
  );

  // Auto-reconnect: reopen previously-open sessions (incl. across Tunnel↔SSH).
  //
  // ⚠ 뷰가 보인 창에서만 돈다. onStartupFinished 로 항상 활성화되므로, 조건 없이 돌리면
  // 사이드바를 켜지도 않은 두 번째 창(또는 휴대폰 터널 접속)까지 같은 tmux 세션에 붙어
  // 키 입력이 섞이고 화면 크기가 좁은 쪽에 맞춰진다.
  const autoReconnect = () => {
    if (!vscode.workspace.getConfiguration("sessionRadar").get<boolean>("autoReconnect", true)) return;
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
  };

  // tmux 상태 폴링과 자동 재접속은 "이 창에서 뷰가 보였을 때" 시작한다.
  // 시작 시 활성화(onStartupFinished)가 필요한 것은 터미널 링크 가로채기 하나뿐이라,
  // 나머지는 뷰를 켜기 전까지 아무 일도 하지 않는다.
  // `claude agents --json` 은 실측 0.6초라 3초 주기에 못 태운다(확장 호스트가 한 줄로 돈다).
  // 느린 주기로 따로 돌려 캐시만 갈아 끼우고, 화면은 언제나 그 캐시를 읽는다.
  const cfg = () => vscode.workspace.getConfiguration("sessionRadar");
  const pullAgents = () => {
    if (!subagentsEnabled()) return;
    refreshClaudeSessions(cfg().get<string>("claudeCommand", "claude"), () => {
      invalidateAgentsIndex();
      refreshAll();
    });
  };
  pullAgentsNow = pullAgents;

  let timer: ReturnType<typeof setInterval> | undefined;
  let agentsTimer: ReturnType<typeof setInterval> | undefined;
  let started = false;
  startViewWork = () => {
    if (started) return;
    started = true;
    autoReconnect();
    timer = setInterval(refreshAll, 3000); // (the spinner animation is CSS, so this only re-reads state)
    pullAgents();
    // 설정에 숫자가 아닌 게 들어오면 NaN → setInterval 이 1ms 로 읽어 CLI 를 쉼 없이 부른다.
    const raw = cfg().get<number>("agentsRefreshSeconds", 20);
    const every = Number.isFinite(raw) ? Math.max(5, Math.min(300, raw)) : 20;
    agentsTimer = setInterval(pullAgents, every * 1000);
  };
  // 트리 뷰와 카드 뷰 중 **어느 쪽이든** 보이면 시작한다. 카드 쪽 신호는 CardViewProvider 가 보낸다.
  if (view.visible) startViewWork();
  context.subscriptions.push(view.onDidChangeVisibility((e) => { if (e.visible) startViewWork(); }));
  context.subscriptions.push({
    dispose: () => {
      if (timer) clearInterval(timer);
      if (agentsTimer) clearInterval(agentsTimer);
    },
  });
}
export function deactivate() {}
