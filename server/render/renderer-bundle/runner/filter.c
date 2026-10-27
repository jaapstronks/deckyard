#define _GNU_SOURCE
#include "filter.h"
#include <errno.h>
#include <linux/audit.h>
#include <linux/filter.h>
#include <linux/seccomp.h>
#include <stddef.h>
#include <stdint.h>
#include <sys/prctl.h>
#include <sys/syscall.h>
#include <unistd.h>

/* Linux x86_64 glibc pthread_create flags, not a mask or a process clone. */
#define PTHREAD_FLAGS 0x003d0f00U
#define ALLOW(number) \
  BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, SYS_##number, 0, 1), \
  BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ALLOW)

static const struct sock_filter filter[] = {
  BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, arch)),
  BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, AUDIT_ARCH_X86_64, 1, 0),
  BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_KILL_PROCESS),
  BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, nr)),
  BPF_JUMP(BPF_JMP | BPF_JSET | BPF_K, 0x40000000U, 0, 1),
  BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_KILL_PROCESS),

  /* Memory/JIT, ordinary private filesystem I/O, clocks and thread runtime. */
  ALLOW(read), ALLOW(write), ALLOW(readv), ALLOW(writev),
  ALLOW(pread64), ALLOW(pwrite64), ALLOW(close), ALLOW(close_range),
  ALLOW(fstat), ALLOW(newfstatat), ALLOW(statx), ALLOW(stat), ALLOW(lstat),
  ALLOW(lseek), ALLOW(open), ALLOW(openat), ALLOW(access), ALLOW(faccessat),
  ALLOW(faccessat2), ALLOW(getdents64), ALLOW(readlink), ALLOW(readlinkat),
  ALLOW(getcwd), ALLOW(fcntl), ALLOW(dup), ALLOW(dup2), ALLOW(dup3),
  ALLOW(mkdir), ALLOW(mkdirat), ALLOW(unlink), ALLOW(unlinkat),
  ALLOW(rename), ALLOW(renameat), ALLOW(renameat2), ALLOW(ftruncate),
  ALLOW(fsync), ALLOW(fdatasync), ALLOW(utimensat),
  ALLOW(brk), ALLOW(mmap), ALLOW(mprotect), ALLOW(munmap), ALLOW(mremap),
  ALLOW(madvise), ALLOW(msync), ALLOW(membarrier),
  ALLOW(futex), ALLOW(rseq), ALLOW(set_robust_list), ALLOW(set_tid_address),
  ALLOW(rt_sigaction), ALLOW(rt_sigprocmask), ALLOW(rt_sigreturn),
  ALLOW(sigaltstack), ALLOW(tgkill), ALLOW(restart_syscall),
  ALLOW(clock_gettime), ALLOW(clock_getres), ALLOW(clock_nanosleep),
  ALLOW(nanosleep), ALLOW(gettimeofday), ALLOW(times),
  ALLOW(getpid), ALLOW(getppid), ALLOW(gettid), ALLOW(getuid), ALLOW(geteuid),
  ALLOW(getgid), ALLOW(getegid), ALLOW(getgroups), ALLOW(getrandom),
  ALLOW(uname), ALLOW(sysinfo), ALLOW(sched_yield), ALLOW(sched_getaffinity),
  ALLOW(getrusage), ALLOW(getrlimit), ALLOW(prlimit64),
  ALLOW(epoll_create1), ALLOW(epoll_ctl), ALLOW(epoll_wait), ALLOW(epoll_pwait),
  ALLOW(eventfd2), ALLOW(pipe2), ALLOW(poll), ALLOW(ppoll),
  ALLOW(exit), ALLOW(exit_group),

  /* glibc may try clone3 first; ENOSYS makes it use inspectable clone. */
  BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, SYS_clone3, 0, 1),
  BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ERRNO | ENOSYS),

  /* libuv pipe mode/read-count controls only; never arbitrary device ioctls. */
  BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, SYS_ioctl, 0, 7),
  BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[1]) + 4),
  BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, 0, 0, 4),
  BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[1])),
  BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, 0x5421U, 1, 0),
  BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, 0x541bU, 0, 1),
  BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ALLOW),
  BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ERRNO | EPERM),

  /* Allow only the exact pthread flag word, including a zero upper word. */
  BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, SYS_clone, 0, 5),
  BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[0]) + 4),
  BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, 0, 0, 3),
  BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, args[0])),
  BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, PTHREAD_FLAGS, 0, 1),
  BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ALLOW),
  /* All unknown calls, sockets, exec, processes, privilege and namespace APIs. */
  BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ERRNO | EPERM),
};

void renderer_install_filter(void) {
#if !defined(__x86_64__) || defined(__ILP32__)
  _exit(126);
#else
  if (prctl(PR_GET_NO_NEW_PRIVS, 0, 0, 0, 0) != 1) _exit(126);
  /* A pipe core_pattern ignores RLIMIT_CORE: a crash would start a host
   * helper with this process's memory. A non-dumpable mm dumps nothing, and
   * prctl is outside the final filter, so the guest cannot undo it. */
  if (prctl(PR_SET_DUMPABLE, 0, 0, 0, 0) != 0 ||
      prctl(PR_GET_DUMPABLE, 0, 0, 0, 0) != 0) _exit(126);
  struct sock_fprog program = {
    .len = (unsigned short)(sizeof(filter) / sizeof(filter[0])),
    .filter = (struct sock_filter *)filter,
  };
  /* A positive thread ID is failure too, not successful synchronisation. */
  if (syscall(SYS_seccomp, SECCOMP_SET_MODE_FILTER,
              SECCOMP_FILTER_FLAG_TSYNC, &program) != 0) _exit(126);
#endif
}
