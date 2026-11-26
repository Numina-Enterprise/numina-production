#!/usr/bin/env node
/**
 * Copyright (c) 2026 Samuel J. Kott and SK Consulting LLC dba Numina Labs
 * Author: Samuel J. Kott
 * Operator: SK Consulting LLC dba Numina Labs
 * License: BSD-3-Clause (see ../LICENSE.md)
 */

import { main } from '../src/cli.mjs';

try {
  const code = main(process.argv.slice(2));
  process.exit(code);
} catch (error) {
  const message = typeof error?.message === 'string' ? error.message.split('\n')[0] : 'SEAL_ERROR';
  process.stderr.write(message + '\n');
  process.exit(2);
}
