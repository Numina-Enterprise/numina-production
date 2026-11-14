import os
import unittest

from numina.aes256_ctr import (
    IV_SIZE,
    KEY_SIZE,
    Aes256CtrDecryptor,
    Aes256CtrEncryptor,
    decrypt,
    encrypt,
    generate_iv,
    generate_key,
    seal,
    unseal,
)


class Aes256CtrTests(unittest.TestCase):
    def test_roundtrip(self):
        key = generate_key()
        iv = generate_iv()
        plaintext = b"Numina AES-256-CTR test"
        self.assertEqual(decrypt(key, iv, encrypt(key, iv, plaintext)), plaintext)

    def test_length_preserved_no_padding(self):
        key = generate_key()
        iv = generate_iv()
        for n in (0, 1, 15, 16, 17, 100, 1000):
            data = os.urandom(n)
            self.assertEqual(len(encrypt(key, iv, data)), n)

    def test_different_iv_different_ciphertext(self):
        key = generate_key()
        plaintext = b"same plaintext"
        c1 = encrypt(key, generate_iv(), plaintext)
        c2 = encrypt(key, generate_iv(), plaintext)
        self.assertNotEqual(c1, c2)

    def test_same_key_iv_is_deterministic(self):
        key = generate_key()
        iv = generate_iv()
        plaintext = b"deterministic under same key+iv"
        self.assertEqual(encrypt(key, iv, plaintext), encrypt(key, iv, plaintext))

    def test_wrong_key_or_iv_does_not_recover(self):
        key = generate_key()
        iv = generate_iv()
        plaintext = b"secret"
        ciphertext = encrypt(key, iv, plaintext)
        self.assertNotEqual(decrypt(generate_key(), iv, ciphertext), plaintext)
        self.assertNotEqual(decrypt(key, generate_iv(), ciphertext), plaintext)

    def test_invalid_key_and_iv_lengths_raise(self):
        with self.assertRaises(ValueError):
            encrypt(b"short", generate_iv(), b"x")
        with self.assertRaises(ValueError):
            encrypt(generate_key(), b"short", b"x")
        with self.assertRaises(ValueError):
            decrypt(generate_key(), generate_iv()[:8], b"x")

    def test_seal_unseal_roundtrip_and_format(self):
        key = generate_key()
        plaintext = b"sealed data"
        sealed = seal(key, plaintext)
        self.assertEqual(len(sealed), IV_SIZE + len(plaintext))
        self.assertEqual(unseal(key, sealed), plaintext)
        # Two seals of the same plaintext differ, because the IV is fresh.
        self.assertNotEqual(seal(key, plaintext), seal(key, plaintext))
        with self.assertRaises(ValueError):
            unseal(key, b"too short")

    def test_ctr_malleability_is_documented_not_detected(self):
        # CTR has no authentication: flipping a ciphertext bit flips
        # the same plaintext bit, with no error. This test locks in
        # that behaviour so no one mistakes decryption success for
        # integrity. Use AES-GCM or encrypt-then-MAC if tampering matters.
        key = generate_key()
        iv = generate_iv()
        plaintext = bytearray(b"AAAAAAAA")
        ciphertext = bytearray(encrypt(key, iv, bytes(plaintext)))
        ciphertext[0] ^= 1
        recovered = decrypt(key, iv, bytes(ciphertext))
        self.assertNotEqual(recovered, bytes(plaintext))
        self.assertEqual(recovered[0], plaintext[0] ^ 1)
        self.assertEqual(recovered[1:], bytes(plaintext[1:]))

    def test_chunked_stream_matches_one_shot(self):
        key = generate_key()
        iv = generate_iv()
        data = os.urandom(1000)
        enc = Aes256CtrEncryptor(key, iv)
        out = enc.update(data[:400]) + enc.update(data[400:]) + enc.finalize()
        self.assertEqual(out, encrypt(key, iv, data))
        dec = Aes256CtrDecryptor(key, iv)
        back = dec.update(out[:400]) + dec.update(out[400:]) + dec.finalize()
        self.assertEqual(back, data)

    def test_key_and_iv_sizes(self):
        self.assertEqual(KEY_SIZE, 32)
        self.assertEqual(IV_SIZE, 16)
        self.assertEqual(len(generate_key()), 32)
        self.assertEqual(len(generate_iv()), 16)


if __name__ == "__main__":
    unittest.main()
