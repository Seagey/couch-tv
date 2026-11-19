import io, os, shutil
D = "/media/developer/apps/usr/palm/services/io.strem.tv.beta.server"
def patch(name, old, new):
    p = os.path.join(D, name)
    s = io.open(p, encoding="utf-8").read()
    if new in s:
        print(name, "already patched"); return
    assert s.count(old) == 1, (name, s.count(old))
    if not os.path.exists(p + ".orig"):
        shutil.copy2(p, p + ".orig")
    io.open(p, "w", encoding="utf-8", newline="").write(s.replace(old, new))
    print(name, "patched")
# 1. settings list: sizes above 160%
patch("beta.html",
      "['4','140%'],['5','160%']]",
      "['4','140%'],['5','160%'],['6','200%'],['7','250%'],['8','300%'],['9','400%']]")
# 2. player: the size setting was never read (subtitles were a fixed 38px); apply it
patch("tvserver.js",
      "'function renderSub(){if(curSub===\"off\"||!cues||!cues.length){return;}' +",
      "'(function(){try{var P=[72,80,100,120,140,160,200,250,300,400],i=parseInt(String(localStorage.getItem(\"subtitleSize\")||\"\").replace(/[^0-9]/g,\"\"),10);if(!(i>=0&&i<P.length))i=2;var st=document.createElement(\"style\");st.textContent=\"#sub{left:3%;right:3%;line-height:1.22}#sub span{font-size:\"+Math.round(38*P[i]/100)+\"px}\";document.head.appendChild(st);}catch(e){}})();' +\n"
      "'function renderSub(){if(curSub===\"off\"||!cues||!cues.length){return;}' +")
