import { PROC_MASKS, MOUNT_FLAGS } from './policy.js';

/** Fixed OCI profile. Only supervisor-generated identities, paths and a checked
 * operator config enter this function; it is never a caller configuration API. */
export function ociProfile({ image, bundle, jobCgroup, subuid, subgid }) {
  return {
    ociVersion: '1.0.2',
    root: { path: image, readonly: true },
    hostname: 'renderer',
    process: {
      terminal: false,
      user: { uid: 1000, gid: 1000 },
      args: ['/bin/node', '/opt/runner/bootstrap.js'],
      env: ['NODE_ENV=production', 'DECKYARD_RENDER_WORKER=1'],
      cwd: '/',
      noNewPrivileges: true,
      capabilities: {
        bounding: [],
        effective: [],
        inheritable: [],
        permitted: [],
        ambient: [],
      },
      rlimits: [
        { type: 'RLIMIT_CORE', hard: 0, soft: 0 },
        { type: 'RLIMIT_NOFILE', hard: 128, soft: 128 },
      ],
    },
    mounts: [
      {
        destination: '/dev',
        type: 'tmpfs',
        source: 'tmpfs',
        options: MOUNT_FLAGS['/dev'],
      },
      {
        destination: '/proc',
        type: 'proc',
        source: 'proc',
        options: MOUNT_FLAGS['/proc'],
      },
      {
        destination: '/tmp',
        type: 'tmpfs',
        source: 'tmpfs',
        options: MOUNT_FLAGS['/tmp'],
      },
      {
        destination: '/bundle',
        type: 'bind',
        source: bundle,
        options: MOUNT_FLAGS['/bundle'],
      },
    ],
    linux: {
      namespaces: ['user', 'mount', 'pid', 'network', 'ipc', 'uts'].map(
        (type) => ({ type }),
      ),
      uidMappings: [{ containerID: 0, hostID: subuid, size: 65536 }],
      gidMappings: [{ containerID: 0, hostID: subgid, size: 65536 }],
      cgroupsPath: jobCgroup,
      resources: {
        memory: { limit: 536870912, swap: 536870912 },
        pids: { limit: 64 },
        cpu: { quota: 100000, period: 100000 },
        devices: [
          { allow: false, access: 'rwm' },
          ...[
            [1, 3],
            [1, 5],
            [1, 9],
          ].map(([major, minor]) => ({
            allow: true,
            type: 'c',
            major,
            minor,
            access: 'rw',
          })),
        ],
      },
      maskedPaths: PROC_MASKS,
      seccomp: {
        defaultAction: 'SCMP_ACT_ALLOW',
        architectures: ['SCMP_ARCH_X86_64'],
        syscalls: [
          {
            names: ['io_uring_setup', 'io_uring_enter', 'io_uring_register'],
            action: 'SCMP_ACT_ERRNO',
            errnoRet: 1,
          },
        ],
      },
    },
  };
}
