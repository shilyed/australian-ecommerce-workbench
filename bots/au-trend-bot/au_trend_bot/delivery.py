import smtplib
import ssl
from email.message import EmailMessage
from email.utils import parseaddr
from typing import Callable
from zoneinfo import ZoneInfo

from .config import Settings
from .http import HttpClient
from .reports import render_csv, render_html, text
from .safety import BotError
from .storage import Store
from .timeutil import utcnow


def smtp_send(settings: Settings, subject: str, html: str, csv: str, key: str):
    message = EmailMessage()
    message["Subject"] = subject
    message["From"] = settings.get("SMTP_FROM")
    message["To"] = settings.get("SMTP_TO")
    message["Message-ID"] = f"<{key}@au-trend-bot.local>"
    message.set_content(
        "澳洲趋势机器人报告／告警。证据限制、来源状态及完整内容见 HTML 与 CSV 附件。"
    )
    message.add_alternative(html, subtype="html")
    message.add_attachment(
        html.encode("utf-8"), maintype="text", subtype="html", filename=f"{key}.html"
    )
    if csv:
        message.add_attachment(
            csv.encode("utf-8"), maintype="text", subtype="csv", filename=f"{key}.csv"
        )
    context = ssl.create_default_context()
    port = int(settings.get("SMTP_PORT", "587"))
    smtp_class = smtplib.SMTP_SSL if port == 465 else smtplib.SMTP
    arguments = {"timeout": settings.limits.http_timeout_seconds}
    if port == 465:
        arguments["context"] = context
    with smtp_class(settings.get("SMTP_HOST"), port, **arguments) as connection:
        if port == 587:
            connection.ehlo()
            connection.starttls(context=context)
            connection.ehlo()
        if settings.get("SMTP_USER"):
            connection.login(settings.get("SMTP_USER"), settings.get("SMTP_PASSWORD"))
        refused = connection.send_message(
            message,
            from_addr=parseaddr(settings.get("SMTP_FROM"))[1],
            to_addrs=[parseaddr(a.strip())[1] for a in settings.get("SMTP_TO").split(",")],
        )
        if refused:
            raise BotError("SMTP accepted only some recipients; check delivery before any retry")


def deliver(
    key: str,
    subject: str,
    html: str,
    csv: str,
    settings: Settings,
    store: Store,
    client: HttpClient,
    sender: Callable = smtp_send,
    *,
    content_is_redacted: bool = False,
) -> dict:
    if store.mode != "live":
        raise BotError("DEMO reports cannot be sent externally")
    old = store.delivery(key)
    if old and old["state"] == "sent":
        return {"state": "sent", "key": key, "detail": "已发送；幂等跳过，不再次投递"}
    if old and old["state"] in ("sending", "uncertain"):
        store.set_delivery(
            key, "uncertain", {"detail": "发送状态不确定，必须人工核对；没有自动重发"}
        )
        return {
            "state": "uncertain",
            "key": key,
            "detail": "先核对收件箱／接收端，再 resolve-delivery",
        }
    status = settings.notification_status()
    if status["state"] != "ready":
        store.set_delivery(key, "blocked", status)
        return {"state": "blocked", "key": key, "detail": status["detail"]}
    now = utcnow()
    day = now.astimezone(ZoneInfo(settings.timezone)).date().isoformat()
    try:
        store.reserve([(day, "notification_attempts", 1, 20)])
    except BotError as exc:
        return {"state": "blocked", "key": key, "detail": str(exc)}
    store.set_delivery(
        key, "sending", {"channel": settings.get("NOTIFICATION"), "detail": "开始外部投递"}
    )
    try:
        if not content_is_redacted:
            html, csv = settings.redactor.text(html), settings.redactor.text(csv)
        subject = settings.redactor.text(subject)
        if settings.get("NOTIFICATION") == "smtp":
            sender(settings, subject, html, csv, key)
        else:
            headers = {"Idempotency-Key": key}
            if settings.get("WEBHOOK_BEARER"):
                headers["Authorization"] = "Bearer " + settings.get("WEBHOOK_BEARER")
            client.request(
                "POST",
                settings.get("WEBHOOK_URL"),
                headers=headers,
                payload={"id": key, "subject": subject, "html": html, "csv": csv},
                retry_safe=False,
                expect_json=False,
            )
    except (smtplib.SMTPAuthenticationError, smtplib.SMTPRecipientsRefused) as exc:
        result = {
            "state": "failed",
            "key": key,
            "detail": f"{type(exc).__name__}; credentials/recipients rejected",
        }
    except (smtplib.SMTPException, OSError, BotError) as exc:
        result = {
            "state": "uncertain",
            "key": key,
            "detail": f"{type(exc).__name__}; delivery may have occurred; operator reconciliation required",
        }
    else:
        result = {
            "state": "sent",
            "key": key,
            "detail": "接收端已接受；不是用户阅读／最终邮箱送达证明",
        }
    store.set_delivery(key, result["state"], result)
    return result


def deliver_report(
    report: dict,
    settings: Settings,
    store: Store,
    client: HttpClient,
    sender: Callable = smtp_send,
) -> dict:
    report = settings.redactor.value(report)
    return deliver(
        report["key"],
        f"[{report['status']}] {report['topic']} {report['window']['end_local'][:10]}",
        render_html(report),
        render_csv(report),
        settings,
        store,
        client,
        sender,
        content_is_redacted=True,
    )


def alert(source: str, detail: str, settings: Settings, store: Store, client: HttpClient) -> dict:
    day = utcnow().astimezone(ZoneInfo(settings.timezone)).date().isoformat()
    key = f"alert-{settings.fingerprint}-{day}-{source}"
    return deliver(
        key,
        f"[degraded] {settings.topic_name}: {source}",
        '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><h1>采集／任务降级告警</h1>'
        f"<p>{text(source)}: {text(settings.redactor.text(detail))}</p>"
        "<p>没有完整数据或投递证据，不能按成功解释。用 status 查看持久化状态。</p></html>",
        "",
        settings,
        store,
        client,
        content_is_redacted=True,
    )


def resolve_delivery(key: str, outcome: str, store: Store) -> dict:
    if outcome not in ("sent", "retry"):
        raise BotError("Delivery reconciliation outcome must be sent or retry")
    old = store.delivery(key)
    recovered_report = not old and outcome == "sent" and store.report(key) is not None
    if not recovered_report and (
        not old or old["state"] not in ("sending", "uncertain", "failed", "blocked", "pending")
    ):
        raise BotError("Only a failed/uncertain delivery can be reconciled")
    state = "sent" if outcome == "sent" else "pending"
    store.set_delivery(
        key,
        state,
        {"detail": "Operator explicitly reconciled external delivery", "outcome": outcome},
    )
    return {
        "key": key,
        "state": state,
        "detail": "已记录人工决定；retry 在下次显式／定时投递时执行",
    }
