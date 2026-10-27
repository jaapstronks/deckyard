#define _GNU_SOURCE
#include <node_api.h>
#include <dirent.h>
#include <errno.h>
#include <fcntl.h>
#include <linux/openat2.h>
#include <poll.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/syscall.h>
#include <sys/xattr.h>
#include <unistd.h>

#ifndef SO_PEERPIDFD
#define SO_PEERPIDFD 77
#endif

/* Host control only. Never copied into the guest image. All I/O is synchronous
 * on the owning producer thread; no AIO, callbacks or detached producers. */
static napi_value fail(napi_env env) {
  napi_throw_error(env, "runner_native_refused", strerror(errno));
  return NULL;
}
static int integer(napi_env env, napi_value v, int *out) {
  return napi_get_value_int32(env, v, out) == napi_ok;
}
static napi_value number(napi_env env, uint32_t value) {
  napi_value out;
  if (napi_create_uint32(env, value, &out) != napi_ok) return NULL;
  return out;
}
static void property(napi_env env, napi_value obj, const char *name, uint32_t value) {
  napi_set_named_property(env, obj, name, number(env, value));
}
static napi_value peer(napi_env env, napi_callback_info info) {
  size_t argc = 1; napi_value args[1]; int fd;
  napi_get_cb_info(env, info, &argc, args, NULL, NULL);
  if (argc != 1 || !integer(env, args[0], &fd)) { errno = EINVAL; return fail(env); }
  struct ucred cred; socklen_t len = sizeof(cred);
  if (getsockopt(fd, SOL_SOCKET, SO_PEERCRED, &cred, &len) || len != sizeof(cred))
    return fail(env);
  int pidfd = -1; len = sizeof(pidfd);
  if (getsockopt(fd, SOL_SOCKET, SO_PEERPIDFD, &pidfd, &len) || len != sizeof(pidfd))
    return fail(env);
  napi_value obj; napi_create_object(env, &obj);
  property(env, obj, "uid", cred.uid); property(env, obj, "gid", cred.gid);
  property(env, obj, "pid", cred.pid); property(env, obj, "pidfd", pidfd);
  return obj;
}
static napi_value exited(napi_env env, napi_callback_info info) {
  size_t argc = 1; napi_value args[1]; int fd;
  napi_get_cb_info(env, info, &argc, args, NULL, NULL);
  if (argc != 1 || !integer(env, args[0], &fd)) { errno = EINVAL; return fail(env); }
  struct pollfd p = {.fd=fd, .events=POLLIN};
  int r = poll(&p, 1, 0);
  if (r < 0 || (p.revents & POLLNVAL)) return fail(env);
  napi_value out; napi_get_boolean(env, r != 0, &out); return out;
}
static napi_value disconnected(napi_env env, napi_callback_info info) {
  size_t argc=1; napi_value args[1]; int fd;
  napi_get_cb_info(env,info,&argc,args,NULL,NULL);
  if (argc!=1 || !integer(env,args[0],&fd)) { errno=EINVAL; return fail(env); }
  /* A Unix caller write-half-close is required by the frame protocol. POLLHUP
   * distinguishes its later full close even after Node stopped reading EOF. */
  struct pollfd p={.fd=fd,.events=0};
  if (poll(&p,1,0)<0) return fail(env);
  napi_value out;
  napi_get_boolean(env,(p.revents & (POLLHUP|POLLERR|POLLNVAL))!=0,&out);return out;
}
static int beneath(int parent, const char *path, int flags) {
  struct open_how h = {.flags=(uint64_t)(flags | O_CLOEXEC | O_NOFOLLOW),
    .resolve=RESOLVE_BENEATH | RESOLVE_NO_SYMLINKS | RESOLVE_NO_MAGICLINKS | RESOLVE_NO_XDEV};
  return syscall(SYS_openat2, parent, path, &h, sizeof(h));
}
static char *string(napi_env env, napi_value value) {
  size_t len = 0;
  if (napi_get_value_string_utf8(env, value, NULL, 0, &len) != napi_ok || !len || len > 4095) {
    errno = EINVAL; return NULL;
  }
  char *p = malloc(len + 1);
  if (!p) return NULL;
  size_t actual;
  if (napi_get_value_string_utf8(env, value, p, len+1, &actual) != napi_ok ||
      actual != len || strlen(p) != len) { free(p); errno=EINVAL; return NULL; }
  return p;
}
struct budget { size_t bytes; unsigned files; unsigned nodes; };
static int ordinary(int fd, int directory) {
  struct stat s;
  if (fstat(fd, &s)) return -1;
  if (directory ? !S_ISDIR(s.st_mode) : (!S_ISREG(s.st_mode) || s.st_nlink != 1)) {
    errno=EINVAL; return -1;
  }
  return 0;
}
static int copy_file(int src, int dst, size_t limit, struct budget *b) {
  char data[65536]; size_t length=0;
  for (;;) {
    ssize_t n = read(src, data, sizeof(data));
    if (n < 0) { if (errno==EINTR) continue; return -1; }
    if (!n) return 0;
    length += (size_t)n; b->bytes += (size_t)n;
    if (length > limit || b->bytes > 128U*1024U*1024U) { errno=EFBIG; return -1; }
    for (ssize_t written=0; written<n;) {
      ssize_t r=write(dst, data+written, (size_t)(n-written));
      if (r<0 && errno==EINTR) continue;
      if (r<=0) return -1;
      written += r;
    }
  }
}
static int tree(int source, int target, unsigned depth, struct budget *b) {
  if (depth>64) { errno=ELOOP; return -1; }
  int scan=dup(source); if (scan<0) return -1;
  DIR *dir=fdopendir(scan); if (!dir) { close(scan); return -1; }
  int result=-1; struct dirent *entry;
  for (;;) {
    errno=0; entry=readdir(dir);
    if (!entry) { if (!errno) result=0; break; }
    if (!strcmp(entry->d_name,".") || !strcmp(entry->d_name,"..")) continue;
    if (++b->nodes > 8192) { errno=EFBIG; break; }
    /* O_NONBLOCK prevents a FIFO from blocking before its fstat rejection. */
    int input=beneath(source, entry->d_name, O_RDONLY | O_NONBLOCK);
    if (input<0) break;
    struct stat s;
    if (fstat(input,&s)) { close(input); break; }
    if (S_ISDIR(s.st_mode)) {
      if (mkdirat(target,entry->d_name,0700)) { close(input); break; }
      int output=beneath(target,entry->d_name,O_RDONLY | O_DIRECTORY);
      int r=output<0 ? -1 : tree(input,output,depth+1,b);
      if (output>=0) close(output);
      close(input); if (r) break;
    } else {
      if (!S_ISREG(s.st_mode) || s.st_nlink!=1 || ++b->files>4096) {
        close(input); errno=EINVAL; break;
      }
      int output=openat(target,entry->d_name,O_WRONLY|O_CREAT|O_EXCL|O_CLOEXEC|O_NOFOLLOW,0600);
      int r=output<0 ? -1 : copy_file(input,output,16U*1024U*1024U,b);
      if (output>=0) close(output);
      close(input); if (r) break;
    }
  }
  int saved=errno; closedir(dir); errno=saved; return result;
}
static napi_value copy(napi_env env, napi_callback_info info) {
  size_t argc=2; napi_value args[2];
  napi_get_cb_info(env,info,&argc,args,NULL,NULL);
  if (argc!=2) { errno=EINVAL; return fail(env); }
  char *source=string(env,args[0]), *target=string(env,args[1]);
  int root=-1,src=-1,dst=-1,manifest=-1,out=-1,files=-1,tofiles=-1;
  int result=-1;
  if (!source || !target || source[0]!='/' || target[0]!='/') { errno=EINVAL; goto done; }
  root=open("/",O_RDONLY|O_DIRECTORY|O_CLOEXEC);
  if (root<0) goto done;
  src=beneath(root,source+1,O_RDONLY|O_DIRECTORY);
  dst=beneath(root,target+1,O_RDONLY|O_DIRECTORY);
  if (src<0 || dst<0 || ordinary(src,1) || ordinary(dst,1)) goto done;
  /* Fresh copies must not inherit access/default ACLs from staging. Mode bits
   * alone are not an inventory of named-user ACL entries. */
  const char *acl[]={"system.posix_acl_access","system.posix_acl_default"};
  for (size_t i=0;i<2;i++) {
    errno=0;
    if (fgetxattr(dst,acl[i],NULL,0)>=0 || errno!=ENODATA) { errno=EACCES; goto done; }
  }
  manifest=beneath(src,"manifest.json",O_RDONLY|O_NONBLOCK);
  if (manifest<0 || ordinary(manifest,0)) goto done;
  out=openat(dst,"manifest.json",O_WRONLY|O_CREAT|O_EXCL|O_CLOEXEC|O_NOFOLLOW,0600);
  struct budget budget={0};
  if (out<0 || copy_file(manifest,out,4U*1024U*1024U,&budget)) goto done;
  close(out); out=-1;
  files=beneath(src,"files",O_RDONLY|O_DIRECTORY);
  if (files<0 || mkdirat(dst,"files",0700)) goto done;
  tofiles=beneath(dst,"files",O_RDONLY|O_DIRECTORY);
  if (tofiles<0 || tree(files,tofiles,0,&budget)) goto done;
  result=0;
done:;
  int saved=errno;
  int fds[]={tofiles,files,out,manifest,dst,src,root};
  for (size_t i=0;i<sizeof(fds)/sizeof(fds[0]);i++) if (fds[i]>=0) close(fds[i]);
  free(source); free(target); errno=saved;
  if (result) return fail(env);
  napi_value value; napi_get_undefined(env,&value); return value;
}
static napi_value init(napi_env env, napi_value exports) {
  napi_property_descriptor methods[]={
    {"peer",NULL,peer,NULL,NULL,NULL,napi_default,NULL},
    {"exited",NULL,exited,NULL,NULL,NULL,napi_default,NULL},
    {"disconnected",NULL,disconnected,NULL,NULL,NULL,napi_default,NULL},
    {"copy",NULL,copy,NULL,NULL,NULL,napi_default,NULL},
  };
  if (napi_define_properties(env,exports,4,methods)!=napi_ok) return NULL;
  return exports;
}
NAPI_MODULE(NODE_GYP_MODULE_NAME,init)
