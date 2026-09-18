"""Owner provisioning. stdout is exclusively a Kubernetes Secret List for stdin apply.

OVH v1 cloud.json contract checked 2026-09-18; no admin credentials on disk.
"""
import base64
import hashlib
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
import uuid

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError

ROLES = ('writer', 'reader', 'retainer')
PUBLIC_BLOCK = dict.fromkeys(('BlockPublicAcls', 'IgnorePublicAcls',
                             'BlockPublicPolicy', 'RestrictPublicBuckets'), True)


class ProvisionError(Exception):
    """Only deliberately secret-free messages may cross the CLI boundary."""


def settings(env):
    if env not in ('preprod', 'production'):
        raise ProvisionError('Require BACKUP_ENV=preprod or production')
    return ('radar-immobilier-backups' + ('-preprod' if env == 'preprod' else ''),
            'radar-immobilier' + ('-preprod' if env == 'preprod' else ''))


def policy(role, bucket, env):
    arn = 'arn:aws:s3:::' + bucket
    prefix = f'postgres/{env}/'
    actions = {
        'writer': ['s3:PutObject', 's3:AbortMultipartUpload', 's3:ListMultipartUploadParts'],
        'reader': ['s3:GetObject', 's3:GetObjectVersion'],
        'retainer': ['s3:GetObject', 's3:DeleteObject'],
    }[role]
    statements = [
        # Explicit denies contain inherited objectstore_operator permissions too.
        {'Effect': 'Deny', 'Action': 's3:*', 'NotResource': [arn, arn + '/' + prefix + '*']},
        {'Effect': 'Deny', 'NotAction': actions + (
            ['s3:DeleteObjectVersion'] if role == 'retainer' else []),
         'Resource': arn + '/' + prefix + '*'},
        {'Effect': 'Allow', 'Action': actions, 'Resource': arn + '/' + prefix + '*'},
        {'Effect': 'Allow', 'Action': ['s3:ListBucket'], 'Resource': arn,
         'Condition': {'StringLike': {'s3:prefix': [prefix + '*']}}},
        {'Effect': 'Deny', 'Action': ['s3:ListBucket'], 'Resource': arn,
         'Condition': {'StringNotLike': {'s3:prefix': [prefix + '*']}}},
    ]
    bucket_actions = ['s3:ListBucket']
    if role == 'reader':
        bucket_actions += ['s3:GetBucketLocation', 's3:GetBucketVersioning',
                           's3:GetBucketPublicAccessBlock', 's3:GetBucketAcl',
                           's3:GetLifecycleConfiguration']
        statements.append({'Effect': 'Allow', 'Action': bucket_actions[1:], 'Resource': arn})
    statements.append({'Effect': 'Deny', 'NotAction': bucket_actions, 'Resource': arn})
    if role == 'retainer':
        probe = arn + '/' + prefix + 'exercises/_provision/*'
        statements += [
            {'Effect': 'Allow', 'Action': 's3:DeleteObjectVersion', 'Resource': probe},
            {'Effect': 'Deny', 'Action': 's3:DeleteObjectVersion', 'NotResource': probe},
        ]
    return {'Version': '2012-10-17', 'Statement': statements}


def lifecycle_rules(env):
    prefix = f'postgres/{env}/'
    rules = [
        {'ID': f'pra-{env}-cleanup', 'Status': 'Enabled', 'Filter': {'Prefix': prefix},
         'AbortIncompleteMultipartUpload': {'DaysAfterInitiation': 1},
         'NoncurrentVersionExpiration': {'NoncurrentDays': 35},
         'Expiration': {'ExpiredObjectDeleteMarker': True}},
        {'ID': f'pra-{env}-exercises', 'Status': 'Enabled',
         'Filter': {'Prefix': prefix + 'exercises/'}, 'Expiration': {'Days': 90}},
    ]
    # S3 expiration is age in days, not a count of represented periods.
    for tier, days in (('daily', 7), ('weekly', 28), ('monthly', 31)):
        rules.append({'ID': f'pra-{env}-{tier}', 'Status': 'Enabled',
                      'Filter': {'Prefix': prefix + tier + '/'}, 'Expiration': {'Days': days}})
    return rules


