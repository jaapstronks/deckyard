#include <node.h>

// Trusted negative image fixture: a legacy Node addon with a deliberately
// mismatched module ABI. Its initializer must never run.
static node::node_module wrong_abi = {
  999, 0, nullptr, __FILE__, nullptr, nullptr,
  "deckyard_wrong_abi_fixture", nullptr, nullptr,
};
NODE_C_CTOR(register_wrong_abi) {
  node::node_module_register(&wrong_abi);
}
