' couch-tv Studio designs on a Roku: the pure part. Nothing here makes a node, reads a file or asks the
' network, so the tests run every function in an off-Roku BrightScript interpreter (tests/test_roku_design.py).
'
' A design is untrusted input. dlSanitize() rebuilds it from an allow list the way the TV home's gate does
' (tv-home/web/design.js, sanitize): known keys only, numbers clamped, choices from fixed lists, colours as
' #hex only, words with no digits (SAN.w), pictures only a JPEG inside the design or a built in background.
' dlLayout() then turns the clean design into a flat list of things to draw on the 1920x1080 screen
' (rectangles, stretchy panels, words, pictures, app tiles); DesignDraw.brs makes the nodes.

' ---------- types ----------
function dlIsNum(v as Dynamic) as Boolean
    t = type(v)
    return t = "Integer" or t = "roInt" or t = "roInteger" or t = "Float" or t = "roFloat" or t = "Double" or t = "roDouble" or t = "LongInteger" or t = "roLongInteger"
end function

function dlIsStr(v as Dynamic) as Boolean
    t = type(v)
    return t = "String" or t = "roString"
end function

function dlIsBool(v as Dynamic) as Boolean
    t = type(v)
    return t = "Boolean" or t = "roBoolean"
end function

function dlIsAA(v as Dynamic) as Boolean
    return type(v) = "roAssociativeArray"
end function

function dlIsList(v as Dynamic) as Boolean
    return type(v) = "roArray"
end function

function dlAA(v as Dynamic) as Object
    if dlIsAA(v) then return v
    return {}
end function

function dlList(v as Dynamic) as Object
    if dlIsList(v) then return v
    return []
end function

' ---------- the gate's checks (SAN in design.js) ----------
' a number clamped to lo..hi (whole when isInt), or invalid. A string that is a plain number counts, as
' JavaScript's Number() would read it.
function dlNum(v as Dynamic, lo as Float, hi as Float, isInt = false as Boolean) as Dynamic
    f = invalid
    if dlIsNum(v)
        f = v
    else if dlIsStr(v)
        s = v.trim()
        if CreateObject("roRegex", "^-?[0-9]{1,9}(\.[0-9]{1,9})?$", "").isMatch(s) then f = Val(s)
    end if
    if f = invalid then return invalid
    if f < lo then f = lo
    if f > hi then f = hi
    if isInt then return Int(f + 0.5)
    if f = Int(f) then return Int(f)
    return Int(f * 1000 + 0.5) / 1000.0
end function

' n with a default when it is not there
function dlOr(v as Dynamic, d as Dynamic) as Dynamic
    if v = invalid then return d
    return v
end function

function dlPick(v as Dynamic, choices as Object) as Dynamic
    if not dlIsStr(v) then return invalid
    for each c in choices
        if c = v then return v
    end for
    return invalid
end function

function dlBool(v as Dynamic) as Dynamic
    if dlIsBool(v) then return v
    return invalid
end function

function dlIs(v as Dynamic, want as String) as Boolean
    return dlIsStr(v) and v = want
end function

function dlTrue(v as Dynamic) as Boolean
    return dlIsBool(v) and v = true
end function

function dlFalse(v as Dynamic) as Boolean
    return dlIsBool(v) and v = false
end function

sub dlPut(o as Object, k as String, v as Dynamic)
    if v <> invalid then o[k] = v
end sub

' a colour as Roku writes it (0xRRGGBBAA) from #rgb, #rgba, #rrggbb or #rrggbbaa; "" for anything else
' (the web home also takes rgba(), a Roku design only #hex)
function dlColour(v as Dynamic) as String
    if not dlIsStr(v) then return ""
    s = LCase(v.trim())
    if not CreateObject("roRegex", "^#[0-9a-f]+$", "").isMatch(s) then return ""
    h = Mid(s, 2)
    n = Len(h)
    if n = 3 or n = 4
        x = ""
        for i = 1 to n
            x = x + Mid(h, i, 1) + Mid(h, i, 1)
        end for
        h = x
        n = n * 2
    end if
    if n = 6 then return "0x" + UCase(h) + "FF"
    if n = 8 then return "0x" + UCase(h)
    return ""
end function

function dlCol(v as Dynamic) as Dynamic
    c = dlColour(v)
    if c = "" then return invalid
    return c
end function

function dlHexVal(h as String) as Integer
    n = 0
    digits = "0123456789ABCDEF"
    for i = 1 to Len(h)
        d = Instr(1, digits, UCase(Mid(h, i, 1))) - 1
        if d < 0 then d = 0
        n = n * 16 + d
    end for
    return n
end function

function dlHex2(n as Integer) as String
    if n < 0 then n = 0
    if n > 255 then n = 255
    s = UCase(StrI(n, 16))
    if Len(s) < 2 then s = "0" + s
    return s
end function

' 0xRRGGBBAA as [r, g, b, a]
function dlRgba(c as String) as Object
    return [dlHexVal(Mid(c, 3, 2)), dlHexVal(Mid(c, 5, 2)), dlHexVal(Mid(c, 7, 2)), dlHexVal(Mid(c, 9, 2))]
end function

' the colour with its alpha made solid (a Poster's blendColor) and the alpha as an opacity
function dlSolid(c as String) as String
    return Left(c, 8) + "FF"
end function

function dlAlpha(c as String) as Float
    return dlHexVal(Mid(c, 9, 2)) / 255.0
end function

function dlMix(a as String, b as String, t as Float) as String
    x = dlRgba(a)
    y = dlRgba(b)
    out = "0x"
    for i = 0 to 3
        out = out + dlHex2(Int(x[i] + (y[i] - x[i]) * t + 0.5))
    end for
    return out
end function

' how dark a colour is (for ink on a coloured panel)
function dlIsLight(c as String) as Boolean
    x = dlRgba(c)
    return (x[0] * 299 + x[1] * 587 + x[2] * 114) / 1000 > 150
end function

' ---------- words (SAN.w): an allow list, line by line ----------
' Latin letters (with accents), spaces and a little punctuation. A line with a digit or any other
' character is dropped whole. Full width letters become plain ones first (a part of NFKC).
function dlCharOk(c as Integer) as Boolean
    if c >= 65 and c <= 90 then return true
    if c >= 97 and c <= 122 then return true
    if c >= 192 and c <= 214 then return true
    if c >= 216 and c <= 246 then return true
    if c >= 248 and c <= 383 then return true
    for each k in [32, 46, 44, 39, 8217, 33, 63, 38, 40, 41, 58, 59, 34, 45]
        if c = k then return true
    end for
    return false
end function

function dlWords(v as Dynamic, max as Integer) as Dynamic
    if not dlIsStr(v) then return invalid
    s = Left(v, 4000)
    lines = []
    line = ""
    good = true
    n = Len(s)
    for i = 1 to n + 1
        c = 10
        if i <= n then c = Asc(Mid(s, i, 1))
        if c = 13 and i < n and Asc(Mid(s, i + 1, 1)) = 10 then c = -1
        if c = 10 or c = 13
            if good then lines.push(dlSquash(line))
            line = ""
            good = true
        else if c >= 0
            if c = 9 or c = 160 or c = 12288 then c = 32
            if c >= 65313 and c <= 65338 then c = c - 65248
            if c >= 65345 and c <= 65370 then c = c - 65248
            if dlCharOk(c) then line = line + Chr(c) else good = false
        end if
    end for
    nl = Chr(10)
    out = ""
    for i = 0 to lines.count() - 1
        if i > 0 then out = out + nl
        out = out + lines[i]
    end for
    ' three or more new lines become two, none at the ends
    out = CreateObject("roRegex", nl + "{3,}", "").replaceAll(out, nl + nl)
    out = CreateObject("roRegex", "^" + nl + "+|" + nl + "+$", "").replaceAll(out, "")
    return Left(out, max)
end function

' spaces: two or more become one, none at the ends
function dlSquash(s as String) as String
    return CreateObject("roRegex", " {2,}", "").replaceAll(s, " ").trim()
end function

' words that point somewhere (a web address) or spell out a long number (a phone number) are not drawn
' (design.js scam(): a shared design must not tell someone to ring or visit anywhere)
function dlScam(t as String) as Boolean
    s = LCase(t)
    if CreateObject("roRegex", "(https?:|www\.|@[a-z0-9-]+|[a-z]{2,}\.[a-z]{2,})", "").isMatch(s) then return true
    words = ["zero", "oh", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "hundred", "thousand"]
    n = 0
    for each w in CreateObject("roRegex", "[^a-z]+", "").split(s)
        for each k in words
            if w = k then n = n + 1
        end for
    end for
    return n >= 6
end function

' ---------- ids, packages, pictures ----------
function dlSecretish(p as String) as Boolean
    mixed = CreateObject("roRegex", "[a-z]", "")
    upper = CreateObject("roRegex", "[A-Z]", "")
    digit = CreateObject("roRegex", "[0-9]", "")
    for each s in CreateObject("roRegex", "[.:]", "").split(p)
        if Len(s) >= 32 then return true
        if Len(s) >= 16 and mixed.isMatch(s) and upper.isMatch(s) and digit.isMatch(s) then return true
        if Left(s, 3) = "eyJ" and Len(s) >= 12 then return true
    end for
    return false
end function

function dlPoison(p as String) as Boolean
    return p = "__proto__" or p = "constructor" or p = "prototype"
end function

function dlIdOk(p as Dynamic) as Boolean
    if not dlIsStr(p) then return false
    return CreateObject("roRegex", "^[A-Za-z0-9_-]{1,60}$", "").isMatch(p) and not dlPoison(p) and not dlSecretish(p)
end function

function dlPkgOk(p as Dynamic) as Boolean
    if not dlIsStr(p) then return false
    return CreateObject("roRegex", "^[A-Za-z0-9_.:-]{1,200}$", "").isMatch(p) and not dlPoison(p) and not dlSecretish(p)
end function

function dlKeepApp(p as String) as Boolean
    return p = "gear" or p = "more" or p = "smart" or p = "com.android.tv.settings"
end function

' The bytes a base64 string starts with, as [b0, b1, ...]
function dlHead(b64 as String, count as Integer) as Object
    ba = CreateObject("roByteArray")
    ba.fromBase64String(Left(b64, 16))
    out = []
    for i = 0 to count - 1
        if i < ba.count() then out.push(ba[i]) else out.push(-1)
    end for
    return out
end function