def configure_bucket(client, bucket, env):
    try:
        client.head_bucket(Bucket=bucket)
    except ClientError as exc:
        if exc.response['Error']['Code'] not in ('404', 'NoSuchBucket'):
            raise
        client.create_bucket(Bucket=bucket, ACL='private',
                             CreateBucketConfiguration={'LocationConstraint': 'bhs'})
    client.put_public_access_block(Bucket=bucket, PublicAccessBlockConfiguration=PUBLIC_BLOCK)
    client.put_bucket_acl(Bucket=bucket, ACL='private')
    client.put_bucket_versioning(Bucket=bucket, VersioningConfiguration={'Status': 'Enabled'})
    try:
        existing = client.get_bucket_lifecycle_configuration(Bucket=bucket)['Rules']
    except ClientError as exc:
        if exc.response['Error']['Code'] != 'NoSuchLifecycleConfiguration':
            raise
        existing = []
    desired = lifecycle_rules(env)
    ids = {rule['ID'] for rule in desired}
    # Preserve unrelated rules; refuse old rules that could expire complete sets.
    for rule in existing:
        if rule.get('ID') not in ids and rule.get('Status') == 'Enabled':
            raise ProvisionError('Unmanaged enabled lifecycle rule; owner must review it before provisioning')
    merged = [r for r in existing if r.get('ID') not in ids] + desired
    client.put_bucket_lifecycle_configuration(Bucket=bucket, LifecycleConfiguration={'Rules': merged})
    verify_bucket(client, bucket, env)


def verify_bucket(client, bucket, env):
    if client.get_bucket_versioning(Bucket=bucket).get('Status') != 'Enabled':
        raise ProvisionError('Bucket versioning readback failed')
    if client.get_public_access_block(Bucket=bucket)['PublicAccessBlockConfiguration'] != PUBLIC_BLOCK:
        raise ProvisionError('Public access block readback failed')
    acl = client.get_bucket_acl(Bucket=bucket)
    if any(g['Grantee'].get('ID') != acl['Owner']['ID'] for g in acl['Grants']):
        raise ProvisionError('Bucket ACL is not private')
    actual = client.get_bucket_lifecycle_configuration(Bucket=bucket)['Rules']
    if any(rule not in actual for rule in lifecycle_rules(env)):
        raise ProvisionError('Bucket lifecycle readback failed')


class Ovh:
    def __init__(self):
        endpoints = {'ovh-eu': 'https://eu.api.ovh.com/1.0',
                     'ovh-ca': 'https://ca.api.ovh.com/1.0'}
        self.endpoint = endpoints[os.environ.get('OVH_ENDPOINT', 'ovh-eu')]
        self.key = os.environ['OVH_APPLICATION_KEY']
        self.secret = os.environ['OVH_APPLICATION_SECRET']
        self.consumer = os.environ['OVH_CONSUMER_KEY']

    def request(self, method, path, body=None):
        url = self.endpoint + path
        data = json.dumps(body, separators=(',', ':')) if body is not None else ''
        # Use OVH's clock; never retry a create after an ambiguous transport failure.
        with urllib.request.urlopen(self.endpoint + '/auth/time', timeout=30) as response:
            timestamp = str(json.load(response))
        signature = '$1$' + hashlib.sha1('+'.join((self.secret, self.consumer, method,
                                                  url, data, timestamp)).encode()).hexdigest()
        req = urllib.request.Request(url, data=data.encode() if body is not None else None,
                                     method=method, headers={
                                         'Content-Type': 'application/json', 'X-Ovh-Application': self.key,
                                         'X-Ovh-Consumer': self.consumer, 'X-Ovh-Timestamp': timestamp,
                                         'X-Ovh-Signature': signature})
        try:
            with urllib.request.urlopen(req, timeout=60) as response:
                payload = response.read()
                return json.loads(payload) if payload else None
        except urllib.error.HTTPError as exc:
            # API paths may contain access keys; neither URL nor body is safe to log.
            raise ProvisionError(f'OVH API returned HTTP {exc.code}; consult the API/manual fallback in the runbook') from None


def identity(api, project, bucket, env, role):
    base = f'/cloud/project/{project}/user'
    name = f'radar-pra-{env}-{role}'
    users = [u for u in api.request('GET', base) if u.get('description') == name]
    if len(users) > 1:
        raise ProvisionError('Duplicate OVH user descriptions; owner reconciliation required')
    user = users[0] if users else api.request('POST', base, {
        'description': name, 'roles': ['objectstore_operator']})
    if {r['name'] for r in user['roles']} != {'objectstore_operator'}:
        raise ProvisionError('Unexpected OVH roles; refusing to adopt the user')
    path = base + '/' + str(user['id'])
    desired = policy(role, bucket, env)
    api.request('POST', path + '/policy', {'policy': json.dumps(desired)})
    if json.loads(api.request('GET', path + '/policy')['policy']) != desired:
        raise ProvisionError('OVH user policy readback failed')
    credentials = api.request('GET', path + '/s3Credentials')
    if len(credentials) > 1:
        raise ProvisionError('Multiple S3 credentials for a PRA user; refusing to choose or rotate')
    if credentials:
        access = credentials[0]['access']
        secret = api.request('POST', path + '/s3Credentials/' +
                             urllib.parse.quote(access, safe='') + '/secret')['secret']
    else:
        created = api.request('POST', path + '/s3Credentials')
        access, secret = created['access'], created['secret']
    return {'access': access, 'secret': secret}


