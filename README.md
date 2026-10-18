# Claude VM

Windows-приложение для работы с [Claude Code](https://docs.claude.com/en/docs/claude-code), который запущен на вашей ВМ (Ubuntu) в tmux.
Оно заменяет ручной сценарий «cmd → `ssh` → `tmux attach`/`tmux new` → `claude` → `tmux kill-session`» кнопками и показывает терминал в интерфейсе в стиле claude.ai.

Приложение подключается только к вашей ВМ по SSH. К серверам Anthropic напрямую оно не обращается: с ними работает Claude Code на ВМ.

> Проект в разработке. Установка и настройка будут описаны к первому релизу.

## Разработка

Нужен Node.js 22.

```bash
npm install                 # заодно включает git-хук .githooks/pre-commit
cp vm.config.example.json vm.config.json   # адрес ВМ, порт, пользователь, ключ
npm run dev                 # приложение с горячей перезагрузкой
npm test                    # модульные тесты
npm run test:int            # интеграционные тесты против ВМ (нужен vm.config.json)
npm run test:e2e            # E2E в Electron (на Linux без экрана: xvfb-run -a npm run test:e2e)
```

`vm.config.json` в `.gitignore`. Хук `pre-commit` отклоняет коммит, если адрес из него встретился в любом добавленном файле.