' "jpg" or "png" for a picture inside the design that is really one (checked by its first bytes), else ""
function dlDataKind(u as Dynamic) as String
    if not dlIsStr(u) or Len(u) > 4000000 then return ""
    mt = CreateObject("roRegex", "^data:image/(jpeg|png);base64,([A-Za-z0-9+/]+={0,2})$", "").match(u)
    if mt.count() < 3 then return ""
    b = dlHead(mt[2], 4)
    if mt[1] = "jpeg" and b[0] = 255 and b[1] = 216 and b[2] = 255 then return "jpg"
    if mt[1] = "png" and b[0] = 137 and b[1] = 80 and b[2] = 78 and b[3] = 71 then return "png"
    return ""
end function

' the base64 part of a data picture
function dlDataBody(u as String) as String
    i = Instr(1, u, ",")
    if i = 0 then return ""
    return Mid(u, i + 1)
end function

' A picture a design may name: a JPEG (or PNG) inside it, a built in background (backgrounds/...), or
' kept:N, a picture this channel saved itself from a design got by code (only when keptOk).
function dlImgOk(u as Dynamic, keptOk as Boolean) as Dynamic
    if not dlIsStr(u) then return invalid
    if dlDataKind(u) <> "" then return u
    if keptOk and CreateObject("roRegex", "^kept:[0-9]{1,2}\.(jpg|png)$", "").isMatch(u) then return u
    if CreateObject("roRegex", "^backgrounds/[A-Za-z0-9_][A-Za-z0-9_./-]*\.(jpe?g|png|webp)$", "i").isMatch(u) and Instr(1, u, "..") = 0 and Instr(1, u, "//") = 0 then return u
    return invalid
end function

' Where a picture is drawn from: a data picture stays as it is (the drawer writes it to a file first), a
' built in scene comes from this channel, any other built in background from the bridge, which serves
' tv-home/web at /tv/. WebP, and anything with no bridge to fetch it from, gives "" (a plain colour).
function dlImageUri(u as String, bridge as String, key as String) as String
    if Left(u, 5) = "data:" then return u
    if Left(u, 5) = "kept:" then return "cachefs:/couchtv-design-" + Mid(u, 6)
    mt = CreateObject("roRegex", "^backgrounds/scene-(night|golden|fog|dawn|water)(@2x)?\.jpg$", "").match(u)
    if mt.count() > 1 then return "pkg:/images/scenes/" + mt[1] + ".jpg"
    if CreateObject("roRegex", "\.webp$", "i").isMatch(u) or bridge = "" then return ""
    url = bridge + "/tv/" + u
    if key <> "" then url = url + "?key=" + key
    return url
end function

' ---------- getting a design by code (tv-home/web/design-code.js) ----------
function dlStoreBase(u as Dynamic) as String
    if not dlIsStr(u) or Len(u) > 200 then return ""
    mt = CreateObject("roRegex", "^(https://[a-z0-9.-]+(:[0-9]{1,5})?|http://(127\.0\.0\.1|localhost)(:[0-9]{1,5})?)/?$", "i").match(u.trim())
    if mt.count() < 2 then return ""
    return LCase(mt[1])
end function

' the store to ask: the bridge's design_store when it names one, "" when it says "" (turned off), else
' couch-tv Studio's own (designer-gate.js DEFAULT_STORE)
function dlStoreFor(cfg as Dynamic) as String
    c = dlAA(cfg)
    if c.doesExist("design_store") then return dlStoreBase(c.design_store)
    return "https://tvdesigner.sites.underseage.studio"
end function

' a code as typed with the remote: ABCDE-FGHJK (any case, spaces and dashes ignored) or the long CTV1- one
function dlReadCode(v as Dynamic) as String
    if not dlIsStr(v) then return ""
    s = v.trim()
    lng = CreateObject("roRegex", "^CTV1-", "i").replaceAll(s, "")
    if CreateObject("roRegex", "^[A-Za-z0-9_-]{43}$", "").isMatch(lng) then return "CTV1-" + lng
    c = CreateObject("roRegex", "[ -]", "").replaceAll(UCase(s), "")
    if Len(c) <> 10 then return ""
    allowed = "23456789ABCDEFGHJKMNPQRSTVWXYZ"
    for i = 1 to 10
        if Instr(1, allowed, Mid(c, i, 1)) = 0 then return ""
    end for
    return Left(c, 5) + "-" + Mid(c, 6)
end function

' what the store's answer means, as words for the screen ("" when it is a design to read)
function dlFetchProblem(status as Integer) as String
    if status = 200 then return ""
    if status = 404 then return "That code did not work. A code works once, for 30 minutes. Make a new one in couch-tv Studio."
    if status = 429 then return "Too many tries. Wait a few minutes, then try again."
    if status = 503 then return "Short codes are paused for a few minutes. Try again soon."
    return "Could not reach the design server. Check the TV is online."
end function

