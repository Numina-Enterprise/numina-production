#!/usr/bin/env python3
"""Read-only multi-cloud inventory. No mutation or credential export."""
import json, subprocess, shutil, datetime, pathlib, hashlib
OUT=pathlib.Path(__file__).parent/'observations.json'
COMMANDS={
 'gcp_identity':['gcloud','auth','list','--format=json'],
 'gcp_projects':['gcloud','projects','list','--format=json'],
 'gcp_cloud_run_us_central1':['gcloud','run','services','list','--region=us-central1','--format=json'],
 'aws_identity':['aws','sts','get-caller-identity','--output','json'],
 'aws_regions':['aws','ec2','describe-regions','--output','json'],
 'azure_accounts':['az','account','list','--output','json'],
 'azure_resources':['az','resource','list','--output','json'],
 'tailscale_status':['tailscale','status','--json'],
}
def collect():
 result={'schema':'numina.topology.observation.v1','observed_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'authority':'observational_only','commands':{}}
 for name,cmd in COMMANDS.items():
  if not shutil.which(cmd[0]):result['commands'][name]={'status':'unavailable','reason':'cli_not_installed'};continue
  try:
   p=subprocess.run(cmd,capture_output=True,text=True,timeout=25)
   if p.returncode:result['commands'][name]={'status':'error','exit_code':p.returncode,'stderr_excerpt':p.stderr[:300]};continue
   data=json.loads(p.stdout)
   # redact potentially sensitive account identifiers and raw host metadata: only hashes and counts here
   result['commands'][name]={'status':'observed','sha256':hashlib.sha256(p.stdout.encode()).hexdigest(),'record_count':len(data) if isinstance(data,(list,dict)) else None}
  except Exception as e:result['commands'][name]={'status':'error','reason':type(e).__name__}
 OUT.write_text(json.dumps(result,indent=2)+'\n')
 print(OUT)
if __name__=='__main__':collect()
