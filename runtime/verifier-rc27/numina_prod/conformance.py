from __future__ import annotations
import json,re,subprocess,sys,time
from dataclasses import asdict,dataclass
from pathlib import Path
from .frozen import ROOT,verify_frozen_core
from . import CORE_VERSION,PRODUCTION_VERSION

@dataclass(frozen=True)
class ConformanceResult:
    core_version:str
    production_version:str
    frozen_core_valid:bool
    frozen_manifest_root:str
    passing_tests:int
    return_code:int
    duration_ms:int
    captured_at:int
    command:tuple[str,...]

    @property
    def valid(self):
        return self.frozen_core_valid and self.return_code==0 and self.passing_tests>=309


def run_core_conformance(timeout:int=120)->ConformanceResult:
    frozen=verify_frozen_core()
    cmd=(sys.executable,"-m","pytest","-q","test_numina_core.py","tests")
    start=time.monotonic()
    p=subprocess.run(cmd,cwd=ROOT,text=True,capture_output=True,timeout=timeout)
    duration=int((time.monotonic()-start)*1000)
    combined=(p.stdout or "")+"\n"+(p.stderr or "")
    m=re.search(r"(\d+) passed",combined)
    passed=int(m.group(1)) if m else 0
    return ConformanceResult(CORE_VERSION,PRODUCTION_VERSION,frozen.valid,frozen.manifest_root,passed,p.returncode,duration,int(time.time()),cmd)


def write_result(path:Path)->ConformanceResult:
    r=run_core_conformance()
    path.parent.mkdir(parents=True,exist_ok=True)
    path.write_text(json.dumps({**asdict(r),"valid":r.valid},indent=2,sort_keys=True)+"\n")
    return r


def load_result(path:Path|None=None)->dict:
    p=path or ROOT/"artifacts/core-conformance.json"
    if not p.exists(): return {"valid":False,"reason":"CONFORMANCE_ARTIFACT_MISSING"}
    return json.loads(p.read_text())


def main():
    out=ROOT/"artifacts/core-conformance.json"
    r=write_result(out)
    print(out)
    print(json.dumps({**asdict(r),"valid":r.valid},indent=2,default=list))
    raise SystemExit(0 if r.valid else 1)
if __name__=="__main__": main()