' the store's answer: only its "design" is kept, and the only picture a JPEG inside it (checked by its
' first bytes) or a built in background. The cut out and a video are not drawn on a Roku, so they go.
function dlAccept(text as Dynamic) as Dynamic
    if not dlIsStr(text) or Len(text) > 4000000 then return invalid
    j = ParseJson(text)
    if not dlIsAA(j) or not dlIsAA(j.design) then return invalid
    d = j.design
    if dlIsAA(d.background)
        img = d.background.image
        ok = false
        if dlIsStr(img)
            ok = dlDataKind(img) = "jpg" or CreateObject("roRegex", "^backgrounds/[A-Za-z0-9_-]+\.(jpe?g|png|webp)$", "").isMatch(img)
        end if
        if not ok then d.background.delete("image")
        d.background.delete("depth_image")
        d.background.delete("video")
    end if
    return d
end function

' ---------- the gate itself ----------
function dlWKinds() as Object
    return ["clock", "tallclock", "glassclock", "analog", "flipclock", "wordclock", "solar", "worldclock", "countdown", "date", "month", "timer", "weather", "bigtemp", "hourly", "week", "rain", "uv", "sun", "moon", "air", "surf", "photo", "slideshow", "mosaic", "artframe", "memory", "keep", "keeprow", "upnext", "picks", "app", "folder", "dock", "appgrid", "games", "nowplaying", "soundscape", "queue", "speakers", "aircon", "scenes", "controls", "camera", "doorbell", "energy", "sensor", "battery", "bins", "people", "agenda", "note", "list", "card", "quote", "word", "news", "sports", "stocks", "commute", "welcome", "quick", "wifi", "guide", "screentime", "ask", "agent", "stack"]
end function

function dlDateKeys() as Object
    return ["short", "numeric", "weekday", "day_month", "full"]
end function

sub dlSanPlace(src as Object, out as Object)
    dlPut(out, "x", dlNum(src.x, -3840, 3840))
    dlPut(out, "y", dlNum(src.y, -2160, 2160))
    dlPut(out, "scale", dlNum(src.scale, 0.1, 8))
    dlPut(out, "rotate", dlNum(src.rotate, -180, 180))
    dlPut(out, "opacity", dlNum(src.opacity, 0.05, 1))
    dlPut(out, "hidden", dlBool(src.hidden))
end sub

sub dlSanType(src as Object, out as Object)
    dlPut(out, "font", dlPick(src.font, ["inter", "antonio", "serif", "mono", "condensed", "rounded", "cormorant", "jost"]))
    dlPut(out, "weight", dlNum(src.weight, 100, 900, true))
    dlPut(out, "colour", dlCol(src.colour))
    dlPut(out, "shadow", dlPick(src.shadow, ["none", "soft", "strong"]))
    dlPut(out, "shade", dlPick(src.shade, ["glow", "panel"]))
    dlPut(out, "case", dlPick(src.case, ["upper"]))
    dlPut(out, "align", dlPick(src.align, ["left", "center", "right"]))
end sub

function dlSanPart(key as String, raw as Dynamic) as Object
    src = dlAA(raw)
    out = {}
    dlSanPlace(src, out)
    if key = "clock" or key = "date" or key = "weather" or key = "keep_watching" then dlSanType(src, out)
    if key = "clock" then dlPut(out, "format", dlPick(src.format, ["12h", "24h"]))
    if key = "date" then dlPut(out, "format", dlPick(src.format, dlDateKeys()))
    if key = "weather"
        dlPut(out, "place", dlBool(src.place))
        dlPut(out, "words", dlBool(src.words))
    end if
    if key = "dock"
        ' the dock can be made small or faint, never gone
        if out.scale <> invalid and out.scale < 0.5 then out.scale = 0.5
        if out.opacity <> invalid and out.opacity < 0.4 then out.opacity = 0.4
        out.delete("hidden")
    end if
    return out
end function

function dlSanWStyle(raw as Dynamic) as Object
    src = dlAA(raw)
    out = {}
    dlPut(out, "panel", dlPick(src.panel, ["glass", "solid", "colour", "paper", "none"]))
    dlPut(out, "ink", dlPick(src.ink, ["auto", "white", "ink", "accent"]))
    dlPut(out, "font", dlPick(src.font, ["inter", "antonio", "rounded", "cormorant", "jost"]))
    dlPut(out, "corners", dlPick(src.corners, ["square", "soft", "round", "pill"]))
    dlPut(out, "colour", dlCol(src.colour))
    dlPut(out, "accent", dlCol(src.accent))
    dlPut(out, "opacity", dlNum(src.opacity, 0.2, 1))
    return out
end function

' the options a Roku uses, each with the web gate's check (OPT and WOPT in design.js)
function dlSanWOpts(raw as Dynamic) as Object
    src = dlAA(raw)
    out = {}
    dlPut(out, "label", dlWords(src.label, 40))
    dlPut(out, "text", dlWords(src.text, 120))
    dlPut(out, "sub", dlWords(src.sub, 80))
    dlPut(out, "kicker", dlWords(src.kicker, 60))
    dlPut(out, "caption", dlWords(src.caption, 60))
    dlPut(out, "format", dlPick(src.format, ["12h", "24h"]))
    dlPut(out, "ampm", dlBool(src.ampm))
    dlPut(out, "date", dlBool(src.date))
    dlPut(out, "align", dlPick(src.align, ["left", "center", "right"]))
    dlPut(out, "show", dlPick(src.show, ["date", "weather", "both"]))
    dlPut(out, "dfmt", dlPick(src.dfmt, dlDateKeys()))
    dlPut(out, "month", dlNum(src.month, 1, 12, true))
    dlPut(out, "day", dlNum(src.day, 1, 31, true))
    dlPut(out, "unit", dlPick(src.unit, ["sleeps", "days", "weeks"]))
    dlPut(out, "cols", dlNum(src.cols, 1, 6, true))
    dlPut(out, "names", dlBool(src.names))
    dlPut(out, "fit", dlPick(src.fit, ["cover", "contain"]))
    dlPut(out, "mat", dlCol(src.mat))
    dlPut(out, "place", dlBool(src.place))
    dlPut(out, "hilo", dlBool(src.hilo))
    dlPut(out, "shows", dlNum(src.shows, 1, 5, true))
    ' a photo inside the design, for a widget on its own or an item in a smart stack: only a JPEG (or PNG),
    ' a built in picture, or kept:N (a design this channel kept files its photos; kept:N names no other file)
    dlPut(out, "image", dlImgOk(src.image, true))
    if dlIsList(src.apps)
        apps = []
        for each p in src.apps
            if apps.count() < 16 and dlPkgOk(p) and not dlKeepApp(p) then apps.push(p)
        end for
        out.apps = apps
    end if
    return out
end function

function dlSanWidget(src as Object, out as Object, inStack as Boolean) as Boolean
    kind = dlPick(src.kind, dlWKinds())
    if kind = invalid or (inStack and kind = "stack") then return false
    out.kind = kind
    out.style = dlSanWStyle(src.style)
    out.opts = dlSanWOpts(src.opts)
    if kind = "stack"
        items = []
        for each it in dlList(src.items)
            o = {}
            if items.count() < 10 and dlSanWidget(dlAA(it), o, true) then items.push(o)
        end for
        if items.count() = 0 then return false
        out.items = items
    end if
    return true
end function

function dlSanObject(raw as Dynamic) as Dynamic
    src = dlAA(raw)
    if not dlIdOk(src.id) then return invalid
    t = dlPick(src.type, ["text", "shape", "clock", "weather", "smart", "group", "widget"])
    if t = invalid then return invalid
    out = { id: src.id, type: t, layer: dlOr(dlPick(src.layer, ["front", "back"]), "front") }
    dlSanPlace(src, out)
    if t <> "shape" and t <> "text"
        dlPut(out, "w", dlNum(src.w, 40, 1920))
        dlPut(out, "h", dlNum(src.h, 40, 1080))
    end if
    if t = "text"
        dlPut(out, "text", dlWords(src.text, 120))
        if out.text = invalid or out.text = "" then return invalid
        dlPut(out, "size", dlNum(src.size, 8, 400))
        dlSanType(src, out)
    else if t = "shape"
        dlPut(out, "variant", dlPick(src.variant, ["glass", "solid", "outline", "line"]))
        dlPut(out, "w", dlNum(src.w, 4, 3840))
        dlPut(out, "h", dlNum(src.h, 1, 2160))
        dlPut(out, "radius", dlNum(src.radius, 0, 1000))
        dlPut(out, "colour", dlCol(src.colour))
    else if t = "clock"
        dlPut(out, "size", dlNum(src.size, 16, 600))
        dlPut(out, "format", dlPick(src.format, ["12h", "24h"]))
        dlPut(out, "date", dlBool(src.date))
        dlPut(out, "date_format", dlPick(src.date_format, dlDateKeys()))
        dlSanType(src, out)
    else if t = "weather"
        dlPut(out, "style", dlPick(src.style, ["line", "card", "big"]))
        dlPut(out, "place", dlBool(src.place))
        dlPut(out, "panel", dlPick(src.panel, ["glass", "solid", "none"]))
        dlSanType(src, out)
    else if t = "smart"
        dlPut(out, "kind", dlOr(dlPick(src.kind, ["aircon", "light", "speaker", "camera", "doorbell", "network", "devices", "vacuum", "appliance", "scene"]), "light"))
        dlPut(out, "style", dlPick(src.style, ["tile", "pill", "icon", "card"]))
        dlPut(out, "panel", dlPick(src.panel, ["glass", "solid", "none"]))
        dlPut(out, "name", dlWords(src.name, 24))
    else if t = "group"
        dlPut(out, "cols", dlNum(src.cols, 1, 8, true))
        dlPut(out, "rows", dlNum(src.rows, 1, 4, true))
        dlPut(out, "panel", dlPick(src.panel, ["glass", "solid", "none"]))
        dlPut(out, "name", dlWords(src.name, 40))
        out.layer = "back"
    else if t = "widget"
        out.delete("rotate")
        out.delete("scale")
        if not dlSanWidget(src, out, false) then return invalid
        if out.w = invalid then out.w = 360
        if out.h = invalid then out.h = 360
    end if
    return out
end function

' keptOk: true only for a design this channel saved itself (its pictures are files named kept:N)
function dlSanitize(rawIn as Dynamic, keptOk = false as Boolean) as Object
    raw = dlAA(rawIn)
    out = { v: 1 }
    hm = dlAA(raw.home)
    h = {}
    dlPut(h, "clock", dlPick(hm.clock, ["12h", "24h"]))
    dlPut(h, "keep_watching", dlBool(hm.keep_watching))
    dlPut(h, "scene_seconds", dlNum(hm.scene_seconds, 5, 3600, true))
    if dlIsList(hm.scenes)
        sc = []
        for each x in hm.scenes
            if sc.count() < 20 and dlIsStr(x) and CreateObject("roRegex", "^[a-z0-9_-]{1,40}$", "").isMatch(x) then sc.push(x)
        end for
        h.scenes = sc
    end if
    if h.count() > 0 then out.home = h
    el = dlAA(raw.elements)
    e = {}
    for each k in ["clock", "date", "weather", "people", "quick", "keep_watching", "dock"]
        if el.doesExist(k)
            c = dlSanPart(k, el[k])
            if c.count() > 0 then e[k] = c
        end if
    end for
    if e.count() > 0 then out.elements = e
    bg = dlAA(raw.background)
    img = dlImgOk(bg.image, keptOk)
    if img <> invalid
        b = { image: img }
        dlPut(b, "darken", dlNum(bg.darken, 0, 0.9))
        dlPut(b, "zoom", dlNum(bg.zoom, 1, 4))
        dlPut(b, "x", dlNum(bg.x, 0, 100))
        dlPut(b, "y", dlNum(bg.y, 0, 100))
        dlPut(b, "scrim", dlPick(bg.scrim, ["top", "bottom", "left", "right", "even"]))
        dlPut(b, "colour", dlCol(bg.colour))
        out.background = b
    else if dlCol(bg.colour) <> invalid
        b = { colour: dlCol(bg.colour) }
        if dlCol(bg.colour2) <> invalid
            b.colour2 = dlCol(bg.colour2)
            dlPut(b, "angle", dlNum(bg.angle, 0, 360, true))
        end if
        out.background = b
    end if
    ap = dlAA(raw.apps)
    a = {}
    if dlIsList(ap.order)
        order = []
        for each p in ap.order
            if order.count() < 40 and dlPkgOk(p) then order.push(p)
        end for
        a.order = order
    end if
    if dlIsList(ap.hidden)
        hid = []
        for each p in ap.hidden
            if hid.count() < 200 and dlPkgOk(p) and not dlKeepApp(p) then hid.push(p)
        end for
        a.hidden = hid
    end if
    if a.count() > 0 then out.apps = a
    texts = []
    for each t in dlList(raw.texts)
        if texts.count() < 8
            src = dlAA(t)
            c = { text: dlOr(dlWords(src.text, 120), "") }
            dlSanPlace(src, c)
            dlPut(c, "size", dlNum(src.size, 8, 400))
            dlSanType(src, c)
            if c.text <> "" and not dlScam(c.text) then texts.push(c)
        end if
    end for
    if texts.count() > 0 then out.texts = texts
    objs = []
    for each o in dlList(raw.objects)
        if objs.count() < 40
            c = dlSanObject(o)
            if c <> invalid then objs.push(dlUnscam(c))
        end if
    end for
    if objs.count() > 0 then out.objects = objs
    lk = dlAA(raw.look)
    look = {}
    for each k in ["ink", "sub", "panel", "solid", "paper", "accent"]
        dlPut(look, k, dlCol(lk[k]))
    end for
    if look.count() > 0 then out.look = look
    return out
end function

' words on an object that point somewhere are taken out (a text object goes, a widget loses that line)
function dlUnscam(o as Object) as Object
    if o.type = "text" and dlScam(o.text) then o.hidden = true
    if o.type = "widget"
        for each k in ["label", "text", "sub", "kicker", "caption"]
            if dlIsStr(o.opts[k]) and dlScam(o.opts[k]) then o.opts.delete(k)
        end for
    end if
    return o
end function

' ---------- time and dates ----------
' days since 1 January 1970 for a calendar date
function dlDays(y as Integer, mo as Integer, d as Integer) as Integer
    yy = y
    if mo <= 2 then yy = yy - 1
    era = Int(yy / 400)
    yoe = yy - era * 400
    mp = (mo + 9) mod 12
    doy = Int((153 * mp + 2) / 5) + d - 1
    doe = yoe * 365 + Int(yoe / 4) - Int(yoe / 100) + doy
    return era * 146097 + doe - 719468
end function

' 0 Sunday to 6 Saturday
function dlWeekday(y as Integer, mo as Integer, d as Integer) as Integer
    return (dlDays(y, mo, d) + 4) mod 7
end function

function dlMonthDays(y as Integer, mo as Integer) as Integer
    n = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mo - 1]
    if mo = 2 and ((y mod 4 = 0 and y mod 100 <> 0) or y mod 400 = 0) then n = 29
    return n
end function

function dlMonths() as Object
    return ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
end function

function dlWeekdays() as Object
    return ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
end function

' "9:05" or "09:05"
function dlTimeText(h as Integer, mi as Integer, c24 as Boolean) as String
    hh = h
    if not c24
        hh = h mod 12
        if hh = 0 then hh = 12
    end if
    s = hh.toStr()
    if c24 and hh < 10 then s = "0" + s
    mm = mi.toStr()
    if mi < 10 then mm = "0" + mm
    return s + ":" + mm
end function

function dlAmPm(h as Integer) as String
    if h < 12 then return "am"
    return "pm"
end function

' the date the way the TV home writes it in Australian English (design.js DATE_FORMATS)
function dlDateText(fmt as Dynamic, now as Object) as String
    wd = dlWeekdays()[now.wd]
    mon = dlMonths()[now.mo - 1]
    d = now.d.toStr()
    if dlIs(fmt, "short") then return Left(wd, 3) + " " + d + " " + Left(mon, 3)
    if dlIs(fmt, "numeric") then return d + "/" + now.mo.toStr() + "/" + now.y.toStr()
    if dlIs(fmt, "weekday") then return wd
    if dlIs(fmt, "day_month") then return d + " " + mon
    if dlIs(fmt, "full") then return wd + " " + d + " " + mon + " " + now.y.toStr()
    return wd + " " + d + " " + mon
end function

