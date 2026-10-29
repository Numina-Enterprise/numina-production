"""Private subprocess bridge to Windows DPAPI and file ACL APIs. No shell/policy changes."""
import argparse
import base64
import ctypes as c
from ctypes import wintypes as w
import json
import os
from pathlib import Path
import sys


def run():
    if sys.platform != 'win32':
        raise ValueError('Windows required')
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=['Initialize', 'Assert', 'Protect', 'Unprotect'])
    parser.add_argument('--directory')
    parser.add_argument('--owner-account')
    parser.add_argument('--creator-sid')
    args = parser.parse_args()
    adv = c.WinDLL('advapi32', use_last_error=True)
    kernel = c.WinDLL('kernel32', use_last_error=True)
    crypt = c.WinDLL('crypt32', use_last_error=True)
    ptr = c.c_void_p
    kernel.LocalFree.argtypes = [ptr]
    kernel.LocalFree.restype = ptr
    adv.LookupAccountNameW.argtypes = [w.LPCWSTR, w.LPCWSTR, ptr, c.POINTER(w.DWORD), w.LPWSTR, c.POINTER(w.DWORD), c.POINTER(w.DWORD)]
    adv.LookupAccountNameW.restype = w.BOOL
    adv.ConvertSidToStringSidW.argtypes = [ptr, c.POINTER(ptr)]
    adv.ConvertSidToStringSidW.restype = w.BOOL
    adv.ConvertStringSecurityDescriptorToSecurityDescriptorW.argtypes = [w.LPCWSTR, w.DWORD, c.POINTER(ptr), c.POINTER(w.DWORD)]
    adv.ConvertStringSecurityDescriptorToSecurityDescriptorW.restype = w.BOOL
    adv.GetSecurityDescriptorDacl.argtypes = [ptr, c.POINTER(w.BOOL), c.POINTER(ptr), c.POINTER(w.BOOL)]
    adv.GetSecurityDescriptorDacl.restype = w.BOOL
    adv.SetNamedSecurityInfoW.argtypes = [w.LPWSTR, w.DWORD, w.DWORD, ptr, ptr, ptr, ptr]
    adv.SetNamedSecurityInfoW.restype = w.DWORD
    adv.GetNamedSecurityInfoW.argtypes = [w.LPWSTR, w.DWORD, w.DWORD, ptr, ptr, c.POINTER(ptr), ptr, c.POINTER(ptr)]
    adv.GetNamedSecurityInfoW.restype = w.DWORD
    adv.GetSecurityDescriptorControl.argtypes = [ptr, c.POINTER(w.WORD), c.POINTER(w.DWORD)]
    adv.GetSecurityDescriptorControl.restype = w.BOOL
    adv.GetAce.argtypes = [ptr, w.DWORD, c.POINTER(ptr)]
    adv.GetAce.restype = w.BOOL

    def require(ok):
        if not ok:
            raise ValueError('Windows operation failed')

    def sid_text(address):
        value = ptr()
        require(adv.ConvertSidToStringSidW(address, c.byref(value)))
        try:
            return c.wstring_at(value)
        finally:
            kernel.LocalFree(value)

    def account_sid(account):
        sid_size, domain_size, use = w.DWORD(), w.DWORD(), w.DWORD()
        adv.LookupAccountNameW(None, account, None, c.byref(sid_size), None, c.byref(domain_size), c.byref(use))
        require(sid_size.value > 0)
        sid = c.create_string_buffer(sid_size.value)
        domain = c.create_unicode_buffer(max(1, domain_size.value))
        require(adv.LookupAccountNameW(None, account, sid, c.byref(sid_size), domain, c.byref(domain_size), c.byref(use)))
        return sid_text(sid)

    class Blob(c.Structure):
        _fields_ = [('length', w.DWORD), ('data', ptr)]

    if args.action in ('Protect', 'Unprotect'):
        raw = base64.b64decode(sys.stdin.buffer.read(16384).strip(), validate=True)
        if args.action == 'Protect' and len(raw) != 32:
            raise ValueError('Invalid password length')
        source_buffer = c.create_string_buffer(raw)
        entropy_buffer = c.create_string_buffer(b'numina.nusd.local-wallet-password.v1')
        source = Blob(len(raw), c.cast(source_buffer, ptr))
        entropy = Blob(len(entropy_buffer) - 1, c.cast(entropy_buffer, ptr))
        output = Blob()
        try:
            if args.action == 'Protect':
                crypt.CryptProtectData.argtypes = [c.POINTER(Blob), w.LPCWSTR, c.POINTER(Blob), ptr, ptr, w.DWORD, c.POINTER(Blob)]
                crypt.CryptProtectData.restype = w.BOOL
                require(crypt.CryptProtectData(c.byref(source), 'Numina local wallet password', c.byref(entropy), None, None, 5, c.byref(output)))
            else:
                crypt.CryptUnprotectData.argtypes = [c.POINTER(Blob), ptr, c.POINTER(Blob), ptr, ptr, w.DWORD, c.POINTER(Blob)]
                crypt.CryptUnprotectData.restype = w.BOOL
                require(crypt.CryptUnprotectData(c.byref(source), None, c.byref(entropy), None, None, 1, c.byref(output)))
                require(output.length == 32)
            sys.stdout.write(base64.b64encode(c.string_at(output.data, output.length)).decode('ascii'))
        finally:
            c.memset(source_buffer, 0, len(source_buffer))
            if output.data:
                c.memset(output.data, 0, output.length)
                kernel.LocalFree(output.data)
        return

    owner_sid = account_sid(args.owner_account)
    # Resolve actual process token identity; environment user names are not trusted.
    adv.OpenProcessToken.argtypes = [w.HANDLE, w.DWORD, c.POINTER(w.HANDLE)]
    adv.OpenProcessToken.restype = w.BOOL
    adv.GetTokenInformation.argtypes = [w.HANDLE, c.c_int, ptr, w.DWORD, c.POINTER(w.DWORD)]
    adv.GetTokenInformation.restype = w.BOOL
    kernel.GetCurrentProcess.restype = w.HANDLE
    kernel.CloseHandle.argtypes = [w.HANDLE]
    token = w.HANDLE()
    require(adv.OpenProcessToken(kernel.GetCurrentProcess(), 8, c.byref(token)))
    try:
        token_size = w.DWORD()
        adv.GetTokenInformation(token, 1, None, 0, c.byref(token_size))
        token_buffer = c.create_string_buffer(token_size.value)
        require(adv.GetTokenInformation(token, 1, token_buffer, token_size, c.byref(token_size)))
        executor_sid = sid_text(ptr.from_buffer(token_buffer))
    finally:
        kernel.CloseHandle(token)

    directory = Path(args.directory).absolute()
    creator_sid = executor_sid if args.action == 'Initialize' else args.creator_sid
    require(creator_sid and creator_sid.startswith('S-1-'))
    allowed = set([owner_sid, creator_sid, 'S-1-5-18'])
    if args.action == 'Initialize':
        # A fresh directory gets its private DACL atomically at creation.
        require(not directory.exists())
        sddl = 'D:P' + ''.join('(A;OICI;FA;;;' + sid + ')' for sid in sorted(allowed))
        descriptor = ptr()
        require(adv.ConvertStringSecurityDescriptorToSecurityDescriptorW(sddl, 1, c.byref(descriptor), None))
        class SecurityAttributes(c.Structure):
            _fields_ = [('length', w.DWORD), ('descriptor', ptr), ('inherit', w.BOOL)]
        attributes = SecurityAttributes(c.sizeof(SecurityAttributes), descriptor, False)
        kernel.CreateDirectoryW.argtypes = [w.LPCWSTR, c.POINTER(SecurityAttributes)]
        kernel.CreateDirectoryW.restype = w.BOOL
        try:
            require(kernel.CreateDirectoryW(str(directory), c.byref(attributes)))
        finally:
            kernel.LocalFree(descriptor)

    def check_acl(target, is_directory):
        stat = target.lstat()
        require(not (stat.st_file_attributes & 0x400))  # No reparse points.
        require(target.is_dir() if is_directory else target.is_file())
        dacl, descriptor = ptr(), ptr()
        require(adv.GetNamedSecurityInfoW(str(target), 1, 4, None, None, c.byref(dacl), None, c.byref(descriptor)) == 0)
        try:
            require(dacl.value is not None)
            control, revision = w.WORD(), w.DWORD()
            require(adv.GetSecurityDescriptorControl(descriptor, c.byref(control), c.byref(revision)))
            if is_directory:
                require(control.value & 0x1000)  # SE_DACL_PROTECTED.
            # ACL header: revision byte, padding byte, size WORD, AceCount WORD.
            count = c.c_ushort.from_address(dacl.value + 4).value
            seen = set()
            for index in range(count):
                ace = ptr()
                require(adv.GetAce(dacl, index, c.byref(ace)))
                ace_type = c.c_ubyte.from_address(ace.value).value
                flags = c.c_ubyte.from_address(ace.value + 1).value
                mask = w.DWORD.from_address(ace.value + 4).value
                sid = sid_text(ptr(ace.value + 8))
                require(ace_type == 0 and mask == 0x1F01FF and sid in allowed)
                require(not (flags & 8))  # Not INHERIT_ONLY.
                if is_directory:
                    require(flags == 3)  # Object/container inheritance, explicit.
                else:
                    require(flags in (0, 16))  # Explicit or inherited file grant.
                seen.add(sid)
            require(seen == allowed)
        finally:
            kernel.LocalFree(descriptor)

    check_acl(directory, True)
    private_file = directory / 'role-wallets.private.json'
    if private_file.exists():
        require(private_file.stat().st_nlink == 1)
        check_acl(private_file, False)
    print(json.dumps({'ownerSid': owner_sid, 'creatorSid': creator_sid, 'allowedSids': sorted(allowed),
                      'inheritanceDisabled': True, 'privateFileAclChecked': private_file.exists(),
                      'protection': 'DPAPI_LOCAL_MACHINE_AND_NTFS_ACL'}))


if __name__ == '__main__':
    try:
        run()
    except Exception:
        print('Windows wallet custody operation failed; no secret details were logged.', file=sys.stderr)
        sys.exit(1)
