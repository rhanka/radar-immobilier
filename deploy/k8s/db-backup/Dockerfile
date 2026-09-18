FROM python:3.11-slim-bullseye AS python
RUN pip install --no-cache-dir boto3==1.40.0 psycopg2-binary==2.9.10 PyYAML==6.0.2
FROM postgis/postgis:16-3.4
# Same Debian/glibc family; preserve PG16/PostGIS 3.4 extension compatibility.
COPY --from=python /usr/local /usr/local
RUN apt-get update && apt-get install -y --no-install-recommends gettext-base \
    && rm -rf /var/lib/apt/lists/*
COPY deploy/k8s/db-backup /scripts
ENV PYTHONDONTWRITEBYTECODE=1 AWS_EC2_METADATA_DISABLED=true
USER 999:999
ENTRYPOINT ["python3", "/scripts/backup.py"]
