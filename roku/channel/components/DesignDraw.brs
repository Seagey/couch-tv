' couch-tv Studio designs on a Roku: which design shows, drawing it, and getting one by code.
'
' A design comes from the bridge's config.json (design, in /api/config) or by a code typed on the Roku
' (Settings at the end of the apps, or the * key). A design got by code always asks "Use this design?"
' first, and is kept in the registry so it is still there after a restart; its pictures are kept as files
' in cachefs:. Go back to the plain home from the same Settings. The pure part (the gate, the layout, the
' code format) is DesignLib.brs; this file makes the nodes. Part of HomeScene (same m).

sub designInit()
    m.design = invalid
    m.el = {}
    m.xf = {}
    m.cfgDesign = invalid
    m.bridgeCfg = invalid
    m.imgFiles = {}
    m.imgCount = 0
    m.menuButtons = []
    m.clockOpacity = 1.0
    m.clockBySettings = false
    m.lastMinute = -1
    m.reg = CreateObject("roRegistrySection", "couchtv-design")
    m.dBg = m.top.findNode("dBg")
    m.dBack = m.top.findNode("dBack")
    m.dFront = m.top.findNode("dFront")
    m.dateG = CreateObject("roSGNode", "Group")
    m.peopleG = CreateObject("roSGNode", "Group")
    m.top.findNode("top").appendChild(m.dateG)
    m.top.findNode("top").appendChild(m.peopleG)
end sub

' after the first draw: a design got by code that was never answered asks now
sub designStart()
    designRefresh()
    if m.reg.exists("fetched") and m.reg.read("ok") <> "1" then designAsk()
end sub

' ---------- which design ----------
function designPick() as Dynamic
    if m.reg.read("off") = "1" then return invalid
    if m.reg.exists("fetched") and m.reg.read("ok") = "1"
        d = ParseJson(m.reg.read("fetched"))
        if dlIsAA(d) then return { raw: d, kept: true }
    end if
    if dlIsAA(m.cfgDesign) then return { raw: m.cfgDesign, kept: false }
    return invalid
end function

' a design is there to show (for the Settings menu), even while the plain home is chosen
function designAvailable() as Boolean
    return dlIsAA(m.cfgDesign) or (m.reg.exists("fetched") and m.reg.read("ok") = "1")
end function

sub designRefresh()
    p = designPick()
    m.design = invalid
    m.el = {}
    if p <> invalid
        m.design = dlSanitize(p.raw, p.kept)
        m.el = dlAA(m.design.elements)
        hm = dlAA(m.design.home)
        if not m.clockBySettings and dlIsStr(hm.clock) then m.clock24 = (hm.clock = "24h")
        if dlIsNum(hm.scene_seconds) then setTurn(hm.scene_seconds)
        if dlIsList(hm.scenes) and hm.scenes.count() > 0 then setSceneOrder(hm.scenes, [])
    end if
    hasBg = m.design <> invalid and m.design.background <> invalid
    for each k in ["bgA", "bgB", "fgA", "fgB"]
        m.top.findNode(k).visible = not hasBg
    end for
    if hasBg
        m.top.findNode("turn").control = "stop"
    else
        m.top.findNode("turn").control = "start"
        if m.next <> invalid and m.next.fg = invalid then m.top.findNode("fgA").visible = false
    end if
    onTick()
    if m.next <> invalid then applyScene(m.next)
    drawTop()
    drawShelf()
    drawDock()
end sub

function designPart(name as String) as Object
    return dlAA(m.el[name])
end function

' move, grow and fade one of the home's own parts (dlXf), and remember it for the focus ring
sub designPlace(node as Object, name as String, ox as Float, oy as Float)
    xf = dlXf(m.el[name], ox, oy)
    m.xf[name] = xf
    node.translation = [xf.tx, xf.ty]
    node.scale = [xf.s, xf.s]
    node.opacity = xf.o
end sub

function designNow() as Object
    dt = CreateObject("roDateTime")
    dt.toLocalTime()
    return { y: dt.getYear(), mo: dt.getMonth(), d: dt.getDayOfMonth(), wd: dt.getDayOfWeek(), h: dt.getHours(), mi: dt.getMinutes() }
end function

' the clock in the scene: hidden, moved, grown, its colour, font and 12 or 24 hours
function designClock24() as Boolean
    f = designPart("clock").format
    if dlIs(f, "24h") then return true
    if dlIs(f, "12h") then return false
    return m.clock24
