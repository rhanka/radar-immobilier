"""Owner provisioning. stdout is exclusively a Kubernetes Secret List for stdin apply.

OVH v1 cloud.json contract checked 2026-09-18; no admin credentials on disk.
"""
import base64
import datetime as dt
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
# Actions the OVH BHS user-policy schema accepts (measured live 2026-09-18). The
# schema also forbids NotAction/NotResource, and omits s3:GetObjectVersion,
# s3:DeleteObjectVersion, bucket-policy and public-access-block verbs. Isolation is
# therefore expressed with EXPLICIT enumerated Deny on recognized verbs, which was
# measured to contain the objectstore_operator base role.
OVH_POLICY_ACTIONS = frozenset({
    's3:*', 's3:GetObject', 's3:PutObject', 's3:DeleteObject', 's3:GetObjectAcl', 's3:PutObjectAcl',
    's3:AbortMultipartUpload', 's3:ListMultipartUploadParts', 's3:ListBucket', 's3:ListBucketVersions',
    's3:ListAllMyBuckets', 's3:GetBucketLocation', 's3:GetBucketVersioning', 's3:PutBucketVersioning',
    's3:GetBucketAcl', 's3:PutBucketAcl', 's3:GetLifecycleConfiguration', 's3:PutLifecycleConfiguration',
    's3:GetEncryptionConfiguration', 's3:GetBucketObjectLockConfiguration', 's3:PutObjectRetention',
    's3:GetObjectRetention', 's3:BypassGovernanceRetention'})
# Recognized sensitive verbs; every one a role is not explicitly granted is denied.
DANGER_ACTIONS = ('s3:GetObject', 's3:GetObjectAcl', 's3:PutObject', 's3:PutObjectAcl',
                  's3:DeleteObject', 's3:PutBucketVersioning', 's3:PutBucketAcl',
                  's3:PutLifecycleConfiguration')


class ProvisionError(Exception):
    """Only deliberately secret-free messages may cross the CLI boundary."""


def settings(env):
    if env not in ('preprod', 'production'):
        raise ProvisionError('Require BACKUP_ENV=preprod or production')
    return ('radar-immobilier-backups' + ('-preprod' if env == 'preprod' else ''),
            'radar-immobilier' + ('-preprod' if env == 'preprod' else ''))


def policy(role, bucket, env):
    """Least-privilege policy in the OVH BHS subset: only recognized verbs, no
    NotAction/NotResource. Each role's forbidden recognized verbs are denied
    explicitly (Deny wins over the inherited base-role Allow); version-scoped
    verbs are absent from the schema, so the retainer relies on lifecycle for
    noncurrent-version cleanup rather than s3:DeleteObjectVersion (see runbook)."""
    arn = 'arn:aws:s3:::' + bucket
    prefix = f'postgres/{env}/'
    obj = arn + '/' + prefix + '*'
    allow_obj = {
        'writer': ['s3:PutObject', 's3:AbortMultipartUpload', 's3:ListMultipartUploadParts'],
        'reader': ['s3:GetObject'],
        'retainer': ['s3:GetObject', 's3:DeleteObject'],
    }[role]
    bucket_reads = (['s3:GetBucketLocation', 's3:GetBucketVersioning', 's3:GetBucketAcl',
                     's3:GetLifecycleConfiguration'] if role == 'reader' else [])
    granted = set(allow_obj) | set(bucket_reads) | {'s3:ListBucket'}
    deny = [a for a in DANGER_ACTIONS if a not in granted]
    statements = [
        {'Effect': 'Allow', 'Action': allow_obj, 'Resource': obj},
        {'Effect': 'Allow', 'Action': ['s3:ListBucket'], 'Resource': arn,
         'Condition': {'StringLike': {'s3:prefix': [prefix + '*']}}},
        # Confine the (base-role) ListBucket to this prefix; Condition is schema-legal.
        {'Effect': 'Deny', 'Action': ['s3:ListBucket'], 'Resource': arn,
         'Condition': {'StringNotLike': {'s3:prefix': [prefix + '*']}}},
        {'Effect': 'Deny', 'Action': deny, 'Resource': [arn, arn + '/*']},
    ]
    if bucket_reads:
        statements.insert(1, {'Effect': 'Allow', 'Action': bucket_reads, 'Resource': arn})
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


