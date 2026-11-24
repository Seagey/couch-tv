"""Screenshots of Setup with account linking ON (the 0.13.15 build), and a width check of the Finish screen.

    python setup-app/tests/ui_shots_link.py <folder>

Shots (1440 wide, and 390 for the question): the "Link as ...?" question, Finish linked (07), Finish installed but
not linked (16), the link panel, the question on Finish, a refused link. Then the Finish screen is laid out at every
width from 1100 to 1440 (step 20) and the big button must never run under the TV picture.
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import ui_harness as uh  # noqa: E402
import ui_shots as us  # noqa: E402


def main(out):
    os.makedirs(out, exist_ok=True)
    pw, br = uh.chromium()
    if not br:
        sys.exit("no browser")

    def page(harness, w=1440, h=900):
        harness.start()
        ctx = br.new_context(viewport={"width": w, "height": h}, device_scale_factor=1)
        pg = ctx.new_page()
        pg.goto(harness.url)
        pg.wait_for_selector("#setup-start")
        return pg, ctx

    def shot(pg, name, w=1440):
        pg.wait_for_timeout(350)
        pg.screenshot(path=os.path.join(out, f"{name}-{w}.png"))

    # the question, before any Yes (welcome)
    for w, h in ((1440, 900), (390, 900)):
        hh = uh.Harness(stub=uh.stub_account())
        pg, ctx = page(hh, w, h)
        pg.wait_for_selector("#acct-box:not([hidden])")
        pg.fill("#acct-code", "ABCD-EFGH")
        pg.click("#acct-go")
        pg.wait_for_selector("#link-ask:not([hidden])")
        shot(pg, "20-link-ask-welcome", w)
        ctx.close()
        hh.stop()

    # Finish, linked (07), at the widths the owner looks at; the button must not run under the picture
    hh = uh.Harness(stub=uh.stub_account())
    pg, ctx = page(hh)
    us.sign_in(pg)
    shot(pg, "21-welcome-signed-in")
    us.go_to_plan(pg)
    pg.click("#setup-go")
    pg.wait_for_selector('section[data-step="tidy"]:not([hidden]), section[data-step="done"]:not([hidden])', timeout=30000)
    if pg.locator('section[data-step="tidy"]:not([hidden])').count():
        shot(pg, "22-tidy")
        pg.click("#tidy-skip")
    pg.wait_for_selector('section[data-step="done"]:not([hidden])')
    shot(pg, "23-finish-linked")
    bad = []
    for w in range(1100, 1441, 20):
        pg.set_viewport_size({"width": w, "height": 900})
        pg.wait_for_timeout(150)
        btn = pg.locator("#studio-cta").bounding_box()
        art = pg.locator(".fin-art").bounding_box()
        scroll = pg.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")
        hit = btn and art and btn["x"] + btn["width"] > art["x"] + 0.5 and btn["y"] < art["y"] + art["height"] and btn["y"] + btn["height"] > art["y"]
        if not btn or not art or hit or scroll > 0:
            bad.append((w, btn, art, scroll))
        if w in (1100, 1280, 1440):
            shot(pg, "24-finish-linked", w)
    ctx.close()
    hh.stop()
    assert not bad, "the Finish button runs under the picture, or the page scrolls sideways: " + repr(bad)

    # Finish, installed but not linked (16), the link panel, the question on Finish, a refused link
    hh = uh.Harness(stub=dict(uh.stub_account(), **{"/v1/setup/tv": {"error": "no"}}), features=["reset-tv", "link-tv"])
    pg, ctx = page(hh)
    us.go_to_plan(pg)
    pg.click("#setup-go")
    pg.wait_for_selector('section[data-step="tidy"]:not([hidden]), section[data-step="done"]:not([hidden])', timeout=30000)
    if pg.locator('section[data-step="tidy"]:not([hidden])').count():
        pg.click("#tidy-skip")
    pg.wait_for_selector('section[data-step="done"]:not([hidden])')
    shot(pg, "25-finish-not-linked")
    pg.click("#link-cta")
    pg.wait_for_selector("#fl-panel:not([hidden])")
    shot(pg, "26-link-panel")
    pg.fill("#fl-code", "ABCD-EFGH")
    pg.click("#fl-go")
    pg.wait_for_selector("#link-ask:not([hidden])")
    shot(pg, "27-link-ask-on-finish")
    pg.click("#link-ask-yes")
    pg.wait_for_selector("#link-status:not([hidden])")
    pg.wait_for_timeout(1500)
    shot(pg, "28-link-refused")
    ctx.close()
    hh.stop()
    br.close()
    pw.stop()
    print("shots in", out)


if __name__ == "__main__":
    main(sys.argv[1])
