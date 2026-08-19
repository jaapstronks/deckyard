import test from 'node:test';
import assert from 'node:assert/strict';

import { createReadOnlyController } from '../client/views/editor/read-only-controller.js';
import { t } from '../client/lib/ui-i18n.js';

/**
 * The editor's read-only state has one source — the server being in
 * maintenance. These tests pin that the controller mirrors it onto the shell
 * (class + banner caption) and clears it again, in isolation from the editor.
 */

const MAINTENANCE_BANNER = `"${t('maintenance.readOnly.banner', 'Paused for maintenance - your work is kept')}"`;

/** Minimal stand-in for the shell element the controller mirrors state onto. */
function makeShell() {
  const classes = new Set();
  const props = new Map();
  return {
    classList: {
      toggle(name, on) {
        if (on) classes.add(name);
        else classes.delete(name);
      },
      contains: (name) => classes.has(name),
    },
    style: {
      setProperty: (k, v) => props.set(k, v),
    },
    banner: () => props.get('--read-only-banner-text'),
    isReadOnlyClass: () => classes.has('is-read-only'),
  };
}

test('starts editable', () => {
  const shell = makeShell();
  const c = createReadOnlyController({ shell });
  assert.equal(c.isReadOnly(), false);
  assert.equal(shell.isReadOnlyClass(), false);
});

test('maintenance makes it read-only with the maintenance caption', () => {
  const shell = makeShell();
  const c = createReadOnlyController({ shell });

  c.setMaintenanceReadOnly(true);
  assert.equal(c.isReadOnly(), true);
  assert.equal(shell.isReadOnlyClass(), true);
  assert.equal(shell.banner(), MAINTENANCE_BANNER);
});

test('read-only clears when maintenance ends', () => {
  const shell = makeShell();
  const c = createReadOnlyController({ shell });
  c.setMaintenanceReadOnly(true);
  c.setMaintenanceReadOnly(false);
  assert.equal(c.isReadOnly(), false);
  assert.equal(shell.isReadOnlyClass(), false);
});
