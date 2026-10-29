import os, pathlib, hashlib, zipfile, json, tempfile, shutil, subprocess, datetime, re
device = "Samuels-MacBook-Pro.local"
source = pathlib.Path("/Users/samuelkott/Documents/Numina/NCPS-Lean4-Proofs-2026-10-09")
archive = pathlib.Path(str(source) + ".zip")
extension = pathlib.Path("/private/tmp/ncps-independent-recheck-20261011-fndn1lhh/NCPSModelClosure.lean")
lean = pathlib.Path("/private/tmp/ncps-lean4-check/elan/toolchains/leanprover--lean4---v4.22.0/bin/lean")
digest = lambda b: hashlib.sha256(b).hexdigest()
expected_archive = "62b3607544daeb524fb82ad60c7442eb9281f9cfb1862029fc716cfd5a14954e"
expected_extension = "033a23ec61cf9e0fa850907988ddf21fc18649015e7d9983524644f86f092ad8"
expected_compiler = "c89073b8a577a5914ead7b740d2ad996af1ad5ad5b4bfc2825e0bce2f01b6aa4"
def inventory():
 return {p.name: {"bytes":len(p.read_bytes()),"sha256":digest(p.read_bytes())} for p in source.iterdir() if p.is_file()}
before = inventory()
assert digest(archive.read_bytes()) == expected_archive
assert digest(extension.read_bytes()) == expected_extension
assert digest(lean.read_bytes()) == expected_compiler
scratch = pathlib.Path(tempfile.mkdtemp(prefix="ncps-model-closure-independent-", dir="/private/tmp"))
archive_checks = []
with zipfile.ZipFile(archive) as z:
 for info in z.infolist():
  if info.is_dir(): continue
  leaf = pathlib.PurePosixPath(info.filename).name
  data=z.read(info)
  assert leaf and "/" not in leaf and leaf != ".."
  (scratch/leaf).write_bytes(data)
  assert (source/leaf).read_bytes() == data
  archive_checks.append({"member":info.filename,"bytes":len(data),"sha256":digest(data),"directory_leaf_exact":True})
receipt=json.loads((scratch/"VERIFICATION_RECEIPT.json").read_text())
receipt_checks=[]
for name, stated in receipt["files"].items():
 b=(scratch/name).read_bytes()
 assert len(b)==stated["bytes"] and digest(b)==stated["sha256"]
 receipt_checks.append({"name":name,"bytes":len(b),"sha256":digest(b),"pass":True})
(scratch/"NCPSModelClosure.lean").write_bytes(extension.read_bytes())
env=os.environ.copy()
env["LEAN_PATH"]=str(scratch)
order=["NCPSCore","NCPSProtocol","NCPSCodec","NCPSRelations","NCPSState","NCPSClosure","NCPSVerification","NCPSVersion","NCPSBoundaries","NCPSAudit","NCPSUtf8","NCPSAll","NCPSModelClosure"]
compilation=[]
for module in order:
 cmd=[str(lean),"-t","0","-o",module+".olean",module+".lean"]
 run=subprocess.run(cmd,cwd=str(scratch),env=env,text=True,capture_output=True)
 compilation.append({"module":module,"command":cmd,"exit_code":run.returncode,"stdout":run.stdout,"stderr":run.stderr})
 if run.returncode:
  break
audit_cmd=[str(lean),"-t","0","NCPSFullAxiomAudit.lean"]
audit=subprocess.run(audit_cmd,cwd=str(scratch),env=env,text=True,capture_output=True)
historical_log=(scratch/"NCPSFullAxiomAudit.log").read_bytes()
historical_exact=(audit.stdout.encode()==historical_log)
extension_result=next((r for r in compilation if r["module"]=="NCPSModelClosure"),None)
after=inventory()
assert after==before
report={"schema":"numina.independent-model-closure-compiler-check.v1","checked_at":datetime.datetime.now(datetime.timezone.utc).isoformat(),"device":device,"scratch_path":str(scratch),"compiler":{"path":str(lean),"sha256":digest(lean.read_bytes()),"version":subprocess.run([str(lean),"--version"],text=True,capture_output=True).stdout.strip(),"trust_level":0},"source_archive":{"path":str(archive),"bytes":archive.stat().st_size,"sha256":digest(archive.read_bytes()),"members":archive_checks},"receipt_manifest_checks":receipt_checks,"extension":{"source_path":str(extension),"bytes":extension.stat().st_size,"sha256":digest(extension.read_bytes()),"axiom_output":extension_result["stdout"] if extension_result else None},"compilation":compilation,"base_axiom_audit":{"command":audit_cmd,"exit_code":audit.returncode,"stdout_sha256":digest(audit.stdout.encode()),"original_log_exact":historical_exact,"stdout":audit.stdout,"stderr":audit.stderr},"originals_unchanged":after==before,"all_compilation_passed":len(compilation)==len(order) and all(r["exit_code"]==0 for r in compilation),"whole_protocol_verified":False}
p=scratch/"independent-compiler-check.json"
p.write_text(json.dumps(report,indent=2)+"\n")
print(json.dumps({"report_path":str(p),"all_compilation_passed":report["all_compilation_passed"],"base_axiom_audit_exit":audit.returncode,"base_log_exact":historical_exact,"extension_axiom_output":report["extension"]["axiom_output"],"originals_unchanged":True},indent=2))
