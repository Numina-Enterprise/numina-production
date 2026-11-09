# Historical embedded repository reference

The former `consolidated-evidence/your_files` Git entry was an orphaned
gitlink, not a configured submodule. It pointed to commit
`365c418d38d34c5765bd986250ff666541d9512e`, and its captured Git
configuration has no remote. The orphan caused GitHub checkout's credential
cleanup to fail.

The unmodified historical archive
`consolidated-evidence/numina-muse-workspace-backup-2026-10-20.tar.gz`
retains that commit object. Its SHA-256 is
`daa4dd9f18fcd740450173fcf924ffa9031772a233f9ec7b78b62a40d98ab8a9`.
The gitlink is removed from the active tree; the archive and the original
commit reference in repository history are preserved. This record does not
assert that the archive was restored or that it is a production dependency.
