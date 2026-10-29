# Multi-stage secure Dockerfile for IBM Cloud Code Engine Quantum Container
# Optimized for Qiskit 2.5.2 & Qiskit IBM Runtime with non-root security execution

FROM python:3.12-slim AS builder

WORKDIR /build
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    g++ \
    libffi-dev \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt

FROM python:3.12-slim AS runtime

# Create dedicated non-root user numina (UID 10001)
RUN groupadd -g 10001 numina && \
    useradd -u 10001 -g numina -m -s /bin/bash numina

WORKDIR /app
COPY --from=builder /install /usr/local
COPY . /app

RUN chown -R numina:numina /app

USER 10001

ENV PYTHONUNBUFFERED=1
ENV PORT=8080

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8080/healthz')" || exit 1

ENTRYPOINT ["python", "app.py"]
