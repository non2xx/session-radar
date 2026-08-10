# session-radar 설치 (WSL/원격)

0. Node 확인: `node -v` (없거나 v18 미만이면 nvm 활성화: `. ~/.nvm/nvm.sh && nvm use` 후 진행).
1. 빌드: `cd ~/projects/session-radar && npm install && npm run build && npm run package`
   → `session-radar.vsix` 생성.
2. 확장 설치(원격): VS Code 명령 팔레트 → "Extensions: Install from VSIX..." → `session-radar.vsix` 선택 (원격 연결 상태에서).
3. 새로고침: Developer: Reload Window.

상태 표시는 `tmux list-panes` 로 창 제목과 앞 프로세스를 읽어서 만든다. 따로 설치할 훅이나 상주 프로그램은 없다.

## 제거
- 확장 Uninstall + `rm -rf ~/.claude/session-radar`.
- v0.4.7 이전의 훅 방식을 깔아 둔 적이 있으면 그 잔재도 지운다:
  `~/.claude/settings.json` 에서 session-status.sh 줄을 지우고
  `rm -rf ~/.claude/session-status ~/.claude/session-status.sh`
  (백업 `settings.json.bak-*` 이 남아 있어 되돌릴 수 있다).
