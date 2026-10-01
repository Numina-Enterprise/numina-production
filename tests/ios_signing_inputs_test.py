import base64, datetime, importlib.util, json, plistlib, tempfile, unittest
from contextlib import contextmanager
from pathlib import Path
from unittest.mock import patch
ROOT=Path(__file__).resolve().parent.parent
spec=importlib.util.spec_from_file_location('ios_signer',ROOT/'scripts/sign-ios-release.py')
signer=importlib.util.module_from_spec(spec)
spec.loader.exec_module(signer)

class SigningInputs(unittest.TestCase):
    @contextmanager
    def compiled_fixture(self, build='6', version='4.0.0', bundle='xyz.numinalabs.app',
                         missing_info=False, profile_changes=None):
        """Exercise real preflight guards without keys, signing tools, or services."""
        with tempfile.TemporaryDirectory(prefix='numina-ios-signing-test-') as directory:
            root=Path(directory)
            (root/'mobile/ios/Configuration').mkdir(parents=True)
            (root/'mobile/signing').mkdir(parents=True)
            (root/'package.json').write_text(json.dumps({'version':'4.0.0'}))
            (root/'mobile/ios/Configuration/Numina.xcconfig').write_text('CURRENT_PROJECT_VERSION = 6\n')
            policy=json.loads((ROOT/'mobile/signing/distribution-policy.json').read_text())
            (root/'mobile/signing/distribution-policy.json').write_text(json.dumps(policy))
            app=root/'compiled/Numina.app'
            app.mkdir(parents=True)
            if not missing_info:
                (app/'Info.plist').write_bytes(plistlib.dumps({
                    'CFBundleIdentifier':bundle,'CFBundleShortVersionString':version,
                    'CFBundleVersion':build,'CFBundleExecutable':'Numina'}))
            (app/'Numina').write_bytes(b'local test fixture, not an executable')
            profile={'TeamIdentifier':['TESTTEAM01'],
                     'ExpirationDate':datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None)+datetime.timedelta(days=1),
                     'ApplicationIdentifierPrefix':['TESTTEAM01'],
                     'Entitlements':{'application-identifier':'TESTTEAM01.xyz.numinalabs.app',
                                     'com.apple.developer.team-identifier':'TESTTEAM01',
                                     'get-task-allow':False}}
            profile.update(profile_changes or {})
            # Deliberately invalid fixture bytes; never obtain or import real credentials.
            fixture_base64=base64.b64encode(b'not an Apple credential').decode()
            environment={policy['apple']['teamIdEnvironmentVariable']:'TESTTEAM01',
                         policy['apple']['secrets'][0]:fixture_base64,
                         policy['apple']['secrets'][1]:'test-only-not-a-real-password',
                         policy['apple']['secrets'][2]:fixture_base64,
                         'NUMINA_IOS_COMPILED_APP':str(app),'RUNNER_TEMP':directory}
            commands=[]
            def fake_run(args, env, step):
                command=[str(arg) for arg in args]
                commands.append(command)
                if command[:4]==['security','cms','-D','-i']:
                    return plistlib.dumps(profile)
                self.fail('Preflight reached a signing/keychain operation: '+step)
            with patch.object(signer,'ROOT',root), \
                 patch.object(signer.platform,'system',return_value='Darwin'), \
                 patch.object(signer.shutil,'which',return_value='/test-only/tool'), \
                 patch.dict(signer.os.environ,environment,clear=True), \
                 patch.object(signer,'run',side_effect=fake_run):
                yield app,commands
            self.assertFalse((root/'packages/ios-signed').exists())

    def test_historical_input_is_blocked(self):
        record=json.loads((ROOT/'docs/native-package-record-v4-pre-build5.json').read_text(encoding='utf-8'))
        self.assertFalse(record['ios']['currentSourceCompiled'])
        with self.compiled_fixture(build=str(record['ios']['binaryVersionCode'])):
            with self.assertRaisesRegex(RuntimeError,'Bundle build number differs from current source'):
                signer.main()
    def test_mismatched_build_is_blocked(self):
        with self.compiled_fixture(build='7'):
            with self.assertRaisesRegex(RuntimeError,'Bundle build number differs from current source'):
                signer.main()
    def test_unverified_input_is_blocked(self):
        with self.compiled_fixture(missing_info=True) as (_,commands):
            with self.assertRaisesRegex(RuntimeError,'Freshly compiled current-source iOS app is required'):
                signer.main()
            self.assertEqual(commands,[])
    def test_valid_fixture_returns_source_build(self):
        with self.compiled_fixture():
            self.assertEqual(signer.source_build_number(),6)
    def test_published_compilation_matches_build5(self):
        record=json.loads((ROOT/'docs/native-package-record-v4.json').read_text(encoding='utf-8'))
        self.assertEqual(record['ios']['binaryVersionCode'],5)
        self.assertEqual(signer.source_build_number(),6)
        self.assertFalse(record['ios']['currentSourceCompiled'])
        self.assertFalse(record['ios']['signingInputMatchesCurrentSource'])
        self.assertFalse(record['ios']['signed'])
        self.assertFalse(record['ios']['storeSubmitted'])
        with self.compiled_fixture(build=str(record['ios']['binaryVersionCode'])):
            with self.assertRaisesRegex(RuntimeError,'Bundle build number differs from current source'):
                signer.main()
    def test_bundle_identifier_mismatch_is_blocked_before_signing(self):
        with self.compiled_fixture(bundle='other.app'):
            with self.assertRaisesRegex(RuntimeError,'Bundle identifier differs from the distribution policy'):
                signer.main()
    def test_marketing_version_mismatch_is_blocked_before_signing(self):
        with self.compiled_fixture(version='3.0.0'):
            with self.assertRaisesRegex(RuntimeError,'Bundle marketing version differs from package version'):
                signer.main()
    def test_wrong_team_profile_is_blocked_before_signing(self):
        with self.compiled_fixture(profile_changes={'TeamIdentifier':['OTHERTEAM1']}):
            with self.assertRaisesRegex(RuntimeError,'Provisioning profile belongs to another Apple team'):
                signer.main()
    def test_expired_profile_is_blocked_before_signing(self):
        with self.compiled_fixture(profile_changes={'ExpirationDate':datetime.datetime(2000,1,1)}):
            with self.assertRaisesRegex(RuntimeError,'Provisioning profile has expired'):
                signer.main()
    def test_device_distribution_profile_is_blocked_before_signing(self):
        with self.compiled_fixture(profile_changes={'ProvisionedDevices':['test-device']}):
            with self.assertRaisesRegex(RuntimeError,'requires an App Store distribution profile'):
                signer.main()
    def test_nested_code_requires_review_before_signing(self):
        with self.compiled_fixture() as (app,_):
            (app/'Frameworks').mkdir()
            with self.assertRaisesRegex(RuntimeError,'Nested code requires a separately reviewed signing order'):
                signer.main()
    def test_export_template_is_non_uploading_and_unfilled(self):
        config=plistlib.loads((ROOT/'mobile/ios/Signing/ExportOptions.plist.template').read_bytes())
        self.assertEqual(config['destination'],'export')
        self.assertFalse(config['manageAppVersionAndBuildNumber'])
        self.assertEqual(config['teamID'],'APPLE_TEAM_ID_REQUIRED')
    def test_existing_csr_is_preserved(self):
        self.assertEqual((ROOT/'mobile/signing/numina-ios-distribution.csr').read_bytes(),(ROOT/'mobile/ios/Signing/Numina-Distribution.certSigningRequest').read_bytes())
    def test_provider_fields_remain_unverified(self):
        data=json.loads((ROOT/'mobile/ios/Signing/signing-inputs.json').read_text())
        for key in ['appleTeamId','appStoreConnectAppId','signedIPA','appStoreSubmission']:
            self.assertIsNone(data[key])
        self.assertFalse(data['csr']['appleIssuanceVerified'])

if __name__=='__main__':
    unittest.main()