' a clock in words, to the nearest five minutes
function dlWordClock(h as Integer, mi as Integer) as String
    names = ["twelve", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven"]
    five = Int((mi + 2) / 5)
    hr = h
    if five > 6 then hr = h + 1
    if five = 12 then five = 0
    hw = names[hr mod 12]
    parts = ["o'clock", "five past", "ten past", "quarter past", "twenty past", "twenty five past", "half past", "twenty five to", "twenty to", "quarter to", "ten to", "five to"]
    if five = 0 then return "It's " + hw + " o'clock"
    return "It's " + parts[five] + " " + hw
end function

' days until a day of the year (today is 0), and the number in the unit asked for
function dlCountdown(month as Integer, day as Integer, unit as String, now as Object) as Object
    y = now.y
    dd = day
    if dd > dlMonthDays(y, month) then dd = dlMonthDays(y, month)
    n = dlDays(y, month, dd) - dlDays(now.y, now.mo, now.d)
    if n < 0
        y = y + 1
        dd = day
        if dd > dlMonthDays(y, month) then dd = dlMonthDays(y, month)
        n = dlDays(y, month, dd) - dlDays(now.y, now.mo, now.d)
    end if
    v = n
    word = "days"
    if unit = "sleeps" then word = "sleeps"
    if unit = "weeks"
        v = Int(n / 7)
        word = "weeks"
        if v = 1 then word = "week"
    else if n = 1
        word = Left(word, Len(word) - 1)
    end if
    return { days: n, n: v, word: word }
end function

' the moon tonight: how far through its month (0 new, 0.5 full), its name and how much is lit
function dlMoon(now as Object) as Object
    age = (dlDays(now.y, now.mo, now.d) + 0.5 - dlDays(2000, 1, 6) - 0.76) / 29.530588853
    p = age - Int(age)
    names = [[0.03, "New moon"], [0.22, "Waxing crescent"], [0.28, "First quarter"], [0.47, "Waxing gibbous"], [0.53, "Full moon"], [0.72, "Waning gibbous"], [0.78, "Last quarter"], [0.97, "Waning crescent"], [1.01, "New moon"]]
    name = "New moon"
    for each n in names
        if p < n[0]
            name = n[1]
            exit for
        end if
    end for
    lit = Int((1 - Cos(2 * 3.14159265 * p)) / 2 * 100 + 0.5)
    return { phase: Int(p * 1000) / 1000.0, name: name, lit: lit }
end function

' ---------- weather (the bridge's /api/weather) ----------
function dlWeather(w as Dynamic, fahrenheit as Boolean) as Dynamic
    if not dlIsAA(w) or not dlIsNum(w.temp) then return invalid
    out = { temp: dlDeg(w.temp, fahrenheit), words: "", place: "", hilo: "" }
    if dlIsStr(w.text) then out.words = w.text
    if dlIsStr(w.place) then out.place = w.place
    if dlIsNum(w.high) and dlIsNum(w.low) then out.hilo = "H " + dlDeg(w.high, fahrenheit) + "  L " + dlDeg(w.low, fahrenheit)
    return out
end function

function dlDeg(t as Dynamic, fahrenheit as Boolean) as String
    v = t + 0.0
    if fahrenheit then v = v * 9 / 5 + 32
    return Int(v + 0.5).toStr() + Chr(176)
end function

' ---------- apps ----------
' the apps in the design's order, without the ones it hides. An app is matched by its package name
' (the bridge's), its Roku id (roku.<id>) or its name.
function dlAppKey(a as Object) as Object
    keys = []
    if dlIsStr(a.package) and a.package <> "" then keys.push(LCase(a.package))
    if dlIsStr(a.id) and a.id <> ""
        keys.push(LCase(a.id))
        keys.push("roku." + LCase(a.id))
    end if
    if dlIsStr(a.title) then keys.push(CreateObject("roRegex", "[^a-z0-9]", "").replaceAll(LCase(a.title), ""))
    return keys
end function

function dlAppMatch(a as Object, name as String) as Boolean
    n = LCase(name)
    for each k in dlAppKey(a)
        if k = n then return true
    end for
    ' a catalogue id ("netflix", "abc-iview") against a name ("Netflix", "ABC iview")
    flat = CreateObject("roRegex", "[^a-z0-9]", "").replaceAll(n, "")
    if flat <> "" and dlIsStr(a.title) and CreateObject("roRegex", "[^a-z0-9]", "").replaceAll(LCase(a.title), "") = flat then return true
    return false
end function

function dlOrderApps(apps as Object, design as Object) as Object
    ap = dlAA(design.apps)
    order = dlList(ap.order)
    hidden = dlList(ap.hidden)
    kept = []
    for each a in apps
        hide = false
        for each h in hidden
            if dlAppMatch(a, h) then hide = true
        end for
        if not hide then kept.push(a)
    end for
    out = []
    used = {}
    for each p in order
        for i = 0 to kept.count() - 1
            if not used.doesExist(i.toStr()) and dlAppMatch(kept[i], p)
                out.push(kept[i])
                used[i.toStr()] = true
            end if
        end for
    end for
    for i = 0 to kept.count() - 1
        if not used.doesExist(i.toStr()) then out.push(kept[i])
    end for
    return out
end function

' the indexes (into apps) a widget shows: the ones it names, else the first `max`
function dlWidgetApps(names as Dynamic, apps as Object, max as Integer) as Object
    out = []
    if dlIsList(names) and names.count() > 0
        for each n in names
            for i = 0 to apps.count() - 1
                if out.count() < max and dlAppMatch(apps[i], n)
                    dup = false
                    for each j in out
                        if j = i then dup = true
                    end for
                    if not dup then out.push(i)
                end if
            end for
        end for
        return out
    end if
    for i = 0 to apps.count() - 1
        if out.count() < max then out.push(i)
    end for
    return out
end function

' ---------- the home's own parts ----------
' A part moved, grown or faded in the design, as a Group's translation and scale: x and y move it, it
' grows from (ox, oy). A point (x, y) of the part lands at (tx + s * x, ty + s * y).
function dlXf(part as Dynamic, ox as Float, oy as Float) as Object
    p = dlAA(part)
    s = dlOr(p.scale, 1.0)
    dx = dlOr(p.x, 0)
    dy = dlOr(p.y, 0)
    return { tx: ox + dx - s * ox, ty: oy + dy - s * oy, s: s, o: dlOr(p.opacity, 1.0), hidden: dlTrue(p.hidden), rot: dlOr(p.rotate, 0) }
end function

' the font file for a design's font name and weight
function dlFont(name as Dynamic, weight as Dynamic) as String
    if dlIs(name, "antonio") then return "Antonio-Light"
    if dlIsNum(weight) and weight < 500 then return "Inter-Regular"
    return "Inter-Medium"
end function

' about how wide a line of words is (no font measuring off the Roku): Antonio is narrow, Inter wider
function dlTextWidth(text as String, fnt as String, size as Float) as Integer
    k = 0.54
    if fnt = "Antonio-Light" then k = 0.4
    if fnt = "Inter-Regular" then k = 0.52
    widest = 0
    for each line in text.split(Chr(10))
        if Len(line) > widest then widest = Len(line)
    end for
    return Int(widest * size * k + 0.5)
end function

' the biggest size (up to max) at which text fits in w x h
function dlFit(text as String, fnt as String, w as Float, h as Float, max as Float) as Integer
    s = max
    if s > h then s = h
    one = dlTextWidth(text, fnt, 100) / 100.0
    if one > 0 and s * one > w then s = w / one
    if s < 12 then s = 12
    return Int(s)
end function

' ---------- the drawing list ----------
' Each item is one thing to draw: k is rect, nine (a stretchy rounded panel: round, line or panel), label,
' poster, disc, or app (a tile the remote can reach; i is the app's index). x, y, w, h in screen pixels;
' c a colour 0xRRGGBBAA; o an opacity; rot degrees clockwise about (cx, cy) inside the item.
function dlRect(x as Float, y as Float, w as Float, h as Float, c as String) as Object
    return { k: "rect", x: Int(x), y: Int(y), w: Int(w), h: Int(h), c: c, o: 1.0 }
end function

function dlNine(kind as String, x as Float, y as Float, w as Float, h as Float, c as String) as Object
    return { k: "nine", u: kind, x: Int(x), y: Int(y), w: Int(w), h: Int(h), c: dlSolid(c), o: dlAlpha(c) }
end function

function dlLabel(text as String, x as Float, y as Float, w as Float, h as Float, fnt as String, size as Float, c as String, align as String) as Object
    return { k: "label", text: text, x: Int(x), y: Int(y), w: Int(w), h: Int(h), font: fnt, size: Int(size), c: c, align: align, valign: "top", wrap: false, o: 1.0 }
end function

' two colours as bands (a SceneGraph Rectangle has no gradient): CSS angles, 0 is towards the top
function dlGradient(c1 as String, c2 as String, angle as Float, x as Float, y as Float, w as Float, h as Float, bands as Integer) as Object
    out = []
    a = angle - Int(angle / 360) * 360
    vertical = a <= 45 or a >= 315 or (a >= 135 and a <= 225)
    first = c1
    last = c2
    if vertical and (a <= 45 or a >= 315)
        first = c2
        last = c1
    end if
    if not vertical and a > 225
        first = c2
        last = c1
    end if
    for i = 0 to bands - 1
        t = (i + 0.5) / bands
        c = dlMix(first, last, t)
        if vertical
            y0 = y + Int(h * i / bands)
            y1 = y + Int(h * (i + 1) / bands)
            out.push(dlRect(x, y0, w, y1 - y0, c))
        else
            x0 = x + Int(w * i / bands)
            x1 = x + Int(w * (i + 1) / bands)
            out.push(dlRect(x0, y, x1 - x0, h, c))
        end if
    end for
    return out
end function

