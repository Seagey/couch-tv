sub init()
    m.top.functionName = "go"
end sub

sub go()
    req = CreateObject("roUrlTransfer")
    port = CreateObject("roMessagePort")
    req.setMessagePort(port)
    req.setUrl(m.top.url)
    req.addHeader("Content-Type", "application/json")
    req.enableEncodings(true)
    sent = false
    if m.top.method = "POST"
        req.setRequest("POST")
        sent = req.asyncPostFromString(m.top.body)
    else
        sent = req.asyncGetToString()
    end if
    status = -1
    text = ""
    if sent
        msg = wait(8000, port)
        if type(msg) = "roUrlEvent"
            status = msg.getResponseCode()
            text = msg.getString()
        else
            req.asyncCancel()
        end if
    end if
    m.top.status = status
    m.top.response = text
    m.top.done = true
end sub
