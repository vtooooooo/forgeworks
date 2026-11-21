# syntax=docker/dockerfile:1
FROM python:3.12-slim
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 \
    FORGEWORKS_DATABASE_URL=sqlite:////data/forgeworks.db FORGEWORKS_MODEL_DIR=/data/models
COPY requirements.lock .
COPY pyproject.toml alembic.ini ./
COPY src src
COPY migrations migrations
COPY examples/console_seed.py /app/examples/console_seed.py
COPY examples/console-fixture /app/examples/console-fixture
RUN --mount=type=secret,id=build_ca \
    if [ -f /run/secrets/build_ca ]; then export PIP_CERT=/run/secrets/build_ca; fi \
    && pip install --no-cache-dir -r requirements.lock \
    && pip install --no-cache-dir --no-deps . \
    && adduser --disabled-password --gecos "" forgeworks \
    && mkdir /data && chown forgeworks /data
USER forgeworks
EXPOSE 8000
HEALTHCHECK --interval=10s --timeout=3s CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=2)"]
CMD ["sh", "-c", "alembic upgrade head && exec uvicorn forgeworks.api:app --host 0.0.0.0 --port 8000"]