def public_access_block_supported(client, bucket):
    """OVH BHS S3 implements neither PublicAccessBlock nor bucket policies (HTTP
    501). Where PutPublicAccessBlock is unavailable, "no public access" rests on
    the private canned ACL: there is no bucket-policy path to grant public access,
    so the only remaining vector is a manual public ACL grant. That is asserted
    private here AND re-checked every freshness cycle by backup.py (detected, not
    prevented, within the freshness cadence). Returns True when the AWS-native
    block was applied, False when the target does not implement it."""
    try:
        client.put_public_access_block(Bucket=bucket, PublicAccessBlockConfiguration=PUBLIC_BLOCK)
        return True
    except ClientError as exc:
        if (exc.response['Error']['Code'] in ('NotImplemented', 'NotSupported')
                or exc.response.get('ResponseMetadata', {}).get('HTTPStatusCode') == 501):
            return False
        raise


def object_lock_retention():
    """Owner-chosen default retention, parameterised so the mode/duration are not
    frozen in code. Returns (MODE, DAYS) when OBJECT_LOCK_MODE and OBJECT_LOCK_DAYS
    are both set, else None (Object Lock stays ENABLED on the bucket with no default
    retention until the owner decides). MODE is GOVERNANCE or COMPLIANCE."""
    mode = os.environ.get('OBJECT_LOCK_MODE')
    days = os.environ.get('OBJECT_LOCK_DAYS')
    if not mode and not days:
        return None
    if mode not in ('GOVERNANCE', 'COMPLIANCE') or not (days or '').isdigit() or int(days) < 1:
        raise ProvisionError('OBJECT_LOCK_MODE must be GOVERNANCE|COMPLIANCE and OBJECT_LOCK_DAYS a positive integer')
    return mode, int(days)


def object_lock_enabled(client, bucket):
    try:
        return client.get_object_lock_configuration(Bucket=bucket).get(
            'ObjectLockConfiguration', {}).get('ObjectLockEnabled') == 'Enabled'
    except ClientError as exc:
        if exc.response['Error']['Code'] in ('ObjectLockConfigurationNotFoundError', 'NoSuchObjectLockConfiguration'):
            return False
        raise


def configure_bucket(client, bucket, env):
    try:
        client.head_bucket(Bucket=bucket)
    except ClientError as exc:
        if exc.response['Error']['Code'] not in ('404', 'NoSuchBucket'):
            raise
        # Object Lock can only be turned on at creation, and it needs versioning.
        client.create_bucket(Bucket=bucket, ACL='private', ObjectLockEnabledForBucket=True,
                             CreateBucketConfiguration={'LocationConstraint': 'bhs'})
    if not object_lock_enabled(client, bucket):
        raise ProvisionError('Bucket exists without Object Lock; recreate it empty with Object Lock enabled')
    pab = public_access_block_supported(client, bucket)
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
    lock = object_lock_retention()
    if lock:
        client.put_object_lock_configuration(Bucket=bucket, ObjectLockConfiguration={
            'ObjectLockEnabled': 'Enabled', 'Rule': {'DefaultRetention': {'Mode': lock[0], 'Days': lock[1]}}})
    verify_bucket(client, bucket, env, pab, lock)
    return pab


def verify_bucket(client, bucket, env, pab=True, lock=None):
    if client.get_bucket_versioning(Bucket=bucket).get('Status') != 'Enabled':
        raise ProvisionError('Bucket versioning readback failed')
    if not object_lock_enabled(client, bucket):
        raise ProvisionError('Object Lock readback failed')
    # PublicAccessBlock readback only where the target implements it; otherwise the
    # private-ACL assertion below is the guarantee (see public_access_block_supported).
    if pab and client.get_public_access_block(Bucket=bucket)['PublicAccessBlockConfiguration'] != PUBLIC_BLOCK:
        raise ProvisionError('Public access block readback failed')
    acl = client.get_bucket_acl(Bucket=bucket)
    if any(g['Grantee'].get('ID') != acl['Owner']['ID'] for g in acl['Grants']):
        raise ProvisionError('Bucket ACL is not private')
    actual = client.get_bucket_lifecycle_configuration(Bucket=bucket)['Rules']
    if any(rule not in actual for rule in lifecycle_rules(env)):
        raise ProvisionError('Bucket lifecycle readback failed')
    if lock:
        got = client.get_object_lock_configuration(Bucket=bucket)['ObjectLockConfiguration'].get('Rule', {}).get('DefaultRetention', {})
        if got.get('Mode') != lock[0] or got.get('Days') != lock[1]:
            raise ProvisionError('Object Lock default retention readback failed')


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


