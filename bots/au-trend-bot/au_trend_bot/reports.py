import csv
import html
import io
import json
from datetime import date, timedelta
from pathlib import Path

from .safety import BotError, csv_cell, public_url
from .storage import Store, encode


def text(value: object) -> str:
    if value is None:
        value = "未知"
    return html.escape(str(value), quote=True)


def link(url: str, title: str) -> str:
    return f'<a href="{text(public_url(url))}" rel="noreferrer noopener">{text(title)}</a>'


def table(headers: list[str], rows: list[list[str]]) -> str:
    if not rows:
        return "<p>未知／暂无合格样本；不能按零值解释。</p>"
    return (
        '<div class="scroll"><table><thead><tr>'
        + "".join(f"<th>{text(header)}</th>" for header in headers)
        + "</tr></thead><tbody>"
        + "".join("<tr>" + "".join(f"<td>{cell}</td>" for cell in row) + "</tr>" for row in rows)
        + "</tbody></table></div>"
    )


def render_html(report: dict) -> str:
    window = report["window"]
    banner = (
        "DEMO 演示数据，非实时采集；不能用于经营判断；不会对外投递"
        if report["mode"] == "DEMO"
        else (
            "降级报告：存在来源／AI／窗口缺失，详见下表"
            if report["status"] != "ok"
            else "LIVE 真实证据样本报告"
        )
    )
    sections = [
        f"<h1>{text(report['topic'])}趋势周报</h1>",
        f'<p class="banner">{text(banner)}</p>',
        f"<p>{text(window['start_local'])} 至 {text(window['end_local'])}，左闭右开。</p>",
        f"<p>UTC: {text(window['start_utc'])} 至 {text(window['end_utc'])}<br>"
        f"生成: {text(report['generated_at'])} · 配置: {text(report['config_fingerprint'])}"
        f" · 修订: {text(report['revision'])}</p>",
        "<h2>来源状态与覆盖</h2>",
        table(
            ["来源", "状态", "样本／点数", "最近尝试", "真实边界"],
            [
                [
                    text(name),
                    text(status["state"]),
                    text(status.get("items")),
                    text(status.get("last_attempt_at")),
                    text(status["detail"]),
                ]
                for name in ("ebay", "tiktok", "trends", "instagram", "facebook")
                for status in (report["sources"][name],)
            ],
        ),
        "<h3>报告窗口内的实际快照覆盖</h3>",
        table(
            ["来源", "独立对象", "快照数", "有快照的当地日期", "缺少快照的当地日期"],
            [
                [
                    text(source),
                    text(coverage["unique_objects"]),
                    text(coverage["snapshots"]),
                    text(", ".join(coverage["observed_local_days"])),
                    text(", ".join(coverage["missing_local_days"])),
                ]
                for source in sorted(report.get("coverage", {}))
                for coverage in (report["coverage"][source],)
            ],
        ),
        "<h2>eBay AU 在售样本</h2>"
        "<p>不是销量排行。相关性位置只在对应查询中有意义；商品所在地不是卖家／买家国家。"
        "HTML 最多展示二十条，完整明细见 CSV。</p>",
        table(
            ["商品", "价格", "查询／位置", "商品所在地", "采集时间", "文案特征"],
            [
                [
                    link(row["url"], row["title"]),
                    text(
                        f"{row['metrics'].get('price')} {row['metrics'].get('currency')}"
                        if row["metrics"].get("price") is not None
                        else "未知／已不可用"
                    ),
                    text(
                        ", ".join(row["queries"]) + " / " + str(row["metrics"].get("search_rank"))
                    ),
                    text(row["geography"].get("item_location_country")),
                    text(row["observed_at"]),
                    text(", ".join(row["features"])),
                ]
                for row in report["market"][:20]
            ],
        ),
        "<h2>AU 买家授权成交样本</h2>",
        f"<p>{text(report['sales']['detail'])}</p>",
        table(
            ["商品", "窗口内样本成交件数", "记录数", "市场", "授权来源"],
            [
                [
                    link(row["url"], row["title"]),
                    text(row["quantity"]),
                    text(row["records"]),
                    text(", ".join(row["marketplaces"])),
                    text(", ".join(row["provenance"])),
                ]
                for row in report["sales"]["ranking"][:20]
            ],
        ),
        f"<p>排除原因计数: {text(encode(report['sales']['excluded']))}。"
        f"环比: {text(report['sales']['wow_reason'])}</p>",
        "<h3>第三方区间估算：不与成交相加</h3>",
        aggregate_table(report["sales"]["period_estimates"]),
        "<h3>滚动三十天原始口径：没有换算为七天销量</h3>",
        aggregate_table(report["sales"]["rolling_30d"]),
        "<h2>TikTok 样本观察区间增量排行</h2>"
        "<p>各视频观察区间不同，排序有覆盖偏差；不是完整本周流量，更不是 AU 观看量或成交。"
        "只有精确周边界快照才可显示完整周增量。</p>",
        table(
            ["内容", "观察增量", "实际观察起止", "完整周增量", "覆盖／原因", "地区证据"],
            [
                [
                    link(row["url"], row["title"]),
                    text(row["deltas"]["views"]["observed_delta"]),
                    text(
                        str(row["deltas"]["views"]["from"])
                        + " → "
                        + str(row["deltas"]["views"]["to"])
                    ),
                    text(row["deltas"]["views"]["week_delta"]),
                    text(
                        row["deltas"]["views"]["coverage"]
                        + " / "
                        + row["deltas"]["views"]["reason"]
                    ),
                    text(encode(row["geography"])),
                ]
                for row in report["social"]
                if row["deltas"]["views"]["observed_delta"] is not None
            ][:20],
        ),
        "<h3>TikTok 累计播放样本：不是本周流量</h3>",
        table(
            ["内容", "累计播放", "点赞／评论／分享", "观察时间", "文案特征"],
            [
                [
                    link(row["url"], row["title"]),
                    text(row["metrics"].get("views")),
                    text(
                        " / ".join(
                            str(row["metrics"].get(key))
                            if row["metrics"].get(key) is not None
                            else "未知"
                            for key in ("likes", "comments", "shares")
                        )
                    ),
                    text(row["observed_at"]),
                    text(", ".join(row["features"])),
                ]
                for row in sorted(
                    report["social"], key=lambda row: -(row["metrics"].get("views") or 0)
                )[:20]
            ],
        ),
        "<h2>澳洲搜索兴趣</h2>"
        "<p>同一份序列内的日兴趣均值，归一化范围零至一百，不是搜索量或销量。"
        "两期完整日覆盖才比较；不同请求从不拼接。</p>",
        table(
            [
                "查询",
                "本周均值",
                "上周均值",
                "环比 %",
                "两期覆盖天数",
                "来源／序列／获取时间",
                "状态／原因",
            ],
            [
                [
                    text(row["query"]),
                    text(row["current_mean"]),
                    text(row["previous_mean"]),
                    text(row["wow_pct"]),
                    text(f"{row['current_days']} / {row['previous_days']}"),
                    text(f"{row['source']} / {row['series_id']} / {row['fetched_at']}"),
                    text(f"{row['state']} / {row['reason']}"),
                ]
                for row in report["search"]
            ],
        ),
        "<h2>来源内的文案特征分布</h2>"
        "<p>每个特征按该来源独立商品／内容样本计数，不按跨平台指标合分；容量为原文单位，未做隐含换算。</p>",
    ]
    for source in sorted(report["features"]):
        features = report["features"][source]
        sections.extend(
            [
                f"<h3>{text(source)}</h3>",
                table(
                    ["文案特征", "独立样本数"],
                    [[text(row["feature"]), text(row["sample_count"])] for row in features],
                ),
            ]
        )
    ai = report["ai"]
    sections.extend(
        [
            "<h2>可选 AI 定性摘要</h2>",
            f"<p>状态: {text(ai['state'])} · 模型: {text(ai.get('model'))}<br>{text(ai['detail'])}</p>",
        ]
    )
    if ai["state"] == "ok":
        sections.append(
            table(
                ["特征", "待验证假设", "公共证据引用"],
                [
                    [
                        text(row["feature"]),
                        text(row["interpretation"]),
                        text(", ".join(row["evidence_ids"])),
                    ]
                    for row in ai["themes"]
                ],
            )
        )
        sections.extend(f"<p>{text(caveat)}</p>" for caveat in ai["caveats"])
    sections.extend(
        [
            "<h2>数据质量与下一步</h2>",
            *[f"<p>{text(item)}</p>" for item in report["quality"]],
            "<p>优先补充窗口基线和合法的 AU 买家成交证据，人工核验规格、运费和成本；本报告不承诺利润。</p>",
            "<h2>通知配置（不是送达凭证）</h2>",
            f"<p>{text(report['notification']['state'])}: {text(report['notification']['detail'])}。"
            "实际发送结果以独立 outbox 状态为准。</p>",
            f'<p class="foot">报告 ID: {text(report["key"])} · 所有外部文字均转义，无外部脚本或跟踪资源。</p>',
        ]
    )
    return (
        '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width, initial-scale=1">'
        "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; style-src 'unsafe-inline'\">"
        f"<title>{text(report['topic'])}趋势周报</title>"
        "<style>body{font:15px/1.65 system-ui,sans-serif;max-width:1280px;margin:32px auto;padding:0 20px;"
        "color:#171717;background:#fafafa}h1{font-size:32px}h2{margin-top:36px;border-bottom:1px solid #ccc}"
        ".banner{background:#fff0cd;padding:16px;border:1px solid #ba8a28;font-weight:700}"
        ".scroll{overflow:auto}table{border-collapse:collapse;width:100%;background:#fff}"
        "th,td{text-align:left;vertical-align:top;padding:10px;border:1px solid #ddd;overflow-wrap:anywhere}"
        "th{background:#eee}a{color:#174a79}.foot{font-size:12px;color:#555}</style></head><body>"
        + "".join(sections)
        + "</body></html>"
    )


