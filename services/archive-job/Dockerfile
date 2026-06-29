FROM python:3.12-slim
WORKDIR /app
# age (client-side encryption) + rclone (S3/B2 transport)
RUN apt-get update && apt-get install -y --no-install-recommends age rclone ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY archive.py .
ENTRYPOINT ["python", "-u", "archive.py"]
CMD ["run"]
