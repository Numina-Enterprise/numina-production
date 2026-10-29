"""Offline audit: original unittest cases and zero-argument assertion functions.
Only the pytest.raises context-manager API is adapted to unittest assertions.
This is explicitly not a pytest run; unsupported pytest APIs fail the audit.
"""
import ast, hashlib, importlib.util, inspect, json, pathlib, sys, types, unittest
root=pathlib.Path(__file__).parent.parent/'vendor'/'numina-core-v1.8'
sys.path.insert(0,str(root))
manifest=[]
for line in (root/'MANIFEST.sha256').read_text().splitlines():
    expected,name=line.split(maxsplit=1); file=root/name
    manifest.append({'file':name,'match':file.is_file() and hashlib.sha256(file.read_bytes()).hexdigest()==expected})
class Raises:
    def __init__(self,kind,match=None): self.kind,self.match=kind,match
    def __enter__(self): return self
    def __exit__(self,kind,value,tb):
        if kind is None: raise AssertionError('Expected exception '+str(self.kind))
        if not issubclass(kind,self.kind): return False
        if self.match:
            import re
            if not re.search(self.match,str(value)): raise AssertionError('Exception message mismatch')
        return True
shim=types.ModuleType('pytest');shim.raises=Raises;sys.modules['pytest']=shim
suite=unittest.TestSuite(); files=[root/'test_numina_core.py',*sorted((root/'tests').glob('test_*.py'))]
for i,file in enumerate(files):
    tree=ast.parse(file.read_text())
    for n in ast.walk(tree):
        if isinstance(n,ast.Attribute) and isinstance(n.value,ast.Name) and n.value.id=='pytest' and n.attr!='raises': raise RuntimeError('Unsupported pytest API')
    spec=importlib.util.spec_from_file_location('audit_'+str(i),file);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
    suite.addTests(unittest.defaultTestLoader.loadTestsFromModule(m))
    for name,f in inspect.getmembers(m,inspect.isfunction):
        if name.startswith('test_'):
            if inspect.signature(f).parameters: raise RuntimeError('Unsupported fixture parameters '+name)
            suite.addTest(unittest.FunctionTestCase(f,description=str(file.relative_to(root))+':'+name))
result=unittest.TextTestRunner(verbosity=1).run(suite)
report={'runner':'unittest + zero-argument functions; pytest.raises adapted, not pytest','testsRun':result.testsRun,'failures':len(result.failures),'errors':len(result.errors),'manifestFiles':len(manifest),'manifestMismatches':[x['file']for x in manifest if not x['match']],'sourceArchiveSha256':json.loads((pathlib.Path(__file__).parent.parent/'fixtures'/'core-v1.8-manifest.json').read_text())['archiveSha256']}
(pathlib.Path(__file__).parent.parent/'fixtures'/'core-audit-rerun.json').write_text(json.dumps(report,indent=2));print(json.dumps(report,indent=2));sys.exit(not result.wasSuccessful() or any('__pycache__/' not in p for p in report['manifestMismatches']))
