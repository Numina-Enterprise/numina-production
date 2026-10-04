import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

test('recursive public ZIP, TAR and GZIP inspection detects nested fixtures and rejects protected source values',()=>{
 const program=String.raw`
import pathlib,json,zipfile,tarfile,gzip,io,re
values=set()
def collect(v,key=''):
 if isinstance(v,dict):
  for k,x in v.items():collect(x,k)
 elif isinstance(v,list):
  for x in v:collect(x,key)
 elif isinstance(v,str) and (re.search(r'(accountLast4|linkedAccountLast4|achRoutingNumber|routingReference|providerTransactionId|providerConfirmation|assertedConfirmation|transactionId|^confirmation$)',key,re.I) or re.match(r'^(acct|fa|finaddr)_',v)) and len(v)>4:values.add(v)
collect(json.loads(pathlib.Path('package.json').read_text()))
rules={'private-resource-identifier':r'\b(?:acct|fa|finaddr)_[A-Za-z0-9]+\b','private-bank-label':r'Savings\s+\d{4}\b','private-key':r'-----BEGIN (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----','raw-journal-requests':r'"transaction_requests"\s*:\s*\[\s*\{'}
counts={'files':0,'archives':0,'archiveEntries':0,'textFiles':0,'binaryFiles':0};findings=[]
def scan(data,name,depth=0):
 if depth>8 or len(data)>67108864:raise RuntimeError('Uninspected archive limit: '+name)
 counts['files']+=1
 if zipfile.is_zipfile(io.BytesIO(data)):
  counts['archives']+=1
  with zipfile.ZipFile(io.BytesIO(data)) as z:
   if z.testzip() is not None:raise RuntimeError('Corrupt ZIP: '+name)
   for i in z.infolist():
    if i.is_dir():continue
    if i.file_size>67108864:raise RuntimeError('Oversize ZIP member: '+name)
    counts['archiveEntries']+=1;scan(z.read(i),name+'!'+i.filename,depth+1)
  return
 try:
  archive=tarfile.open(fileobj=io.BytesIO(data))
 except tarfile.ReadError:archive=None
 if archive is not None:
  counts['archives']+=1
  with archive as t:
   for i in t:
    if i.isdir():continue
    if not i.isfile() or i.size>67108864:raise RuntimeError('Uninspected TAR member: '+name)
    counts['archiveEntries']+=1;scan(t.extractfile(i).read(),name+'!'+i.name,depth+1)
  return
 if data.startswith(b'\x1f\x8b'):
  counts['archives']+=1
  with gzip.GzipFile(fileobj=io.BytesIO(data)) as stream:expanded=stream.read(67108865)
  scan(expanded,name+'!gzip',depth+1);return
 if name.lower().endswith(('.zip','.tar','.tar.gz','.tgz','.gz','.gzip','.7z','.rar','.xz','.bz2','.apk','.aab','.jar')) or data.startswith((b'7z\xbc\xaf\x27\x1c',b'Rar!')):raise RuntimeError('Unsupported or corrupt archive: '+name)
 try:s=data.decode('utf8');counts['textFiles']+=1
 except UnicodeDecodeError:s=data.decode('latin1');counts['binaryFiles']+=1
 for label,pattern in rules.items():
  if re.search(pattern,s) or re.search(pattern,s.replace('\x00','')):findings.append({'path':name,'rule':label})
 if any(v in s or v in s.replace('\x00','') for v in values):findings.append({'path':name,'rule':'protected-source-value'})
# Prove the scanner reaches a ZIP member inside a gzipped TAR before relying on it.
zbuf=io.BytesIO()
with zipfile.ZipFile(zbuf,'w') as z:z.writestr('nested.txt','acct_SYNTHETICONLY1234')
tbuf=io.BytesIO()
with tarfile.open(fileobj=tbuf,mode='w:gz') as t:
 data=zbuf.getvalue();i=tarfile.TarInfo('nested.zip');i.size=len(data);t.addfile(i,io.BytesIO(data))
scan(tbuf.getvalue(),'fixture.tar.gz')
assert any(x['rule']=='private-resource-identifier' and '!nested.zip!nested.txt' in x['path'] for x in findings)
try:scan(b'unsupported','fixture.7z')
except RuntimeError:pass
else:raise AssertionError('Unsupported archive must fail closed')
counts={'files':0,'archives':0,'archiveEntries':0,'textFiles':0,'binaryFiles':0};findings=[]
for p in sorted(pathlib.Path('dist/client').rglob('*')):
 if p.is_file():scan(p.read_bytes(),str(p))
print(json.dumps({'counts':counts,'findings':findings,'findingCount':len(findings)}))
assert not findings,'Protected data remains in public recursive assets'
`;
 const result=spawnSync(process.env.NUMINA_PYTHON||(process.platform==='win32'?'python':'python3'),['-c',program],{cwd:fileURLToPath(new URL('../',import.meta.url)),encoding:'utf8',maxBuffer:2*1024*1024,timeout:60000});
 assert.equal(result.status,0,result.stderr||result.stdout);
 const report=JSON.parse(result.stdout);assert.equal(report.findingCount,0);assert.ok(report.counts.archives>0);assert.ok(report.counts.archiveEntries>0);
 console.log('Public recursive archive audit: '+JSON.stringify(report.counts));
});
