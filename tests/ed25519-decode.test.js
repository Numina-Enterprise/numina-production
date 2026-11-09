import { describe, it, expect, vi } from "vitest";
import { P, recoverEd25519, decodeCompressedEd25519 } from "../src/crypto/ed25519-point.js";

const fromHex = hex => Uint8Array.from(hex.match(/../g).map(x => parseInt(x, 16)));
describe("RFC 8032 Ed25519 decompression", () => {
  it("decodes RFC 8032 vector 1 public key", () => {
    const point = decodeCompressedEd25519(fromHex("d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a"));
    expect(point.x & 1n).toBe(0n);
    expect(point.y).toBeLessThan(P);
  });
  it("decodes standard basepoint encoding", () => {
    const point = decodeCompressedEd25519(fromHex("5866666666666666666666666666666666666666666666666666666666666666"));
    expect(point.x & 1n).toBe(0n);
  });
  it("rejects y=2 non-residue and reports both candidates", () => {
    const cb = vi.fn();
    expect(() => recoverEd25519(2n, 0, cb)).toThrow(/Non-residue/);
    expect(cb).toHaveBeenCalledWith(expect.objectContaining({ rejected: true }));
  });
  it("rejects y >= p as non-canonical", () => {
    expect(() => recoverEd25519(P, 0)).toThrow(/Non-canonical/);
  });
  it("rejects zero x with sign bit one", () => {
    expect(() => recoverEd25519(1n, 1)).toThrow(/Invalid sign bit/);
  });
  it("accepts identity with valid sign bit", () => {
    expect(recoverEd25519(1n, 0).x).toBe(0n);
  });
  it("rejects invalid byte lengths", () => {
    expect(() => decodeCompressedEd25519(new Uint8Array(31))).toThrow(/32 bytes/);
  });
  it("rejects non-canonical encoded y", () => {
    const bytes = new Uint8Array(32).fill(255);
    bytes[31] = 0x7f;
    expect(() => decodeCompressedEd25519(bytes)).toThrow(/Non-canonical/);
  });
});