end function

sub designClock(size as Integer, top as Integer)
    c = designPart("clock")
    s = dlOr(c.scale, 1.0)
    fname = "Antonio-Light"
    if dlIsStr(c.font) and c.font <> "antonio" then fname = dlFont(c.font, c.weight)
    if s <> 1 or fname <> "Antonio-Light" then m.clock.font = font(fname, Int(size * s))
    if s <> 1 then m.clock.height = Int(size * s * 1.3)
    t = m.clock.translation
    m.clock.translation = [t[0] + dlOr(c.x, 0), top + dlOr(c.y, 0)]
    if dlIsStr(c.colour) then m.clock.color = c.colour
    m.clock.visible = not dlTrue(c.hidden)
    m.clockOpacity = dlOr(c.opacity, 1.0)
    m.clock.opacity = m.clockOpacity
end sub

' the date line: its format, and whether the weather on it shows its place and words
function designDateParts() as Object
    d = designPart("date")
    w = designPart("weather")
    parts = []
    if not dlTrue(d.hidden) then parts.push(dlDateText(d.format, designNow()))
    t = weatherText()
    if not dlTrue(w.hidden) and t <> ""
        cut = Instr(1, t, "  ")
        if dlFalse(w.words) and cut > 0 then t = Left(t, cut - 1)
        if dlTrue(w.place) and dlIsStr(m.weather.place) and m.weather.place <> "" then t = m.weather.place + "  " + t
        parts.push(t)
    end if
    return parts
end function

' which part moves the date line: the date's, or the weather's when the date is hidden
function designDateName() as String
    if dlTrue(designPart("date").hidden) then return "weather"
    return "date"
end function

' ---------- drawing ----------
function designCtx() as Object
    names = []
    for each p in m.people
        if dlIsAA(p) and dlIsStr(p.name) then names.push(p.name)
    end for
    shelf = []
    if m.keepOn then shelf = m.shelf
    bridge = ""
    if hasBridge() then bridge = m.cfg.bridge
    key = ""
    if dlIsStr(m.cfg.key) then key = m.cfg.key
    return { now: designNow(), c24: m.clock24, fahrenheit: m.fahrenheit, weather: m.weather, apps: m.dockApps, people: names, shelf: shelf, bridge: bridge, key: key }
end function

sub designDraw()
    for each g in [m.dBg, m.dBack, m.dFront]
        clearGroup(g)
    end for
    m.zones.wapps = []
    if m.design = invalid
        placeFocus()
        return
    end if
    lay = dlLayout(m.design, designCtx())
    designItems(m.dBg, lay.bg)
    designItems(m.dBack, lay.back)
    designItems(m.dFront, lay.front)
    ' the remote goes through the apps in a design top to bottom, left to right
    m.zones.wapps.sortBy("order")
    placeFocus()
end sub

sub designItems(g as Object, list as Object)
    for each it in list
        n = designNode(it)
        if n <> invalid
            if it.rot <> invalid and it.rot <> 0
                n.rotation = -it.rot * 3.14159265 / 180
                n.scaleRotateCenter = [dlOr(it.cx, 0), dlOr(it.cy, 0)]
            end if
            g.appendChild(n)
        end if
    end for
end sub

function designNode(it as Object) as Dynamic
    k = it.k
    n = invalid
    if k = "rect" or (k = "nine" and (it.w < 58 or it.h < 58))
        n = CreateObject("roSGNode", "Rectangle")
        n.width = it.w
        n.height = it.h
        n.color = it.c
        n.opacity = it.o
    else if k = "nine" or k = "disc"
        n = CreateObject("roSGNode", "Poster")
        if k = "disc" then n.uri = "pkg:/images/ui/disc.png" else n.uri = "pkg:/images/ui/" + it.u + ".9.png"
        n.width = it.w
        n.height = it.h
        if it.u <> "panel" then n.blendColor = it.c
        n.opacity = it.o
    else if k = "label"
        n = CreateObject("roSGNode", "Label")
        n.font = font(it.font, it.size)
        n.color = it.c
        n.text = it.text
        n.width = it.w
        n.height = it.h
        n.horizAlign = it.align
        n.vertAlign = it.valign
        n.wrap = it.wrap
        n.opacity = it.o
    else if k = "poster"
        uri = designUri(it.u)
        if uri = "" then return invalid
        n = CreateObject("roSGNode", "Poster")
        n.uri = uri
        n.width = it.w
        n.height = it.h
        modes = { fill: "scaleToFill", zoom: "scaleToZoom", fit: "scaleToFit" }
        n.loadDisplayMode = modes[it.mode]
        n.opacity = it.o
    else if k = "app"
        if it.i >= m.dockApps.count() then return invalid
        a = m.dockApps[it.i]
        n = appTile(a, it.w)
        n.opacity = it.o
        m.zones.wapps.push({ x: it.x, y: it.y, w: it.w, h: it.h, app: a, node: n, order: it.y * 4000 + it.x })
    end if
    if n <> invalid then n.translation = [it.x, it.y]
    return n
