#!/usr/bin/env bash
# Снимок экрана настоящего Claude Code для фикстур (tests/fixtures/screens/<имя>.ans).
# Нужен запущенный scripts/dev/fake-anthropic.mjs — запросов к модели нет.
#   capture-screen.sh start [папка]     — новая сессия cvg-test-cap с claude (папка по умолчанию /tmp/cvg-probe)
#   capture-screen.sh keys <ключи…>     — tmux send-keys в сессию
#   capture-screen.sh text <текст>      — набрать текст буквально
#   capture-screen.sh paste <файл>      — вставка (bracketed paste) содержимого файла
#   capture-screen.sh save <имя>        — сохранить снимок с SGR-атрибутами
#   capture-screen.sh stop
set -euo pipefail
S=cvg-test-cap
# Свой сервер tmux: при window-size latest окно общего сервера взяло бы размер чужого клиента (телефона)
T="tmux -L cvg-capture"
DIR=${2:-/tmp/cvg-probe}
OUT="$(cd "$(dirname "$0")/../.." && pwd)/tests/fixtures/screens"
case "$1" in
  start)
    mkdir -p "$DIR"
    $T kill-session -t "=$S" 2>/dev/null || true
    $T new-session -d -s "$S" -x 120 -y 40 -c "$DIR" "env ANTHROPIC_BASE_URL=http://127.0.0.1:${PORT:-8787} claude"
    sleep 5 ;;
  keys) shift; $T send-keys -t "=$S:" "$@"; sleep 2 ;;
  text) shift; $T send-keys -t "=$S:" -l "$*"; sleep 1 ;;
  paste) $T load-buffer -b cvgcap "$2" && $T paste-buffer -p -d -b cvgcap -t "=$S:"; sleep 2 ;;
  save)
    mkdir -p "$OUT"
    $T capture-pane -e -p -t "=$S:" | sed -e "s#/tmp/cvg-probe[A-Za-z0-9-]*#/tmp/project#g" -e "s#/root#/home/user#g" > "$OUT/$2.ans"
    echo "$OUT/$2.ans" ;;
  stop) $T kill-server 2>/dev/null || true ;;
esac
