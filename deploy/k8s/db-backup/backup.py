"""Snapshot-consistent PostgreSQL backup; S3 manifests are commit markers."""
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import uuid

import boto3
from boto3.s3.transfer import TransferConfig
import psycopg2
from psycopg2 import sql

WORK = Path(os.environ.get("WORK", "/work"))
TRANSFER = TransferConfig(max_concurrency=1, use_threads=False)


def now():
    return dt.datetime.now(dt.timezone.utc)


def digest(path):
    h = hashlib.sha256()
    with open(path, "rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def write_json(path, value):
    path.write_text(json.dumps(value, sort_keys=True) + "\n")


def table_counts(cursor):
    cursor.execute("""SELECT n.nspname, c.relname FROM pg_class c
        JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE c.relkind IN ('r','m') AND n.nspname NOT IN ('pg_catalog','information_schema')
        AND n.nspname NOT LIKE 'pg_toast%' ORDER BY 1,2""")
    tables = cursor.fetchall()
    result = []
    for schema, table in tables:
        cursor.execute(sql.SQL("SELECT count(*) FROM ONLY {}.{}").format(
            sql.Identifier(schema), sql.Identifier(table)))
        result.append({"schema": schema, "table": table, "count": cursor.fetchone()[0]})
    return result


def extensions(cursor):
    cursor.execute("SELECT extname, extversion FROM pg_extension ORDER BY 1")
    return [list(row) for row in cursor.fetchall()]


def dump():
    WORK.mkdir(parents=True, exist_ok=True)
    stamp = now()
    cycle = os.environ.get("CYCLE_ID") or stamp.strftime("%Y%m%dT%H%M%SZ-") + uuid.uuid4().hex[:12]
    if not re.fullmatch(r"[A-Za-z0-9-]{1,80}", cycle):
        raise ValueError("invalid cycle ID")
    # libpq environment is scoped to the dump container, never the S3 stages.
    with psycopg2.connect("") as conn:
        conn.set_session(isolation_level="REPEATABLE READ", readonly=True)
        with conn.cursor() as cur:
            cur.execute("SELECT pg_export_snapshot(), current_database(), current_setting('server_version_num')")
            snapshot, database, version = cur.fetchone()
            if int(version) // 10000 != 16:
                raise ValueError("expected PostgreSQL 16")
            counts = table_counts(cur)
            ext = extensions(cur)
            subprocess.run(["pg_dump", "--format=custom", "--no-owner", "--no-privileges",
                            "--snapshot=" + snapshot, "--file=" + str(WORK / "backup.dump")], check=True)
    manifest = {"schemaVersion": 2, "cycleId": cycle, "environment": os.environ["BACKUP_ENV"],
                "database": database, "postgresMajor": 16, "extensions": ext,
                "snapshotAt": stamp.isoformat(), "scope": "postgres-only",
                "tables": counts, "bytes": (WORK / "backup.dump").stat().st_size,
                "sha256": digest(WORK / "backup.dump")}
    if os.environ.get("REFERENCE_TIME"):
        reference = dt.datetime.fromisoformat(os.environ["REFERENCE_TIME"])
        if reference.tzinfo is None or reference > stamp:
            raise ValueError("cycle reference time must precede snapshot")
        manifest["referenceTime"] = reference.isoformat()
    write_json(WORK / "manifest.json", manifest)
    (WORK / "manifest.sha256").write_text(digest(WORK / "manifest.json") + "\n")
    print(json.dumps({"cycleId": cycle, "bytes": manifest["bytes"], "tables": len(counts)}))


def validate():
    checksum = (WORK / "manifest.sha256").read_text().strip()
    if not re.fullmatch(r"[0-9a-f]{64}", checksum) or checksum != digest(WORK / "manifest.json"):
        raise ValueError("manifest checksum mismatch")
    m = json.loads((WORK / "manifest.json").read_text())
    if (m["schemaVersion"] != 2 or m["postgresMajor"] != 16 or m["scope"] != "postgres-only"
            or m["environment"] != os.environ["BACKUP_ENV"]
            or m["database"] != os.environ["EXPECTED_DATABASE"]
            or not re.fullmatch(r"[A-Za-z0-9-]{1,80}", m["cycleId"])):
        raise ValueError("manifest identity/version mismatch")
    selected = os.environ.get("BACKUP_OBJECT")
    if selected and selected != f"postgres/{m['environment']}/sets/{m['cycleId']}":
        raise ValueError("manifest does not match selected S3 object")
    snapshot = dt.datetime.fromisoformat(m["snapshotAt"])
    if snapshot.tzinfo is None or snapshot > now() + dt.timedelta(minutes=5):
        raise ValueError("invalid snapshot time")
    seen = set()
    if not isinstance(m["tables"], list) or not m["tables"]:
        raise ValueError("missing table counts")
    for row in m["tables"]:
        identity = (row["schema"], row["table"])
        if (not all(isinstance(v, str) and v for v in identity) or identity in seen
                or type(row["count"]) is not int or row["count"] < 0):
            raise ValueError("invalid table counts")
        seen.add(identity)
    if (not re.fullmatch(r"[0-9a-f]{64}", m["sha256"])
            or m["bytes"] != (WORK / "backup.dump").stat().st_size
            or m["sha256"] != digest(WORK / "backup.dump")):
        raise ValueError("dump checksum/size mismatch")
    return m


def s3():
    return boto3.client("s3", endpoint_url=os.environ["BACKUP_S3_ENDPOINT"],
                        region_name=os.environ.get("AWS_DEFAULT_REGION", "bhs"))


def prefix(m):
    return f"postgres/{m['environment']}/sets/{m['cycleId']}"


def upload():
    m = validate()
    client, bucket = s3(), os.environ["BACKUP_S3_BUCKET"]
    # Only one data copy. The manifest is published LAST; any upload failure aborts.
    for name in ("backup.dump", "manifest.sha256", "manifest.json"):
        client.upload_file(str(WORK / name), bucket, prefix(m) + "/" + name,
                           ExtraArgs={"ServerSideEncryption": "AES256"}, Config=TRANSFER)
    print(json.dumps({"completeObject": prefix(m)}))


def download():
    key = os.environ["BACKUP_OBJECT"]
    if not re.fullmatch(r"postgres/" + re.escape(os.environ["BACKUP_ENV"]) + r"/sets/[A-Za-z0-9-]{1,80}", key):
        raise ValueError("invalid selected object prefix")
    WORK.mkdir(parents=True, exist_ok=True)
    client = s3()
    for name in ("manifest.json", "manifest.sha256", "backup.dump"):
        client.download_file(os.environ["BACKUP_S3_BUCKET"], key + "/" + name,
                             str(WORK / name), Config=TRANSFER)
    validate()


def restore():
    m = validate()  # No PostgreSQL process or SQL before validation.
    root = Path(os.environ.get("SCRATCH", "/scratch"))
    data, socket = root / "pgdata", root / "socket"
    socket.mkdir(parents=True, exist_ok=True)
    started = now()
    subprocess.run(["/usr/lib/postgresql/16/bin/initdb", "-D", str(data), "-U", "postgres",
                    "--auth-local=trust", "--auth-host=reject", "--no-locale", "--encoding=UTF8"], check=True,
                   stdout=subprocess.DEVNULL)
    ctl = ["/usr/lib/postgresql/16/bin/pg_ctl", "-D", str(data)]
    try:
        subprocess.run(ctl + ["-l", str(root / "postgres.log"), "-o",
                             f"-k {socket} -c listen_addresses='' -c shared_buffers=32MB "
                             "-c work_mem=2MB -c maintenance_work_mem=32MB -c max_connections=10", "-w", "start"], check=True)
        env = {**os.environ, "PGHOST": str(socket), "PGUSER": "postgres", "PGDATABASE": "restore"}
        # Refuse accidental source credentials even if the manifest gets modified.
        for name in ("PGPASSWORD", "PGSERVICE", "PGSERVICEFILE", "PGPASSFILE"):
            env.pop(name, None)
        subprocess.run(["createdb", "restore", "--template=template0"], env=env, check=True)
        subprocess.run(["pg_restore", "--dbname=restore", "--no-owner", "--no-privileges",
                        "--exit-on-error", "--single-transaction", str(WORK / "backup.dump")], env=env, check=True)
        with psycopg2.connect(host=str(socket), user="postgres", dbname="restore") as conn:
            with conn.cursor() as cur:
                if table_counts(cur) != m["tables"] or extensions(cur) != m["extensions"]:
                    raise ValueError("restored table counts/extensions differ from snapshot")
                cur.execute("SELECT count(*) FROM pg_index WHERE NOT indisvalid")
                if cur.fetchone()[0]:
                    raise ValueError("invalid restored index")
        report = {"schemaVersion": 1, "object": prefix(m), "manifestSha256": digest(WORK / "manifest.json"),
                  "snapshotAt": m["snapshotAt"], "verifiedAt": now().isoformat(),
                  "jobUid": os.environ.get("JOB_UID", "local-test"), "sha256": m["sha256"],
                  "tables": len(m["tables"]), "durationSeconds": (now() - started).total_seconds()}
        write_json(WORK / "verified.json", report)
        print(json.dumps(report))
    finally:
        subprocess.run(ctl + ["-m", "immediate", "-w", "stop"], check=False, stdout=subprocess.DEVNULL)


def objects(client, bucket, base):
    return [obj for page in client.get_paginator("list_objects_v2").paginate(Bucket=bucket, Prefix=base)
            for obj in page.get("Contents", [])]


def read_json(client, bucket, key):
    return json.loads(client.get_object(Bucket=bucket, Key=key)["Body"].read())


def keep_sets(manifests):
    """7 daily, 4 ISO-weekly, 1 monthly verified points; gaps do not age them out."""
    keep = set()
    for limit, group in ((7, lambda d: d.date()), (4, lambda d: d.isocalendar()[:2]),
                         (1, lambda d: (d.year, d.month))):
        seen = set()
        for m in sorted(manifests, key=lambda x: x["snapshotAt"], reverse=True):
            period = group(dt.datetime.fromisoformat(m["snapshotAt"]))
            if period not in seen and len(seen) < limit:
                seen.add(period)
                keep.add(m["object"])
    return keep


def verified_sets(client, bucket):
    base = f"postgres/{os.environ['BACKUP_ENV']}/verified/"
    reports = []
    for item in objects(client, bucket, base):
        r = read_json(client, bucket, item["Key"])
        # Cross-check the commit marker; stale/dangling reports never count.
        body = client.get_object(Bucket=bucket, Key=r["object"] + "/manifest.json")["Body"].read()
        m = json.loads(body)
        if (hashlib.sha256(body).hexdigest() != r["manifestSha256"] or prefix(m) != r["object"]
                or m["snapshotAt"] != r["snapshotAt"] or m["sha256"] != r["sha256"]):
            raise ValueError("verification report does not match manifest")
        head = client.head_object(Bucket=bucket, Key=r["object"] + "/backup.dump")
        if head["ContentLength"] != m["bytes"]:
            raise ValueError("verified dump missing or truncated")
        reports.append(r)
    return reports


def report():
    m = validate()
    client, bucket = s3(), os.environ["BACKUP_S3_BUCKET"]
    r = json.loads((WORK / "verified.json").read_text())
    if r["manifestSha256"] != digest(WORK / "manifest.json") or r["object"] != prefix(m):
        raise ValueError("invalid local verification receipt")
    for key in (f"postgres/{m['environment']}/exercises/{m['cycleId']}/{r['jobUid']}.json",
                f"postgres/{m['environment']}/verified/{m['cycleId']}.json"):
        client.upload_file(str(WORK / "verified.json"), bucket, key,
                           ExtraArgs={"ServerSideEncryption": "AES256"}, Config=TRANSFER)
    print(json.dumps(r))


def retain():
    client, bucket = s3(), os.environ["BACKUP_S3_BUCKET"]
    reports = verified_sets(client, bucket)
    keep = keep_sets(reports)
    for r in reports:
        if r["object"] in keep:
            continue
        # Hide the receipt first so freshness cannot accept a partially deleted set.
        client.delete_object(Bucket=bucket, Key=f"postgres/{os.environ['BACKUP_ENV']}/verified/{r['object'].split('/')[-1]}.json")
        for name in ("manifest.json", "manifest.sha256", "backup.dump"):
            client.delete_object(Bucket=bucket, Key=r["object"] + "/" + name)
    # Failed/incomplete uploads cannot accumulate forever. Never clean these
    # until at least one verified point exists; allow 48h for diagnosis/retry.
    if reports:
        known = {r["object"] for r in reports}
        grouped = {}
        base = f"postgres/{os.environ['BACKUP_ENV']}/sets/"
        for item in objects(client, bucket, base):
            stem = item["Key"].rsplit("/", 1)[0]
            grouped.setdefault(stem, []).append(item)
        for stem, items in grouped.items():
            if stem not in known and all((now() - i["LastModified"]).total_seconds() > 172800 for i in items):
                for item in sorted(items, key=lambda i: i["Key"] != stem + "/manifest.json"):
                    client.delete_object(Bucket=bucket, Key=item["Key"])


def freshness():
    reports = verified_sets(s3(), os.environ["BACKUP_S3_BUCKET"])
    age = (now() - max(dt.datetime.fromisoformat(r["snapshotAt"]) for r in reports)).total_seconds() if reports else float("inf")
    print(json.dumps({"event": "backup_freshness", "ageSeconds": age if reports else None, "rpoSeconds": 86400}), flush=True)
    if age > 86400 or age < -300:
        raise ValueError("RPO exceeded: no complete verified backup within 24 hours; page immo on-call")


def lifecycle():
    # No expiration of current complete sets: count-based pruning owns those.
    policy = {"Rules": [{"ID": "postgres-abandoned-and-deleted", "Status": "Enabled",
                         "Filter": {"Prefix": "postgres/"}, "AbortIncompleteMultipartUpload": {"DaysAfterInitiation": 1},
                         "NoncurrentVersionExpiration": {"NoncurrentDays": 35},
                         "Expiration": {"ExpiredObjectDeleteMarker": True}},
                        {"ID": "exercise-receipts", "Status": "Enabled",
                         "Filter": {"Prefix": "postgres/" + os.environ["BACKUP_ENV"] + "/exercises/"},
                         "Expiration": {"Days": 90}}]}
    client, bucket = s3(), os.environ["BACKUP_S3_BUCKET"]
    client.put_bucket_lifecycle_configuration(Bucket=bucket, LifecycleConfiguration=policy)
    actual = client.get_bucket_lifecycle_configuration(Bucket=bucket)
    if actual["Rules"] != policy["Rules"]:
        raise ValueError("lifecycle readback mismatch")
    print(json.dumps({"bucket": bucket, "lifecycle": actual["Rules"]}))


if __name__ == "__main__":
    actions = {f.__name__: f for f in (dump, upload, download, restore, report, retain, freshness, lifecycle)}
    actions[sys.argv[1]]()
