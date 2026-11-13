# Приём отчётов об ошибках

Один HTTPS-адрес используется в Windows- и Android-клиенте. Сервис отправляет письма на `egorstep.0801@gmail.com`. Он принимает текст и до пяти изображений общим размером до 10 МиБ. При согласии в письмо добавляются время в UTC, часовой пояс, версия клиента, сведения об ОС и устройстве, язык, размер окна, тема, экран, состояние и коды проверок подключения и известная версия Claude Code. При отказе в письме будет отметка об отказе. Диагностика не включает адрес ВМ, настройки SSH, ключи, переписку и журналы. Приложенные изображения передаются с исходными метаданными.

## Запуск

1. На сервере установите Python 3.10+ и зависимости в виртуальное окружение.

   ```sh
   python3 -m venv .venv
   .venv/bin/pip install -r requirements.txt
   ```

2. Задайте для процесса сервиса `SMTP_USERNAME` и `SMTP_PASSWORD` через защищённое хранилище окружения, например `EnvironmentFile=` в systemd с правами `0600`. По умолчанию используется Gmail (`smtp.gmail.com:465`, TLS). Для Gmail укажите адрес отправителя и пароль приложения. Для другого SMTP-сервера с TLS можно задать `SMTP_HOST` и `SMTP_PORT`. Запустите `.venv/bin/python server.py` из этого каталога. Сервис слушает только `127.0.0.1:8787`. Порт можно изменить через `PORT`.
3. Проксируйте только `/bug-reports` через HTTPS. Включите лимиты на запросы и одновременные подключения. Клиенты не имеют общего секрета, поэтому заголовок `Origin` не заменяет ограничение запросов. Например, в блоке `http` Nginx:

   ```nginx
   limit_req_zone $binary_remote_addr zone=bug_reports:10m rate=2r/m;
   limit_req_zone $server_name zone=bug_reports_global:1m rate=20r/h;
   limit_conn_zone $binary_remote_addr zone=bug_report_connections:10m;
   ```

   В HTTPS-блоке `server`:

   ```nginx
   location = /bug-reports {
       limit_req zone=bug_reports burst=4 nodelay;
       limit_req zone=bug_reports_global burst=20 nodelay;
       limit_req_status 429;
       limit_conn bug_report_connections 2;
       limit_conn_status 429;
       client_max_body_size 14m;
       client_body_timeout 15s;
       proxy_read_timeout 35s;
       access_log off;
       proxy_pass http://127.0.0.1:8787;
   }
   ```

   Windows-клиент также может отправлять POST без заголовка `Origin`. `BUG_REPORT_ALLOWED_ORIGINS` по умолчанию содержит `null` для запросов Windows-клиента с непрозрачным origin (`file://`) и `https://localhost` для WebView Android. Для локального браузерного теста добавьте origin Vite через запятую.
4. Задайте публичный origin сервиса без пути (например, `https://reports.example.com`) в GitHub Actions как переменную `BUG_REPORT_ORIGIN` в обоих репозиториях. Для локальной сборки задайте `VITE_BUG_REPORT_ORIGIN` в окружении. Для тестов сборка допускает HTTP на localhost и 127.0.0.1. Пока адрес не задан, клиент показывает сообщение о недоступности отправки и сохраняет заполненную форму открытой.

## Тесты

```sh
.venv/bin/python -m unittest -v
```
