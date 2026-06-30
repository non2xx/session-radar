import * as vscode from "vscode";
import { getTreeData, moveSessionsTo } from "./treeProvider";

function getNonce(): string {
  let t = ""; const c = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 24; i++) t += c.charAt(Math.floor(Math.random() * c.length));
  return t;
}

export class CardViewProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;
  constructor(private readonly refreshAll: () => void) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: true };
    view.webview.html = this.html();
    view.webview.onDidReceiveMessage((m) => this.onMessage(m));
    view.onDidChangeVisibility(() => { if (view.visible) this.refresh(); });
    view.onDidDispose(() => { this.view = undefined; });
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
    this.view.webview.postMessage({ type: "render", data: getTreeData(), open });
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
        border-left-width:3px;border-radius:0;cursor:pointer}
  .card:hover{background:var(--vscode-list-hoverBackground)}
  .card.sel{background:var(--vscode-list-activeSelectionBackground);outline:1px solid var(--vscode-focusBorder);outline-offset:-1px}
  .card.dragover{border-top:2px solid var(--vscode-focusBorder)}
  .card.working{border-left-color:var(--vscode-charts-red,#e5534b)}
  .card.waiting{border-left-color:var(--vscode-charts-yellow,#d4a72c)}
  .card.idle{border-left-color:var(--vscode-charts-green,#57ab5a)}
  .card.unknown{border-left-color:var(--vscode-descriptionForeground,#888)}
  .dot{width:8px;height:8px;border-radius:0;flex:0 0 auto}
  .dot.working{background:var(--vscode-charts-red,#e5534b)} .dot.waiting{background:var(--vscode-charts-yellow,#d4a72c)}
  .dot.idle{background:var(--vscode-charts-green,#57ab5a)} .dot.unknown{background:transparent;border:1.5px solid var(--vscode-descriptionForeground,#888)}
  .nm{flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .ago{color:var(--vscode-descriptionForeground);font-size:10.5px}
  .empty{padding:12px;color:var(--vscode-descriptionForeground)}
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
  function cls(s){return ['working','waiting','idle'].indexOf(s)>=0?s:'unknown';}
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
        card.innerHTML='<span class="dot '+st+'"></span><span class="nm">'+esc(s.label)+'</span><span class="ago">'+om+(s.ts?ago(s.ts):'')+'</span>';
        const tip=[];if(s.label!==s.name)tip.push(s.name);if(s.path)tip.push('📁 '+s.path);if(tip.length)card.title=tip.join('\\n');
        card.addEventListener('click',()=>{sel=idx;selName=s.name;updateSel();post({type:'jump',name:s.name});});
        card.addEventListener('contextmenu',e=>{e.preventDefault();sessionMenu(e,s.name,s.label);});
        card.addEventListener('dragstart',e=>{drag=s.name;if(e.dataTransfer){e.dataTransfer.setData('text/plain',s.name);e.dataTransfer.effectAllowed='move';}});
        card.addEventListener('dragend',()=>{drag=null;document.querySelectorAll('.card.dragover').forEach(c=>c.classList.remove('dragover'));});
        card.addEventListener('dragover',e=>{e.preventDefault();card.classList.add('dragover');});
        card.addEventListener('dragleave',()=>card.classList.remove('dragover'));
        card.addEventListener('drop',e=>{e.preventDefault();card.classList.remove('dragover');if(drag&&drag!==s.name)post({type:'move',name:drag,targetGroupId:g.id,beforeName:s.name});drag=null;});
        root.appendChild(card);
      }
    }
    if(!flat.length) root.innerHTML='<div class="empty">세션이 없어요. (＋ 버튼으로 추가하거나 tmux 세션을 켜세요)</div>';
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
    {label:'터미널 닫기',run:()=>post({type:'closeTerminal',name})},
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
