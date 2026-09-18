"""Offline provisioning contract tests. No cloud, cluster or real credentials."""
import contextlib
import copy
import fnmatch
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import Mock, patch

from botocore.exceptions import ClientError

ROOT = Path('/repo')
spec = importlib.util.spec_from_file_location('provision', ROOT / 'deploy/ci/backup-provision.py')
p = importlib.util.module_from_spec(spec)
spec.loader.exec_module(p)


def error(code):
    return ClientError({'Error': {'Code': code}}, 'offline-test')


def allowed(policy, action, resource, prefix=''):
    """Evaluate the supported IAM subset, with a hostile inherited full allow."""
    def matches(patterns, value):
        return any(fnmatch.fnmatchcase(value, pat) for pat in
                   (patterns if isinstance(patterns, list) else [patterns]))
    for st in policy['Statement']:
        applies = (matches(st['Action'], action) if 'Action' in st else not matches(st['NotAction'], action))
        applies &= (matches(st['Resource'], resource) if 'Resource' in st else not matches(st['NotResource'], resource))
        for operator, conditions in st.get('Condition', {}).items():
            for key, patterns in conditions.items():
                assert key == 's3:prefix'
                found = matches(patterns, prefix)
                applies &= found if operator == 'StringLike' else not found
        if applies and st['Effect'] == 'Deny':
            return False
    return True


class Api:
    def __init__(self):
        self.users = []
        self.policies = {}
        self.keys = {}
        self.calls = []

    def request(self, method, path, body=None):
        self.calls.append((method, path))
        if path.endswith('/user'):
            if method == 'GET':
                return copy.deepcopy(self.users)
            user = {'id': len(self.users) + 1, 'description': body['description'],
                    'roles': [{'name': role} for role in body['roles']]}
            self.users.append(user)
            return copy.deepcopy(user)
        uid = path.split('/user/')[1].split('/')[0]
        if path.endswith('/policy'):
            if method == 'POST':
                self.policies[uid] = body
            return self.policies[uid]
        if path.endswith('/secret'):
            return {'secret': self.keys[uid]['secret']}
        if path.endswith('/s3Credentials'):
            if method == 'GET':
                return [{'access': self.keys[uid]['access']}] if uid in self.keys else []
            self.keys[uid] = {'access': 'synthetic-access-' + uid, 'secret': 'synthetic-secret-' + uid}
            return self.keys[uid]
        raise AssertionError('Unexpected API call')


class Bucket:
    def __init__(self):
        self.exists = False
        self.creates = 0
        self.rules = []
        self.block = {}
        self.versioning = {}
        self.object_lock = False
        self.lock_config = None

    def head_bucket(self, **kw):
        if not self.exists:
            raise error('404')

    def create_bucket(self, **kw):
        assert kw['ACL'] == 'private'
        self.exists = True
        self.creates += 1
        if kw.get('ObjectLockEnabledForBucket'):
            self.object_lock = True

    def get_object_lock_configuration(self, **kw):
        if not self.object_lock:
            raise error('ObjectLockConfigurationNotFoundError')
        cfg = {'ObjectLockEnabled': 'Enabled'}
        if self.lock_config:
            cfg['Rule'] = self.lock_config
        return {'ObjectLockConfiguration': cfg}

    def put_object_lock_configuration(self, **kw):
        self.lock_config = kw['ObjectLockConfiguration']['Rule']

    def put_public_access_block(self, **kw):
        self.block = kw['PublicAccessBlockConfiguration']

    def get_public_access_block(self, **kw):
        return {'PublicAccessBlockConfiguration': self.block}

    def put_bucket_acl(self, **kw):
        assert kw['ACL'] == 'private'

    def get_bucket_acl(self, **kw):
        return {'Owner': {'ID': 'owner'}, 'Grants': [{'Grantee': {'ID': 'owner'}}]}

    def put_bucket_versioning(self, **kw):
        self.versioning = kw['VersioningConfiguration']

    def get_bucket_versioning(self, **kw):
        return self.versioning

    def get_bucket_lifecycle_configuration(self, **kw):
        return {'Rules': self.rules}

    def put_bucket_lifecycle_configuration(self, **kw):
        self.rules = kw['LifecycleConfiguration']['Rules']


