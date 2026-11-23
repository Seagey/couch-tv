' couch-tv for Roku: the home screen as a channel. Everything is drawn in components/HomeScene.brs.
sub Main()
    screen = CreateObject("roSGScreen")
    port = CreateObject("roMessagePort")
    screen.setMessagePort(port)
    scene = screen.CreateScene("HomeScene")
    screen.show()
    scene.setFocus(true)
    while true
        msg = wait(0, port)
        if type(msg) = "roSGScreenEvent" and msg.isScreenClosed() then return
    end while
end sub
