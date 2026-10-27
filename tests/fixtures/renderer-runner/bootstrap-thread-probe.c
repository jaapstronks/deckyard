#define _GNU_SOURCE
#include <node_api.h>
#include <errno.h>
#include <pthread.h>
#include <sched.h>
#include <stdatomic.h>
#include <sys/socket.h>
#include <unistd.h>
#include "filter.h"

/* Trusted image fixture only. The production build never compiles this file.
 * The external strace observer must see both thread creations, TSYNC and their
 * actual socket errno, rather than trusting this fixture's marker. */
static atomic_int go=0,ready=0;
static void *attempt(void *pointer) {
  int *answer=pointer;
  atomic_store(&ready,1);
  while (!atomic_load(&go)) sched_yield();
  int fd=socket(AF_INET,SOCK_STREAM,0);
  *answer=fd<0 ? errno : 0;
  if (fd>=0) close(fd);
  return NULL;
}
static napi_value activate(napi_env env,napi_callback_info info) {
  (void)info;
  int before=0,after=0;pthread_t a,b;
  if (pthread_create(&a,NULL,attempt,&before)) _exit(126);
  while (!atomic_load(&ready)) sched_yield();
  renderer_install_filter();
  atomic_store(&go,1);
  if (pthread_join(a,NULL) || before!=EPERM) _exit(126);
  if (pthread_create(&b,NULL,attempt,&after) || pthread_join(b,NULL) || after!=EPERM) _exit(126);
  const char message[]="TRUSTED_PREEXISTING_AND_NEW_THREAD_SOCKET_EPERM\n";
  if (write(2,message,sizeof(message)-1)!=(ssize_t)(sizeof(message)-1)) _exit(126);
  napi_value result;if(napi_get_boolean(env,true,&result)!=napi_ok)return NULL;return result;
}
static napi_value init(napi_env env,napi_value exports) {
  napi_value function;
  if (napi_create_function(env,"activate",NAPI_AUTO_LENGTH,activate,NULL,&function)!=napi_ok)return NULL;
  if (napi_set_named_property(env,exports,"activate",function)!=napi_ok)return NULL;
  return exports;
}
NAPI_MODULE(NODE_GYP_MODULE_NAME,init)