function dlBackground(bg as Dynamic, ctx as Object) as Object
    out = []
    if not dlIsAA(bg) then return out
    if dlIsStr(bg.image)
        uri = dlImageUri(bg.image, ctx.bridge, ctx.key)
        if uri = ""
            ' a picture this Roku cannot show: the design's colour, else a plain dark one
            out.push(dlRect(0, 0, 1920, 1080, dlOr(bg.colour, "0x0B0D12FF")))
        else
            z = dlOr(bg.zoom, 1.0)
            w = 1920 * z
            h = 1080 * z
            out.push({ k: "poster", u: uri, x: Int((1920 - w) * dlOr(bg.x, 50) / 100 + 0.5), y: Int((1080 - h) * dlOr(bg.y, 50) / 100 + 0.5), w: Int(w), h: Int(h), mode: "fill", o: 1.0 })
        end if
        dark = dlOr(bg.darken, 0.15)
        if dark > 0
            if dlIs(bg.scrim, "top")
                bands = dlGradient("0x000000FF", "0x00000060", 180, 0, 0, 1920, 1080, 24)
            else if dlIs(bg.scrim, "bottom")
                bands = dlGradient("0x000000FF", "0x00000050", 0, 0, 0, 1920, 1080, 24)
            else if dlIs(bg.scrim, "left")
                bands = dlGradient("0x000000FF", "0x0000004C", 90, 0, 0, 1920, 1080, 24)
            else if dlIs(bg.scrim, "right")
                bands = dlGradient("0x000000FF", "0x0000004C", 270, 0, 0, 1920, 1080, 24)
            else
                bands = [dlRect(0, 0, 1920, 1080, "0x000000FF")]
            end if
            for each b in bands
                b.o = dark
                out.push(b)
            end for
        end if
    else if dlIsStr(bg.colour)
        if dlIsStr(bg.colour2)
            out.append(dlGradient(bg.colour, bg.colour2, dlOr(bg.angle, 160), 0, 0, 1920, 1080, 48))
        else
            out.push(dlRect(0, 0, 1920, 1080, bg.colour))
        end if
    end if
    return out
end function

' words with the design's shadow: a dark copy just under them (a Label has no shadow of its own)
sub dlPushText(out as Object, l as Object, shadow as Dynamic)
    s = "soft"
    if dlIsStr(shadow) then s = shadow
    if s <> "none"
        d = {}
        d.append(l)
        off = 2
        a = "0x00000066"
        if s = "strong"
            off = 4
            a = "0x000000AA"
        end if
        d.x = l.x + off
        d.y = l.y + off
        d.c = a
        out.push(d)
    end if
    out.push(l)
end sub

' a text object or a v1 text
sub dlTextItem(out as Object, o as Object, defSize as Float)
    s = dlOr(o.scale, 1.0)
    size = dlOr(o.size, defSize) * s
    fnt = dlFont(o.font, o.weight)
    text = o.text
    if dlIs(o.case, "upper") then text = UCase(text)
    lines = text.split(Chr(10)).count()
    w = dlTextWidth(text, fnt, size)
    if w > 1760 * s then w = Int(1760 * s)
    if w < size then w = Int(size)
    l = dlLabel(text, dlOr(o.x, 0), dlOr(o.y, 0), w, Int(size * 1.3 * lines), fnt, size, dlOr(o.colour, "0xFFFFFFFF"), dlOr(o.align, "left"))
    l.wrap = lines > 1
    l.o = dlOr(o.opacity, 1.0)
    l.rot = dlOr(o.rotate, 0)
    l.cx = Int(w / 2)
    l.cy = Int(l.h / 2)
    if dlIs(o.shade, "panel") then out.push(dlNine("round", l.x - 24, l.y - 12, w + 48, l.h + 24, "0x14161C99"))
    dlPushText(out, l, o.shadow)
end sub

sub dlShapeItem(out as Object, o as Object)
    s = dlOr(o.scale, 1.0)
    v = dlOr(o.variant, "glass")
    x = dlOr(o.x, 0)
    y = dlOr(o.y, 0)
    w = dlOr(o.w, 600) * s
    h = dlOr(o.h, 320)
    if v = "line" and h > 40 then h = 40
    if v = "line" and o.h = invalid then h = 4
    h = h * s
    radius = dlOr(o.radius, 36)
    if v = "line" then radius = 0
    round = radius >= 8 and w >= 24 and h >= 24
    items = []
    if v = "glass"
        if round
            items.push(dlNine("round", x, y, w, h, dlMix(dlOr(o.colour, "0xFFFFFFFF"), "0xFFFFFF00", 0.82)))
            items.push(dlNine("line", x, y, w, h, "0xFFFFFF40"))
        else
            items.push(dlRect(x, y, w, h, dlMix(dlOr(o.colour, "0xFFFFFFFF"), "0xFFFFFF00", 0.82)))
        end if
    else if v = "solid"
        c = dlOr(o.colour, "0x16181FCC")
        if round then items.push(dlNine("round", x, y, w, h, c)) else items.push(dlRect(x, y, w, h, c))
    else if v = "outline"
        c = dlOr(o.colour, "0xFFFFFFCC")
        if round
            items.push(dlNine("line", x, y, w, h, c))
        else
            items.push(dlRect(x, y, w, 3, c))
            items.push(dlRect(x, y + h - 3, w, 3, c))
            items.push(dlRect(x, y, 3, h, c))
            items.push(dlRect(x + w - 3, y, 3, h, c))
        end if
    else
        items.push(dlRect(x, y, w, h, dlOr(o.colour, "0xFFFFFFCC")))
    end if
    for each it in items
        it.o = it.o * dlOr(o.opacity, 1.0)
        it.rot = dlOr(o.rotate, 0)
        it.cx = Int(x + w / 2 - it.x)
        it.cy = Int(y + h / 2 - it.y)
        out.push(it)
    end for
end sub

sub dlClockItem(out as Object, o as Object, ctx as Object)
    s = dlOr(o.scale, 1.0)
    size = dlOr(o.size, 120) * s
    c24 = ctx.c24
    if dlIs(o.format, "24h") then c24 = true
    if dlIs(o.format, "12h") then c24 = false
    fnt = "Antonio-Light"
    if dlIsStr(o.font) and o.font <> "antonio" then fnt = dlFont(o.font, o.weight)
    t = dlTimeText(ctx.now.h, ctx.now.mi, c24)
    w = dlTextWidth(t, fnt, size) + 8
    l = dlLabel(t, dlOr(o.x, 0), dlOr(o.y, 0), w, Int(size * 1.25), fnt, size, dlOr(o.colour, "0xFFFFFFFF"), dlOr(o.align, "left"))
    l.o = dlOr(o.opacity, 1.0)
    dlPushText(out, l, o.shadow)
    if dlTrue(o.date)
        ds = size * 0.24
        if ds < 20 then ds = 20
        d = dlDateText(o.date_format, ctx.now)
        dl = dlLabel(d, l.x, l.y + l.h, dlTextWidth(d, "Inter-Medium", ds) + 8, Int(ds * 1.3), "Inter-Medium", ds, dlOr(o.colour, "0xFFFFFFE6"), "left")
        dl.o = l.o
        dlPushText(out, dl, o.shadow)
    end if
end sub

sub dlWeatherItem(out as Object, o as Object, ctx as Object)
    w = dlWeather(ctx.weather, ctx.fahrenheit)
    s = dlOr(o.scale, 1.0)
    x = dlOr(o.x, 0)
    y = dlOr(o.y, 0)
    ink = dlOr(o.colour, "0xFFFFFFFF")
    st = dlOr(o.style, "line")
    op = dlOr(o.opacity, 1.0)
    items = []
    if w = invalid
        items.push(dlLabel("Weather", x, y, 300 * s, 48 * s, "Inter-Medium", 36 * s, ink, "left"))
    else if st = "line"
        t = w.temp
        if w.words <> "" then t = t + "  " + w.words
        if dlTrue(o.place) and w.place <> "" then t = w.place + "  " + t
        items.push(dlLabel(t, x, y, dlTextWidth(t, "Inter-Medium", 36 * s) + 8, 48 * s, "Inter-Medium", 36 * s, ink, "left"))
    else
        bw = dlOr(o.w, 330)
        bh = dlOr(o.h, 170)
        if st = "big"
            bw = dlOr(o.w, 340)
            bh = dlOr(o.h, 210)
        end if
        bw = bw * s
        bh = bh * s
        if not dlIs(o.panel, "none")
            pc = "0x14161C8C"
            if dlIs(o.panel, "solid") then pc = "0x1E2028EB"
            items.push(dlNine("round", x, y, bw, bh, pc))
        end if
        pad = 24 * s
        big = (bh - pad * 2) * 0.62
        if st = "card" then big = (bh - pad * 2) * 0.5
        items.push(dlLabel(w.temp, x + pad, y + pad, bw - pad * 2, big * 1.2, "Inter-Medium", big, ink, "left"))
        sub1 = w.words
        if dlTrue(o.place) and w.place <> "" then sub1 = w.place + "  " + sub1
        ss = big * 0.32
        if ss < 22 then ss = 22
        items.push(dlLabel(sub1, x + pad, y + pad + big * 1.2, bw - pad * 2, ss * 1.3, "Inter-Regular", ss, dlMix(ink, "0xFFFFFF00", 0.2), "left"))
    end if
    for each it in items
        it.o = it.o * op
        if it.k = "label" then dlPushText(out, it, o.shadow) else out.push(it)
    end for
end sub

' a smart home object or a section: their panel with their name (a Roku has no Home Assistant path)
sub dlSmartItem(out as Object, o as Object)
    titles = { aircon: "Air conditioning", light: "Light", speaker: "Speaker", camera: "Camera", doorbell: "Doorbell", network: "Network", devices: "Devices", vacuum: "Vacuum", appliance: "Appliance", scene: "Scenes" }
    w = dlOr(o.w, 200)
    h = dlOr(o.h, 200)
    title = "Smart home"
    if o.type = "smart"
        title = titles[o.kind]
        if dlIs(o.style, "card") and o.w = invalid
            w = 440
            h = 120
        else if dlIs(o.style, "pill") and o.w = invalid
            w = 260
            h = 80
        end if
    else if o.w = invalid
        w = dlOr(o.cols, 2) * 180
        h = dlOr(o.rows, 1) * 180
    end if
    if dlIsStr(o.name) and o.name <> "" then title = o.name
    s = dlOr(o.scale, 1.0)
    dlCard(out, title, "", dlOr(o.x, 0), dlOr(o.y, 0), w * s, h * s, { panel: dlOr(o.panel, "glass") }, {}, dlOr(o.opacity, 1.0))
end sub

' ---------- widgets ----------
function dlWTitle(kind as String) as String
    t = { clock: "Clock", tallclock: "Clock", glassclock: "Clock", analog: "Clock", flipclock: "Clock", wordclock: "Clock", solar: "Sun", worldclock: "World clock", countdown: "Countdown", date: "Date", month: "Calendar", timer: "Timer", weather: "Weather", bigtemp: "Weather", hourly: "Hourly forecast", week: "This week", rain: "Rain", uv: "UV", sun: "Sunrise and sunset", moon: "Moon", air: "Air quality", surf: "Surf", photo: "Photo", slideshow: "Slideshow", mosaic: "Photos", artframe: "Art", memory: "Memories", keep: "Keep watching", keeprow: "Keep watching", upnext: "Up next", picks: "Picks for you", app: "App", folder: "Apps", dock: "Apps", appgrid: "Apps", games: "Games", nowplaying: "Now playing", soundscape: "Soundscape", queue: "Queue", speakers: "Speakers", aircon: "Air conditioning", scenes: "Scenes", controls: "Controls", camera: "Camera", doorbell: "Doorbell", energy: "Energy", sensor: "Sensor", battery: "Batteries", bins: "Bins", people: "People", agenda: "Agenda", note: "Note", list: "List", card: "Card", quote: "Quote", word: "Word of the day", news: "News", sports: "Sports", stocks: "Shares", commute: "Commute", welcome: "Welcome", quick: "Quick settings", wifi: "Wi-Fi", guide: "Guide", screentime: "Screen time", ask: "Ask", agent: "Agent", stack: "Stack" }
    if t.doesExist(kind) then return t[kind]
    return "Widget"
