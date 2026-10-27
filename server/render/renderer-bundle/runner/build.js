import {
  mkdirSync,
  copyFileSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  lstatSync,
  chmodSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { sha256Hex } from '../manifest.js';

const directory = path.dirname(fileURLToPath(import.meta.url));
const LIBS = {
  '/lib64/ld-linux-x86-64.so.2':
    'c20a2dc8917c755f02b94049356320fe1f62ac7d9f8994731f807d9df39302da',
  '/lib/x86_64-linux-gnu/libpthread.so.0':
    '90491a21ce44efcf3bd4b65ec82501c091d7ebe7f8d9b341dd01d721001d9ecd',
  '/lib/x86_64-linux-gnu/libm.so.6':
    'fce00b6f25f459cf4ae0b7fae4257909a1a8a86f9149e7c029a5d617baf1ccd0',
  '/lib/x86_64-linux-gnu/libc.so.6':
    '3a15d66867d83762c7f2f1e37359cb8f6c5743edb369c65285cb0b1c4f7498bf',
  '/lib/x86_64-linux-gnu/libgcc_s.so.1':
    'd93224d2b0dab4247598be683adca02f5cf00586f99c187579cd7e92058fb7cb',
  '/lib/x86_64-linux-gnu/libdl.so.2':
    'c2994527172cc23b7fb0f7d611b71e00a37da27af12c2e5e9e0dc1a742886c96',
  '/lib/x86_64-linux-gnu/libstdc++.so.6':
    '1fd75fe70354a416d75aef22bcae68c47bd25d20e2d0568c30b1a9838cf62f11',
};
export const HOST_LIBRARIES = Object.freeze({
  ...LIBS,
  '/lib/x86_64-linux-gnu/libseccomp.so.2':
    'b4d9140a7797ccf3ac14f5d9d579b64f157111662940cb8330c632b11a8cea8e',
  '/lib/x86_64-linux-gnu/libcap.so.2':
    '6ac6abc86ac891c6e13486470e26f1d939f47fda9e6b5d5508a7f5ec881adc84',
  '/lib/x86_64-linux-gnu/libjson-c.so.5':
    '5cb4dfc866c13becb4d447440c4efbbd4114a469e348209f6f86d9741c12661f',
});

export const NODE_DIGEST =
  'e32e2d16081cf644f88392934288086e7662529d0d43277c34f7aad2207cfafb';
export const CRUN_DIGEST =
  '7f20cf8b40d12ad50d3ae70734f07254ba23d3b6ec9a6f0257c8f51e6aa04f1d';

/** Content inventory including modes. Refuse symlinks and special files. */
export function inventory(root) {
  const entries = [];
  function walk(dir, prefix) {
    for (const name of readdirSync(dir).sort()) {
      const relative = prefix ? `${prefix}/${name}` : name;
      const absolute = path.join(dir, name);
      const s = lstatSync(absolute);
      if (s.isDirectory()) {
        entries.push({ path: relative, mode: s.mode & 0o777, directory: true });
        walk(absolute, relative);
      } else if (s.isFile() && s.nlink === 1)
        entries.push({
          path: relative,
          mode: s.mode & 0o777,
          sha256: sha256Hex(readFileSync(absolute)),
        });
      else throw new Error('runner inventory alias or special file');
    }
  }
  walk(root, '');
  return entries;
}

/** Build only into a new directory. Never installs or starts services. */
export function buildRunner(output, crun) {
  if (
    process.platform !== 'linux' ||
    process.arch !== 'x64' ||
    process.version !== 'v24.22.1' ||
    sha256Hex(readFileSync(process.execPath)) !== NODE_DIGEST ||
    sha256Hex(readFileSync(crun)) !== CRUN_DIGEST
  )
    throw new Error('runner toolchain pin mismatch');
  for (const [file, digest] of Object.entries(HOST_LIBRARIES))
    if (sha256Hex(readFileSync(file)) !== digest)
      throw new Error('host library pin mismatch');
  process.umask(0o022);
  mkdirSync(output, { mode: 0o755 });
  const image = path.join(output, 'image');
  mkdirSync(image);
  function put(src, relative) {
    const dest = path.join(image, relative);
    mkdirSync(path.dirname(dest), { recursive: true });
    copyFileSync(src, dest);
    chmodSync(dest, 0o555);
  }
  put(process.execPath, 'bin/node');
  for (const [src, digest] of Object.entries(LIBS)) {
    if (sha256Hex(readFileSync(src)) !== digest)
      throw new Error(`library pin mismatch: ${src}`);
    put(src, src.slice(1));
  }
  for (const name of ['bundle', 'dev', 'proc', 'tmp', 'etc', 'sys', 'run'])
    mkdirSync(path.join(image, name));
  for (const name of ['hosts', 'hostname', 'resolv.conf'])
    writeFileSync(path.join(image, 'etc', name), '', { mode: 0o444 });
  mkdirSync(path.join(image, 'opt/runner'), { recursive: true });
  const include = path.resolve(process.execPath, '../../include/node');
  const compile = (args) =>
    execFileSync(
      '/usr/bin/cc',
      ['-O2', '-g0', '-Wall', '-Wextra', '-Werror', ...args],
      { cwd: directory, stdio: 'inherit' },
    );
  compile([
    '-shared',
    '-fPIC',
    `-I${include}`,
    'bootstrap-native.c',
    'filter.c',
    '-o',
    path.join(image, 'opt/runner/bootstrap.node'),
  ]);
  compile([
    '-shared',
    '-fPIC',
    `-I${include}`,
    'control-native.c',
    '-o',
    path.join(output, 'control.node'),
  ]);
  compile(['launch-runtime.c', '-o', path.join(output, 'launch-runtime')]);
  put(path.join(directory, 'bootstrap.js'), 'opt/runner/bootstrap.js');
  put(path.join(directory, 'policy.js'), 'opt/runner/policy.js');
  writeFileSync(path.join(image, 'package.json'), '{"type":"module"}\n', {
    mode: 0o444,
  });
  copyFileSync(crun, path.join(output, 'crun'));
  chmodSync(path.join(output, 'crun'), 0o555);
  const lock = {
    schema: 'deckyard.renderer-runner.build/1',
    hostLibraries: HOST_LIBRARIES,
    node: NODE_DIGEST,
    crun: CRUN_DIGEST,
    image: inventory(image),
    control: sha256Hex(readFileSync(path.join(output, 'control.node'))),
    launcher: sha256Hex(readFileSync(path.join(output, 'launch-runtime'))),
  };
  writeFileSync(
    path.join(output, 'build.json'),
    `${JSON.stringify(lock, null, 2)}\n`,
  );
  return lock;
}
