#!/bin/bash
# Builds the virtual Matter devices for the contract test. Runs ON THE MACBOOK, where
# ~/matter-spike holds connectedhomeip v1.6.1.0, bootstrapped (~/matter-spike/build.sh bootstrap),
# with ~/matter-spike/build.sh as the build wrapper. Takes about 3 minutes on the M5 Pro.
#
#   scp tests/matter/fixtures/{build-fixtures.sh,fx,fx.py} tests/matter/reference_server.py macbook:matter-fixtures/
#   ssh macbook matter-fixtures/build-fixtures.sh
set -e
W="$HOME/matter-spike"
CHIP="$W/connectedhomeip"
test -d "$CHIP" || { echo "no $CHIP: bootstrap connectedhomeip v1.6.1.0 first"; exit 1; }

# 1. host apps from build_examples (chip-lighting-app comes from the spike: darwin-arm64-light)
"$W/build.sh" darwin-arm64-light darwin-arm64-chip-tool-no-ble darwin-arm64-all-devices-no-ble \
  darwin-arm64-thermostat-no-ble darwin-arm64-lock-no-ble

# 2. the window covering: chef's rootnode_windowcovering. chef's linux target builds on macOS once
#    FakeAttributeAccess.cpp (only used with Pigweed RPC) is left out of non-RPC builds.
python3 - "$CHIP/examples/chef/common/FakeAttributeAccess.cpp" <<'EOF'
import sys
p = sys.argv[1]; s = open(p).read()
if "matter-fixtures patch" not in s:
    s = s.replace("#include <optional>\n", "#include <optional>\n#if CONFIG_ENABLE_PW_RPC // matter-fixtures patch: darwin non-rpc build\n", 1)
    s += "\n#else\nnamespace chip { namespace app { namespace Clusters { namespace Chef { void RegisterAttributeAccessor() {} } } } }\n#endif\n"
    open(p, "w").write(s)
    print("patched", p)
EOF
export ZAP_INSTALL_PATH="$W/zap-arm64"
D=rootnode_windowcovering_RLCxaGi9Yx
(
  cd "$CHIP"
  source scripts/activate.sh >/dev/null 2>&1
  ./examples/chef/chef.py -t linux -d "$D" -b
)
mkdir -p "$W/chef-bin"
cp "$CHIP/examples/chef/linux/out/$D" "$W/chef-bin/$D"
echo "built: $(ls "$CHIP"/out/darwin-arm64-{light,chip-tool-no-ble,all-devices-no-ble,thermostat-no-ble,lock-no-ble}/ | grep -E 'app$|tool$' | tr '\n' ' ') $D"