def aggregate_table(rows: list[dict]) -> str:
    return table(
        ["商品", "原始数量", "原始区间", "买家国家", "来源"],
        [
            [
                link(row["url"], row["title"]),
                text(row["quantity"]),
                text(row["period_start"] + " → " + row["period_end"]),
                text(row["buyer_country"]),
                text(row["provenance"]),
            ]
            for row in rows[:20]
        ],
    )


CSV_COLUMNS = [
    "mode",
    "kind",
    "source",
    "external_id",
    "title",
    "url",
    "observed_or_sold_at",
    "time_basis",
    "interval_start",
    "interval_end",
    "metrics_json",
    "observed_delta",
    "full_week_delta",
    "reason",
    "geography_json",
    "queries_json",
    "features_json",
    "provenance",
    "confidence",
]


def render_csv(report: dict) -> str:
    output = io.StringIO(newline="")
    writer = csv.DictWriter(output, fieldnames=CSV_COLUMNS)
    writer.writeheader()
    records: list[dict] = []
    for row in report["market"] + report["social"]:
        delta = row.get("deltas", {}).get("views", {})
        records.append(
            {
                "kind": "listing" if row["source"] == "ebay" else "social_cumulative",
                "source": row["source"],
                "external_id": row["external_id"],
                "title": row["title"],
                "url": row["url"],
                "observed_or_sold_at": row["observed_at"],
                "time_basis": row["time_basis"],
                "interval_start": delta.get("from"),
                "interval_end": delta.get("to"),
                "metrics_json": encode(
                    {"latest_cumulative": row["metrics"], "delta_evidence": row["deltas"]}
                    if "deltas" in row
                    else row["metrics"]
                ),
                "observed_delta": delta.get("observed_delta"),
                "full_week_delta": delta.get("week_delta"),
                "reason": delta.get("reason", row["limitation"]),
                "geography_json": encode(row["geography"]),
                "queries_json": encode(row["queries"]),
                "features_json": encode(row["features"]),
                "confidence": row["confidence"],
            }
        )
    for row in (
        report["sales"]["transactions"]
        + report["sales"]["period_estimates"]
        + report["sales"]["rolling_30d"]
    ):
        records.append(
            {
                "kind": row["kind"],
                "source": row["source"],
                "external_id": row["item_id"],
                "title": row["title"],
                "url": row["url"],
                "observed_or_sold_at": row["sold_at"],
                "interval_start": row["period_start"],
                "interval_end": row["period_end"],
                "metrics_json": encode({"quantity": row["quantity"]}),
                "geography_json": encode(
                    {
                        k: row[k]
                        for k in (
                            "buyer_country",
                            "marketplace",
                            "item_location_country",
                            "seller_country",
                        )
                    }
                ),
                "features_json": encode(row["features"]),
                "provenance": row["provenance"],
                "confidence": row["verification"],
            }
        )
    for row in report["search"]:
        records.append(
            {
                "kind": "search_interest_summary",
                "source": row["source"],
                "external_id": row["series_id"],
                "title": row["query"],
                "url": "https://trends.google.com/trends/",
                "observed_or_sold_at": row["fetched_at"],
                "interval_start": report["window"]["start_local"],
                "interval_end": report["window"]["end_local"],
                "metrics_json": encode(
                    {
                        "current_mean": row["current_mean"],
                        "previous_mean": row["previous_mean"],
                        "wow_pct": row["wow_pct"],
                        "current_days": row["current_days"],
                        "previous_days": row["previous_days"],
                    }
                ),
                "geography_json": encode({"geo": "AU"}),
                "reason": row["reason"],
                "confidence": row["state"],
            }
        )
        for point in row.get("daily_points", []):
            records.append(
                {
                    "kind": "search_daily_interest",
                    "source": row["source"],
                    "external_id": row["series_id"],
                    "title": row["query"],
                    "url": "https://trends.google.com/trends/",
                    "observed_or_sold_at": row["fetched_at"],
                    "interval_start": point["date"],
                    "interval_end": (
                        date.fromisoformat(point["date"]) + timedelta(days=1)
                    ).isoformat(),
                    "metrics_json": encode(
                        {"interest_index": point["value"], "partial": point["partial"]}
                    ),
                    "geography_json": encode({"geo": "AU"}),
                    "reason": "one_series_daily_bucket_not_sales",
                    "confidence": row["state"],
                }
            )
    for row in records:
        row["mode"] = report["mode"]
        writer.writerow({key: csv_cell(row.get(key)) for key in CSV_COLUMNS})
    return "\ufeff" + output.getvalue()


def write_report(store: Store, report: dict) -> dict[str, Path]:
    report = store.settings.redactor.value(report)
    root = store.root / "reports"
    root.mkdir(exist_ok=True)
    name = report["key"]
    if not name or any(ch not in "abcdefghijklmnopqrstuvwxyz0123456789-" for ch in name):
        raise BotError("Invalid report file identifier")
    paths = {
        kind: root / (name + extension)
        for kind, extension in (("html", ".html"), ("csv", ".csv"), ("json", ".json"))
    }
    contents = {
        "html": render_html(report),
        "csv": render_csv(report),
        "json": json.dumps(report, ensure_ascii=False, sort_keys=True, indent=2, allow_nan=False),
    }
    for kind, path in paths.items():
        content = contents[kind]
        if path.exists() and path.read_bytes() == content.encode("utf-8"):
            continue
        temporary = path.with_suffix(path.suffix + ".tmp")
        temporary.write_text(content, encoding="utf-8", newline="")
        temporary.replace(path)
    return paths