end function

' each widget's name as couch-tv Studio and the TV home say it (widget-caps.js name), for the card of a
' kind not drawn here
function dlWName(kind as String) as String
    n = { clock: "Digital clock", tallclock: "Tall clock", glassclock: "Glass clock", analog: "Analogue clock", flipclock: "Flip clock", wordclock: "Time in words", solar: "Sun clock", worldclock: "World clocks", countdown: "Countdown", date: "Date", month: "Month", timer: "Timer", weather: "Weather", bigtemp: "Big number", hourly: "Hourly", week: "This week", rain: "Rain soon", uv: "UV index", sun: "Sunrise and sunset", moon: "Moon", air: "Air quality", surf: "Surf", photo: "Photo", slideshow: "Slideshow", mosaic: "Photo mosaic", artframe: "Art frame", memory: "On this day", keep: "Keep watching", keeprow: "Keep watching row", upnext: "Up next", picks: "Picks for you", app: "One app", folder: "App folder", dock: "Dock", appgrid: "App grid", games: "Games", nowplaying: "Now playing", soundscape: "Soundscape", queue: "Up next queue", speakers: "Speakers", aircon: "Aircon", scenes: "Scenes", controls: "Control Centre", camera: "Camera", doorbell: "Doorbell", energy: "Solar and energy", sensor: "Sensor", battery: "Batteries", bins: "Bin night", people: "People", agenda: "Agenda", note: "Family note", list: "List", card: "Custom card", quote: "Quote", word: "Word of the day", news: "Headlines", sports: "Scores", stocks: "Markets", commute: "Commute", welcome: "Welcome words", quick: "Quick buttons", wifi: "Guest Wi-Fi", guide: "House guide", screentime: "Screen time", ask: "Ask AI", agent: "From your AI", stack: "Smart stack" }
    if n.doesExist(kind) then return n[kind]
    return "This widget"
end function

' the words on a kind this Roku does not draw: its name, said plainly, and where it does show. Never a
' label from the design (a surf widget's beach, an aircon's room): there is no data here behind it.
function dlNotHereWords(kind as String) as Object
    return { title: dlWName(kind) + ": not on this TV", line: "Shows on Google TV, Android TV and Fire TV" }
end function

' the card for a kind not drawn here. The title and the line each go on two lines when one would be too
' small to read, and a short box (a 40 px pill) has the title alone.
sub dlNotHere(out as Object, kind as String, x as Float, y as Float, w as Float, h as Float, style as Object, look as Object, op as Float)
    wd = dlNotHereWords(kind)
    items = []
    panel = dlOr(style.panel, "glass")
    if panel = "none" then panel = "glass"
    dlPanel(items, panel, x, y, w, h, style, look)
    ink = dlInk(panel, style, look)
    dimc = dlMix(ink, Left(ink, 8) + "00", 0.3)
    pad = dlPad(w, h)
    if h < 110 then pad = Int(dlMin(16, h * 0.12))
    iw = w - pad * 2
    ih = h - pad * 2
    if h < 110
        size = dlFit(wd.title, "Inter-Medium", iw, ih * 0.8, 40)
        items.push(dlLabel(wd.title, x + pad, y + (h - size * 1.3) / 2, iw, size * 1.3, "Inter-Medium", size, ink, "center"))
    else
        cut = Instr(1, wd.title, ": ")
        tl = [wd.title]
        big = dlFit(wd.title, "Inter-Medium", iw, ih * 0.3, 44)
        if big < 24
            tl = [Left(wd.title, cut), Mid(wd.title, cut + 2)]
            big = dlMin(dlFit(tl[0], "Inter-Medium", iw, ih * 0.22, 44), dlFit(tl[1], "Inter-Medium", iw, ih * 0.22, 44))
        end if
        sl = [wd.line]
        ss = dlFit(wd.line, "Inter-Regular", iw, ih * 0.16, dlMin(30, big * 0.7))
        if ss < 18
            sl = ["Shows on Google TV,", "Android TV and Fire TV"]
            ss = dlFit(sl[1], "Inter-Regular", iw, ih * 0.14, dlMin(30, big * 0.7))
            ' still too small to read: the title alone
            if ss < 18 then sl = []
        end if
        total = tl.count() * big * 1.3
        if sl.count() > 0 then total = total + big * 0.4 + sl.count() * ss * 1.3
        ty = y + (h - total) / 2
        for each t in tl
            items.push(dlLabel(t, x + pad, ty, iw, big * 1.3, "Inter-Medium", big, ink, "center"))
            ty = ty + big * 1.3
        end for
        if sl.count() > 0 then ty = ty + big * 0.4
        for each t in sl
            items.push(dlLabel(t, x + pad, ty, iw, ss * 1.3, "Inter-Regular", ss, dimc, "center"))
            ty = ty + ss * 1.3
        end for
    end if
    for each it in items
        it.o = it.o * op
        out.push(it)
    end for
end sub

' couch-tv Studio's sample words in its starter designs (app/templates.js), as widgets.js WELCOME_SAMPLE
' and WELCOME_SAMPLE_LINES: on a real TV they are a stranger's name and a made up house, so they never
' show. The greeting stays.
function dlWelcomeText(text as String) as String
    sample = { "Welcome, Ella and friends": "Welcome", "Hi Ruby!": "Hi!" }
    if sample.doesExist(text) then return sample[text]
    ' a sample line used as the greeting itself: the plain greeting
    if text <> "" and dlWelcomeLine(text) = "" then return "Welcome"
    return text
end function

function dlWelcomeLine(line as String) as String
    for each s in ["Headland House, North Point", "Tuesday to Sunday. Night two of five", "Three sleeps till the beach"]
        if s = line then return ""
    end for
    return line
end function

' the kinds drawn here; any other is the card that says it is not on this TV. Family note is not one:
' the note is kept in the web home's own store, which a Roku does not have.
function dlWNative(kind as String) as Boolean
    for each k in ["clock", "tallclock", "glassclock", "analog", "flipclock", "wordclock", "countdown", "date", "month", "weather", "bigtemp", "moon", "photo", "artframe", "keep", "keeprow", "app", "folder", "dock", "appgrid", "games", "people", "card", "quote", "welcome"]
        if k = kind then return true
    end for
    return false
end function

' the panel a kind has when its style does not say (WPANEL in design.js)
function dlWPanel(kind as String, style as Object) as String
    if dlIsStr(style.panel) then return style.panel
    p = { clock: "none", tallclock: "none", glassclock: "none", flipclock: "none", date: "none", welcome: "none", quote: "none", quick: "none", photo: "none", slideshow: "none", mosaic: "none", artframe: "none", memory: "none", keep: "none", keeprow: "none", upnext: "none", picks: "none", app: "none", appgrid: "none", camera: "none", stack: "none", analog: "colour", wordclock: "colour", countdown: "colour", weather: "colour", bigtemp: "colour", hourly: "colour", week: "colour", uv: "colour", surf: "colour", screentime: "colour", note: "colour", word: "paper", worldclock: "solid", moon: "solid", timer: "solid", stocks: "solid", battery: "solid" }
    if p.doesExist(kind) then return p[kind]
    return "glass"
end function

' the panel's colour, and the colour of words on it
function dlPanelColour(panel as String, style as Object, look as Object) as String
    if panel = "solid" then return dlOr(look.solid, "0x1E2028EB")
    if panel = "paper" then return dlOr(look.paper, "0xF4EFE6FF")
    if panel = "colour" then return dlOr(style.colour, dlOr(look.panel, "0x2B3A55FF"))
    return "0x1C141E80"
end function

function dlInk(panel as String, style as Object, look as Object) as String
    ink = dlOr(style.ink, "auto")
    if ink = "white" then return "0xFFFFFFFF"
    if ink = "ink" then return "0x1C1C1CFF"
    if ink = "accent" then return dlOr(style.accent, dlOr(look.accent, "0xFFC46BFF"))
    if panel = "paper" or ((panel = "colour" or panel = "solid") and dlIsLight(dlPanelColour(panel, style, look))) then return "0x1C1C1CFF"
    return dlOr(look.ink, "0xFFFFFFFF")
end function

sub dlPanel(out as Object, panel as String, x as Float, y as Float, w as Float, h as Float, style as Object, look as Object)
    if panel = "none" then return
    if panel = "glass" and not dlIsStr(style.corners)
        out.push({ k: "nine", u: "panel", x: Int(x), y: Int(y), w: Int(w), h: Int(h), c: "0xFFFFFFFF", o: 1.0 })
        return
    end if
    c = dlPanelColour(panel, style, look)
    if dlIs(style.corners, "square") then out.push(dlRect(x, y, w, h, c)) else out.push(dlNine("round", x, y, w, h, c))
end sub

' a tidy card: the panel, a title and, under it, one more line
sub dlCard(out as Object, title as String, sub1 as String, x as Float, y as Float, w as Float, h as Float, style as Object, look as Object, op as Float)
    items = []
    panel = dlOr(style.panel, "glass")
    if panel = "none" then panel = "glass"
    dlPanel(items, panel, x, y, w, h, style, look)
    ink = dlInk(panel, style, look)
    pad = dlPad(w, h)
    big = dlFit(title, "Inter-Medium", w - pad * 2, (h - pad * 2) * 0.45, 44)
    ty = y + (h - big * 1.3) / 2
    if sub1 <> "" then ty = ty - big * 0.4
    items.push(dlLabel(title, x + pad, ty, w - pad * 2, big * 1.3, "Inter-Medium", big, ink, "center"))
    if sub1 <> ""
        ss = Int(big * 0.62)
        if ss < 20 then ss = 20
        items.push(dlLabel(sub1, x + pad, ty + big * 1.35, w - pad * 2, ss * 1.3, "Inter-Regular", ss, dlMix(ink, Left(ink, 8) + "00", 0.3), "center"))
    end if
    for each it in items
        it.o = it.o * op
        out.push(it)
    end for
end sub

