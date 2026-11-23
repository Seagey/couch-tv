"""Start the couch-tv bridge on a rooted LG (webOS, soft-float ARM).

The Android and Apple TV drivers need native libraries (cryptography, adb-shell,
androidtvremote2) that cannot be installed here. This TV only uses the LG driver, so
those modules are replaced by inert placeholders: importing them works, using them raises.
"""
import importlib.abc, importlib.machinery, os, runpy, sys, types

STUBBED = ("cryptography", "adb_shell", "androidtvremote2", "zeroconf", "mcp", "rsa")

class _Missing(types.ModuleType):
    __path__ = []
    def __getattr__(self, name):
        if name.startswith("__"):
            raise AttributeError(name)
        def _unavailable(*a, **k):
            raise RuntimeError(f"{self.__name__}.{name} is not available on this TV")
        return type(name, (Exception,), {"__init__": _unavailable, "__call__": _unavailable,
                                          "generate": staticmethod(_unavailable)})

class _Finder(importlib.abc.MetaPathFinder, importlib.abc.Loader):
    def find_spec(self, fullname, path, target=None):
        if fullname.split(".")[0] in STUBBED:
            return importlib.machinery.ModuleSpec(fullname, self, is_package=True)
        return None
    def create_module(self, spec):
        return _Missing(spec.name)
    def exec_module(self, module):
        pass

sys.meta_path.insert(0, _Finder())
bridge = os.path.join(os.path.dirname(os.path.abspath(__file__)), "couch-tv", "bridge")
sys.path.insert(0, bridge)
os.chdir(bridge)
sys.argv = [os.path.join(bridge, "server.py")]
runpy.run_path(sys.argv[0], run_name="__main__")
