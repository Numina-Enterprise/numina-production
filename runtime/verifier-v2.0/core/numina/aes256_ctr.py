"""AES-256-CTR symmetric encryption for Numina.

What this module is
-------------------
A thin, explicit wrapper around AES-256 in CTR (counter) mode, using
the ``cryptography`` library already used elsewhere in this tree for
Ed25519. CTR turns AES into a stream cipher: it encrypts a 16-byte
counter block, XORs the result with the plaintext, and increments the
counter. No padding is needed, and ciphertext length equals plaintext
length.

What this module is NOT
-----------------------
- It is NOT signing, verification, or authentication. AES-256
  encrypts; Ed25519 (elsewhere in this tree) signs and verifies.
  There is no "AES signature" here, and an AES-CTR ciphertext is not
  a signature, a credential, or a proof of origin.
- It does NOT authenticate. CTR provides confidentiality only.
  Flipping a bit in the ciphertext flips the same bit in the
  recovered plaintext, with no error. If tampering must be detected,
  use AES-GCM, or encrypt-then-MAC, on top of — not instead of
  understanding — this mode. This module deliberately does not
  claim to detect tampering.
- It does NOT grant authority. Encrypting data does not make a
  transition ALLOW, DENY, or ESCALATE, and it does not substitute
  for an owner decision. Under Constitution v0.3 (ratified
  2026-10-30), ALLOW / DENY / ESCALATE are reserved to Samuel J.
  Kott alone; this module issues none of those values.
- It does NOT store, derive, or manage keys. Callers supply a
  32-byte key and a 16-byte IV, and are responsible for keeping the
  key secret and for never reusing an IV under the same key.

IV rule (the one rule that must not be broken)
--------------------------------------------
The IV (initial counter) MUST be unique for every message encrypted
under a given key. Reusing key + IV leaks the XOR of the two
plaintexts. ``seal()`` generates a fresh random IV for every call
for exactly this reason; callers using ``encrypt()`` directly must
generate and track a fresh IV themselves. The IV is not secret —
``seal()`` prepends it to the ciphertext — but it must be unique.

Key and IV sizes
----------------
- Key: exactly 32 bytes (256 bits). Anything else raises ValueError.
- IV: exactly 16 bytes. Anything else raises ValueError.
"""

from __future__ import annotations

import os

from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

KEY_SIZE = 32
IV_SIZE = 16

__all__ = [
    "KEY_SIZE",
    "IV_SIZE",
    "generate_key",
    "generate_iv",
    "encrypt",
    "decrypt",
    "seal",
    "unseal",
    "Aes256CtrEncryptor",
    "Aes256CtrDecryptor",
]


def _check_key(key: bytes) -> None:
    if not isinstance(key, (bytes, bytearray)):
        raise TypeError("key must be bytes")
    if len(key) != KEY_SIZE:
        raise ValueError(f"AES-256 key must be exactly {KEY_SIZE} bytes, got {len(key)}")


def _check_iv(iv: bytes) -> None:
    if not isinstance(iv, (bytes, bytearray)):
        raise TypeError("iv must be bytes")
    if len(iv) != IV_SIZE:
        raise ValueError(f"CTR IV must be exactly {IV_SIZE} bytes, got {len(iv)}")


def generate_key() -> bytes:
    """Generate a fresh random 32-byte AES-256 key.

    The caller must store this securely. This function does not
    store it, log it, or derive it from anything else.
    """
    return os.urandom(KEY_SIZE)


def generate_iv() -> bytes:
    """Generate a fresh random 16-byte IV. Use once per key."""
    return os.urandom(IV_SIZE)


def encrypt(key: bytes, iv: bytes, plaintext: bytes) -> bytes:
    """Encrypt ``plaintext`` with AES-256-CTR. Returns ciphertext only.

    The caller must keep ``iv`` and use it, once, for decryption.
    For a self-contained output, prefer :func:`seal`.
    """
    _check_key(key)
    _check_iv(iv)
    if not isinstance(plaintext, (bytes, bytearray)):
        raise TypeError("plaintext must be bytes")
    cipher = Cipher(algorithms.AES(bytes(key)), modes.CTR(bytes(iv)))
    encryptor = cipher.encryptor()
    return encryptor.update(bytes(plaintext)) + encryptor.finalize()


def decrypt(key: bytes, iv: bytes, ciphertext: bytes) -> bytes:
    """Decrypt AES-256-CTR ``ciphertext``. No authentication is checked.

    A wrong key or IV produces wrong plaintext silently — CTR has
    no integrity check. Do not treat successful decryption as proof
    that the ciphertext was unmodified or came from a given sender.
    """
    _check_key(key)
    _check_iv(iv)
    if not isinstance(ciphertext, (bytes, bytearray)):
        raise TypeError("ciphertext must be bytes")
    cipher = Cipher(algorithms.AES(bytes(key)), modes.CTR(bytes(iv)))
    decryptor = cipher.decryptor()
    return decryptor.update(bytes(ciphertext)) + decryptor.finalize()


def seal(key: bytes, plaintext: bytes) -> bytes:
    """Encrypt with a fresh random IV, returning ``IV || ciphertext``.

    This is the recommended entry point for stored or transmitted
    data: the IV travels with the ciphertext, and it is fresh for
    every call, so key + IV reuse cannot happen through this path
    unless the caller deliberately reuses a key across an unsafe
    number of messages (see the IV rule above).
    """
    iv = generate_iv()
    return iv + encrypt(key, iv, plaintext)


def unseal(key: bytes, sealed: bytes) -> bytes:
    """Decrypt output from :func:`seal`. ``sealed`` must be at least 16 bytes."""
    _check_key(key)
    if not isinstance(sealed, (bytes, bytearray)):
        raise TypeError("sealed must be bytes")
    sealed = bytes(sealed)
    if len(sealed) < IV_SIZE:
        raise ValueError(f"sealed data must be at least {IV_SIZE} bytes (the IV)")
    return decrypt(key, sealed[:IV_SIZE], sealed[IV_SIZE:])


class Aes256CtrEncryptor:
    """Stateful AES-256-CTR encryptor for chunked data.

    Use ``update()`` for each chunk and ``finalize()`` once at the
    end. The same key + IV must not be used for a second stream.
    """

    def __init__(self, key: bytes, iv: bytes):
        _check_key(key)
        _check_iv(iv)
        cipher = Cipher(algorithms.AES(bytes(key)), modes.CTR(bytes(iv)))
        self._encryptor = cipher.encryptor()

    def update(self, data: bytes) -> bytes:
        return self._encryptor.update(bytes(data))

    def finalize(self) -> bytes:
        return self._encryptor.finalize()


class Aes256CtrDecryptor:
    """Stateful AES-256-CTR decryptor for chunked data.

    Mirrors :class:`Aes256CtrEncryptor`. No authentication is checked.
    """

    def __init__(self, key: bytes, iv: bytes):
        _check_key(key)
        _check_iv(iv)
        cipher = Cipher(algorithms.AES(bytes(key)), modes.CTR(bytes(iv)))
        self._decryptor = cipher.decryptor()

    def update(self, data: bytes) -> bytes:
        return self._decryptor.update(bytes(data))

    def finalize(self) -> bytes:
        return self._decryptor.finalize()
