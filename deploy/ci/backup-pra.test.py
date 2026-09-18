"""Runs in the backup image: real PG16/PostGIS, isolated sockets, hermetic S3."""
import copy
import datetime as dt
import importlib.util
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
from unittest.mock import patch

import psycopg2
import yaml

ROOT = Path('/repo')
spec = importlib.util.spec_from_file_location('backup', ROOT / 'deploy/k8s/db-backup/backup.py')
b = importlib.util.module_from_spec(spec)
spec.loader.exec_module(b)


class Store:
    def __init__(self):
        self.data = {}
        self.fail = None
        self.uploads = []

    def upload_file(self, path, bucket, key, **kwargs):
        if self.fail and key.endswith(self.fail):
            raise OSError('injected upload failure')
        self.uploads.append(key)
        self.data[key] = Path(path).read_bytes()

    def download_file(self, bucket, key, path, **kwargs):
        Path(path).write_bytes(self.data[key])

    def get_object(self, Bucket, Key):
        return {'Body': io.BytesIO(self.data[Key])}

    def head_object(self, Bucket, Key):
        return {'ContentLength': len(self.data[Key])}

    def get_paginator(self, name):
        return self

    def paginate(self, Bucket, Prefix):
        yield {'Contents': [{'Key': k, 'LastModified': b.now()-dt.timedelta(days=3)} for k in sorted(self.data) if k.startswith(Prefix)]}

    def delete_object(self, Bucket, Key):
        del self.data[Key]


class BackupTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source = Path(tempfile.mkdtemp(dir='/scratch'))
        cls.socket = cls.source / 'socket'
        cls.socket.mkdir()
        cls.data = cls.source / 'data'
        subprocess.run(['/usr/lib/postgresql/16/bin/initdb', '-D', str(cls.data), '-U', 'postgres',
                        '--auth-local=trust', '--auth-host=reject', '--no-locale', '--encoding=UTF8'], check=True,
                       stdout=subprocess.DEVNULL)
        subprocess.run(['/usr/lib/postgresql/16/bin/pg_ctl', '-D', str(cls.data), '-l', str(cls.source / 'log'),
                        '-o', f"-k {cls.socket} -c listen_addresses=''", '-w', 'start'], check=True)
        os.environ.update(PGHOST=str(cls.socket), PGUSER='postgres', PGDATABASE='postgres', BACKUP_ENV='preprod',
                          EXPECTED_DATABASE='postgres', BACKUP_S3_BUCKET='test-bucket', BACKUP_S3_ENDPOINT='https://invalid')
        with psycopg2.connect('') as conn:
            with conn.cursor() as cur:
                cur.execute('CREATE EXTENSION postgis; CREATE EXTENSION pg_trgm; CREATE EXTENSION btree_gist')
                cur.execute('CREATE TABLE annotations(id int primary key, note text); INSERT INTO annotations VALUES(1,\'owner note\')')
                cur.execute('CREATE TABLE partitions(id int) PARTITION BY RANGE(id); CREATE TABLE p1 PARTITION OF partitions FOR VALUES FROM (0) TO (10); INSERT INTO partitions VALUES(1)')
                cur.execute('CREATE SCHEMA "odd schema"; CREATE TABLE "odd schema"."odd table"(id int);')

    @classmethod
    def tearDownClass(cls):
        subprocess.run(['/usr/lib/postgresql/16/bin/pg_ctl', '-D', str(cls.data), '-m', 'immediate', '-w', 'stop'], check=True)
        shutil.rmtree(cls.source)

    def setUp(self):
        self.work = Path(tempfile.mkdtemp(dir='/work'))
        b.WORK = self.work
        self.scratch = tempfile.mkdtemp(dir='/scratch')
        os.environ['SCRATCH'] = self.scratch
        os.environ.pop('BACKUP_OBJECT', None)
        self.store = Store()
        self.mock = patch.object(b, 's3', return_value=self.store)
        self.mock.start()

    def tearDown(self):
        self.mock.stop()
        shutil.rmtree(self.work)
        shutil.rmtree(self.scratch)

    def make_backup(self):
        b.dump()
        return b.validate()

    def rewrite_manifest(self, m):
        b.write_json(self.work / 'manifest.json', m)
        (self.work / 'manifest.sha256').write_text(b.digest(self.work / 'manifest.json') + '\n')

    def test_real_snapshot_survives_source_write_and_source_offline_restore(self):
        real_run = subprocess.run
        def racing_run(args, **kwargs):
            if args[0] == 'pg_dump':
                with psycopg2.connect('') as conn:
                    with conn.cursor() as cur:
                        cur.execute("INSERT INTO annotations VALUES (2,'after snapshot') ON CONFLICT DO NOTHING")
            return real_run(args, **kwargs)
        with patch.object(b.subprocess, 'run', side_effect=racing_run):
            m = self.make_backup()
        self.assertEqual(next(t['count'] for t in m['tables'] if t['table'] == 'annotations'), 1)
        b.upload()
        os.environ['BACKUP_OBJECT'] = b.prefix(m)
        shutil.rmtree(self.work)
        b.download()
        with patch.dict(os.environ, {'PGHOST': '/nonexistent-source'}):
            b.restore()
        b.report()
        b.freshness()
        b.retain()
        self.assertEqual(json.loads((self.work / 'verified.json').read_text())['object'], b.prefix(m))
        self.assertFalse((Path(self.scratch) / 'pgdata/postmaster.pid').exists())
        with psycopg2.connect('') as conn:
            with conn.cursor() as cur:
                cur.execute('DELETE FROM annotations WHERE id=2')

    def test_upload_each_failure_does_not_publish_complete_marker(self):
        self.make_backup()
        for name in ('backup.dump', 'manifest.sha256', 'manifest.json'):
            with self.subTest(name=name):
                self.store.data.clear()
                self.store.fail = name
                with self.assertRaises(OSError):
                    b.upload()
                self.assertFalse(any(k.endswith('/manifest.json') for k in self.store.data))

    def test_manifest_published_last_single_dump_copy(self):
        self.make_backup()
        b.upload()
        self.assertTrue(self.store.uploads[-1].endswith('/manifest.json'))
        self.assertEqual(sum(k.endswith('backup.dump') for k in self.store.uploads), 1)

    def test_corruption_rejected_before_any_postgres_process(self):
        self.make_backup()
        for filename in ('manifest.sha256', 'manifest.json', 'backup.dump'):
            with self.subTest(filename=filename):
                path = self.work / filename
                original = path.read_bytes()
                path.write_bytes(original + b'corruption')
                with patch.object(b.subprocess, 'run') as run, self.assertRaises(ValueError):
                    b.restore()
                run.assert_not_called()
                path.write_bytes(original)

    def test_wrong_identity_version_and_counts_rejected(self):
        original = self.make_backup()
        changes = [('environment', 'production'), ('database', 'wrong'), ('postgresMajor', 15),
                   ('schemaVersion', 1), ('tables', []), ('snapshotAt', '2099-01-01T00:00:00+00:00')]
        for field, value in changes:
            with self.subTest(field=field):
                m = copy.deepcopy(original)
                m[field] = value
                self.rewrite_manifest(m)
                with self.assertRaises(ValueError):
                    b.validate()
        self.rewrite_manifest(original)
        os.environ['BACKUP_OBJECT'] = 'postgres/preprod/sets/wrong'
        with self.assertRaises(ValueError):
            b.validate()

    def test_missing_complete_manifest_rejected(self):
        m = self.make_backup()
        b.upload()
        del self.store.data[b.prefix(m) + '/manifest.json']
        os.environ['BACKUP_OBJECT'] = b.prefix(m)
        with self.assertRaises(KeyError):
            b.download()

    def test_mismatched_exact_counts_fail_and_stop_server(self):
        m = self.make_backup()
        m['tables'][0]['count'] += 1
        self.rewrite_manifest(m)
        with self.assertRaisesRegex(ValueError, 'counts/extensions'):
            b.restore()
        self.assertFalse((self.work / 'verified.json').exists())
        self.assertFalse((Path(self.scratch) / 'pgdata/postmaster.pid').exists())

    def test_retention_preserves_latest_across_missing_days(self):
        items = [{'object': str(i), 'snapshotAt': (b.now()-dt.timedelta(days=i*10)).isoformat()} for i in range(12)]
        kept = b.keep_sets(items)
        self.assertIn('0', kept)
        self.assertEqual(len(kept), 7)
        self.assertEqual(b.keep_sets(items[-1:]), {'11'})

    def test_rpo_exceeded_or_no_verified_point_fails(self):
        with self.assertRaises(ValueError):
            b.freshness()
        old = [{'snapshotAt': (b.now()-dt.timedelta(hours=25)).isoformat()}]
        with patch.object(b, 'verified_sets', return_value=old), self.assertRaises(ValueError):
            b.freshness()

    def test_secret_examples_have_exactly_three_identities_per_environment(self):
        docs = list(yaml.safe_load_all((ROOT / 'deploy/k8s/backup-common/secrets.example.yaml').read_text()))
        for ns in ('radar-immobilier', 'radar-immobilier-preprod'):
            names = [d['metadata']['name'] for d in docs if d['metadata']['namespace'] == ns]
            self.assertCountEqual(names, ['radar-pra-writer', 'radar-pra-reader', 'radar-pra-retainer'])

    def test_retention_only_deletes_expired_unverified_after_a_good_point(self):
        key = 'postgres/preprod/sets/orphan/backup.dump'
        self.store.data[key] = b'incomplete'
        with patch.object(b, 'verified_sets', return_value=[]):
            b.retain()
        self.assertIn(key, self.store.data)
        verified = [{'object': 'postgres/preprod/sets/good', 'snapshotAt': b.now().isoformat()}]
        with patch.object(b, 'verified_sets', return_value=verified):
            b.retain()
        self.assertNotIn(key, self.store.data)

    def test_verified_receipt_cannot_point_to_replaced_manifest(self):
        m = self.make_backup()
        b.upload()
        receipt = {'object': b.prefix(m), 'snapshotAt': m['snapshotAt'], 'sha256': m['sha256'],
                   'manifestSha256': '0'*64}
        self.store.data['postgres/preprod/verified/forged.json'] = json.dumps(receipt).encode()
        with self.assertRaisesRegex(ValueError, 'report does not match'):
            b.freshness()

    def test_retention_week_month_selection_and_same_day_deduplication(self):
        points = [{'object': str(i), 'snapshotAt': (dt.datetime(2026, 9, 18, 12, tzinfo=dt.timezone.utc)-dt.timedelta(hours=i*12)).isoformat()} for i in range(90)]
        kept = b.keep_sets(points)
        self.assertIn('0', kept)
        self.assertNotIn('1', kept)  # Earlier point in the same represented day/week/month.
        self.assertLessEqual(len(kept), 12)
        self.assertGreaterEqual(len(kept), 7)

    def test_pg_dump_failure_leaves_no_manifest(self):
        with patch.object(b.subprocess, 'run', side_effect=subprocess.CalledProcessError(1, 'pg_dump')):
            with self.assertRaises(subprocess.CalledProcessError):
                b.dump()
        self.assertFalse((self.work / 'manifest.json').exists())


class ManifestTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        spec = importlib.util.spec_from_file_location('render', ROOT / 'deploy/ci/backup-pra-render.py')
        cls.renderer = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cls.renderer)
        cls.docs = list(yaml.safe_load_all((ROOT / 'tmp/backup-pra-render/preprod.yaml').read_text()))

    def test_rendered_overlays_activate_both_with_distinct_settings(self):
        for env, ns, bucket in [('preprod', 'radar-immobilier-preprod', 'radar-immobilier-backups-preprod'),
                                ('prod', 'radar-immobilier', 'radar-immobilier-backups')]:
            docs = list(yaml.safe_load_all((ROOT / f'tmp/backup-pra-render/{env}.yaml').read_text()))
            self.assertEqual({d['metadata']['namespace'] for d in docs}, {ns})
            settings = next(d for d in docs if d['kind'] == 'ConfigMap')
            self.assertEqual(settings['data']['BACKUP_S3_BUCKET'], bucket)
            crons = [d for d in docs if d['kind'] == 'CronJob']
            self.assertEqual(len(crons), 2)
            for cron in crons:
                self.assertFalse(cron['spec']['suspend'])
                pod = cron['spec']['jobTemplate']['spec']['template']['spec']
                for container in pod.get('initContainers', []) + pod['containers']:
                    self.assertNotIn('PIN-BEFORE-APPLY', container['image'])
                    self.assertEqual(container['envFrom'][0]['configMapRef']['name'], settings['metadata']['name'])

    def test_premerge_support_has_no_schedules_and_unique_backup_job(self):
        support = self.renderer.proof_resource('support', self.docs)
        self.assertEqual({d['kind'] for d in support['items']}, {'ConfigMap', 'NetworkPolicy'})
        job = self.renderer.proof_resource('backup', self.docs, name='radar-pra-backup-unique',
                                           cycle='joint-cycle', reference='2026-09-18T00:00:00+00:00')
        self.assertEqual(job['kind'], 'Job')
        self.assertEqual(job['metadata']['name'], 'radar-pra-backup-unique')
        values = job['spec']['template']['spec']['initContainers'][0]['env']
        self.assertIn({'name': 'CYCLE_ID', 'value': 'joint-cycle'}, values)

    def test_restore_render_binds_exact_object_and_image(self):
        image = 'ghcr.io/rhanka/radar-backup@sha256:' + '1'*64
        selected = 'postgres/preprod/sets/one'
        job = self.renderer.proof_resource('restore', self.docs, 'radar-pra-restore-unique', image, selected)
        self.assertEqual(job['metadata']['name'], 'radar-pra-restore-unique')
        pod = job['spec']['template']['spec']
        self.assertIn({'name': 'BACKUP_OBJECT', 'value': selected}, pod['initContainers'][0]['env'])
        for container in pod['initContainers'] + pod['containers']:
            self.assertEqual(container['image'], image)
            self.assertFalse(any(e['name'] == 'PGPASSWORD' for e in container.get('env', [])))

    def test_resource_and_credential_guards(self):
        for filename in ('41-db-backup-cronjob.yaml', '42-db-restore-verify-job.yaml', '43-backup-freshness-cronjob.yaml'):
            doc = yaml.safe_load((ROOT / 'deploy/k8s' / filename).read_text())
            spec = doc['spec']['jobTemplate']['spec'] if doc['kind'] == 'CronJob' else doc['spec']
            pod = spec['template']['spec']
            self.assertFalse(pod['automountServiceAccountToken'])
            limits = []
            for container in pod.get('initContainers', []) + pod['containers']:
                limits.append(int(container['resources']['limits']['memory'].removesuffix('Mi')))
                self.assertIn('memory', container['resources']['requests'])
                names = [v['name'] for v in container.get('env', [])]
                self.assertFalse('PGPASSWORD' in names and 'AWS_SECRET_ACCESS_KEY' in names)
                if container['name'] == 'restore-and-verify':
                    self.assertNotIn('PGPASSWORD', names)
                    self.assertNotIn('AWS_SECRET_ACCESS_KEY', names)
                role = {'upload': 'writer', 'report': 'writer', 'download': 'reader',
                        'freshness': 'reader', 'retain': 'retainer'}.get(container['name'])
                if role:
                    for entry in container['env']:
                        if entry['name'].startswith('AWS_'):
                            self.assertEqual(entry['valueFrom']['secretKeyRef']['name'], 'radar-pra-' + role)
            self.assertLessEqual(max(limits), 512)
            self.assertTrue(all('persistentVolumeClaim' not in v for v in pod['volumes']))
            if doc['kind'] == 'CronJob':
                self.assertFalse(doc['spec']['suspend'])


if __name__ == '__main__':
    unittest.main(verbosity=2)
