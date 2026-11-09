#!/usr/bin/env python3
"""Read-only illumos/SunOS host evidence adapter. No privilege escalation or mutations."""
import argparse, datetime, hashlib, json, pathlib, subprocess

COMMANDS = {
    'kernel': ['uname', '-a'],
    'release': ['uname', '-r'],
    'platform': ['uname', '-s'],
    'zones': ['zoneadm', 'list', '-cp'],
    'zfs_datasets': ['zfs', 'list', '-H', '-o', 'name,used,avail,mountpoint'],
    'zpool_health': ['zpool', 'list', '-H', '-o', 'name,health'],
    'smf_services': ['svcs', '-H', '-o', 'fmri,state'],
    'network_links': ['dladm', 'show-link', '-p', '-o', 'link,class,state'],
    'faults': ['fmadm', 'faulty'],
}
# DTrace capability is recorded only by executable discovery; never run probes.

def collect(runner=subprocess.run):
    out={'schema':'numina.illumos.host-observation.v1','authority':'observational_only',
         'observed_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),
         'commands':{},'runtime_verified':False,'deployment_authorized':False}
    for name,cmd in COMMANDS.items():
        try:
            p=runner(cmd, capture_output=True, text=True, timeout=12, check=False)
            raw=p.stdout or ''
            out['commands'][name]={'status':'observed' if p.returncode==0 else 'error',
                'returncode':p.returncode,'sha256':hashlib.sha256(raw.encode()).hexdigest() if p.returncode==0 else None,
                'line_count':len(raw.splitlines()) if p.returncode==0 else 0}
        except (OSError,subprocess.TimeoutExpired):
            out['commands'][name]={'status':'unavailable'}
    out['platform_class']='illumos_or_sunos_candidate' if out['commands']['platform']['status']=='observed' else 'unverified'
    # Successful execution alone is not evidence of an illumos distribution or signed deployment.
    return out

if __name__=='__main__':
    ap=argparse.ArgumentParser();ap.add_argument('--out',required=True);a=ap.parse_args()
    report=collect();pathlib.Path(a.out).write_text(json.dumps(report,indent=2,sort_keys=True)+'\n')
    print('Observation complete; platform and deployment remain unverified')
