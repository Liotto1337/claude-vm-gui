import base64
from http.client import HTTPConnection
from io import BytesIO
import json
import smtplib
from threading import Thread
import unittest

from PIL import Image

from server import RECIPIENT, ReportServer


class TestMail:
    username = "sender@example.com"

    def __init__(self):
        self.messages = []
        self.fail = False

    def send(self, message):
        if self.fail:
            raise smtplib.SMTPException("not accepted")
        self.messages.append(message)


def image_data(image_format):
    with BytesIO() as buffer:
        Image.new("RGB", (2, 2), "red").save(buffer, image_format)
        return base64.b64encode(buffer.getvalue()).decode()


class BugReportTest(unittest.TestCase):
    def setUp(self):
        self.mail = TestMail()
        self.server = ReportServer(("127.0.0.1", 0), self.mail, {"https://localhost", "null"})
        self.thread = Thread(target=self.server.serve_forever, kwargs={"poll_interval": 0.02})
        self.thread.start()
        self.addCleanup(self.thread.join)
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)

    def request(self, method, data=None, origin="https://localhost"):
        conn = HTTPConnection(*self.server.server_address, timeout=3)
        try:
            conn.request(method, "/bug-reports", json.dumps(data), {
                "Content-Type": "application/json",
                **({"Origin": origin} if origin else {}),
            })
            response = conn.getresponse()
            return response.status, response.getheader("Access-Control-Allow-Origin")
        finally:
            conn.close()

    def report(self, **changes):
        return {"title": "  Сбой  ", "description": "Шаг 1\nШаг 2", "diagnostics": None, "images": [], **changes}

    def test_without_consent(self):
        self.assertEqual(self.request("OPTIONS", origin="null"), (204, "null"))
        self.assertEqual(self.request("POST", self.report(), origin="null"), (204, "null"))
        message, = self.mail.messages
        self.assertEqual(message["To"], RECIPIENT)
        self.assertEqual(message["Subject"], "[Claude VM] Сбой")
        body = message.get_content()
        self.assertIn("Шаг 1\nШаг 2", body)
        self.assertIn("Пользователь не дал согласие", body)
        self.assertNotIn("Время (UTC)", body)

    def test_electron_post_without_origin(self):
        self.assertEqual(self.request("POST", self.report(), origin=None), (204, None))

    def test_with_consent_and_images(self):
        png, jpeg = image_data("PNG"), image_data("JPEG")
        data = self.report(diagnostics={
            "os": "Android 15", "reportedAt": "2026-11-13T08:00:00Z", "connectionChecks": {"ssh": "fail"},
            "sshPassword": "private data",
        }, images=[png, jpeg])
        self.assertEqual(self.request("POST", data), (204, "https://localhost"))
        message, = self.mail.messages
        body = message.get_body().get_content()
        self.assertIn("Android 15", body)
        self.assertIn("2026-11-13T08:00:00Z", body)
        self.assertIn("ssh: fail", body)
        self.assertNotIn("private data", body)
        attachments = list(message.iter_attachments())
        self.assertEqual([a.get_content_type() for a in attachments], ["image/png", "image/jpeg"])
        self.assertEqual([a.get_payload(decode=True) for a in attachments], [base64.b64decode(png), base64.b64decode(jpeg)])

    def test_rejects_invalid_reports(self):
        png = image_data("PNG")
        for data in (self.report(title=" "), self.report(images=["bm90IGFuIGltYWdl"]),
                     self.report(images=[png] * 6), self.report(diagnostics=False)):
            with self.subTest(data=data):
                self.assertEqual(self.request("POST", data)[0], 400)
        self.assertEqual(self.request("POST", self.report(), origin="https://example.com"), (403, None))
        self.assertEqual(self.mail.messages, [])

    def test_smtp_failure(self):
        self.mail.fail = True
        self.assertEqual(self.request("POST", self.report()), (502, "https://localhost"))


if __name__ == "__main__":
    unittest.main()