function dlPad(w as Float, h as Float) as Integer
    mt = w
    if h < mt then mt = h
    p = Int(mt * 0.08)
    if p < 14 then p = 14
    if p > 40 then p = 40
    return p
end function

' one widget in its box. ctx.apps are the Roku's apps; app tiles come back as items of kind "app".
sub dlWidget(out as Object, o as Object, ctx as Object, look as Object)
    kind = o.kind
    st = o.style
    op = dlOr(o.opts, {})
    x = dlOr(o.x, 0)
    y = dlOr(o.y, 0)
    w = o.w
    h = o.h
    alpha = dlOr(o.opacity, 1.0) * dlOr(st.opacity, 1.0)
    if kind = "stack"
        ' a smart stack takes turns: the next widget each minute (the design is drawn again each minute,
        ' dlHasTime), counted from midnight so every redraw agrees
        n = o.items.count()
        at = 0
        nw = dlAA(ctx.now)
        if n > 1 and nw.h <> invalid and nw.mi <> invalid then at = (nw.h * 60 + nw.mi) mod n
        first = {}
        first.append(o.items[at])
        first.x = x
        first.y = y
        first.w = w
        first.h = h
        first.opacity = o.opacity
        dlWidget(out, first, ctx, look)
        return
    end if
    if not dlWNative(kind)
        dlNotHere(out, kind, x, y, w, h, st, look, alpha)
        return
    end if
    items = []
    panel = dlWPanel(kind, st)
    dlPanel(items, panel, x, y, w, h, st, look)
    ink = dlInk(panel, st, look)
    dimc = dlMix(ink, Left(ink, 8) + "00", 0.3)
    pad = dlPad(w, h)
    fnt = "Inter-Medium"
    if dlIs(st.font, "antonio") then fnt = "Antonio-Light"
    align = dlOr(op.align, "center")
    iw = w - pad * 2
    ih = h - pad * 2
    now = ctx.now
    c24 = ctx.c24
    if dlIs(op.format, "24h") then c24 = true
    if dlIs(op.format, "12h") then c24 = false
    if kind = "clock" or kind = "glassclock" or kind = "tallclock" or kind = "flipclock"
        t = dlTimeText(now.h, now.mi, c24)
        if kind = "clock" and dlTrue(op.ampm) and not c24 then t = t + " " + dlAmPm(now.h)
        cf = "Antonio-Light"
        if dlIsStr(st.font) and st.font <> "antonio" then cf = "Inter-Medium"
        dh = ih
        if dlTrue(op.date) then dh = ih * 0.72
        if kind = "tallclock"
            parts = t.split(":")
            size = dlFit("00", cf, iw, dh / 2, 600)
            items.push(dlLabel(parts[0], x + pad, y + pad, iw, size * 1.05, cf, size, ink, align))
            items.push(dlLabel(Left(parts[1], 2), x + pad, y + pad + size * 1.0, iw, size * 1.05, cf, size, ink, align))
        else if kind = "flipclock"
            parts = t.split(":")
            gap = Int(iw * 0.04)
            cw = (iw - gap) / 2
            size = dlFit("00", cf, cw * 0.86, ih * 0.8, 600)
            for i = 0 to 1
                cx = x + pad + i * (cw + gap)
                items.push(dlNine("round", cx, y + pad, cw, ih, "0x111216F0"))
                items.push(dlRect(cx, y + pad + ih / 2 - 1, cw, 2, "0x00000099"))
                items.push(dlLabel(parts[i], cx, y + pad + (ih - size * 1.2) / 2, cw, size * 1.2, cf, size, "0xF2F2F2FF", "center"))
            end for
        else
            size = dlFit(t, cf, iw, dh / 1.15, 600)
            items.push(dlLabel(t, x + pad, y + pad + (dh - size * 1.15) / 2, iw, size * 1.2, cf, size, ink, align))
        end if
        if dlTrue(op.date) and kind <> "flipclock"
            d = dlDateText(invalid, now)
            ds = dlFit(d, "Inter-Medium", iw, ih * 0.2, 48)
            items.push(dlLabel(d, x + pad, y + pad + ih - ds * 1.3, iw, ds * 1.3, "Inter-Medium", ds, dimc, align))
        end if
    else if kind = "wordclock"
        t = dlWordClock(now.h, now.mi)
        size = dlFit("twenty five past", "Inter-Medium", iw, ih / 3.6, 80)
        l = dlLabel(t, x + pad, y + pad, iw, ih, "Inter-Medium", size, ink, align)
        l.wrap = true
        l.valign = "center"
        items.push(l)
    else if kind = "analog"
        dlAnalog(items, x + w / 2, y + h / 2, (dlMin(w, h) - pad * 2) / 2, now, ink)
    else if kind = "date"
        show = dlOr(op.show, "date")
        lines = []
        if show <> "weather" then lines.push(dlDateText(op.dfmt, now))
        wx = dlWeather(ctx.weather, ctx.fahrenheit)
        if show <> "date" and wx <> invalid
            t = wx.temp
            if wx.words <> "" then t = t + "  " + wx.words
            if dlTrue(op.place) and wx.place <> "" then t = wx.place + "  " + t
            lines.push(t)
        end if
        if lines.count() = 0 then lines.push(dlDateText(op.dfmt, now))
        size = dlFit(lines[0], "Inter-Medium", iw, ih / (lines.count() * 1.3), 72)
        ty = y + pad + (ih - size * 1.3 * lines.count()) / 2
        for i = 0 to lines.count() - 1
            c = ink
            if i > 0 then c = dimc
            items.push(dlLabel(lines[i], x + pad, ty + i * size * 1.3, iw, size * 1.3, "Inter-Medium", size, c, align))
        end for
    else if kind = "weather" or kind = "bigtemp"
        wx = dlWeather(ctx.weather, ctx.fahrenheit)
        if wx = invalid
            dlCard(out, "Weather", "", x, y, w, h, st, look, alpha)
            return
        end if
        big = dlFit(wx.temp, "Inter-Medium", iw, ih * 0.62, 400)
        if kind = "bigtemp" then big = dlFit(wx.temp, "Inter-Medium", iw, ih * 0.8, 500)
        top = y + pad
        if dlTrue(op.place) and wx.place <> ""
            ps = dlFit(wx.place, "Inter-Medium", iw, ih * 0.14, 40)
            items.push(dlLabel(wx.place, x + pad, top, iw, ps * 1.3, "Inter-Medium", ps, dimc, align))
            top = top + ps * 1.3
            big = dlMin(big, (y + h - pad - top) * 0.7)
        end if
        items.push(dlLabel(wx.temp, x + pad, top, iw, big * 1.15, "Inter-Medium", big, ink, align))
        if kind = "weather"
            t = wx.words
            if dlTrue(op.hilo) and wx.hilo <> "" then t = t + "   " + wx.hilo
            if t <> ""
                ss = dlFit(t, "Inter-Regular", iw, ih * 0.16, 40)
                items.push(dlLabel(t, x + pad, top + big * 1.15, iw, ss * 1.3, "Inter-Regular", ss, dimc, align))
            end if
        end if
    else if kind = "countdown"
        if op.month = invalid or op.day = invalid
            dlCard(out, dlOr(op.label, "Countdown"), "", x, y, w, h, st, look, alpha)
            return
        end if
        cd = dlCountdown(op.month, op.day, dlOr(op.unit, "days"), now)
        n = cd.n.toStr()
        big = dlFit(n, "Antonio-Light", iw, ih * 0.55, 400)
        items.push(dlLabel(n, x + pad, y + pad, iw, big * 1.15, "Antonio-Light", big, ink, align))
        t = cd.word
        if dlIsStr(op.label) and op.label <> "" then t = t + " until " + op.label
        ss = dlFit(t, "Inter-Medium", iw, ih * 0.18, 40)
        items.push(dlLabel(t, x + pad, y + pad + big * 1.15, iw, ss * 1.3, "Inter-Medium", ss, dimc, align))
    else if kind = "month"
        dlMonth(items, x + pad, y + pad, iw, ih, now, ink, dimc)
    else if kind = "moon"
        mn = dlMoon(now)
        r = dlMin(iw, ih * 0.55) / 2
        cx = x + w / 2
        items.push({ k: "disc", x: Int(cx - r), y: Int(y + pad), w: Int(r * 2), h: Int(r * 2), c: "0xF3EEDCFF", o: 0.2 + 0.8 * mn.lit / 100.0 })
        ns = dlFit(mn.name, "Inter-Medium", iw, ih * 0.16, 40)
        items.push(dlLabel(mn.name, x + pad, y + pad + r * 2 + ns * 0.3, iw, ns * 1.3, "Inter-Medium", ns, ink, "center"))
        lit = mn.lit.toStr() + "% lit"
        items.push(dlLabel(lit, x + pad, y + pad + r * 2 + ns * 1.6, iw, ns * 1.3, "Inter-Regular", ns * 0.8, dimc, "center"))
    else if kind = "photo" or kind = "artframe"
        uri = ""
        if dlIsStr(op.image) then uri = dlImageUri(op.image, ctx.bridge, ctx.key)
        if uri = ""
            dlCard(out, dlWTitle(kind), "", x, y, w, h, st, look, alpha)
            return
        end if
        px = x
        py = y
        pw = w
        ph = h
        if kind = "artframe"
            items.push(dlRect(x, y, w, h, dlOr(op.mat, "0xF4F1EAFF")))
            mt = Int(dlMin(w, h) * 0.09)
            px = x + mt
            py = y + mt
            pw = w - mt * 2
            ph = h - mt * 2
        end if
        mode = "zoom"
        if dlIs(op.fit, "contain") then mode = "fit"
        items.push({ k: "poster", u: uri, x: Int(px), y: Int(py), w: Int(pw), h: Int(ph), mode: mode, o: 1.0 })
        cap = dlOr(op.caption, "")
        if cap <> "" or dlIsStr(op.sub)
            cs = dlFit(cap + " ", "Inter-Medium", pw - 40, ph * 0.1, 36)
            band = cs * 1.3
            if dlIsStr(op.sub) then band = band + cs
            items.push(dlRect(px, py + ph - band - 24, pw, band + 24, "0x00000080"))
            items.push(dlLabel(cap, px + 20, py + ph - band - 12, pw - 40, cs * 1.3, "Inter-Medium", cs, "0xFFFFFFFF", "left"))
            if dlIsStr(op.sub) then items.push(dlLabel(op.sub, px + 20, py + ph - band - 12 + cs * 1.3, pw - 40, cs, "Inter-Regular", cs * 0.75, "0xFFFFFFCC", "left"))
        end if
    else if kind = "keep" or kind = "keeprow"
        shelf = dlList(ctx.shelf)
        if shelf.count() = 0
            dlCard(out, dlOr(op.label, "Keep watching"), "", x, y, w, h, st, look, alpha)
            return
        end if
        n = 1
        if kind = "keeprow" then n = dlOr(op.shows, 3)
        if n > shelf.count() then n = shelf.count()
        gap = 16
        cw = (iw - gap * (n - 1)) / n
        for i = 0 to n - 1
            it = shelf[i]
            cx = x + pad + i * (cw + gap)
            ph = dlMin(cw * 9 / 16, ih * 0.72)
            if dlIsStr(it.poster) and it.poster <> "" then items.push({ k: "poster", u: it.poster, x: Int(cx), y: Int(y + pad), w: Int(cw), h: Int(ph), mode: "zoom", o: 1.0 })
            ts = dlMin(30, (ih - ph) * 0.6)
            if ts < 16 then ts = 16
            title = ""
            if dlIsStr(it.title) then title = it.title
            items.push(dlLabel(title, cx, y + pad + ph + 8, cw, ts * 1.3, "Inter-Medium", ts, ink, "left"))
        end for
    else if kind = "people"
        names = dlList(ctx.people)
        if names.count() = 0
            dlCard(out, "People", "", x, y, w, h, st, look, alpha)
            return
        end if
        n = names.count()
        if n > 6 then n = 6
        size = dlMin(44, ih / (n * 1.4))
        for i = 0 to n - 1
            items.push(dlLabel(names[i], x + pad, y + pad + i * size * 1.4, iw, size * 1.3, "Inter-Medium", size, ink, align))
        end for
    else if kind = "card" or kind = "quote" or kind = "welcome" or kind = "note"
        top = ""
        body = ""
        bottom = ""
        if kind = "card"
            top = dlOr(op.label, "")
            body = dlOr(op.text, "")
        else if kind = "quote"
            body = dlOr(op.text, "")
            if body <> "" then body = Chr(8220) + body + Chr(8221)
            bottom = dlOr(op.sub, "")
        else if kind = "welcome"
            top = dlWelcomeLine(dlOr(op.kicker, ""))
            body = dlWelcomeText(dlOr(op.text, "Welcome"))
            bottom = dlWelcomeLine(dlOr(op.sub, ""))
        else
            body = "Note"
        end if
        if body = "" then body = dlWTitle(kind)
        ks = dlMin(32, ih * 0.14)
        ty = y + pad
        if top <> ""
            items.push(dlLabel(UCase(top), x + pad, ty, iw, ks * 1.3, "Inter-Medium", ks, dimc, align))
            ty = ty + ks * 1.6
        end if
        room = y + h - pad - ty
        if bottom <> "" then room = room - ks * 1.6
        size = dlFit(body, fnt, iw, room, 96)
        lines = 1
        if size < 28 and Len(body) > 20
            size = dlFit(Left(body, Int(Len(body) / 2) + 1), fnt, iw, room / 2.4, 72)
            lines = 3
        end if
        l = dlLabel(body, x + pad, ty, iw, room, fnt, size, ink, align)
        l.wrap = lines > 1
        l.valign = "center"
        items.push(l)
        if bottom <> "" then items.push(dlLabel(bottom, x + pad, y + h - pad - ks * 1.3, iw, ks * 1.3, "Inter-Regular", ks, dimc, align))
    else
        ' the app kinds: tiles the remote reaches
        title = ""
        if kind = "folder" or kind = "games" then title = dlOr(op.label, dlWTitle(kind))
        ty = y + pad
        if title <> ""
            ts = dlMin(32, ih * 0.14)
            items.push(dlLabel(title, x + pad, ty, iw, ts * 1.3, "Inter-Medium", ts, ink, "left"))
            ty = ty + ts * 1.6
        end if
        avail = y + h - pad - ty
        dlAppTiles(items, kind, op, x + pad, ty, iw, avail, ctx, ink)
    end if
    for each it in items
        it.o = it.o * alpha
        out.push(it)
    end for
