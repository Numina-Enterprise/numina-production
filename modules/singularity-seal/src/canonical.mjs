/**
 * Copyright (c) 2026 Samuel J. Kott and SK Consulting LLC dba Numina Labs
 * Author: Samuel J. Kott
 * Operator: SK Consulting LLC dba Numina Labs
 * License: BSD-3-Clause (see ../LICENSE.md)
 *
 * Canonical JSON matching numina-doc-alignment/src/provenance-verifier.mjs
 * canonicalizeJson: sorted keys, no whitespace, UTF-8, prototype keys rejected.
 * That function is the repository's RFC 8785-style encoder for provenance.
 * This copy stays inside the module so the module does not edit that file.
 */

import { createHash, timingSafeEqual } from 'node:crypto';

export function canonicalizeJson(value) {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'number' && !Number.isFinite(value)) {
      throw new Error('NON_FINITE_NUMBER_FORBIDDEN');
    }
    if (typeof value === 'undefined') {
      throw new Error('UNDEFINED_FORBIDDEN');
    }
    if (typeof value === 'bigint' || typeof value === 'symbol' || typeof value === 'function') {
      throw new Error('UNSUPPORTED_JSON_TYPE');
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return '[' + value.map(canonicalizeJson).join(',') + ']';
  }
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) {
    throw new Error('PROTOTYPE_POLLUTION_KEY_REJECTED');
  }
  const keys = Object.keys(value).sort();
  for (const k of keys) {
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') {
      throw new Error('PROTOTYPE_POLLUTION_KEY_REJECTED');
    }
  }
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalizeJson(value[k])).join(',') + '}';
}

export function canonicalBytes(value) {
  return Buffer.from(canonicalizeJson(value), 'utf8');
}

export function sha256(bytes) {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  return createHash('sha256').update(buf).digest();
}

export function sha256Hex(bytes) {
  return sha256(bytes).toString('hex');
}

export function sha512(bytes) {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  return createHash('sha512').update(buf).digest();
}

export function bytesEqual(left, right) {
  const a = Buffer.isBuffer(left) ? left : Buffer.from(left);
  const b = Buffer.isBuffer(right) ? right : Buffer.from(right);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function fromBase64(value, label) {
  if (typeof value !== 'string' || value.length === 0 || /\s/.test(value)) {
    throw new Error('BASE64_REQUIRED:' + label);
  }
  const buf = Buffer.from(value, 'base64');
  if (buf.length === 0 || buf.toString('base64') !== value) {
    throw new Error('BASE64_INVALID:' + label);
  }
  return buf;
}

export function toBase64(bytes) {
  return Buffer.from(bytes).toString('base64');
}
