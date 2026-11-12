' The couch-tv home on a Roku.
'
' What it shows, top to bottom: the scene photo with the clock in it (the cut-out of the scenery is drawn
' over the digits), the people switch, the date and weather, Keep watching, and the apps. The bridge (a
' computer at home, its address baked in by roku/build.py into pkg:/config.json) supplies the weather,
' the people, Keep watching and the apps, and is asked to open them. With no bridge, or when it does not
' answer, the clock, the date and the apps still work: the apps come from this Roku (ECP on 127.0.0.1:8060)
' and are opened the same way.
'
' Not tried on a real Roku yet (docs/ROKU.md).

sub init()
    m.cfg = readJson("pkg:/config.json")
    if m.cfg = invalid then m.cfg = {}
    sc = readJson("pkg:/scenes.json")
    m.scenes = []
    if sc <> invalid then m.scenes = sc.scenes
    m.order = []
    for each s in m.scenes
        m.order.push(s.id)
    end for
    m.sceneIdx = -1
    m.sceneId = ""
    m.clock24 = false
    m.keepOn = true
    m.fahrenheit = false
    m.people = []
    m.who = ""
    m.weather = invalid
    m.shelf = []
    m.apps = []
    m.focusZone = "dock"
    m.focusIdx = 0
    m.focusSet = false
    m.dockFirst = 0
    m.zones = { people: [], shelf: [], dock: [] }
    m.fonts = {}
    m.tasks = []
    m.dateWidgets = []
    m.localApps = false
    m.refreshCount = 0
    m.peopleWidgets = []
    m.shownWho = ""
    m.pendingLocal = invalid
    m.dateText = invalid
    m.next = invalid
    ' the dock's place and size on the 1920x1080 screen (from the TV home's style sheet)
    m.k = { dockX: 118, dockY: 878, dockW: 1684, dockH: 156, tile: 112, pitch: 138, cap: 12 }

    m.clock = m.top.findNode("clock")
    m.clock.font = font("Antonio-Light", 400)
    m.status = m.top.findNode("status")
    m.status.font = font("Inter-Medium", 26)
    m.status.color = "0xFFFFFFE0"
    m.focusRing = m.top.findNode("focus")
    m.dockClip = invalid

    m.top.findNode("tick").observeField("fire", "onTick")
    m.top.findNode("turn").observeField("fire", "onTurn")
    m.top.findNode("swap").observeField("fire", "onSwap")
    m.top.findNode("refresh").observeField("fire", "onRefresh")
    m.top.findNode("msg").observeField("fire", "onMsgDone")
    m.top.findNode("fade").observeField("state", "onFadeState")
    m.top.findNode("tick").control = "start"
    m.top.findNode("refresh").control = "start"

    onTick()
    showScene(0, true)
    m.top.findNode("turn").control = "start"
    loadAll()
end sub

' ---------- small helpers ----------
function readJson(path as String) as Dynamic
    text = ReadAsciiFile(path)
    if text = "" then return invalid
    return ParseJson(text)
end function

function font(name as String, size as Integer) as Object
    key = name + "-" + size.toStr()
    if not m.fonts.doesExist(key)
        f = CreateObject("roSGNode", "Font")
        f.uri = "pkg:/fonts/" + name + ".ttf"
        f.size = size
        m.fonts[key] = f
    end if
    return m.fonts[key]
end function

function makeLabel(text as String, fontName as String, size as Integer, color as String) as Object
    l = CreateObject("roSGNode", "Label")
    l.font = font(fontName, size)
    l.color = color
    l.text = text
    l.wrap = false
    return l
end function

function makePoster(uri as String, x as Integer, y as Integer, w as Integer, h as Integer) as Object
    p = CreateObject("roSGNode", "Poster")
    p.uri = uri
    p.translation = [x, y]
    p.width = w
    p.height = h
    p.loadDisplayMode = "scaleToZoom"
    return p
end function

function textWidth(text as String, fontName as String, size as Integer) as Integer
    l = makeLabel(text, fontName, size, "0xFFFFFFFF")
    return Int(l.boundingRect().width)
end function

sub clearGroup(g as Object)
    g.removeChildrenIndex(g.getChildCount(), 0)
end sub

' A web request. onFetched() sorts the answers by their tag.
sub fetch(tag as String, url as String, method = "GET" as String, body = "" as String)
    t = CreateObject("roSGNode", "Fetch")
    t.tag = tag
    t.url = url
    t.method = method
    t.body = body
    t.observeField("done", "onFetched")
    m.tasks.push(t)
    t.control = "run"
end sub

function bridgeUrl(path as String) as String
    url = m.cfg.bridge + path
    if m.cfg.tv <> invalid and m.cfg.tv <> ""
        if Instr(1, url, "?") > 0 then url = url + "&" else url = url + "?"
        url = url + "tv=" + m.cfg.tv
    end if
    return withKey(url)
end function

' The bridge's pairing key, when it has one (config.json bridge.pairing_key, couch-tv#73).
function withKey(url as String) as String
    if m.cfg.key <> invalid and m.cfg.key <> ""
        if Instr(1, url, "?") > 0 then url = url + "&" else url = url + "?"
        url = url + "key=" + m.cfg.key
    end if
    return url
end function

function hasBridge() as Boolean
    return m.cfg.bridge <> invalid and m.cfg.bridge <> ""
end function

sub say(text as String, bad = false as Boolean)
    m.status.text = text
    m.status.color = "0xFFFFFFE0"
    if bad then m.status.color = "0xFFB4A8FF"
    m.top.findNode("msg").control = "stop"
    m.top.findNode("msg").control = "start"
end sub

sub onMsgDone()
    showFocusName()
end sub

' ---------- loading ----------
sub loadAll()
    if hasBridge()
        fetch("config", bridgeUrl("/api/config"))
        fetch("settings", bridgeUrl("/api/settings"))
        fetch("people", bridgeUrl("/api/people"))
        fetch("who", bridgeUrl("/api/who"))
        fetch("weather", bridgeUrl("/api/weather"))
        fetchContinue("/api/continue")
        fetch("apps", bridgeUrl("/api/roku/apps"))
    else
        fetchLocalApps()
    end if
end sub

' Keep watching can be switched off (home.keep_watching, or Home settings): then it is not asked for at all.
sub fetchContinue(path as String)
    if m.keepOn then fetch("continue", bridgeUrl(path))
end sub

sub setKeepOn(on as Boolean)
    if on = m.keepOn then return
    m.keepOn = on
    if on
        if hasBridge() then fetchContinue("/api/continue")
    else
        m.shelf = []
        drawShelf()
    end if
end sub

sub onRefresh()
    m.refreshCount = m.refreshCount + 1
    if hasBridge()
        fetchContinue("/api/continue")
        fetch("apps", bridgeUrl("/api/roku/apps"))
        fetch("who", bridgeUrl("/api/who"))
        if m.refreshCount mod 10 = 0 then fetch("weather", bridgeUrl("/api/weather"))
    else
        fetchLocalApps()
    end if
end sub

sub fetchLocalApps()
    ' Roku OS 16 refuses a channel's own ECP (403), so build.py --apps-from can put the list in the zip
    if m.apps.count() = 0 and m.cfg <> invalid and m.cfg.apps <> invalid and m.cfg.apps.count() > 0
        list = []
        for each a in m.cfg.apps
            icon = ""
            if a.icon <> invalid then icon = a.icon
            list.push({ id: a.id, title: a.title, package: "", icon: icon })
        end for
        m.apps = list
        m.localApps = true
        drawDock()
    end if
    fetch("localapps", "http://127.0.0.1:8060/query/apps")
end sub

' Open an app without ECP, for when the Roku refuses the channel's own ECP (403).
sub launchDirect(id as String)
    am = CreateObject("roAppManager")
    if am <> invalid and FindMemberFunction(am, "LaunchApp") <> invalid
        am.LaunchApp(id, "", {})
        say("")
    else
        say("This Roku would not open that app from couch-tv.", true)
    end if
end sub

sub onFetched(event as Object)
    t = event.getRoSGNode()
    tag = t.tag
    status = t.status
    body = t.response
    ' the finished task is no longer needed
    keep = []
    for each x in m.tasks
        if not x.isSameNode(t) then keep.push(x)
    end for
    m.tasks = keep
    j = invalid
    if status = 200 and body <> "" then j = ParseJson(body)

    if tag = "config"
        if j <> invalid and j.home <> invalid
            if j.home.keep_watching = false then setKeepOn(false)
            if j.home.clock = "24h" then m.clock24 = true
            if j.home.clock = "12h" then m.clock24 = false
            if j.home.scene_seconds <> invalid then setTurn(j.home.scene_seconds)
            if j.home.scenes <> invalid then setSceneOrder(j.home.scenes, [])
        end if
    else if tag = "settings"
        if j <> invalid and j.settings <> invalid then applySettings(j.settings)
    else if tag = "people"
        if j <> invalid and j.people <> invalid
            m.people = j.people
            drawTop()
        end if
    else if tag = "who"
        if j <> invalid and j.who <> invalid
            m.who = j.who
            if m.who <> m.shownWho
                m.shownWho = m.who
                drawTop()
                if hasBridge() then fetchContinue("/api/continue")
            end if
        end if
    else if tag = "weather"
        if j <> invalid and j.temp <> invalid then m.weather = j
        drawDate()
    else if tag = "continue"
        if j <> invalid and j.items <> invalid
            m.shelf = j.items
            drawShelf()
        end if
    else if tag = "apps"
        if j <> invalid and j.apps <> invalid
            m.apps = j.apps
            m.localApps = false
            drawDock()
        else if m.apps.count() = 0
            say("The couch-tv bridge did not answer. Showing the Roku's own apps.", true)
            fetchLocalApps()
        end if
    else if tag = "localapps"
        parseLocalApps(body)
    else if tag = "localhome"
        if status = 403 and m.pendingLocal <> invalid then launchDirect(m.pendingLocal)
    else if tag = "launch"
        if status = 200
            say("")
        else if m.pendingLocal <> invalid and (status <= 0 or status >= 500)
            ' the bridge is not there: ask this Roku to open it itself
            fetch("localhome", "http://127.0.0.1:8060/launch/" + m.pendingLocal, "POST")
        else
            msg = "That did not open."
            if j <> invalid and j.error <> invalid then msg = j.error
            say(msg, true)
        end if
    else if tag = "continueopen"
        if status = 200
            say("")
        else
            msg = "That did not open."
            if j <> invalid and j.error <> invalid then msg = j.error
            say(msg, true)
        end if
    end if
end sub

sub applySettings(s as Object)
    if s.keep_watching <> invalid then setKeepOn(s.keep_watching = true)
    if s.clock = "24h" then m.clock24 = true
    if s.clock = "12h" then m.clock24 = false
    if s.wx_unit = "f" then m.fahrenheit = true
    if s.wx_unit = "c" then m.fahrenheit = false
    if s.scene_seconds <> invalid then setTurn(s.scene_seconds)
    if s.scene_order <> invalid
        off = []
        if s.scenes_off <> invalid then off = s.scenes_off
        setSceneOrder(s.scene_order, off)
    end if
    onTick()
    drawDate()
end sub

sub setTurn(seconds as Dynamic)
    n = Val(seconds.toStr())
    if n < 5 then n = 5
    m.top.findNode("turn").duration = n
end sub

' The scenes the TV settings name (ids of the built in ones; a photo or your own scene is skipped, it is not on the Roku).
sub setSceneOrder(ids as Object, off as Object)
    known = {}
    for each s in m.scenes
        known[s.id] = true
    end for
    order = []
    for each id in ids
        skip = false
        for each o in off
            if o = id then skip = true
        end for
        if known.doesExist(id) and not skip then order.push(id)
    end for
    if order.count() = 0 then return
    m.order = order
    ' the scene showing is not one of them any more: change to the first
    shown = false
    for each id in order
        if id = m.sceneId then shown = true
    end for
    if not shown then showScene(0, false)
end sub

sub parseLocalApps(body as String)
    xml = CreateObject("roXMLElement")
    if not xml.parse(body) then return
    list = []
    for each el in xml.getChildElements()
        a = el.getAttributes()
        if a.id <> invalid and a.id <> "dev" and a.type = "appl"
            list.push({ id: a.id, title: el.getText(), package: "", icon: "http://127.0.0.1:8060/query/icon/" + a.id })
        end if
    end for
    if list.count() > 0
        m.apps = list
        m.localApps = true
        drawDock()
    end if
end sub

' ---------- the scene, the clock and the date ----------
sub onTick()
    dt = CreateObject("roDateTime")
    dt.toLocalTime()
    h = dt.getHours()
    mi = dt.getMinutes()
    if not m.clock24
        h = h mod 12
        if h = 0 then h = 12
    end if
    hh = h.toStr()
    if m.clock24 and h < 10 then hh = "0" + hh
    mm = mi.toStr()
    if mi < 10 then mm = "0" + mm
    m.clock.text = hh + ":" + mm
    day = dt.getDayOfMonth()
    months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
    dateText = dt.getWeekday() + " " + day.toStr() + " " + months[dt.getMonth() - 1]
    if dateText <> m.dateText
        m.dateText = dateText
        drawDate()
    end if
end sub

sub onTurn()
    if m.order.count() > 1 then showScene(m.sceneIdx + 1, false)
end sub

function sceneById(id as String) as Object
    for each s in m.scenes
        if s.id = id then return s
    end for
    return m.scenes[0]
end function

' Show scene number n of the order. First: no fade. Otherwise the new photo comes up in the B layer over 1.6 s,
' the clock fades out and back in as it moves, and onFadeState() makes B the front layer.
sub showScene(n as Integer, first as Boolean)
    if m.scenes.count() = 0 then return
    if n >= m.order.count() then n = 0
    s = sceneById(m.order[n])
    m.sceneIdx = n
    m.sceneId = s.id
    m.next = s
    layers = "A"
    if not first then layers = "B"
    m.top.findNode("bg" + layers).uri = s.photo
    m.top.findNode("bg" + layers).blendColor = shade(s.bright)
    fg = m.top.findNode("fg" + layers)
    if s.fg <> invalid
        fg.uri = s.fg.uri
        fg.translation = [s.fg.x, s.fg.y]
        fg.width = s.fg.w
        fg.height = s.fg.h
        fg.blendColor = shade(s.bright)
        fg.visible = true
    else
        fg.visible = false
    end if
    if first
        applyScene(s)
    else
        m.top.findNode("fade").control = "start"
        m.top.findNode("swap").control = "start"
    end if
end sub

function shade(b as Float) as String
    v = Int(b * 255)
    h = StrI(v, 16)
    if Len(h) < 2 then h = "0" + h
    return "0x" + h + h + h + "FF"
end function

' The clock's size, place and colour for this scene (the numbers come from the TV home's style sheet).
sub applyScene(s as Object)
    c = s.clock
    size = c.size
    m.clock.font = font("Antonio-Light", size)
    ' The web page puts the line box at c.top with a line height of 0.82. A Label draws from the top of
    ' Antonio's full line (ascent 1.155 em), so the label goes 0.237 em above c.top to land the digits in the same place.
    m.clock.vertAlign = "top"
    m.clock.height = Int(size * 1.3)
    top = c.top - Int(size * 0.237)
    m.clock.translation = [0, top]
    if c.x = "left"
        m.clock.horizAlign = "left"
        m.clock.width = 1400
        m.clock.translation = [c.left, top]
    else
        m.clock.horizAlign = "center"
        m.clock.width = 1920
    end if
    a = Int(s.alpha * 255)
    ah = StrI(a, 16)
    if Len(ah) < 2 then ah = "0" + ah
    m.clock.color = "0x" + s.ink + ah
    drawDate()
end sub

sub onSwap()
    if m.next <> invalid then applyScene(m.next)
end sub

sub onFadeState()
    if m.top.findNode("fade").state <> "stopped" then return
    ' B is now showing: copy it to A and hide B
    for each k in ["bg", "fg"]
        a = m.top.findNode(k + "A")
        b = m.top.findNode(k + "B")
        a.uri = b.uri
        a.translation = b.translation
        a.width = b.width
        a.height = b.height
        a.blendColor = b.blendColor
        a.visible = b.visible
        b.opacity = 0
    end for
    m.clock.opacity = 1
end sub

sub drawDate()
    top = m.top.findNode("top")
    for each w in m.dateWidgets
        top.removeChild(w)
    end for
    m.dateWidgets = []
    if m.dateText = invalid or m.next = invalid then return
    s = m.next
    parts = [m.dateText]
    wx = weatherText()
    if wx <> "" then parts.push(wx)
    gap = 20
    widths = []
    total = 0
    for each p in parts
        w = textWidth(p, "Inter-Medium", 36)
        widths.push(w)
        total = total + w
    end for
    total = total + gap * (parts.count() - 1)
    padX = 28
    x = Int((1920 - total) / 2)
    if s.date.x = "left" then x = s.date.left + padX
    y = s.date.y
    ' dark glass behind light text, light glass behind the dark text of the fog scene
    glass = "pkg:/images/ui/panel.9.png"
    if s.text = "16201D" then glass = "pkg:/images/ui/pill.9.png"
    pill = makePoster(glass, x - padX, y - 10, total + padX * 2, 64)
    pill.loadDisplayMode = "noScale"
    m.dateWidgets.push(pill)
    top.appendChild(pill)
    for i = 0 to parts.count() - 1
        color = "0x" + s.text + "F0"
        if i > 0 then color = "0x" + s.text + "C0"
        l = makeLabel(parts[i], "Inter-Medium", 36, color)
        l.translation = [x, y]
        l.height = 44
        l.vertAlign = "center"
        m.dateWidgets.push(l)
        top.appendChild(l)
        x = x + widths[i] + gap
    end for
end sub

function weatherText() as String
    w = m.weather
    if w = invalid or w.temp = invalid then return ""
    t = w.temp
    unit = "C"
    if m.fahrenheit
        t = Int(w.temp * 9 / 5 + 32 + 0.5)
        unit = "F"
    end if
    out = t.toStr() + Chr(176) + unit
    if w.text <> invalid and w.text <> "" then out = out + "  " + w.text
    return out
end function

' ---------- people ----------
sub drawTop()
    g = m.top.findNode("top")
    for each w in m.peopleWidgets
        g.removeChild(w)
    end for
    m.peopleWidgets = []
    m.zones.people = []
    if m.people.count() < 2
        placeFocus()
        return
    end if
    n = m.people.count()
    if n > 6 then n = 6
    x = 78
    labels = []
    total = 0
    for i = 0 to n - 1
        w = textWidth(m.people[i].name, "Inter-Medium", 30) + 50
        labels.push(w)
        total = total + w
    end for
    bar = makePoster("pkg:/images/ui/panel.9.png", x, 60, total + 8, 56)
    bar.loadDisplayMode = "noScale"
    m.peopleWidgets.push(bar)
    g.appendChild(bar)
    px = x + 4
    for i = 0 to n - 1
        p = m.people[i]
        on = (p.id = m.who)
        if on
            hi = makePoster("pkg:/images/ui/pill-on.9.png", px, 64, labels[i], 48)
            hi.loadDisplayMode = "noScale"
            m.peopleWidgets.push(hi)
            g.appendChild(hi)
        end if
        color = "0xFFFFFFE0"
        if on then color = "0x14161CFF"
        l = makeLabel(p.name, "Inter-Medium", 30, color)
        l.translation = [px, 64]
        l.width = labels[i]
        l.height = 48
        l.horizAlign = "center"
        l.vertAlign = "center"
        m.peopleWidgets.push(l)
        g.appendChild(l)
        m.zones.people.push({ x: px, y: 64, w: labels[i], h: 48, id: p.id, name: p.name })
        px = px + labels[i]
    end for
    placeFocus()
end sub

' ---------- Keep watching ----------
sub drawShelf()
    g = m.top.findNode("shelf")
    clearGroup(g)
    m.zones.shelf = []
    if not m.keepOn or m.shelf.count() = 0
        placeFocus()
        return
    end if
    head = makeLabel("Keep watching", "Inter-Medium", 28, "0xFFFFFFE6")
    head.translation = [80, 636]
    g.appendChild(head)
    n = m.shelf.count()
    if n > 3 then n = 3
    for i = 0 to n - 1
        it = m.shelf[i]
        x = 80 + i * 542
        y = 692
        g.appendChild(makePanel(x, y, 520, 142))
        if it.poster <> invalid and it.poster <> ""
            g.appendChild(makePoster(it.poster, x + 16, y + 24, 168, 95))
        end if
        svc = ""
        if it.app <> invalid and it.app.name <> invalid then svc = UCase(it.app.name)
        a = makeLabel(svc, "Inter-Regular", 20, "0xFFFFFFB0")
        a.translation = [x + 200, y + 18]
        a.width = 300
        g.appendChild(a)
        t = makeLabel(it.title, "Inter-Medium", 32, "0xFFFFFFFF")
        t.translation = [x + 200, y + 46]
        t.width = 300
        t.height = 40
        t.wrap = false
        g.appendChild(t)
        sub1 = episodeText(it)
        if sub1 <> ""
            e = makeLabel(sub1, "Inter-Regular", 24, "0xFFFFFFB8")
            e.translation = [x + 200, y + 90]
            e.width = 300
            g.appendChild(e)
        end if
        if it.progress <> invalid
            g.appendChild(makeBar(x + 200, y + 126, 300, it.progress))
        end if
        m.zones.shelf.push({ x: x, y: y, w: 520, h: 142, id: it.id, title: it.title })
    end for
    placeFocus()
end sub

function episodeText(it as Object) as String
    if it.season <> invalid and it.episode <> invalid then return "S" + it.season.toStr() + " E" + it.episode.toStr()
    if it.episode_title <> invalid and it.episode_title <> "" then return it.episode_title
    return ""
end function

function makePanel(x as Integer, y as Integer, w as Integer, h as Integer) as Object
    p = CreateObject("roSGNode", "Poster")
    p.uri = "pkg:/images/ui/panel.9.png"
    p.translation = [x, y]
    p.width = w
    p.height = h
    return p
end function

function makeBar(x as Integer, y as Integer, w as Integer, share as Float) as Object
    g = CreateObject("roSGNode", "Group")
    g.translation = [x, y]
    back = CreateObject("roSGNode", "Rectangle")
    back.width = w
    back.height = 4
    back.color = "0xFFFFFF33"
    g.appendChild(back)
    fill = CreateObject("roSGNode", "Rectangle")
    fill.width = Int(w * share)
    fill.height = 4
    fill.color = "0xFFFFFFFF"
    g.appendChild(fill)
    return g
end function

' ---------- the dock ----------
sub drawDock()
    g = m.top.findNode("dock")
    clearGroup(g)
    m.zones.dock = []
    g.appendChild(makePanel(m.k.dockX, m.k.dockY, m.k.dockW, m.k.dockH))
    m.dockClip = CreateObject("roSGNode", "Group")
    m.dockClip.translation = [m.k.dockX + 14, m.k.dockY]
    m.dockClip.clippingRect = { x: -10, y: -10, width: m.k.dockW - 28 + 20, height: m.k.dockH + 20 }
    g.appendChild(m.dockClip)
    for i = 0 to m.apps.count() - 1
        a = m.apps[i]
        tile = CreateObject("roSGNode", "Group")
        tile.translation = [13 + i * m.k.pitch, 22]
        bg = CreateObject("roSGNode", "Rectangle")
        bg.width = m.k.tile
        bg.height = m.k.tile
        bg.color = "0x2A2D36FF"
        tile.appendChild(bg)
        letter = makeLabel(UCase(Left(a.title, 1)), "Inter-Medium", 56, "0xFFFFFFE0")
        letter.width = m.k.tile
        letter.height = m.k.tile
        letter.horizAlign = "center"
        letter.vertAlign = "center"
        tile.appendChild(letter)
        tile.appendChild(makePoster(logoFor(a), 0, 0, m.k.tile, m.k.tile))
        m.dockClip.appendChild(tile)
        m.zones.dock.push({ x: m.k.dockX + 14 + 13 + i * m.k.pitch, y: m.k.dockY + 22, w: m.k.tile, h: m.k.tile, app: a, node: tile })
    end for
    if not m.focusSet and m.zones.dock.count() > 0
        ' the first time the apps are there, start on the first one
        m.focusSet = true
        m.focusZone = "dock"
        m.focusIdx = 0
    end if
    if m.focusZone = "dock" and m.focusIdx >= m.zones.dock.count() then m.focusIdx = 0
    placeFocus()
end sub

' The bundled logo if there is one, else the Roku's own icon (through the bridge, or from the Roku itself).
function logoFor(a as Object) as String
    if a.package <> invalid and a.package <> ""
        file = "pkg:/images/logos/" + a.package + ".png"
        if CreateObject("roFileSystem").exists(file) then return file
    end if
    if a.icon <> invalid and a.icon <> ""
        if Left(a.icon, 4) = "http" or Left(a.icon, 5) = "pkg:/" then return a.icon
        if hasBridge() then return withKey(m.cfg.bridge + a.icon)
    end if
    return ""
end function

' ---------- focus ----------
sub placeFocus()
    z = m.zones[m.focusZone]
    if (z = invalid or z.count() = 0) and m.focusSet
        pickZone()
        z = m.zones[m.focusZone]
    end if
    if z = invalid or z.count() = 0
        m.focusRing.visible = false
        return
    end if
    if m.focusIdx >= z.count() then m.focusIdx = z.count() - 1
    if m.focusIdx < 0 then m.focusIdx = 0
    it = z[m.focusIdx]
    x = it.x
    pad = 10
    if m.focusZone = "dock"
        ' scroll the dock so the focused tile is in view
        if m.focusIdx < m.dockFirst then m.dockFirst = m.focusIdx
        if m.focusIdx > m.dockFirst + m.k.cap - 1 then m.dockFirst = m.focusIdx - m.k.cap + 1
        m.dockClip.translation = [m.k.dockX + 14 - m.dockFirst * m.k.pitch, m.k.dockY]
        m.dockClip.clippingRect = { x: m.dockFirst * m.k.pitch - 10, y: -10, width: m.k.dockW - 28 + 20, height: m.k.dockH + 20 }
        x = it.x - m.dockFirst * m.k.pitch
    end if
    if m.focusZone = "people" then pad = 8
    m.focusRing.translation = [x - pad, it.y - pad]
    m.focusRing.width = it.w + pad * 2
    m.focusRing.height = it.h + pad * 2
    m.focusRing.visible = true
    showFocusName()
end sub

' The name of the focused app, over the dock.
sub showFocusName()
    name = ""
    if m.focusZone = "dock" and m.zones.dock.count() > 0 and m.focusIdx < m.zones.dock.count()
        name = m.zones.dock[m.focusIdx].app.title
    else if m.focusZone = "shelf" and m.zones.shelf.count() > 0 and m.focusIdx < m.zones.shelf.count()
        name = "Resume " + m.zones.shelf[m.focusIdx].title
    end if
    m.status.text = name
    m.status.color = "0xFFFFFFE0"
end sub

' If the focused row has nothing in it, move to one that has.
sub pickZone()
    for each name in ["dock", "shelf", "people"]
        if m.zones[name].count() > 0
            m.focusZone = name
            m.focusIdx = 0
            return
        end if
    end for
end sub

function neighbour(zone as String, dir as Integer) as String
    rows = ["people", "shelf", "dock"]
    i = 0
    for k = 0 to 2
        if rows[k] = zone then i = k
    end for
    j = i + dir
    while j >= 0 and j <= 2
        if m.zones[rows[j]].count() > 0 then return rows[j]
        j = j + dir
    end while
    return zone
end function

function onKeyEvent(key as String, press as Boolean) as Boolean
    if not press then return false
    m.focusSet = true
    z = m.zones[m.focusZone]
    if key = "left"
        if m.focusIdx > 0 then m.focusIdx = m.focusIdx - 1
        placeFocus()
        return true
    else if key = "right"
        if z <> invalid and m.focusIdx < z.count() - 1 then m.focusIdx = m.focusIdx + 1
        placeFocus()
        return true
    else if key = "up" or key = "down"
        dir = -1
        if key = "down" then dir = 1
        nz = neighbour(m.focusZone, dir)
        if nz <> m.focusZone
            m.focusZone = nz
            m.focusIdx = 0
            ' stay roughly under where we were when moving between the shelf and the people
            placeFocus()
        end if
        return true
    else if key = "OK"
        choose()
        return true
    end if
    ' Back and Home are left to the Roku: Back closes the channel, Home goes to Roku's home.
    return false
end function

sub choose()
    z = m.zones[m.focusZone]
    if z = invalid or m.focusIdx >= z.count() then return
    it = z[m.focusIdx]
    if m.focusZone = "dock"
        a = it.app
        say("Opening " + a.title + "...")
        m.pendingLocal = a.id
        if hasBridge() and not m.localApps
            pkg = a.package
            if pkg = invalid or pkg = "" then pkg = "roku." + a.id
            fetch("launch", bridgeUrl("/api/launch"), "POST", FormatJson({ app: pkg }))
        else
            fetch("localhome", "http://127.0.0.1:8060/launch/" + a.id, "POST")
        end if
    else if m.focusZone = "shelf"
        say("Opening " + it.title + "...")
        fetch("continueopen", bridgeUrl("/api/continue/open"), "POST", FormatJson({ id: it.id }))
    else if m.focusZone = "people"
        m.who = it.id
        m.shownWho = it.id
        drawTop()
        fetch("whoset", bridgeUrl("/api/who"), "POST", FormatJson({ who: it.id }))
        fetchContinue("/api/continue?who=" + it.id)
    end if
end sub
