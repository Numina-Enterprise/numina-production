import unittest
from types import SimpleNamespace
from illumos_adapter import COMMANDS,collect
class TestIllumosAdapter(unittest.TestCase):
    def test_all_commands_are_read_only(self):
        forbidden={'create','destroy','set','enable','disable','reboot','install','attach','detach','start','stop','modify'}
        for command in COMMANDS.values(): self.assertFalse(forbidden.intersection(command))
    def test_observation_not_authorization(self):
        def fake(cmd,**kw):return SimpleNamespace(stdout='sample\n',returncode=0)
        x=collect(fake)
        self.assertFalse(x['deployment_authorized']);self.assertFalse(x['runtime_verified'])
        self.assertEqual(x['commands']['zones']['status'],'observed')
    def test_missing_commands_block(self):
        def missing(cmd,**kw):raise FileNotFoundError()
        x=collect(missing)
        self.assertEqual(x['platform_class'],'unverified')
        self.assertTrue(all(x['commands'][k]['status']=='unavailable' for k in COMMANDS))
if __name__=='__main__':unittest.main()
