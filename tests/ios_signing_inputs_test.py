import importlib.util, json, plistlib, unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parent.parent
spec=importlib.util.spec_from_file_location('ios_signer',ROOT/'scripts/sign-ios-release.py')
signer=importlib.util.module_from_spec(spec)
spec.loader.exec_module(signer)

class SigningInputs(unittest.TestCase):
    def test_historical_input_is_blocked(self):
        record=json.loads((ROOT/'docs/native-package-record-v4.json').read_text(encoding='utf-8'))
        settings=(ROOT/'mobile/ios/Configuration/Numina.xcconfig').read_text()
        with self.assertRaisesRegex(RuntimeError,'CURRENT_IOS_SOURCE_NOT_COMPILED'):
            signer.current_source_build(settings,record)
    def test_mismatched_build_is_blocked(self):
        fixture={'ios':{'currentSourceCompiled':True,'sourceBuildNumber':5,'binaryVersionCode':3,'signingInputMatchesCurrentSource':True}}
        with self.assertRaisesRegex(RuntimeError,'CURRENT_IOS_SIGNING_INPUT_MISMATCH'):
            signer.current_source_build('CURRENT_PROJECT_VERSION = 5',fixture)
    def test_unverified_input_is_blocked(self):
        fixture={'ios':{'currentSourceCompiled':True,'sourceBuildNumber':5,'binaryVersionCode':5,'signingInputMatchesCurrentSource':False}}
        with self.assertRaisesRegex(RuntimeError,'CURRENT_IOS_SIGNING_INPUT_NOT_VERIFIED'):
            signer.current_source_build('CURRENT_PROJECT_VERSION = 5',fixture)
    def test_valid_fixture_returns_source_build(self):
        fixture={'ios':{'currentSourceCompiled':True,'sourceBuildNumber':5,'binaryVersionCode':5,'signingInputMatchesCurrentSource':True}}
        self.assertEqual(signer.current_source_build('CURRENT_PROJECT_VERSION = 5',fixture),5)
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
