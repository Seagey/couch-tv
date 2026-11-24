"""Screenshots of the Setup page for the approved mockups (03 to 07, 16) and the other states, at 1440 wide.

    python setup-app/tests/ui_shots.py <folder> [width height]
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import ui_harness as uh  # noqa: E402


def many(n):
    names = ["Lounge TV 2", "Guest Room TV", "Garage TV", "Kids Room TV", "Study TV", "Granny Flat TV"]
    return [uh.row(f"192.0.2.{30 + i}", names[i % len(names)], "ready" if i % 3 != 2 else "switch", adb_5555=i % 3 != 2) for i in range(n)]


def sign_in(pg):
    pg.wait_for_selector("#acct-box:not([hidden])")
    pg.fill("#acct-code", "ABCD-EFGH")
    pg.click("#acct-go")
    pg.wait_for_selector("#link-ask:not([hidden])")      # whose account: nothing is used until Yes
    pg.click("#link-ask-yes")
    pg.wait_for_selector("#acct-top:not([hidden])")


def go_to_plan(pg, name="Lounge TV 2"):
    pg.click("#setup-start")
    pg.wait_for_selector("#found .tvc")
    pg.click("#found .tvc >> text=Set up this TV")
    pg.wait_for_selector('section[data-step="plan"]:not([hidden])', timeout=20000)


def main(out, w=1440, h=900):
    os.makedirs(out, exist_ok=True)
    pw, br = uh.chromium()
    if not br:
        sys.exit("no browser")

    def page(harness):
        harness.start()
        ctx = br.new_context(viewport={"width": w, "height": h}, device_scale_factor=1)
        pg = ctx.new_page()
        pg.goto(harness.url)
        pg.wait_for_selector("#setup-start")
        return pg, ctx

    def shot(pg, name):
        pg.wait_for_timeout(350)
        pg.screenshot(path=os.path.join(out, f"{name}-{w}.png"))

    # welcome, signed in (03)
    hh = uh.Harness(stub=uh.stub_account())
    pg, ctx = page(hh)
    sign_in(pg)
    shot(pg, "03-welcome")
    # find with three TVs and one Details open (04)
    pg.click("#setup-start")
    pg.wait_for_selector("#found .tvc")
    pg.click("#found .tvc:first-child .det")
    shot(pg, "04-find")
    # help page
    pg.click("#nohere-go")
    shot(pg, "04b-my-tv-isnt-here")
    pg.click("#back")
    pg.wait_for_selector("#found .tvc")
    # plan (05, 05b)
    pg.click("#found .tvc:first-child >> text=Set up this TV")
    pg.wait_for_selector('section[data-step="plan"]:not([hidden])')
    pg.wait_for_selector("#plan-list li", state="attached")
    shot(pg, "05-plan")
    pg.click("#plan-details > summary")
    shot(pg, "05b-plan-what-will-change")
    ctx.close()
    hh.stop()

    # progress (06), then finish linked (07)
    hh = uh.Harness(stub=uh.stub_account(), slow=6.0)
    pg, ctx = page(hh)
    sign_in(pg)
    go_to_plan(pg)
    pg.click("#setup-go")
    pg.wait_for_selector('section[data-step="work"]:not([hidden])')
    pg.wait_for_timeout(3400)
    shot(pg, "06-progress")
    pg.wait_for_selector('section[data-step="done"]:not([hidden])', timeout=30000)
    shot(pg, "07-finish")
    # a second TV, installed but not linked (16 needs the account to fail registering)
    ctx.close()
    hh.stop()

    hh = uh.Harness(stub=dict(uh.stub_account(), **{"/v1/setup/tv": {"error": "no"}}), features=["reset-tv", "link-tv"])
    pg, ctx = page(hh)
    sign_in(pg)
    go_to_plan(pg)
    pg.click("#setup-go")
    pg.wait_for_selector('section[data-step="done"]:not([hidden])', timeout=30000)
    shot(pg, "16-finish-not-linked")
    ctx.close()
    hh.stop()

    # no TVs, and many TVs
    hh = uh.Harness(rows=[])
    pg, ctx = page(hh)
    pg.click("#setup-start")
    pg.wait_for_selector("#find-help:not([hidden])")
    shot(pg, "find-zero")
    ctx.close()
    hh.stop()
    hh = uh.Harness(rows=many(7) + [uh.row("192.0.2.99", "Looking one", "switch", adb_5555=False, stale=True),
                                    uh.row("192.0.2.98", "Helper TV", "other", other="Tizen", android=False)])
    pg, ctx = page(hh)
    pg.click("#setup-start")
    pg.wait_for_selector("#found .tvc")
    shot(pg, "find-many")
    ctx.close()
    hh.stop()
    br.close()
    pw.stop()
    print("shots in", out)


if __name__ == "__main__":
    main(sys.argv[1], *(int(a) for a in sys.argv[2:4]))
