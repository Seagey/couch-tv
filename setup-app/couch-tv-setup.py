"""Entry point for the app builds (PyInstaller). --self-test checks the build and exits."""
import sys

if "--self-test" in sys.argv:
    from couchtv_setup import selftest
    selftest.run()
else:
    from couchtv_setup.server import main
    main()
