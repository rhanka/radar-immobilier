"""Build temporary proof resources from branch renders, without activating schedules."""
import copy
import json
import os
from pathlib import Path
import sys

import yaml


def proof_resource(mode, docs, name=None, image=None, object_key=None, cycle=None, reference=None):
    if mode == 'support':
        return {'apiVersion': 'v1', 'kind': 'List', 'items': [
            d for d in docs if d['kind'] in ('ConfigMap', 'NetworkPolicy')]}
    if mode == 'backup':
        cron = next(d for d in docs if d['kind'] == 'CronJob' and d['metadata']['name'] == 'radar-db-backup')
        job = {'apiVersion': 'batch/v1', 'kind': 'Job', 'metadata': {
            'name': name, 'namespace': 'radar-immobilier-preprod'}, 'spec': copy.deepcopy(cron['spec']['jobTemplate']['spec'])}
        if cycle:
            if not reference:
                raise ValueError('a joint cycle requires its reference time')
            job['spec']['template']['spec']['initContainers'][0]['env'] += [
                {'name': 'CYCLE_ID', 'value': cycle}, {'name': 'REFERENCE_TIME', 'value': reference}]
        return job
    if mode == 'restore':
        job = yaml.safe_load(Path('/repo/deploy/k8s/42-db-restore-verify-job.yaml').read_text())
        job['metadata']['name'] = name
        cm = next(d['metadata']['name'] for d in docs if d['kind'] == 'ConfigMap' and d['metadata']['name'].startswith('radar-pra-settings-'))
        pod = job['spec']['template']['spec']
        for c in pod['initContainers'] + pod['containers']:
            c['image'] = image
            c['envFrom'] = [{'configMapRef': {'name': cm}}]
            for entry in c.get('env', []):
                if entry['name'] == 'BACKUP_OBJECT':
                    entry['value'] = object_key
        return job
    raise ValueError('unknown render mode')


if __name__ == '__main__':
    documents = list(yaml.safe_load_all(Path('/repo/tmp/backup-pra-render/preprod.yaml').read_text()))
    result = proof_resource(sys.argv[1], documents, *sys.argv[2:],
                            cycle=os.environ.get('CYCLE_ID'), reference=os.environ.get('REFERENCE_TIME'))
    print(json.dumps(result))
