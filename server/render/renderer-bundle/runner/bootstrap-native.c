#include <node_api.h>
#include "filter.h"

static napi_value activate(napi_env env, napi_callback_info info) {
  (void)info;
  renderer_install_filter();
  napi_value value;
  if (napi_get_boolean(env, true, &value) != napi_ok) return NULL;
  return value;
}

static napi_value init(napi_env env, napi_value exports) {
  napi_value fn;
  if (napi_create_function(env, "activate", NAPI_AUTO_LENGTH, activate, NULL, &fn) != napi_ok)
    return NULL;
  if (napi_set_named_property(env, exports, "activate", fn) != napi_ok) return NULL;
  return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, init)
