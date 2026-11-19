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
    if LCase(Left(m.top.url, 6)) = "https:"
        ' couch-tv Studio's design store: checked against the Roku's own list of certificate authorities
        req.setCertificatesFile("common:/certs/ca-bundle.crt")
        req.initClientCertificates()
    end if
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
        timeout = m.top.timeout
        if timeout <= 0 then timeout = 8000
        msg = wait(timeout, port)
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