def s3(credentials=None):
    args = {} if credentials is None else {
        'aws_access_key_id': credentials['access'], 'aws_secret_access_key': credentials['secret'],
        # Do not inherit the administrator's optional session token.
        'aws_session_token': ''}
    return boto3.client('s3', endpoint_url='https://s3.bhs.io.cloud.ovh.net', region_name='bhs',
                        config=Config(signature_version='s3v4', connect_timeout=10, read_timeout=30,
                                      retries={'max_attempts': 2}, s3={'addressing_style': 'path'}), **args)


def expect_denied(call, **kwargs):
    try:
        call(**kwargs)
    except ClientError as exc:
        if exc.response['Error']['Code'] == 'AccessDenied':
            return
        raise
    raise ProvisionError('Role isolation failed: forbidden operation succeeded')


def probe(clients, bucket, env):
    writer, reader, retainer = (clients[r] for r in ROLES)
    key = f'postgres/{env}/exercises/_provision/{uuid.uuid4()}'
    version = writer.put_object(Bucket=bucket, Key=key, Body=b'PRA access probe',
                                ServerSideEncryption='AES256')['VersionId']
    try:
        obj = reader.get_object(Bucket=bucket, Key=key)
        if obj['Body'].read() != b'PRA access probe' or obj.get('ServerSideEncryption') != 'AES256':
            raise ProvisionError('S3 probe content/encryption mismatch')
        expect_denied(writer.delete_object, Bucket=bucket, Key=key)
        expect_denied(writer.delete_object, Bucket=bucket, Key=key, VersionId=version)
        expect_denied(reader.put_object, Bucket=bucket, Key=key, Body=b'forbidden')
        expect_denied(reader.delete_object, Bucket=bucket, Key=key)
        # Prefix denial must hold even if the base OpenStack role is broad.
        for client in clients.values():
            expect_denied(client.list_objects_v2, Bucket=bucket, Prefix='postgres/other/')
        verify_bucket(reader, bucket, env)
    finally:
        # Only the retainer removes the exact version this invocation created.
        retainer.delete_object(Bucket=bucket, Key=key, VersionId=version)
    try:
        reader.get_object(Bucket=bucket, Key=key, VersionId=version)
    except ClientError as exc:
        if exc.response['Error']['Code'] in ('NoSuchKey', 'NoSuchVersion'):
            return
        raise
    raise ProvisionError('Retainer deletion readback failed')


def provision(api, admin, project, env, client_factory=s3):
    bucket, namespace = settings(env)
    configure_bucket(admin, bucket, env)
    credentials = {r: identity(api, project, bucket, env, r) for r in ROLES}
    probe({r: client_factory(c) for r, c in credentials.items()}, bucket, env)
    items = []
    for role, credential in credentials.items():
        items.append({'apiVersion': 'v1', 'kind': 'Secret', 'type': 'Opaque',
                      'metadata': {'name': 'radar-pra-' + role, 'namespace': namespace},
                      'data': {k: base64.b64encode(v.encode()).decode() for k, v in
                               [('S3_ACCESS_KEY', credential['access']), ('S3_SECRET_KEY', credential['secret'])]}})
    print(f'{bucket}: private, public access blocked, versioning Enabled; lifecycle daily=7d weekly=28d monthly=31d; '
          'writer/read/retainer probe and expected denials passed. Users: ' +
          ', '.join(f'radar-pra-{env}-{r}' for r in ROLES), file=sys.stderr)
    return {'apiVersion': 'v1', 'kind': 'List', 'items': items}


def main():
    if os.environ.get('PRA_PROVISION_GO') != '1':
        raise ProvisionError('Require PRA_PROVISION_GO=1')
    env = os.environ.get('BACKUP_ENV')
    settings(env)
    if env == 'production' and os.environ.get('PRA_PRODUCTION_GO') != '1':
        raise ProvisionError('Require PRA_PRODUCTION_GO=1')
    project = os.environ['OVH_PROJECT_ID']
    if not re.fullmatch(r'[a-fA-F0-9]{32}', project):
        raise ProvisionError('OVH_PROJECT_ID must be a 32-character project ID')
    result = provision(Ovh(), s3(), project, env)
    json.dump(result, sys.stdout)


if __name__ == '__main__':
    try:
        main()
    except ProvisionError as exc:
        print(str(exc), file=sys.stderr)
        sys.exit(1)
    except Exception:
        print('Provisioning failed (details suppressed to protect credentials); check OVH support and permissions in the runbook.', file=sys.stderr)
        sys.exit(1)