end function

' a picture inside the design is written to a file first (a Poster cannot show a data: address)
function designUri(u as String) as String
    if Left(u, 5) <> "data:" then return u
    kind = dlDataKind(u)
    if kind = "" then return ""
    key = Len(u).toStr() + Right(u, 40)
    if m.imgFiles.doesExist(key) then return m.imgFiles[key]
    ba = CreateObject("roByteArray")
    ba.fromBase64String(dlDataBody(u))
    m.imgCount = m.imgCount + 1
    path = "tmp:/couchtv-design-" + m.imgCount.toStr() + "." + kind
    if not ba.writeFile(path) then return ""
    m.imgFiles[key] = path
    return path
end function

' one app tile, as in the dock: a letter under the app's logo
function appTile(a as Object, size as Integer) as Object
    tile = CreateObject("roSGNode", "Group")
    bg = CreateObject("roSGNode", "Rectangle")
    bg.width = size
    bg.height = size
    bg.color = "0x2A2D36FF"
    tile.appendChild(bg)
    if a.id = "_settings"
        ' Settings: three sliders
        for i = 0 to 2
            ln = CreateObject("roSGNode", "Rectangle")
            ln.width = Int(size * 0.52)
            ln.height = 4
            ln.color = "0xFFFFFFD0"
            ln.translation = [Int(size * 0.24), Int(size * (0.32 + i * 0.18))]
            tile.appendChild(ln)
            knob = CreateObject("roSGNode", "Rectangle")
            knob.width = 12
            knob.height = 16
            knob.color = "0xFFFFFFFF"
            knob.translation = [Int(size * (0.3 + ((i * 7) mod 3) * 0.14)), Int(size * (0.32 + i * 0.18)) - 6]
            tile.appendChild(knob)
        end for
        return tile
    end if
    letter = makeLabel(UCase(Left(a.title, 1)), "Inter-Medium", Int(size / 2), "0xFFFFFFE0")
    letter.width = size
    letter.height = size
    letter.horizAlign = "center"
    letter.vertAlign = "center"
    tile.appendChild(letter)
    tile.appendChild(makePoster(logoFor(a), 0, 0, size, size))
    return tile
end function

' the minute changed: a design that shows the time is drawn again
sub designTick(mi as Integer)
    if mi = m.lastMinute then return
    m.lastMinute = mi
    if m.design <> invalid and dlHasTime(m.design) then designDraw()
end sub

' new weather, people, Keep watching or apps: the design's widgets that show them are drawn again
sub designData()
    if m.design <> invalid then designDraw()
end sub

' ---------- the Settings menu ----------
sub openMenu()
    d = CreateObject("roSGNode", "StandardMessageDialog")
    if d = invalid then return
    d.title = "couch-tv Studio"
    msg = "This TV shows the plain home."
    if m.design <> invalid then msg = "This TV shows a design from couch-tv Studio."
    d.message = [msg]
    btns = ["Get a design by code"]
    if m.design <> invalid
        btns.push("Go back to the plain home")
    else if designAvailable()
        btns.push("Show the design")
    end if
    btns.push("Close")
    d.buttons = btns
    m.menuButtons = btns
    d.observeField("buttonSelected", "onMenuButton")
    m.top.dialog = d
end sub

sub onMenuButton()
    d = m.top.dialog
    if d = invalid then return
    choice = m.menuButtons[d.buttonSelected]
    d.close = true
    if choice = "Get a design by code"
        openCodeDialog()
    else if choice = "Go back to the plain home"
        m.reg.write("off", "1")
        m.reg.flush()
        designRefresh()
        say("The plain home is back. Settings, Show the design brings the design back.")
    else if choice = "Show the design"
        m.reg.delete("off")
        m.reg.flush()
        designRefresh()
    end if