def probe(clients, admin, bucket, env, pab=True):
    writer, reader, retainer = (clients[r] for r in ROLES)
    key = f'postgres/{env}/exercises/_provision/{uuid.uuid4()}'
    lockkey = f'postgres/{env}/exercises/_provision/lock-{uuid.uuid4()}'
    version = writer.put_object(Bucket=bucket, Key=key, Body=b'PRA access probe',
                                ServerSideEncryption='AES256')['VersionId']
    lockver = None
    try:
        obj = reader.get_object(Bucket=bucket, Key=key)
        if obj['Body'].read() != b'PRA access probe' or obj.get('ServerSideEncryption') != 'AES256':
            raise ProvisionError('S3 probe content/encryption mismatch')
        # Writer isolation: cannot read, delete, expose (public ACL), or suspend
        # versioning. OVH has no public-access-block, so denying PutObjectAcl is what
        # prevents a runtime identity from exposing an object.
        expect_denied(writer.get_object, Bucket=bucket, Key=key)
        expect_denied(writer.delete_object, Bucket=bucket, Key=key)
        expect_denied(writer.put_object_acl, Bucket=bucket, Key=key, ACL='public-read')
        expect_denied(writer.put_bucket_versioning, Bucket=bucket, VersioningConfiguration={'Status': 'Suspended'})
        # Reader isolation: cannot write or delete.
        expect_denied(reader.put_object, Bucket=bucket, Key=key, Body=b'forbidden')
        expect_denied(reader.delete_object, Bucket=bucket, Key=key)
        # Prefix confinement holds even though the base OpenStack role is broad.
        for client in clients.values():
            expect_denied(client.list_objects_v2, Bucket=bucket, Prefix='postgres/other/')
        # Immutability is the durable protection: version deletion is absent from the
        # OVH IAM enum, so prove a governance-locked version resists deletion without
        # an explicit bypass — which no runtime identity holds.
        until = dt.datetime.now(dt.timezone.utc) + dt.timedelta(minutes=2)
        lockver = admin.put_object(Bucket=bucket, Key=lockkey, Body=b'immutable', ServerSideEncryption='AES256',
                                   ObjectLockMode='GOVERNANCE', ObjectLockRetainUntilDate=until)['VersionId']
        expect_denied(admin.delete_object, Bucket=bucket, Key=lockkey, VersionId=lockver)
        verify_bucket(reader, bucket, env, pab)
    finally:
        # No IAM verb can delete a version, so the administrator clears the probe with
        # an explicit governance bypass; routine cleanup uses the retainer's
        # current-object delete plus lifecycle expiry of noncurrent versions.
        if lockver is not None:
            admin.delete_object(Bucket=bucket, Key=lockkey, VersionId=lockver, BypassGovernanceRetention=True)
        admin.delete_object(Bucket=bucket, Key=key, VersionId=version)


def provision(api, admin, project, env, client_factory=s3):
    bucket, namespace = settings(env)
    pab = configure_bucket(admin, bucket, env)
    credentials = {r: identity(api, project, bucket, env, r) for r in ROLES}
    probe({r: client_factory(c) for r, c in credentials.items()}, admin, bucket, env, pab)
    items = []
    for role, credential in credentials.items():
        items.append({'apiVersion': 'v1', 'kind': 'Secret', 'type': 'Opaque',
                      'metadata': {'name': 'radar-pra-' + role, 'namespace': namespace},
                      'data': {k: base64.b64encode(v.encode()).decode() for k, v in
                               [('S3_ACCESS_KEY', credential['access']), ('S3_SECRET_KEY', credential['secret'])]}})
    block = ('public-access-block set' if pab else
             'public access denied by private ACL (target has no PublicAccessBlock/bucket policy; '
             'writer cannot set a public object ACL; bucket ACL re-checked hourly by freshness)')
    lock = object_lock_retention()
    lockdesc = f'Object Lock default {lock[0]} {lock[1]}d' if lock else 'Object Lock enabled (no default retention yet)'
    print(f'{bucket}: private, {block}, versioning Enabled, {lockdesc}; '
          'lifecycle daily=7d weekly=28d monthly=31d; writer denied read/delete/expose/versioning-suspend; '
          'a governance-locked version resisted deletion. Users: ' +
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
