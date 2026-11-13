"""HTTP → SMTP relay. Run on loopback behind the HTTPS reverse proxy."""
import base64
from dataclasses import dataclass
from email.message import EmailMessage
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from io import BytesIO
import json
import os
import smtplib
import ssl
from threading import BoundedSemaphore
import warnings

from PIL import Image, ImageSequence

RECIPIENT = "egorstep.0801@gmail.com"
MAX_IMAGE_BYTES = 10 * 1024 * 1024
MAX_BODY_BYTES = 14 * 1024 * 1024
MAX_PIXELS = 20_000_000
MAX_FRAME_PIXELS = 40_000_000
IMAGE_TYPES = {
    "PNG": "png", "JPEG": "jpeg", "WEBP": "webp", "GIF": "gif", "BMP": "bmp", "AVIF": "avif",
}
DIAGNOSTIC_LABELS = {
    "reportedAt": "Время (UTC)",
    "timeZone": "Часовой пояс",
    "appVersion": "Версия приложения",
    "os": "Операционная система",
    "device": "Устройство",
    "architecture": "Архитектура",
    "webView": "Среда отрисовки",
    "locale": "Язык",
    "viewport": "Размер окна",
    "theme": "Тема",
    "screen": "Экран",
    "connection": "Подключение",
    "connectionError": "Код ошибки подключения",
    "claudeVersion": "Версия Claude Code",
}
CHECKS = ("ping", "tcp", "ssh", "tmux")
CHECK_STATUSES = ("running", "ok", "warn", "fail", "skipped")


def text_field(value, limit):
    if not isinstance(value, str) or not value.strip() or len(value) > limit:
        raise ValueError("invalid text field")
    return value.strip()


def diagnostic_lines(diagnostics):
    if diagnostics is None:
        return ["Пользователь не дал согласие на сбор и обработку диагностических данных."]
    if not isinstance(diagnostics, dict):
        raise ValueError("invalid diagnostics")
    lines = ["Пользователь дал согласие на сбор и обработку диагностических данных."]
    for key, label in DIAGNOSTIC_LABELS.items():
        if key in diagnostics:
            value = text_field(diagnostics[key], 250)
            lines.append(f"{label}: {' '.join(value.splitlines())}")
    checks = diagnostics.get("connectionChecks", {})
    if not isinstance(checks, dict):
        raise ValueError("invalid connection checks")
    for step in CHECKS:
        if step in checks:
            if checks[step] not in CHECK_STATUSES:
                raise ValueError("invalid connection check")
            lines.append(f"{step}: {checks[step]}")
    return lines


def add_images(message, images):
    if not isinstance(images, list) or len(images) > 5:
        raise ValueError("invalid images")
    remaining = MAX_IMAGE_BYTES
    for number, encoded in enumerate(images, start=1):
        if not isinstance(encoded, str) or len(encoded) > 4 * ((remaining + 2) // 3):
            raise ValueError("image too large")
        data = base64.b64decode(encoded, validate=True)
        remaining -= len(data)
        if remaining < 0 or not data:
            raise ValueError("invalid image size")
        with Image.open(BytesIO(data), formats=list(IMAGE_TYPES)) as image:
            pixels = image.width * image.height
            if pixels > MAX_PIXELS:
                raise ValueError("image dimensions too large")
            for index, frame in enumerate(ImageSequence.Iterator(image), start=1):
                if pixels * index > MAX_FRAME_PIXELS:
                    raise ValueError("animated image too large")
                frame.load()
            subtype = IMAGE_TYPES[image.format]
        message.add_attachment(data, maintype="image", subtype=subtype, filename=f"image-{number}.{subtype}")


def report_message(payload, sender):
    if not isinstance(payload, dict) or "diagnostics" not in payload:
        raise ValueError("invalid report")
    title = text_field(payload.get("title"), 120)
    description = text_field(payload.get("description"), 5000)
    message = EmailMessage()
    message["From"] = sender
    message["To"] = RECIPIENT
    message["Subject"] = f"[Claude VM] {' '.join(title.splitlines())}"
    details = "\n".join(diagnostic_lines(payload["diagnostics"]))
    message.set_content(f"{title}\n\n{description}\n\n{details}\n")
    add_images(message, payload.get("images"))
    return message


@dataclass(frozen=True)
class MailConfig:
    host: str
    port: int
    username: str
    password: str

    def send(self, message):
        with smtplib.SMTP_SSL(self.host, self.port, timeout=10, context=ssl.create_default_context()) as smtp:
            smtp.login(self.username, self.password)
            smtp.send_message(message)


class ReportServer(ThreadingHTTPServer):
    def __init__(self, address, mail, origins):
        self.mail = mail
        self.origins = origins
        self.slots = BoundedSemaphore(2)
        super().__init__(address, ReportHandler)


class ReportHandler(BaseHTTPRequestHandler):
    def setup(self):
        self.request.settimeout(15)
        super().setup()

    def log_message(self, *_args):
        # Не сохраняем IP, адреса клиентов и содержимое отчётов.
        pass

    def reply(self, status):
        self.send_response(status)
        origin = self.headers.get("Origin")
        if origin in self.server.origins:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.send_header("Vary", "Origin")
        self.end_headers()

    def allowed(self):
        if self.path != "/bug-reports":
            self.reply(404)
            return False
        origin = self.headers.get("Origin")
        # Electron может отправить POST с file:// без заголовка Origin.
        if origin not in self.server.origins and (origin is not None or self.command != "POST"):
            self.reply(403)
            return False
        return True

    def do_OPTIONS(self):
        if self.allowed():
            self.reply(204)

    def do_POST(self):
        if not self.allowed():
            return
        if self.headers.get_content_type() != "application/json":
            self.reply(415)
            return
        try:
            length = int(self.headers.get("Content-Length", ""))
        except ValueError:
            self.reply(411)
            return
        if length <= 0 or length > MAX_BODY_BYTES:
            self.reply(413)
            return
        if not self.server.slots.acquire(blocking=False):
            self.reply(429)
            return
        try:
            self.handle_report(length)
        finally:
            self.server.slots.release()

    def handle_report(self, length):
        try:
            raw = self.rfile.read(length)
            if len(raw) != length:
                raise ValueError("incomplete report")
            payload = json.loads(raw)
            message = report_message(payload, self.server.mail.username)
        except (ValueError, OSError, SyntaxError, OverflowError, RecursionError,
                Image.DecompressionBombError, Image.DecompressionBombWarning):
            self.reply(400)
            return
        try:
            self.server.mail.send(message)
        except (smtplib.SMTPException, OSError) as error:
            # Не включаем ответ SMTP: он может содержать адреса и другие данные письма.
            print(f"SMTP delivery failed ({type(error).__name__})", flush=True)
            self.reply(502)
            return
        self.reply(204)


if __name__ == "__main__":
    warnings.simplefilter("error", Image.DecompressionBombWarning)
    mail = MailConfig(
        os.environ.get("SMTP_HOST", "smtp.gmail.com"),
        int(os.environ.get("SMTP_PORT", "465")),
        os.environ["SMTP_USERNAME"],
        os.environ["SMTP_PASSWORD"],
    )
    origins = set(os.environ.get("BUG_REPORT_ALLOWED_ORIGINS", "null,https://localhost").split(","))
    with ReportServer(("127.0.0.1", int(os.environ.get("PORT", "8787"))), mail, origins) as server:
        server.serve_forever()
