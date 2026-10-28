FROM python:3.12-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONUTF8=1 \
    ATB_DATA_DIR=/data

WORKDIR /opt/bot
COPY pyproject.toml ./
COPY au_trend_bot ./au_trend_bot
COPY config.example.toml ./
ARG PIP_INDEX_URL=https://pypi.org/simple
RUN pip install --no-cache-dir . \
    && groupadd --gid 10001 bot \
    && useradd --uid 10001 --gid 10001 --no-create-home bot \
    && mkdir /data /imports \
    && chown bot:bot /data /imports

USER 10001:10001
ENTRYPOINT ["python", "-m", "au_trend_bot"]
CMD ["run"]