end sub

sub openCodeDialog()
    d = CreateObject("roSGNode", "StandardKeyboardDialog")
    if d = invalid then return
    d.title = "Get a design"
    d.message = ["Type the code from couch-tv Studio. It looks like ABCDE-FGHJK."]
    d.buttons = ["Get it", "Cancel"]
    d.observeField("buttonSelected", "onCodeButton")
    m.top.dialog = d
end sub

sub onCodeButton()
    d = m.top.dialog
    if d = invalid then return
    typed = d.text
    pressed = d.buttonSelected
    d.close = true
    if pressed = 0 then getDesign(typed)
end sub

sub getDesign(typed as String)
    code = dlReadCode(typed)
    if code = ""
        say("That is not a design code. It looks like ABCDE-FGHJK.", true)
        return
    end if
    cfg = {}
    if m.bridgeCfg <> invalid then cfg = m.bridgeCfg
    base = dlStoreFor(cfg)
    if base = ""
        say("Getting a design by code is switched off on this TV (design_store in config.json).", true)
        return
    end if
    say("Getting the design...")
    fetch("designcode", base + "/v1/designs/fetch", "POST", FormatJson({ code: code }), 15000)
end sub

sub designFetched(status as Integer, body as String)
    problem = dlFetchProblem(status)
    if problem <> ""
        say(problem, true)
        return
    end if
    d = dlAccept(body)
    if d = invalid
        say("That design could not be used.", true)
        return
    end if
    if not designKeep(d)
        say("This TV has no room to keep that design.", true)
        return
    end if
    say("")
    designAsk()
end sub

' Keep a design got by code: its pictures as files in cachefs: (the registry holds 16 KB in all), the
' rest in the registry. Any yes or no given before is forgotten, so the question always comes first.
function designKeep(d as Object) as Boolean
    bg = d.background
    if dlIsAA(bg) and dlIsStr(bg.image) and Left(bg.image, 5) = "data:"
        name = designKeepFile(bg.image, 0)
        if name = "" then bg.delete("image") else bg.image = name
    end if
    ' a widget's own photo, and the photo of each item in a smart stack, each a file of its own (1 to 99)
    n = 0
    for each o in dlList(d.objects)
        if dlIsAA(o)
            n = designKeepPhoto(o, n)
            for each it in dlList(o.items)
                if dlIsAA(it) then n = designKeepPhoto(it, n)
            end for
        end if
    end for
    text = FormatJson(d)
    if Len(text) > 15000 then return false
    m.reg.write("fetched", text)
    m.reg.delete("ok")
    m.reg.delete("off")
    return m.reg.flush()
end function

' files o.opts.image when it is a picture inside the design (n photos filed so far); a photo that cannot
' be filed is left out, so the design is never kept with it inline
function designKeepPhoto(o as Object, n as Integer) as Integer
    if not dlIsAA(o.opts) or not dlIsStr(o.opts.image) or Left(o.opts.image, 5) <> "data:" then return n
    n = n + 1
    name = ""
    if n < 100 then name = designKeepFile(o.opts.image, n)
    if name = "" then o.opts.delete("image") else o.opts.image = name
    return n
end function

function designKeepFile(u as String, n as Integer) as String
    kind = dlDataKind(u)
    if kind = "" then return ""
    ba = CreateObject("roByteArray")
    ba.fromBase64String(dlDataBody(u))
    name = n.toStr() + "." + kind
    if not ba.writeFile("cachefs:/couchtv-design-" + name) then return ""
    return "kept:" + name
end function

sub designAsk()
    d = CreateObject("roSGNode", "StandardMessageDialog")
    if d = invalid then return
    d.title = "Use this design?"
    d.message = ["A design from couch-tv Studio is ready. It changes how this home looks. You can go back to the plain home any time from Settings, at the end of the apps."]
    d.buttons = ["Yes", "No"]
    d.observeField("buttonSelected", "onAskButton")
    m.top.dialog = d
end sub

sub onAskButton()
    d = m.top.dialog
    if d = invalid then return
    yes = d.buttonSelected = 0
    d.close = true
    if yes
        m.reg.write("ok", "1")
        m.reg.delete("off")
    else
        m.reg.delete("fetched")
        m.reg.delete("ok")
    end if
    m.reg.flush()
    designRefresh()
end sub