end sub

function dlMin(a as Float, b as Float) as Float
    if a < b then return a
    return b
end function

sub dlAppTiles(items as Object, kind as String, op as Object, x as Float, y as Float, w as Float, h as Float, ctx as Object, ink as String)
    apps = dlList(ctx.apps)
    gap = 18
    if kind = "app"
        idx = dlWidgetApps(op.apps, apps, 1)
        if idx.count() = 0 then return
        t = dlMin(w, h)
        items.push({ k: "app", i: idx[0], x: Int(x + (w - t) / 2), y: Int(y + (h - t) / 2), w: Int(t), h: Int(t), o: 1.0 })
        return
    end if
    if kind = "dock"
        t = dlMin(h, 112)
        n = Int((w + gap) / (t + gap))
        if n < 1 then n = 1
        idx = dlWidgetApps(op.apps, apps, n)
        total = idx.count() * (t + gap) - gap
        sx = x + (w - total) / 2
        for i = 0 to idx.count() - 1
            items.push({ k: "app", i: idx[i], x: Int(sx + i * (t + gap)), y: Int(y + (h - t) / 2), w: Int(t), h: Int(t), o: 1.0 })
        end for
        return
    end if
    cols = dlOr(op.cols, 3)
    t = (w - gap * (cols - 1)) / cols
    names = dlTrue(op.names)
    nh = 0
    if names then nh = 34
    if t > 160 then t = 160
    rows = Int((h + gap) / (t + nh + gap))
    if rows < 1 then rows = 1
    idx = dlWidgetApps(op.apps, apps, rows * cols)
    for i = 0 to idx.count() - 1
        c = i mod cols
        r = Int(i / cols)
        tx = x + c * (t + gap)
        ty = y + r * (t + nh + gap)
        items.push({ k: "app", i: idx[i], x: Int(tx), y: Int(ty), w: Int(t), h: Int(t), o: 1.0 })
        if names and dlIsStr(apps[idx[i]].title) then items.push(dlLabel(apps[idx[i]].title, tx - 8, ty + t + 4, t + 16, 30, "Inter-Regular", 22, ink, "center"))
    end for
end sub

' a clock face: twelve marks and three hands, each a thin rectangle turned about the middle
sub dlAnalog(items as Object, cx as Float, cy as Float, r as Float, now as Object, ink as String)
    for i = 0 to 11
        lng = 0.08
        if i mod 3 = 0 then lng = 0.14
        items.push({ k: "rect", x: Int(cx - 2), y: Int(cy - r), w: 4, h: Int(r * lng), c: dlMix(ink, Left(ink, 8) + "00", 0.35), o: 1.0, rot: i * 30, cx: 2, cy: Int(r) })
    end for
    hourDeg = (now.h mod 12) * 30 + now.mi * 0.5
    minDeg = now.mi * 6
    items.push({ k: "rect", x: Int(cx - 5), y: Int(cy - r * 0.5), w: 10, h: Int(r * 0.5), c: ink, o: 1.0, rot: hourDeg, cx: 5, cy: Int(r * 0.5) })
    items.push({ k: "rect", x: Int(cx - 3), y: Int(cy - r * 0.78), w: 6, h: Int(r * 0.78), c: ink, o: 1.0, rot: minDeg, cx: 3, cy: Int(r * 0.78) })
    items.push({ k: "disc", x: Int(cx - 9), y: Int(cy - 9), w: 18, h: 18, c: ink, o: 1.0 })
end sub

' this month as a grid, Monday first, today marked
sub dlMonth(items as Object, x as Float, y as Float, w as Float, h as Float, now as Object, ink as String, dimc as String)
    title = dlMonths()[now.mo - 1] + " " + now.y.toStr()
    ts = dlMin(36, h * 0.12)
    items.push(dlLabel(title, x, y, w, ts * 1.3, "Inter-Medium", ts, ink, "left"))
    first = (dlWeekday(now.y, now.mo, 1) + 6) mod 7
    days = dlMonthDays(now.y, now.mo)
    rows = Int((first + days + 6) / 7)
    top = y + ts * 1.5
    ch = (y + h - top) / (rows + 1)
    cw = w / 7
    size = dlMin(ch * 0.6, cw * 0.45)
    heads = ["M", "T", "W", "T", "F", "S", "S"]
    for c = 0 to 6
        items.push(dlLabel(heads[c], x + c * cw, top, cw, ch, "Inter-Medium", size * 0.8, dimc, "center"))
    end for
    for d = 1 to days
        i = first + d - 1
        cx = x + (i mod 7) * cw
        cy = top + (Int(i / 7) + 1) * ch
        c = ink
        if d = now.d
            items.push(dlNine("round", cx + cw * 0.12, cy, cw * 0.76, ch * 0.92, Left(ink, 8) + "33"))
        end if
        items.push(dlLabel(d.toStr(), cx, cy + (ch - size * 1.25) / 2, cw, size * 1.25, "Inter-Regular", size, c, "center"))
    end for
end sub

' The whole design as things to draw. ctx: now {y, mo, d, wd, h, mi}, c24, fahrenheit, weather (the
' bridge's), apps (the Roku's, in the dock's order), people (names), shelf (Keep watching), bridge, key.
' Returns { bg: [...], back: [...], front: [...] }: the background, what goes behind the home's own parts
' and what goes in front of them.
function dlLayout(design as Object, ctx as Object) as Object
    out = { bg: dlBackground(design.background, ctx), back: [], front: [] }
    look = dlAA(design.look)
    for each t in dlList(design.texts)
        if not dlTrue(t.hidden) then dlTextItem(out.front, t, 48)
    end for
    for each o in dlList(design.objects)
        if not dlTrue(o.hidden)
            dest = out.front
            if o.layer = "back" then dest = out.back
            if o.type = "text"
                dlTextItem(dest, o, 56)
            else if o.type = "shape"
                dlShapeItem(dest, o)
            else if o.type = "clock"
                dlClockItem(dest, o, ctx)
            else if o.type = "weather"
                dlWeatherItem(dest, o, ctx)
            else if o.type = "smart" or o.type = "group"
                dlSmartItem(dest, o)
            else if o.type = "widget"
                dlWidget(dest, o, ctx, look)
            end if
        end if
    end for
    return out
end function

' a design that shows the time: drawn again each minute
function dlHasTime(design as Object) as Boolean
    for each o in dlList(design.objects)
        if o.type = "clock" then return true
        if o.type = "widget"
            k = o.kind
            ' a stack of two or more moves on each minute
            if k = "stack" and o.items.count() > 1 then return true
            if k = "stack" then k = o.items[0].kind
            for each t in ["clock", "tallclock", "glassclock", "analog", "flipclock", "wordclock", "countdown", "date", "month", "moon"]
                if t = k then return true
            end for
        end if
    end for
    return false
end function