class ProvisionTests(unittest.TestCase):
    def test_shell_pipes_secrets_only_to_server_side_apply_and_hides_error_bodies(self):
        with tempfile.TemporaryDirectory() as directory:
            # Executable doubles only: the test container has --network none.
            folder = Path(directory)
            docker = folder / 'docker'
            docker.write_text('#!/bin/bash\n'
                              'if [[ $1 == image ]]; then exit 0; fi\n'
                              'echo "{\\"synthetic-secret\\":\\"pipe-only\\"}"\n')
            kubectl = folder / 'kubectl'
            kubectl.write_text('#!/bin/bash\n'
                               'case $1 in\n'
                               'config) echo https://hlhedx.c1.bhs5.k8s.ovh.net;;\n'
                               'get|auth) exit 0;;\n'
                               'apply)\n'
                               ' [[ "$*" == "apply --server-side --field-manager=radar-pra-provision -f -" ]] || exit 5\n'
                               ' read -r payload\n'
                               ' [[ $payload == *pipe-only* ]] || exit 6\n'
                               ' if [[ ${FAIL_APPLY:-} == 1 ]]; then echo "$payload" >&2; exit 1; fi;;\n'
                               '*) exit 7;;\n'
                               'esac\n')
            docker.chmod(0o755)
            kubectl.chmod(0o755)
            env = {'PATH': directory, 'PRA_PROVISION_GO': '1', 'BACKUP_ENV': 'preprod',
                   **{name: 'synthetic' for name in ('OVH_APPLICATION_KEY', 'OVH_APPLICATION_SECRET',
                      'OVH_CONSUMER_KEY', 'OVH_PROJECT_ID', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'KUBECONFIG')}}
            for failure in ('0', '1'):
                result = subprocess.run(['/bin/bash', str(ROOT / 'deploy/ci/backup-provision.sh'), 'image'],
                                        env={**env, 'FAIL_APPLY': failure}, capture_output=True, text=True)
                self.assertEqual(result.returncode, int(failure), result.stderr)
                self.assertNotIn('pipe-only', result.stdout + result.stderr)
                self.assertEqual('three S3 Secrets applied' in result.stdout, failure == '0')

    def test_shell_guards_stop_before_any_external_command(self):
        for env, message in [({}, 'PRA_PROVISION_GO'),
                             ({'PRA_PROVISION_GO': '1'}, 'BACKUP_ENV'),
                             ({'PRA_PROVISION_GO': '1', 'BACKUP_ENV': 'production'}, 'PRA_PRODUCTION_GO')]:
            result = subprocess.run(['/bin/bash', str(ROOT / 'deploy/ci/backup-provision.sh'), 'unused'],
                                    env={**env, 'PATH': '/nonexistent'}, capture_output=True, text=True)
            self.assertEqual(result.returncode, 2)
            self.assertIn(message, result.stderr)
            self.assertEqual(result.stdout, '')

    def test_python_guards_stop_before_api_or_s3(self):
        for env in ({}, {'PRA_PROVISION_GO': '1'}):
            with patch.dict(os.environ, env, clear=True), patch.object(p, 'Ovh') as api, patch.object(p, 's3') as s3:
                with self.assertRaises(p.ProvisionError):
                    p.main()
                api.assert_not_called()
                s3.assert_not_called()

    def test_replay_reuses_bucket_users_credentials_and_secret_payload(self):
        api, bucket = Api(), Bucket()
        with patch.object(p, 'probe') as probe, contextlib.redirect_stderr(io.StringIO()) as log:
            first = p.provision(api, bucket, 'project', 'preprod', client_factory=Mock())
            second = p.provision(api, bucket, 'project', 'preprod', client_factory=Mock())
        self.assertEqual(first, second)
        self.assertEqual(bucket.creates, 1)
        self.assertEqual(len(api.users), 3)
        self.assertEqual(len(api.keys), 3)
        self.assertEqual(probe.call_count, 2)
        self.assertEqual(sum(m == 'POST' and path.endswith('/s3Credentials') for m, path in api.calls), 3)
        self.assertEqual(len(first['items']), 3)
        self.assertNotIn('synthetic-', log.getvalue())

    def test_interrupted_apply_recovers_without_a_new_key(self):
        api = Api()
        first = p.identity(api, 'project', 'bucket', 'preprod', 'writer')
        # No cluster secret exists: the prior pipe/apply was interrupted.
        second = p.identity(api, 'project', 'bucket', 'preprod', 'writer')
        self.assertEqual(first, second)
        self.assertEqual(len(api.keys), 1)

    def test_duplicate_users_and_unexpected_roles_are_not_adopted(self):
        api = Api()
        p.identity(api, 'project', 'bucket', 'preprod', 'writer')
        api.users.append(copy.deepcopy(api.users[0]))
        with self.assertRaises(p.ProvisionError):
            p.identity(api, 'project', 'bucket', 'preprod', 'writer')
        api.users.pop()
        api.users[0]['roles'] = [{'name': 'administrator'}]
        with self.assertRaises(p.ProvisionError):
            p.identity(api, 'project', 'bucket', 'preprod', 'writer')

    def test_policies_deny_forbidden_rights_with_explicit_denies(self):
        # OVH subset: no NotAction/NotResource, so each role's forbidden recognized
        # verbs are denied EXPLICITLY. Verbs absent from the enum (e.g.
        # DeleteObjectVersion) are contained by OVH default-deny, verified live, not here.
        granted = {'writer': ['s3:PutObject'], 'reader': ['s3:GetObject'],
                   'retainer': ['s3:GetObject', 's3:DeleteObject']}
        for env in ('preprod', 'production'):
            bucket, _ = p.settings(env)
            arn = 'arn:aws:s3:::' + bucket
            obj = arn + f'/postgres/{env}/sets/example'
            for role in p.ROLES:
                pol = p.policy(role, bucket, env)
                forbidden = [a for a in p.DANGER_ACTIONS if a not in granted[role]]
                for action in forbidden:
                    self.assertFalse(allowed(pol, action, obj), (role, action, 'obj'))
                    self.assertFalse(allowed(pol, action, arn), (role, action, 'bucket'))
                for action in granted[role]:
                    self.assertTrue(allowed(pol, action, obj), (role, action))
                # No runtime identity may expose an object or suspend versioning.
                self.assertFalse(allowed(pol, 's3:PutObjectAcl', obj))
                self.assertFalse(allowed(pol, 's3:PutBucketVersioning', arn))
                # ListBucket is confined to the prefix by condition.
                self.assertTrue(allowed(pol, 's3:ListBucket', arn, f'postgres/{env}/sets/'))
                for prefix in ('', 'postgres/', 'postgres/other/'):
                    self.assertFalse(allowed(pol, 's3:ListBucket', arn, prefix))

    def test_policy_uses_only_ovh_supported_shape(self):
        for env in ('preprod', 'production'):
            bucket, _ = p.settings(env)
            for role in p.ROLES:
                for st in p.policy(role, bucket, env)['Statement']:
                    self.assertLessEqual(set(st), {'Sid', 'Effect', 'Action', 'Resource', 'Condition'}, (role, st))
                    self.assertIn(st['Effect'], ('Allow', 'Deny'))
                    for act in (st['Action'] if isinstance(st['Action'], list) else [st['Action']]):
                        self.assertIn(act, p.OVH_POLICY_ACTIONS, (role, act))

    def test_lifecycle_scopes_7_4_1_without_expiring_complete_sets(self):
        rules = p.lifecycle_rules('preprod')
        expiry = {r['Filter']['Prefix']: r.get('Expiration', {}).get('Days') for r in rules}
        for tier, days in [('daily', 7), ('weekly', 28), ('monthly', 31)]:
            self.assertEqual(expiry['postgres/preprod/' + tier + '/'], days)
        self.assertIsNone(expiry['postgres/preprod/'])
        self.assertEqual(rules[0]['AbortIncompleteMultipartUpload']['DaysAfterInitiation'], 1)
        self.assertFalse(any('/sets/' in r['Filter']['Prefix'] for r in rules))

    def test_unknown_enabled_lifecycle_is_not_overwritten(self):
        bucket = Bucket()
        bucket.rules = [{'ID': 'unrelated', 'Status': 'Enabled'}]
        with self.assertRaises(p.ProvisionError):
            p.configure_bucket(bucket, 'bucket', 'preprod')
        self.assertEqual(bucket.rules, [{'ID': 'unrelated', 'Status': 'Enabled'}])

    def test_bucket_forbidden_is_not_mistaken_for_absent(self):
        bucket = Bucket()
        bucket.head_bucket = Mock(side_effect=error('403'))
        with self.assertRaises(ClientError):
            p.configure_bucket(bucket, 'bucket', 'preprod')
        self.assertEqual(bucket.creates, 0)

    def test_live_probe_asserts_writer_isolation_and_locked_version_resists_deletion(self):
        clients = {r: Mock() for r in p.ROLES}
        admin = Mock()
        clients['writer'].put_object.return_value = {'VersionId': 'v'}
        clients['reader'].get_object.return_value = {'Body': io.BytesIO(b'PRA access probe'),
                                                     'ServerSideEncryption': 'AES256'}
        admin.put_object.return_value = {'VersionId': 'lv'}
        for role, op in [('writer', 'get_object'), ('writer', 'delete_object'), ('writer', 'put_object_acl'),
                         ('writer', 'put_bucket_versioning'), ('reader', 'put_object'), ('reader', 'delete_object')]:
            getattr(clients[role], op).side_effect = error('AccessDenied')
        for client in clients.values():
            client.list_objects_v2.side_effect = error('AccessDenied')
        # governance-locked version: delete denied, then bypass cleanup, then probe cleanup
        admin.delete_object.side_effect = [error('AccessDenied'), None, None]
        with patch.object(p, 'verify_bucket') as verify:
            p.probe(clients, admin, 'bucket', 'preprod')
        clients['writer'].get_object.assert_called_once()
        clients['writer'].put_object_acl.assert_called_once()
        clients['writer'].put_bucket_versioning.assert_called_once()
        self.assertEqual(admin.put_object.call_args.kwargs['ObjectLockMode'], 'GOVERNANCE')
        self.assertEqual(admin.delete_object.call_count, 3)  # denied + bypass cleanup + probe cleanup
        self.assertTrue(admin.delete_object.call_args_list[1].kwargs.get('BypassGovernanceRetention'))
        verify.assert_called_once_with(clients['reader'], 'bucket', 'preprod', True)

    def test_public_access_block_unsupported_falls_back_to_private_acl(self):
        # OVH BHS returns 501 for (Put/Get)PublicAccessBlock: configure must not fail,
        # the readback must be skipped, and the private-ACL guarantee must remain.
        bucket = Bucket()
        bucket.put_public_access_block = Mock(side_effect=error('NotImplemented'))
        bucket.get_public_access_block = Mock(side_effect=error('NotImplemented'))
        self.assertFalse(p.configure_bucket(bucket, 'bucket', 'preprod'))
        self.assertTrue(bucket.exists)
        self.assertEqual(bucket.versioning, {'Status': 'Enabled'})

    def test_public_access_block_supported_is_applied_and_verified(self):
        bucket = Bucket()
        self.assertTrue(p.configure_bucket(bucket, 'bucket', 'preprod'))
        self.assertEqual(bucket.block, p.PUBLIC_BLOCK)

    def test_public_access_block_non_501_error_is_not_tolerated(self):
        bucket = Bucket()
        bucket.put_public_access_block = Mock(side_effect=error('AccessDenied'))
        with self.assertRaises(ClientError):
            p.configure_bucket(bucket, 'bucket', 'preprod')

    def test_verify_skips_block_readback_but_still_requires_private_acl(self):
        bucket = Bucket()
        bucket.exists, bucket.versioning, bucket.rules = True, {'Status': 'Enabled'}, p.lifecycle_rules('preprod')
        bucket.object_lock = True
        bucket.get_public_access_block = Mock(side_effect=AssertionError('must not read block when unsupported'))
        p.verify_bucket(bucket, 'bucket', 'preprod', pab=False)  # private ACL default: passes
        bucket.get_bucket_acl = lambda **kw: {'Owner': {'ID': 'owner'}, 'Grants': [
            {'Grantee': {'ID': 'owner'}}, {'Grantee': {'URI': 'http://acs.amazonaws.com/groups/global/AllUsers'}}]}
        with self.assertRaises(p.ProvisionError):
            p.verify_bucket(bucket, 'bucket', 'preprod', pab=False)

    def test_network_error_or_other_403_is_not_a_successful_denial(self):
        for exception in (OSError('transport'), error('InvalidAccessKeyId'), error('SignatureDoesNotMatch')):
            with self.assertRaises(type(exception)):
                p.expect_denied(Mock(side_effect=exception))
        with self.assertRaises(p.ProvisionError):
            p.expect_denied(Mock())


if __name__ == '__main__':
    unittest.main(verbosity=2)
