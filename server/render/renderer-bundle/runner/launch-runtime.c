#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <linux/sched.h>
#include <poll.h>
#include <signal.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include <sys/syscall.h>
#include <sys/wait.h>
#include <unistd.h>

/* Node's child stdio uses socketpairs. Relay through actual pipes so no socket
 * descriptor enters the guest. Fixed buffers, no threads or detached I/O. The
 * launcher remains in broker containment until all pipe I/O and waitpid join. */
struct flow { int from, to, eof; size_t begin, end; char data[65536]; };
static int relay(struct flow *f) {
  if (f->begin < f->end) {
    ssize_t n=write(f->to,f->data+f->begin,f->end-f->begin);
    if (n>0) f->begin+=(size_t)n;
    else if (n<0 && errno!=EAGAIN && errno!=EINTR) return -1;
  }
  if (f->begin==f->end) {
    f->begin=f->end=0;
    if (f->eof) { if (f->to>=0) close(f->to); f->to=-1; return 0; }
    ssize_t n=read(f->from,f->data,sizeof(f->data));
    if (n>0) f->end=(size_t)n;
    else if (!n) { f->eof=1; close(f->from); f->from=-1; close(f->to); f->to=-1; }
    else if (errno!=EAGAIN && errno!=EINTR) return -1;
  }
  return 0;
}
int main(int argc, char **argv) {
  if (argc!=4 || geteuid()!=0 || strlen(argv[3])!=32 || strspn(argv[3],"0123456789abcdef")!=32) return 126;
  int cg=open(argv[1],O_RDONLY|O_DIRECTORY|O_CLOEXEC|O_NOFOLLOW);
  if (cg<0) return 126;
  int pipes[3][2];
  for (int i=0;i<3;i++) if (pipe2(pipes[i],O_CLOEXEC|O_NONBLOCK)) return 126;
  char root[128];
  if (snprintf(root,sizeof(root),"/run/deckyard-render/runtime/%s",argv[3])<0) return 126;
  int pidfd=-1;
  struct clone_args a={.flags=CLONE_INTO_CGROUP|CLONE_PIDFD,
    .pidfd=(uint64_t)(uintptr_t)&pidfd,.cgroup=(uint64_t)cg,.exit_signal=SIGCHLD};
  pid_t pid=syscall(SYS_clone3,&a,sizeof(a));
  if (pid<0) return 126;
  if (!pid) {
    int child[]={pipes[0][0],pipes[1][1],pipes[2][1]};
    for (int i=0;i<3;i++) {
      if (fcntl(child[i],F_SETFL,0) || dup2(child[i],i)<0) _exit(126);
    }
    if (syscall(SYS_close_range,3U,~0U,0)) _exit(126);
    char *args[]={"/opt/deckyard-render/crun","--root",root,
      "--cgroup-manager","cgroupfs","run","--bundle",argv[2],argv[3],NULL};
    char *env[]={NULL};
    execve(args[0],args,env); _exit(126);
  }
  close(cg); close(pipes[0][0]); close(pipes[1][1]); close(pipes[2][1]);
  signal(SIGPIPE,SIG_IGN);
  for (int i=0;i<3;i++) if (fcntl(i,F_SETFL,O_NONBLOCK)) return 126;
  struct flow flows[]={
    {.from=0,.to=pipes[0][1]}, {.from=pipes[1][0],.to=1}, {.from=pipes[2][0],.to=2}
  };
  int status=0,exited=0;
  for (;;) {
    struct pollfd pollfds[7];
    for (int i=0;i<3;i++) {
      struct flow *f=&flows[i];
      pollfds[i*2]=(struct pollfd){.fd=f->begin==f->end ? f->from : -1,.events=POLLIN};
      pollfds[i*2+1]=(struct pollfd){.fd=f->begin<f->end ? f->to : -1,.events=POLLOUT};
    }
    pollfds[6]=(struct pollfd){.fd=exited ? -1 : pidfd,.events=POLLIN};
    if (poll(pollfds,7,-1)<0) { if (errno==EINTR) continue; return 126; }
    for (int i=0;i<3;i++) if (relay(&flows[i])) {
      /* The guest closed its stdin: discard the unwritten input and keep
       * relaying output until the guest's own exit is joined. */
      if (i==0 && errno==EPIPE) { close(flows[0].from);close(flows[0].to);flows[0].from=flows[0].to=-1;flows[0].begin=flows[0].end=0;flows[0].eof=1; }
      else return 126;
    }
    if (!exited && pollfds[6].revents) {
      while (waitpid(pid,&status,0)<0) if (errno!=EINTR) return 126;
      exited=1;
      /* A failed or killed runtime is a failure now: a still-running guest
       * keeps the pipes open, so waiting for EOF would last until the
       * deadline. Only a clean exit drains the remaining output. */
      if (!WIFEXITED(status) || WEXITSTATUS(status)) break;
      if (flows[0].from>=0) close(flows[0].from);
      if (flows[0].to>=0) close(flows[0].to);
      flows[0].from=flows[0].to=-1;flows[0].begin=flows[0].end=0;flows[0].eof=1;
    }
    if (exited && flows[1].to<0 && flows[2].to<0) break;
  }
  close(pidfd);
  return WIFEXITED(status) ? WEXITSTATUS(status) : 128+WTERMSIG(status);
}
