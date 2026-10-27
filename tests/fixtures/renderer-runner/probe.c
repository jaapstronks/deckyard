#define _GNU_SOURCE
#include <node_api.h>
#include <errno.h>
#include <linux/sched.h>
#include <pthread.h>
#include <signal.h>
#include <sys/socket.h>
#include <sys/syscall.h>
#include <unistd.h>

static void item(napi_env env,napi_value object,const char *key,long result) {
  int saved=errno; napi_value value;
  napi_create_int32(env,result<0 ? -saved : (int)result,&value);
  napi_set_named_property(env,object,key,value);
}
static void *thread(void *p) {
  int *result=p;
  int fd=socket(AF_INET,SOCK_STREAM,0);
  *result=fd<0 ? -errno : fd;
  if(fd>=0) close(fd);
  return NULL;
}
static napi_value probe(napi_env env,napi_callback_info info) {
  (void)info; napi_value object; napi_create_object(env,&object);
  item(env,object,"socket4",syscall(SYS_socket,AF_INET,SOCK_STREAM,0));
  item(env,object,"socket6",syscall(SYS_socket,AF_INET6,SOCK_DGRAM,0));
  item(env,object,"socketUnix",syscall(SYS_socket,AF_UNIX,SOCK_STREAM,0));
  item(env,object,"connect",syscall(SYS_connect,0,NULL,0));
  item(env,object,"accept",syscall(SYS_accept4,0,NULL,NULL,0));
  item(env,object,"uringSetup",syscall(SYS_io_uring_setup,1,NULL));
  item(env,object,"uringEnter",syscall(SYS_io_uring_enter,-1,0,0,0,NULL,0));
  item(env,object,"uringRegister",syscall(SYS_io_uring_register,-1,0,NULL,0));
  char *args[]={"/missing",NULL};char *environment[]={NULL};
  item(env,object,"exec",syscall(SYS_execve,args[0],args,environment));
  item(env,object,"execat",syscall(SYS_execveat,-1,args[0],args,environment,0));
  long pid=syscall(SYS_fork); if(pid==0)_exit(99); item(env,object,"fork",pid);
  pid=syscall(SYS_vfork); if(pid==0)_exit(99); item(env,object,"vfork",pid);
  pid=syscall(SYS_clone,SIGCHLD,NULL,NULL,NULL,0);if(pid==0)_exit(99);item(env,object,"processClone",pid);
  pid=syscall(SYS_clone,CLONE_NEWUSER|SIGCHLD,NULL,NULL,NULL,0);if(pid==0)_exit(99);item(env,object,"namespaceClone",pid);
  struct clone_args a={.exit_signal=SIGCHLD};
  pid=syscall(SYS_clone3,&a,sizeof(a));if(pid==0)_exit(99);item(env,object,"clone3",pid);
  item(env,object,"unshare",syscall(SYS_unshare,CLONE_NEWNET));
  item(env,object,"mount",syscall(SYS_mount,"none","/tmp","tmpfs",0,NULL));
  item(env,object,"ptrace",syscall(SYS_ptrace,0,0,NULL,NULL));
  item(env,object,"bpf",syscall(SYS_bpf,0,NULL,0));
  item(env,object,"perf",syscall(SYS_perf_event_open,NULL,0,-1,-1,0));
  int socketResult=0;pthread_t t;
  int r=pthread_create(&t,NULL,thread,&socketResult);
  if(!r)r=pthread_join(t,NULL);
  item(env,object,"pthread",r);item(env,object,"threadSocket",socketResult);
  return object;
}
static napi_value x32(napi_env env,napi_callback_info info) {
  (void)env;(void)info;syscall(0x40000027);_exit(99);
}
static napi_value compat(napi_env env,napi_callback_info info) {
  (void)env;(void)info;
#if defined(__x86_64__)
  __asm__ volatile("int $0x80" : : "a"(20) : "memory");
#endif
  _exit(99);
}
static napi_value init(napi_env env,napi_value exports) {
  napi_property_descriptor methods[]={
    {"probe",NULL,probe,NULL,NULL,NULL,napi_default,NULL},
    {"x32",NULL,x32,NULL,NULL,NULL,napi_default,NULL},
    {"compat",NULL,compat,NULL,NULL,NULL,napi_default,NULL},
  };
  napi_define_properties(env,exports,3,methods);return exports;
}
NAPI_MODULE(NODE_GYP_MODULE_NAME,init)
