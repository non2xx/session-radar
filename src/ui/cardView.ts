import * as vscode from "vscode";
import { getTreeData, moveSessionsTo } from "./treeProvider";
import { decorate } from "../core/cardModel";

function getNonce(): string {
  let t = ""; const c = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 24; i++) t += c.charAt(Math.floor(Math.random() * c.length));
  return t;
}

export class CardViewProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;
  /**
   * "이 창에서 뷰를 봤다"는 신호. 자동 재접속·상태 폴링의 시작 조건이다.
   * 트리 뷰만 보고 판단하면, 트리를 접고 카드만 쓰는 창에서는 영영 시작되지 않아
   * 세션이 자동으로 안 열리고 상태가 처음 그린 채로 멈춘다(README 가 "안 쓰는 뷰는 접으라"고 권한다).
   */
  constructor(private readonly refreshAll: () => void, private readonly onShown?: () => void) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: true };
    view.webview.html = this.html();
    view.webview.onDidReceiveMessage((m) => this.onMessage(m));
    view.onDidChangeVisibility(() => { if (view.visible) { this.onShown?.(); this.refresh(); } });
    view.onDidDispose(() => { this.view = undefined; });
    if (view.visible) this.onShown?.();
  }

  private onMessage(m: any): void {
    if (!m || typeof m.type !== "string") return;
    switch (m.type) {
      case "ready": this.refresh(); break;
      case "jump": if (typeof m.name === "string") vscode.commands.executeCommand("sessionRadar.jump", m.name); break;
      case "renameSession": if (typeof m.name === "string") vscode.commands.executeCommand("sessionRadar.renameSession", { name: m.name, label: m.label }); break;
      case "hideSession": if (typeof m.name === "string") vscode.commands.executeCommand("sessionRadar.hideSession", { name: m.name }); break;
      case "setPath": if (typeof m.name === "string") vscode.commands.executeCommand("sessionRadar.setPath", { name: m.name }); break;
      case "clearPath": if (typeof m.name === "string") vscode.commands.executeCommand("sessionRadar.clearPath", { name: m.name }); break;
      case "jumpSplit": if (typeof m.name === "string") vscode.commands.executeCommand("sessionRadar.jumpSplit", { name: m.name }); break;
      case "closeTerminal": if (typeof m.name === "string") vscode.commands.executeCommand("sessionRadar.closeTerminal", { name: m.name }); break;
      case "renameGroup": if (typeof m.id === "string") vscode.commands.executeCommand("sessionRadar.renameGroup", { id: m.id, name: m.name }); break;
      case "deleteGroup": if (typeof m.id === "string") vscode.commands.executeCommand("sessionRadar.deleteGroup", { id: m.id }); break;
      case "move":
        if (typeof m.name === "string") {
          moveSessionsTo([m.name], m.targetGroupId ?? null, m.beforeName ?? null);
          this.refreshAll();
        }
        break;
    }
  }

  refresh(): void {
    if (!this.view || !this.view.visible) return;
    const open = vscode.window.terminals.map((t) => t.name);
    this.view.webview.postMessage({ type: "render", data: decorate(getTreeData(), Date.now()), open });
  }

  private html(): string {
    const nonce = getNonce();
    return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<style>
  body{margin:0;padding:4px 0;font-family:var(--vscode-font-family);color:var(--vscode-foreground);font-size:12px}
  .gh{padding:7px 10px 3px;font-weight:600;font-size:11.5px;opacity:.9;cursor:default}
  .card{display:flex;align-items:center;gap:8px;padding:6px 10px;margin:2px 6px;
        background:var(--vscode-sideBar-background);border:1px solid var(--vscode-panel-border);
        border-radius:0;cursor:pointer}
  .card:hover{background:var(--vscode-list-hoverBackground)}
  .card.sel{background:var(--vscode-list-activeSelectionBackground);outline:1px solid var(--vscode-focusBorder);outline-offset:-1px}
  .card.dragover{border-top:2px solid var(--vscode-focusBorder)}
  .card.inactive{opacity:.6}
  .ind{width:16px;height:16px;flex:0 0 auto;display:grid;place-items:center;position:relative}
  /* 작업중: 도는 스피너 링 */
  .ring{width:12px;height:12px;border-radius:50%;box-sizing:border-box;
        border:2px solid rgba(63,185,80,.25);border-top-color:var(--vscode-charts-green,#3fb950);
        animation:sr-spin .8s linear infinite}
  /* 뒤에서 에이전트만: 파란 점선 링(초록 스피너와 색·모양 둘 다 다르게) */
  .aring{width:12px;height:12px;border-radius:50%;box-sizing:border-box;
        border:2px dashed var(--vscode-charts-blue,#4c9df3);
        animation:sr-spin 2.4s linear infinite}
  /* 내 차례: 앰버 점 + 퍼지는 링 */
  .tdot{width:9px;height:9px;border-radius:50%;background:var(--vscode-charts-yellow,#e3b341);position:relative}
  .tdot::after{content:"";position:absolute;inset:0;border-radius:50%;
        box-shadow:0 0 0 2px var(--vscode-charts-yellow,#e3b341);animation:sr-halo 1.6s ease-out infinite}
  /* 비활성: 회색 빈 점 */
  .idot{width:8px;height:8px;border-radius:50%;background:transparent;border:1.5px solid var(--vscode-descriptionForeground,#6e7681)}
  @keyframes sr-spin{to{transform:rotate(360deg)}}
  @keyframes sr-halo{0%{transform:scale(1);opacity:.6}100%{transform:scale(2.5);opacity:0}}
  @media (prefers-reduced-motion:reduce){.ring{animation:none}.aring{animation:none}.tdot::after{animation:none}}
  .nm{flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .ago{color:var(--vscode-descriptionForeground);font-size:10.5px}
  .empty{padding:12px;color:var(--vscode-descriptionForeground)}
  /* 서브에이전트 한 줄: 카드 밑에 붙는 작은 줄 */
  .sub{display:flex;align-items:center;gap:6px;margin:0 6px 0 6px;padding:2px 10px;
       color:var(--vscode-descriptionForeground);font-size:10.5px}
  .sub .sdot{width:6px;height:6px;flex:0 0 auto;border-radius:50%;
       background:var(--vscode-charts-blue,#4c9df3);animation:sr-pulse 1.6s ease-in-out infinite}
  .sub .stx{flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--vscode-foreground);opacity:.85}
  .sub .sty{flex:0 0 auto;opacity:.75}
  @keyframes sr-pulse{0%,100%{opacity:1}50%{opacity:.25}}
  @media (prefers-reduced-motion:reduce){.sub .sdot{animation:none}}
  .blk{margin:2px 6px;padding:6px 10px;border:1px solid var(--vscode-panel-border);
       background:var(--vscode-sideBar-background);display:flex;align-items:center;gap:8px}
  .blk .bdot{width:8px;height:8px;flex:0 0 auto;border-radius:50%;background:var(--vscode-charts-red,#f85149)}
  #menu{position:fixed;display:none;z-index:9;background:var(--vscode-menu-background,#252526);
        color:var(--vscode-menu-foreground,#ccc);border:1px solid var(--vscode-menu-border,#454545);
        box-shadow:0 2px 8px rgba(0,0,0,.4);min-width:150px;border-radius:0;padding:3px 0}
  #menu .mi{padding:5px 14px;cursor:pointer;white-space:nowrap}
  #menu .mi:hover{background:var(--vscode-menu-selectionBackground,#094771);color:var(--vscode-menu-selectionForeground,#fff)}
</style></head>
<body><div id="root" tabindex="0"></div><div id="menu"></div>
<script nonce="${nonce}">
  const vscode=acquireVsCodeApi();
  let flat=[],sel=0,selName=null,drag=null;
  function ago(ts){const m=Math.max(0,Math.round((Date.now()/1000-ts)/60));return m+'m';}
  function esc(s){const d=document.createElement('div');d.textContent=s;return d.innerHTML;}
  function cls(s){return s==='working'?'working':s==='agents'?'agents':s==='turn'?'turn':'inactive';}
  function ind(st){return st==='working'?'<span class="ind"><span class="ring"></span></span>':st==='agents'?'<span class="ind"><span class="aring"></span></span>':st==='turn'?'<span class="ind"><span class="tdot"></span></span>':'<span class="ind"><span class="idot"></span></span>';}
  function post(o){vscode.postMessage(o);}
  function render(data, open){
    const openSet=new Set(open||[]);
    const root=document.getElementById('root');root.innerHTML='';flat=[];
    const groups=[...data.groups.map(g=>({id:g.id,name:g.name,sessions:g.sessions})),{id:null,name:'미분류',sessions:data.ungrouped}];
    for(const g of groups){
      const empty=!g.sessions||!g.sessions.length;
      if(empty&&!g.id) continue; // show empty real groups (as drop targets); hide only empty 미분류
      const gh=document.createElement('div');gh.className='gh';gh.textContent=g.name+(empty?'  (비어있음)':'');
      if(g.id) gh.addEventListener('contextmenu',e=>{e.preventDefault();groupMenu(e,g.id,g.name);});
      gh.addEventListener('dragover',e=>{e.preventDefault();});
      gh.addEventListener('drop',e=>{e.preventDefault();if(drag)post({type:'move',name:drag,targetGroupId:g.id,beforeName:null});drag=null;});
      root.appendChild(gh);
      for(const s of (g.sessions||[])){
        const idx=flat.length;flat.push(s.name);const st=cls(s.state);
        const card=document.createElement('div');card.className='card '+st;card.draggable=true;
        const om=openSet.has(s.name)?'● ':'';
        const na=(s.agents&&s.agents.length)||0;
        // 에이전트가 돌면 경과시간 대신 개수를 보인다(트리 뷰와 같은 규칙).
        // 파일에서 센 것(s.running)이 화면에서 읽은 것보다 정확해서 먼저다.
        const meta=s.running?('●'+s.running):(st==='agents'&&na)?('에이전트 '+na):(st!=='inactive'&&s.ts?ago(s.ts):'');
        card.innerHTML=ind(st)+'<span class="nm">'+esc(s.label)+'</span><span class="ago">'+om+meta+'</span>';
        const tip=[];if(s.label!==s.name)tip.push(s.name);if(s.running)tip.push('도는 서브에이전트 '+s.running+'개');else if(na)tip.push('도는 중: '+s.agents.join(', '));if(s.path)tip.push('📁 '+s.path);if(tip.length)card.title=tip.join('\\n');
        card.addEventListener('click',()=>{sel=idx;selName=s.name;updateSel();post({type:'jump',name:s.name});});
        card.addEventListener('contextmenu',e=>{e.preventDefault();sessionMenu(e,s.name,s.label);});
        card.addEventListener('dragstart',e=>{drag=s.name;if(e.dataTransfer){e.dataTransfer.setData('text/plain',s.name);e.dataTransfer.effectAllowed='move';}});
        card.addEventListener('dragend',()=>{drag=null;document.querySelectorAll('.card.dragover').forEach(c=>c.classList.remove('dragover'));});
        card.addEventListener('dragover',e=>{e.preventDefault();card.classList.add('dragover');});
        card.addEventListener('dragleave',()=>card.classList.remove('dragover'));
        card.addEventListener('drop',e=>{e.preventDefault();card.classList.remove('dragover');if(drag&&drag!==s.name)post({type:'move',name:drag,targetGroupId:g.id,beforeName:s.name});drag=null;});
        root.appendChild(card);
        // 도는 서브에이전트를 카드 밑에 작은 줄로. 글자는 확장 쪽에서 이미 잘라 보낸다.
        for(const r of (s.rows||[])){
          const sub=document.createElement('div');sub.className='sub';
          sub.style.paddingLeft=(10+r.level*10)+'px';
          sub.innerHTML='<span class="sdot"></span><span class="stx">'+esc(r.label)+'</span><span class="sty">'+esc(r.meta)+'</span>';
          sub.title=r.tip;
          root.appendChild(sub);
        }
      }
    }
    // 몇 주씩 막혀 있던 세션 — tmux 창이 없어 여태 어디에도 안 보이던 것들.
    if(data.blocked&&data.blocked.length){
      const bh=document.createElement('div');bh.className='gh';bh.textContent='막힌 세션 '+data.blocked.length;
      root.appendChild(bh);
      for(const b of data.blocked){
        const d=document.createElement('div');d.className='blk';
        d.innerHTML='<span class="bdot"></span><span class="nm">'+esc(b.name)+'</span><span class="ago">'+esc(b.age)+'</span>';
        d.title=b.tip;
        root.appendChild(d);
      }
    }
    // 막힌 세션만 있고 tmux 세션이 하나도 없을 수 있다 — 그때 이 안내로 덮으면 안 된다.
    if(!flat.length&&!(data.blocked&&data.blocked.length)) root.innerHTML='<div class="empty">세션이 없어요. (＋ 버튼으로 추가하거나 tmux 세션을 켜세요)</div>';
    if(selName){const i=flat.indexOf(selName);if(i>=0)sel=i;}
    if(sel>=flat.length)sel=Math.max(0,flat.length-1);
    selName=flat[sel]||null;updateSel();
  }
  function updateSel(){const cs=[...document.querySelectorAll('.card')];cs.forEach((c,i)=>c.classList.toggle('sel',i===sel));if(cs[sel])cs[sel].scrollIntoView({block:'nearest'});}
  function setSel(i){sel=Math.max(0,Math.min(i,flat.length-1));selName=flat[sel]||null;updateSel();}
  const menu=document.getElementById('menu');
  function showMenu(e,items){
    menu.innerHTML='';
    for(const it of items){const d=document.createElement('div');d.className='mi';d.textContent=it.label;d.addEventListener('click',()=>{hideMenu();it.run();});menu.appendChild(d);}
    menu.style.display='block';
    const w=menu.offsetWidth,h=menu.offsetHeight;
    menu.style.left=Math.min(e.clientX,window.innerWidth-w-4)+'px';
    menu.style.top=Math.min(e.clientY,window.innerHeight-h-4)+'px';
  }
  function hideMenu(){menu.style.display='none';}
  function sessionMenu(e,name,label){showMenu(e,[
    {label:'분할로 열기',run:()=>post({type:'jumpSplit',name})},
    {label:'분할 닫기',run:()=>post({type:'closeTerminal',name})},
    {label:'이름변경(별명)',run:()=>post({type:'renameSession',name,label})},
    {label:'그룹에서 빼기(미분류로)',run:()=>post({type:'move',name,targetGroupId:null,beforeName:null})},
    {label:'프로젝트 경로 지정',run:()=>post({type:'setPath',name})},
    {label:'경로 지우기',run:()=>post({type:'clearPath',name})},
    {label:'목록에서 삭제',run:()=>post({type:'hideSession',name})},
  ]);}
  function groupMenu(e,id,name){showMenu(e,[
    {label:'그룹 이름변경',run:()=>post({type:'renameGroup',id,name})},
    {label:'그룹 삭제',run:()=>post({type:'deleteGroup',id})},
  ]);}
  document.addEventListener('click',hideMenu);
  document.addEventListener('keydown',e=>{
    if(e.key==='Escape'){hideMenu();return;}
    if(menu.style.display==='block')return;
    if(!flat.length)return;
    if(e.key==='ArrowDown'){setSel(sel+1);e.preventDefault();}
    else if(e.key==='ArrowUp'){setSel(sel-1);e.preventDefault();}
    else if(e.key==='Enter'){if(flat[sel])post({type:'jump',name:flat[sel]});e.preventDefault();}
  });
  window.addEventListener('message',e=>{if(e.data&&e.data.type==='render')render(e.data.data, e.data.open||[]);});
  post({type:'ready'});
</script></body></html>`;
  }
}
