# session-radar 설치 (WSL/원격)

0. Node 확인: `node -v` (없거나 v18 미만이면 nvm 활성화: `. ~/.nvm/nvm.sh && nvm use` 후 진행).
1. 빌드: `cd ~/projects/session-radar && npm install && npm run build && npm run package`
   → `session-radar.vsix` 생성.
2. 훅 스크립트 배치: `cp scripts/session-status.sh ~/.claude/session-status.sh && chmod +x ~/.claude/session-status.sh`
3. 훅 연결: `node scripts/install-hooks.mjs` (기존 차근 훅은 보존, 백업 + 원자적 쓰기 + 검증).
4. 확장 설치(원격): VS Code 명령 팔레트 → "Extensions: Install from VSIX..." → `session-radar.vsix` 선택 (원격 연결 상태에서).
5. 새로고침: Developer: Reload Window.

## 제거
- 확장 Uninstall + `~/.claude/settings.json`에서 session-status.sh 줄 제거 + `rm -rf ~/.claude/session-status ~/.claude/session-radar ~/.claude/session-status.sh`.
- 훅 제거 시에도 백업(`settings.json.bak-*`)이 있으니 안전.
