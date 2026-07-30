import test from 'node:test';
import assert from 'node:assert/strict';

import { createReadOnlyController } from '../client/views/editor/read-only-controller.js';
import { t } from '../client/lib/ui-i18n.js';

/**
 * The editor's read-only state has two independent sources — another user
 * holding the presentation lock, and the server being in maintenance — and the
 * subtle requirement is that they compose without clobbering each other. These
 * tests pin the OR precedence and the banner-caption hand-off that the inline
 * comment in editor-controller warns about, which the extraction into
 * client/views/editor/read-only-controller.js now makes testable in isolation.
 */

const LOCK_BANNER = `"${t('editor.readOnly.banner', 'View only - someone else is editing')}"`;
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

test('either source alone makes it read-only', () => {
  const shell = makeShell();
  const c = createReadOnlyController({ shell });

  c.setLockReadOnly(true);
  assert.equal(c.isReadOnly(), true);
  assert.equal(shell.isReadOnlyClass(), true);
  assert.equal(shell.banner(), LOCK_BANNER);

  c.setLockReadOnly(false);
  assert.equal(c.isReadOnly(), false);
  assert.equal(shell.isReadOnlyClass(), false);

  c.setMaintenanceReadOnly(true);
  assert.equal(c.isReadOnly(), true);
  assert.equal(shell.banner(), MAINTENANCE_BANNER);
});

test('maintenance caption wins while both sources are up', () => {
  const shell = makeShell();
  const c = createReadOnlyController({ shell });
  c.setLockReadOnly(true);
  c.setMaintenanceReadOnly(true);
  assert.equal(shell.banner(), MAINTENANCE_BANNER);
});

test('a lock released mid-deploy keeps the editor read-only', () => {
  // The scenario the OR split exists for: maintenance is up, the other editor's
  // lock releases — editing must NOT come back while saves still 503.
  const shell = makeShell();
  const c = createReadOnlyController({ shell });
  c.setLockReadOnly(true);
  c.setMaintenanceReadOnly(true);

  c.setLockReadOnly(false);
  assert.equal(c.isReadOnly(), true, 'still read-only under maintenance');
  assert.equal(shell.banner(), MAINTENANCE_BANNER);
});

test('when maintenance ends under a standing lock, the caption returns to the lock text', () => {
  const shell = makeShell();
  const c = createReadOnlyController({ shell });
  c.setLockReadOnly(true);
  c.setMaintenanceReadOnly(true);

  c.setMaintenanceReadOnly(false);
  assert.equal(c.isReadOnly(), true, 'lock still holds');
  assert.equal(
    shell.banner(),
    LOCK_BANNER,
    'caption must stop claiming "paused for maintenance" once maintenance is over'
  );
});

test('read-only clears only when both sources are down', () => {
  const shell = makeShell();
  const c = createReadOnlyController({ shell });
  c.setLockReadOnly(true);
  c.setMaintenanceReadOnly(true);
  c.setLockReadOnly(false);
  c.setMaintenanceReadOnly(false);
  assert.equal(c.isReadOnly(), false);
  assert.equal(shell.isReadOnlyClass(), false);
});
