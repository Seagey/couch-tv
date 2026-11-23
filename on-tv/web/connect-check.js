// "Can't connect?" on Home settings on the phone (on-tv/web/setup.html, This TV, Let the phone press keys).
// It asks the TV what is in the way (GET /api/adb/check, ConnectCheck.kt) and says the one thing wrong, with
// the fix, in plain words: the phone on another network, the TV on a network cable, debugging off, no
// Wireless debugging, the Allow question not answered, or the debugging connection closed. When the phone
// can't reach the TV at all, the page says that itself. "Copy a report" copies a short block for asking
// for help: model, Android version, the connection state and the last error, with no addresses and no keys
// (the TV masks them). The words come in every phone page language (the same 16 as phone-words.js).
(function () {
  'use strict';
  var LANGS = ['en', 'es', 'es-MX', 'it', 'de', 'fr', 'tr', 'sr-Latn-RS', 'pl', 'nl', 'cs', 'he', 'ar', 'pt', 'ro', 'zh-CN'];
  var RTL = { he: 1, ar: 1 };
  // key: { language: words }. es-MX only where Mexico says it differently (else es).
  var W = {
    title: { en: "Can't connect?", es: '¿No se conecta?', it: 'Non si connette?', de: 'Keine Verbindung?', fr: 'Pas de connexion ?', tr: 'Bağlanamıyor mu?', 'sr-Latn-RS': 'Ne možete da se povežete?', pl: 'Nie możesz połączyć?', nl: 'Lukt verbinden niet?', cs: 'Nedaří se připojit?', he: 'אין חיבור?', ar: 'لا يتصل؟', pt: 'Não conecta?', ro: 'Nu se conectează?', 'zh-CN': '连接不上？' },
    intro: { en: "If the phone can't press keys, this check finds what is in the way and says how to fix it.",
      es: 'Si el teléfono no puede pulsar teclas, esta comprobación encuentra qué lo impide y dice cómo arreglarlo.',
      'es-MX': 'Si el celular no puede presionar teclas, esta revisión encuentra qué lo impide y dice cómo arreglarlo.',
      it: 'Se il telefono non riesce a premere i tasti, questo controllo trova cosa lo blocca e dice come risolvere.',
      de: 'Wenn das Handy keine Tasten drücken kann, findet diese Prüfung, was im Weg ist, und sagt, wie du es behebst.',
      fr: "Si le téléphone ne peut pas appuyer sur les touches, cette vérification trouve ce qui bloque et dit comment régler ça.",
      tr: 'Telefon tuşlara basamıyorsa bu kontrol neyin engel olduğunu bulur ve nasıl düzeleceğini söyler.',
      'sr-Latn-RS': 'Ako telefon ne može da pritiska tastere, ova provera pronalazi šta smeta i kaže kako da se popravi.',
      pl: 'Jeśli telefon nie może naciskać klawiszy, to sprawdzenie znajdzie, co przeszkadza, i powie, jak to naprawić.',
      nl: 'Kan de telefoon geen toetsen indrukken? Deze controle vindt wat in de weg zit en zegt hoe je het oplost.',
      cs: 'Pokud telefon nemůže mačkat tlačítka, tato kontrola najde, co brání, a řekne, jak to opravit.',
      he: 'אם הטלפון לא יכול ללחוץ על מקשים, הבדיקה הזו מוצאת מה מפריע ואומרת איך לתקן.',
      ar: 'إذا لم يستطع الهاتف الضغط على الأزرار، يجد هذا الفحص ما يعيق ذلك ويقول كيف تصلحه.',
      pt: 'Se o celular não consegue apertar teclas, esta verificação encontra o que atrapalha e diz como resolver.',
      ro: 'Dacă telefonul nu poate apăsa taste, această verificare găsește ce împiedică și spune cum se rezolvă.',
      'zh-CN': '如果手机无法按键，这项检查会找出问题所在，并告诉你怎么解决。' },
    check: { en: 'Check now', es: 'Comprobar ahora', 'es-MX': 'Revisar ahora', it: 'Controlla ora', de: 'Jetzt prüfen', fr: 'Vérifier maintenant', tr: 'Şimdi kontrol et', 'sr-Latn-RS': 'Proveri sada', pl: 'Sprawdź teraz', nl: 'Nu controleren', cs: 'Zkontrolovat teď', he: 'לבדוק עכשיו', ar: 'افحص الآن', pt: 'Verificar agora', ro: 'Verifică acum', 'zh-CN': '立即检查' },
    checking: { en: 'Checking…', es: 'Comprobando…', 'es-MX': 'Revisando…', it: 'Controllo in corso…', de: 'Wird geprüft…', fr: 'Vérification…', tr: 'Kontrol ediliyor…', 'sr-Latn-RS': 'Proveravam…', pl: 'Sprawdzanie…', nl: 'Bezig met controleren…', cs: 'Kontroluji…', he: 'בודק…', ar: 'جارٍ الفحص…', pt: 'Verificando…', ro: 'Se verifică…', 'zh-CN': '正在检查…' },
    copy: { en: 'Copy a report', es: 'Copiar un informe', 'es-MX': 'Copiar un reporte', it: 'Copia un resoconto', de: 'Bericht kopieren', fr: 'Copier un rapport', tr: 'Rapor kopyala', 'sr-Latn-RS': 'Kopiraj izveštaj', pl: 'Kopiuj raport', nl: 'Een verslag kopiëren', cs: 'Zkopírovat zprávu', he: 'העתקת דוח', ar: 'نسخ تقرير', pt: 'Copiar um relatório', ro: 'Copiază un raport', 'zh-CN': '复制报告' },
    copied: { en: 'Copied. Paste it in your message when you ask for help. It has no addresses and no passwords.',
      es: 'Copiado. Pégalo en tu mensaje cuando pidas ayuda. No lleva direcciones ni contraseñas.',
      it: 'Copiato. Incollalo nel messaggio quando chiedi aiuto. Non contiene indirizzi né password.',
      de: 'Kopiert. Füge es in deine Nachricht ein, wenn du um Hilfe bittest. Es enthält keine Adressen und keine Passwörter.',
      fr: "Copié. Colle-le dans ton message quand tu demandes de l'aide. Il ne contient ni adresse ni mot de passe.",
      tr: 'Kopyalandı. Yardım isterken mesajına yapıştır. İçinde adres ve şifre yok.',
      'sr-Latn-RS': 'Kopirano. Nalepite ga u poruku kada tražite pomoć. Nema adresa ni lozinki.',
      pl: 'Skopiowano. Wklej to do wiadomości, gdy prosisz o pomoc. Nie ma w nim adresów ani haseł.',
      nl: 'Gekopieerd. Plak het in je bericht als je om hulp vraagt. Er staan geen adressen en geen wachtwoorden in.',
      cs: 'Zkopírováno. Vložte to do zprávy, když budete žádat o pomoc. Nejsou v tom žádné adresy ani hesla.',
      he: 'הועתק. הדביקו אותו בהודעה כשאתם מבקשים עזרה. אין בו כתובות ואין סיסמאות.',
      ar: 'تم النسخ. الصقه في رسالتك عندما تطلب المساعدة. لا يحتوي على عناوين ولا كلمات مرور.',
      pt: 'Copiado. Cole na sua mensagem quando pedir ajuda. Não tem endereços nem senhas.',
      ro: 'Copiat. Lipește-l în mesaj când ceri ajutor. Nu conține adrese și nici parole.',
      'zh-CN': '已复制。求助时把它粘贴到你的消息里。里面没有地址，也没有密码。' },
    copyfail: { en: "Couldn't copy it by itself. Press and hold the report below, then choose Copy.",
      es: 'No se pudo copiar solo. Mantén pulsado el informe de abajo y elige Copiar.',
      'es-MX': 'No se pudo copiar solo. Mantén presionado el reporte de abajo y elige Copiar.',
      it: 'Non è stato possibile copiarlo da solo. Tieni premuto il resoconto qui sotto e scegli Copia.',
      de: 'Das Kopieren hat nicht von selbst geklappt. Halte den Bericht unten gedrückt und wähle Kopieren.',
      fr: "La copie n'a pas marché toute seule. Appuie longuement sur le rapport ci-dessous, puis choisis Copier.",
      tr: 'Kendiliğinden kopyalanamadı. Aşağıdaki rapora basılı tut ve Kopyala\'yı seç.',
      'sr-Latn-RS': 'Nije moglo samo da se kopira. Zadržite prst na izveštaju ispod i izaberite Kopiraj.',
      pl: 'Nie udało się skopiować samo. Przytrzymaj raport poniżej i wybierz Kopiuj.',
      nl: 'Kopiëren lukte niet vanzelf. Houd het verslag hieronder ingedrukt en kies Kopiëren.',
      cs: 'Samo se to zkopírovat nepodařilo. Podržte prst na zprávě níže a zvolte Kopírovat.',
      he: 'לא הצלחנו להעתיק אוטומטית. לחצו לחיצה ארוכה על הדוח למטה ובחרו העתקה.',
      ar: 'تعذّر النسخ تلقائيًا. اضغط مطولًا على التقرير بالأسفل ثم اختر نسخ.',
      pt: 'Não deu para copiar sozinho. Toque e segure o relatório abaixo e escolha Copiar.',
      ro: 'Nu s-a putut copia singur. Ține apăsat pe raportul de mai jos și alege Copiază.',
      'zh-CN': '无法自动复制。长按下面的报告，然后选择复制。' },
    ok: { en: 'The phone can press keys. Nothing is in the way.', es: 'El teléfono puede pulsar teclas. Nada lo impide.', 'es-MX': 'El celular puede presionar teclas. Nada lo impide.', it: 'Il telefono può premere i tasti. Niente lo blocca.', de: 'Das Handy kann Tasten drücken. Nichts ist im Weg.', fr: 'Le téléphone peut appuyer sur les touches. Rien ne bloque.', tr: 'Telefon tuşlara basabiliyor. Engel yok.', 'sr-Latn-RS': 'Telefon može da pritiska tastere. Ništa ne smeta.', pl: 'Telefon może naciskać klawisze. Nic nie przeszkadza.', nl: 'De telefoon kan toetsen indrukken. Niets zit in de weg.', cs: 'Telefon může mačkat tlačítka. Nic nebrání.', he: 'הטלפון יכול ללחוץ על מקשים. שום דבר לא מפריע.', ar: 'يستطيع الهاتف الضغط على الأزرار. لا شيء يعيق ذلك.', pt: 'O celular consegue apertar teclas. Nada atrapalha.', ro: 'Telefonul poate apăsa taste. Nimic nu împiedică.', 'zh-CN': '手机可以按键。没有任何问题。' },
    unreachable_h: { en: "The phone can't reach the TV.", es: 'El teléfono no llega a la tele.', 'es-MX': 'El celular no llega a la tele.', it: 'Il telefono non raggiunge la TV.', de: 'Das Handy erreicht den Fernseher nicht.', fr: 'Le téléphone ne joint pas la TV.', tr: 'Telefon TV\'ye ulaşamıyor.', 'sr-Latn-RS': 'Telefon ne može da dođe do televizora.', pl: 'Telefon nie może połączyć się z telewizorem.', nl: 'De telefoon kan de tv niet bereiken.', cs: 'Telefon se k televizi nedostane.', he: 'הטלפון לא מגיע לטלוויזיה.', ar: 'لا يصل الهاتف إلى التلفزيون.', pt: 'O celular não alcança a TV.', ro: 'Telefonul nu ajunge la televizor.', 'zh-CN': '手机连不到电视。' },
    unreachable_f: { en: 'Put the phone on the same Wi-Fi as the TV, not a guest network and not mobile data. Check the TV is on. Then load this page again.',
      es: 'Pon el teléfono en la misma Wi-Fi que la tele, no en una red de invitados ni en datos móviles. Comprueba que la tele está encendida. Luego vuelve a cargar esta página.',
      'es-MX': 'Conecta el celular a la misma Wi-Fi que la tele, no a una red de invitados ni a datos móviles. Revisa que la tele esté prendida. Luego vuelve a cargar esta página.',
      it: 'Metti il telefono sulla stessa Wi-Fi della TV, non su una rete ospiti e non sui dati mobili. Controlla che la TV sia accesa. Poi ricarica questa pagina.',
      de: 'Verbinde das Handy mit demselben WLAN wie den Fernseher, nicht mit einem Gästenetz und nicht mit mobilen Daten. Prüfe, ob der Fernseher an ist. Lade dann diese Seite neu.',
      fr: "Mets le téléphone sur le même Wi-Fi que la TV, pas sur un réseau invité ni sur les données mobiles. Vérifie que la TV est allumée. Puis recharge cette page.",
      tr: 'Telefonu TV ile aynı Wi-Fi\'ye bağla; misafir ağına veya mobil veriye değil. TV\'nin açık olduğunu kontrol et. Sonra bu sayfayı yeniden yükle.',
      'sr-Latn-RS': 'Povežite telefon na isti Wi-Fi kao televizor, ne na mrežu za goste i ne na mobilne podatke. Proverite da je televizor uključen. Zatim ponovo učitajte ovu stranicu.',
      pl: 'Połącz telefon z tą samą siecią Wi-Fi co telewizor, nie z siecią dla gości i nie z danymi komórkowymi. Sprawdź, czy telewizor jest włączony. Potem wczytaj tę stronę ponownie.',
      nl: 'Zet de telefoon op dezelfde wifi als de tv, niet op een gastnetwerk en niet op mobiele data. Kijk of de tv aan staat. Laad deze pagina daarna opnieuw.',
      cs: 'Připojte telefon ke stejné Wi-Fi jako televizi, ne k síti pro hosty a ne k mobilním datům. Zkontrolujte, že je televize zapnutá. Pak tuto stránku načtěte znovu.',
      he: 'חברו את הטלפון לאותה רשת Wi-Fi של הטלוויזיה, לא לרשת אורחים ולא לנתונים סלולריים. בדקו שהטלוויזיה דולקת. אחר כך טענו את הדף מחדש.',
      ar: 'صِل الهاتف بشبكة Wi-Fi نفسها التي يتصل بها التلفزيون، لا بشبكة الضيوف ولا ببيانات الجوال. تأكد أن التلفزيون يعمل. ثم أعد تحميل هذه الصفحة.',
      pt: 'Coloque o celular no mesmo Wi-Fi da TV, não numa rede de convidados nem nos dados móveis. Veja se a TV está ligada. Depois carregue esta página de novo.',
      ro: 'Conectează telefonul la același Wi-Fi ca televizorul, nu la o rețea pentru oaspeți și nu la datele mobile. Verifică dacă televizorul e pornit. Apoi reîncarcă această pagină.',
      'zh-CN': '让手机连接和电视相同的 Wi-Fi，不要用访客网络，也不要用移动数据。确认电视已开机。然后重新加载此页面。' },
    fire_blocked_h: { en: 'This Fire TV stops Couch TV pressing keys by itself.', es: 'Este Fire TV no deja que Couch TV pulse teclas por sí solo.', 'es-MX': 'Este Fire TV no deja que Couch TV presione teclas por sí solo.', it: 'Questo Fire TV impedisce a Couch TV di premere i tasti da solo.', de: 'Dieser Fire TV lässt Couch TV nicht selbst Tasten drücken.', fr: "Ce Fire TV empêche Couch TV d'appuyer seul sur les touches.", tr: 'Bu Fire TV, Couch TV\'nin kendi başına tuşlara basmasını engelliyor.', 'sr-Latn-RS': 'Ovaj Fire TV ne dozvoljava da Couch TV sam pritiska tastere.', pl: 'Ten Fire TV nie pozwala Couch TV samemu naciskać klawiszy.', nl: 'Deze Fire TV laat Couch TV niet zelf toetsen indrukken.', cs: 'Tento Fire TV nedovolí Couch TV mačkat tlačítka sám.', he: 'ה-Fire TV הזה לא נותן ל-Couch TV ללחוץ על מקשים בעצמו.', ar: 'جهاز Fire TV هذا يمنع Couch TV من الضغط على الأزرار بنفسه.', pt: 'Este Fire TV impede o Couch TV de apertar teclas sozinho.', ro: 'Acest Fire TV nu lasă Couch TV să apese singur taste.', 'zh-CN': '这台 Fire TV 不让 Couch TV 自己按键。' },
    fire_blocked_f: { en: 'Amazon switched this off in a Fire TV update. For keys and typing from the phone, you need a home computer running Couch TV.',
      es: 'Amazon lo desactivó en una actualización de Fire TV. Para teclas y escribir desde el teléfono, necesitas un ordenador en casa con Couch TV.',
      'es-MX': 'Amazon lo desactivó en una actualización de Fire TV. Para teclas y escribir desde el celular, necesitas una computadora en casa con Couch TV.',
      it: 'Amazon l\'ha disattivato con un aggiornamento di Fire TV. Per tasti e scrittura dal telefono serve un computer di casa con Couch TV.',
      de: 'Amazon hat das mit einem Fire TV Update abgeschaltet. Für Tasten und Tippen vom Handy brauchst du einen Computer zu Hause, auf dem Couch TV läuft.',
      fr: "Amazon l'a coupé dans une mise à jour de Fire TV. Pour les touches et la saisie depuis le téléphone, il faut un ordinateur à la maison avec Couch TV.",
      tr: 'Amazon bunu bir Fire TV güncellemesiyle kapattı. Telefondan tuş ve yazı için evde Couch TV çalıştıran bir bilgisayar gerekir.',
      'sr-Latn-RS': 'Amazon je ovo isključio u ažuriranju za Fire TV. Za tastere i kucanje sa telefona potreban je kućni računar na kome radi Couch TV.',
      pl: 'Amazon wyłączył to w aktualizacji Fire TV. Do klawiszy i pisania z telefonu potrzebny jest komputer w domu z Couch TV.',
      nl: 'Amazon heeft dit uitgezet in een Fire TV update. Voor toetsen en typen vanaf de telefoon heb je een computer thuis nodig waarop Couch TV draait.',
      cs: 'Amazon to vypnul v aktualizaci Fire TV. Pro tlačítka a psaní z telefonu potřebujete domácí počítač s Couch TV.',
      he: 'אמזון כיבתה את זה בעדכון של Fire TV. כדי ללחוץ ולהקליד מהטלפון צריך מחשב בבית שמריץ את Couch TV.',
      ar: 'أوقفت أمازون ذلك في تحديث لـ Fire TV. للأزرار والكتابة من الهاتف تحتاج إلى حاسوب في المنزل يشغّل Couch TV.',
      pt: 'A Amazon desligou isso numa atualização do Fire TV. Para teclas e digitação pelo celular, você precisa de um computador em casa com o Couch TV.',
      ro: 'Amazon a oprit asta într-o actualizare Fire TV. Pentru taste și scris de pe telefon ai nevoie de un calculator acasă care rulează Couch TV.',
      'zh-CN': '亚马逊在一次 Fire TV 更新中关闭了这个功能。要用手机按键和打字，需要家里有一台运行 Couch TV 的电脑。' },
    debugging_off_h: { en: 'Debugging is off on the TV.', es: 'La depuración está desactivada en la tele.', it: 'Il debug è disattivato sulla TV.', de: 'Debugging ist am Fernseher aus.', fr: 'Le débogage est désactivé sur la TV.', tr: 'TV\'de hata ayıklama kapalı.', 'sr-Latn-RS': 'Otklanjanje grešaka je isključeno na televizoru.', pl: 'Debugowanie jest wyłączone w telewizorze.', nl: 'Foutopsporing staat uit op de tv.', cs: 'Ladění je na televizi vypnuté.', he: 'ניפוי הבאגים כבוי בטלוויזיה.', ar: 'تصحيح الأخطاء متوقف على التلفزيون.', pt: 'A depuração está desligada na TV.', ro: 'Depanarea este oprită pe televizor.', 'zh-CN': '电视上的调试已关闭。' },
    debugging_off_f: { en: 'On the TV open Settings, System, About and press OK on Android TV OS build (on some TVs, Build) seven times (older Android TV: Settings, Device Preferences, About). Then in Developer options switch on USB debugging (some TVs call it Network debugging or ADB debugging).',
      es: 'En la tele abre Ajustes, Sistema, Información y pulsa OK en Compilación del SO de Android TV (en algunas teles, Compilación o Build) siete veces (Android TV más antiguo: Ajustes, Preferencias del dispositivo, Información). Luego, en Opciones para desarrolladores, activa Depuración por USB (algunas teles lo llaman Depuración de red o Depuración ADB).',
      'es-MX': 'En la tele abre Configuración, Sistema, Información y presiona OK en Compilación del SO de Android TV (en algunas teles, Compilación o Build) siete veces (Android TV más antigua: Configuración, Preferencias del dispositivo, Información). Luego, en Opciones para desarrolladores, activa Depuración por USB (algunas teles lo llaman Depuración de red o Depuración ADB).',
      it: 'Sulla TV apri Impostazioni, Sistema, Informazioni e premi OK su Build del sistema operativo Android TV (su alcune TV, Build) sette volte (Android TV più vecchie: Impostazioni, Preferenze dispositivo, Informazioni). Poi in Opzioni sviluppatore attiva Debug USB (su alcune TV si chiama Debug di rete o Debug ADB).',
      de: 'Öffne am Fernseher Einstellungen, System, Info und drücke siebenmal OK auf Android TV OS-Build, bei manchen Fernsehern Build (älteres Android TV: Einstellungen, Geräteeinstellungen, Info). Schalte dann in den Entwickleroptionen USB-Debugging ein (manche Fernseher nennen es Netzwerk-Debugging oder ADB-Debugging).',
      fr: "Sur la TV, ouvre Paramètres, Système, À propos et appuie sept fois sur OK sur Build d'Android TV OS, sur certaines TV Build (Android TV plus ancienne : Paramètres, Préférences de l'appareil, À propos). Puis dans Options pour les développeurs, active Débogage USB (certaines TV l'appellent Débogage réseau ou Débogage ADB).",
      tr: 'TV\'de Ayarlar, Sistem, Hakkında\'yı aç ve Android TV OS derlemesinde (bazı TV\'lerde Yapı numarası) yedi kez OK\'a bas (eski Android TV: Ayarlar, Cihaz Tercihleri, Hakkında). Sonra Geliştirici seçenekleri\'nde USB hata ayıklama\'yı aç (bazı TV\'lerde adı Ağ hata ayıklama veya ADB hata ayıklama).',
      'sr-Latn-RS': 'Na televizoru otvorite Podešavanja, Sistem, Osnovni podaci i sedam puta pritisnite OK na Android TV OS verzija, na nekim televizorima Verzija (stariji Android TV: Podešavanja, Podešavanja uređaja, Osnovni podaci). Zatim u Opcijama za programere uključite Otklanjanje grešaka sa USB-a (na nekim televizorima se zove Mrežno otklanjanje grešaka ili ADB otklanjanje grešaka).',
      pl: 'Na telewizorze otwórz Ustawienia, System, Informacje i siedem razy naciśnij OK na Kompilacja systemu Android TV OS, na niektórych telewizorach Kompilacja (starszy Android TV: Ustawienia, Ustawienia urządzenia, Informacje). Potem w Opcjach programisty włącz Debugowanie USB (na niektórych telewizorach to Debugowanie sieciowe lub Debugowanie ADB).',
      nl: 'Open op de tv Instellingen, Systeem, Over en druk zeven keer op OK bij Android TV OS-build, op sommige tv\'s Build (oudere Android TV: Instellingen, Apparaatvoorkeuren, Over). Zet daarna in Ontwikkelaarsopties USB-foutopsporing aan (sommige tv\'s noemen het Netwerkfoutopsporing of ADB-foutopsporing).',
      cs: 'Na televizi otevřete Nastavení, Systém, Informace a sedmkrát stiskněte OK na Sestavení systému Android TV OS, na některých televizích Sestavení (starší Android TV: Nastavení, Předvolby zařízení, Informace). Pak v Možnostech pro vývojáře zapněte Ladění přes USB (na některých televizích se jmenuje Ladění přes síť nebo Ladění ADB).',
      he: 'בטלוויזיה פתחו הגדרות, מערכת, מידע ולחצו OK על Android TV OS build (בחלק מהטלוויזיות Build) שבע פעמים (Android TV ישן יותר: הגדרות, העדפות מכשיר, מידע). אחר כך באפשרויות למפתחים הפעילו ניפוי באגים ב-USB (בחלק מהטלוויזיות זה נקרא ניפוי באגים ברשת או ניפוי באגים ADB).',
      ar: 'على التلفزيون افتح الإعدادات، النظام، حول واضغط OK على Android TV OS build (في بعض أجهزة التلفزيون رقم الإصدار) سبع مرات (Android TV الأقدم: الإعدادات، الإعدادات المفضّلة للجهاز، حول). ثم في خيارات المطور شغّل تصحيح أخطاء USB (في بعض أجهزة التلفزيون اسمه تصحيح أخطاء الشبكة أو تصحيح أخطاء ADB).',
      pt: 'Na TV abra Configurações, Sistema, Sobre e aperte OK em Build do Android TV OS (em algumas TVs, Build) sete vezes (Android TV mais antiga: Configurações, Preferências do dispositivo, Sobre). Depois, em Opções do desenvolvedor, ative Depuração USB (algumas TVs chamam de Depuração de rede ou Depuração ADB).',
      ro: 'Pe televizor deschide Setări, Sistem, Despre și apasă OK pe Android TV OS build (pe unele televizoare, Versiune) de șapte ori (Android TV mai vechi: Setări, Preferințe dispozitiv, Despre). Apoi în Opțiuni dezvoltator pornește Depanare USB (unele televizoare îi spun Depanare prin rețea sau Depanare ADB).',
      'zh-CN': '在电视上打开设置、系统、关于，在 Android TV OS 版本号（部分电视上为版本号）上按 OK 七次（较旧的 Android TV：设置、设备偏好设置、关于）。然后在开发者选项中打开 USB 调试（有些电视叫网络调试或 ADB 调试）。' },
    debugging_off_fire_f: { en: 'On the Fire TV open Settings, My Fire TV, About and press OK on the device name seven times. Then go back to My Fire TV, Developer options, and switch on ADB debugging.',
      es: 'En el Fire TV abre Configuración, Mi Fire TV, Acerca de y pulsa OK siete veces en el nombre del dispositivo. Luego vuelve a Mi Fire TV, Opciones para desarrolladores, y activa Depuración ADB.',
      'es-MX': 'En el Fire TV abre Configuración, Mi Fire TV, Acerca de y presiona OK siete veces en el nombre del dispositivo. Luego regresa a Mi Fire TV, Opciones para desarrolladores, y activa Depuración ADB.',
      it: 'Sul Fire TV apri Impostazioni, La mia Fire TV, Informazioni e premi OK sette volte sul nome del dispositivo. Poi torna a La mia Fire TV, Opzioni sviluppatore, e attiva Debug ADB.',
      de: 'Öffne am Fire TV Einstellungen, Mein Fire TV, Info und drücke siebenmal OK auf den Gerätenamen. Geh dann zurück zu Mein Fire TV, Entwickleroptionen, und schalte ADB-Debugging ein.',
      fr: "Sur la Fire TV, ouvre Paramètres, Ma Fire TV, À propos et appuie sept fois sur OK sur le nom de l'appareil. Puis reviens à Ma Fire TV, Options pour les développeurs, et active Débogage ADB.",
      tr: 'Fire TV\'de Settings, My Fire TV, About\'u aç ve cihaz adında yedi kez OK\'a bas. Sonra My Fire TV, Developer options\'a dön ve ADB debugging\'i aç.',
      'sr-Latn-RS': 'Na Fire TV-u otvorite Settings, My Fire TV, About i sedam puta pritisnite OK na nazivu uređaja. Zatim se vratite na My Fire TV, Developer options, i uključite ADB debugging.',
      pl: 'Na Fire TV otwórz Settings, My Fire TV, About i siedem razy naciśnij OK na nazwie urządzenia. Potem wróć do My Fire TV, Developer options, i włącz ADB debugging.',
      nl: 'Open op de Fire TV Instellingen, Mijn Fire TV, Info en druk zeven keer op OK bij de apparaatnaam. Ga daarna terug naar Mijn Fire TV, Ontwikkelaarsopties, en zet ADB-foutopsporing aan.',
      cs: 'Na Fire TV otevřete Settings, My Fire TV, About a sedmkrát stiskněte OK na názvu zařízení. Pak se vraťte do My Fire TV, Developer options, a zapněte ADB debugging.',
      he: 'ב-Fire TV פתחו Settings, My Fire TV, About ולחצו OK שבע פעמים על שם המכשיר. אחר כך חזרו ל-My Fire TV, Developer options, והפעילו ADB debugging.',
      ar: 'على Fire TV افتح Settings، My Fire TV، About واضغط OK سبع مرات على اسم الجهاز. ثم ارجع إلى My Fire TV، Developer options، وشغّل ADB debugging.',
      pt: 'No Fire TV abra Configurações, Meu Fire TV, Sobre e aperte OK sete vezes no nome do dispositivo. Depois volte a Meu Fire TV, Opções do desenvolvedor, e ative Depuração ADB.',
      ro: 'Pe Fire TV deschide Settings, My Fire TV, About și apasă OK de șapte ori pe numele dispozitivului. Apoi întoarce-te la My Fire TV, Developer options, și pornește ADB debugging.',
      'zh-CN': '在 Fire TV 上打开 Settings、My Fire TV、About，在设备名称上按 OK 七次。然后回到 My Fire TV、Developer options，打开 ADB debugging。' },
    waiting_allow_h: { en: 'The TV is waiting for you.', es: 'La tele te está esperando.', it: 'La TV ti sta aspettando.', de: 'Der Fernseher wartet auf dich.', fr: "La TV t'attend.", tr: 'TV seni bekliyor.', 'sr-Latn-RS': 'Televizor vas čeka.', pl: 'Telewizor na ciebie czeka.', nl: 'De tv wacht op je.', cs: 'Televize na vás čeká.', he: 'הטלוויזיה מחכה לכם.', ar: 'التلفزيون ينتظرك.', pt: 'A TV está esperando você.', ro: 'Televizorul te așteaptă.', 'zh-CN': '电视在等你操作。' },
    waiting_allow_f: {"en": "On the TV's \"Allow USB debugging?\", tick Always allow, then Down, Left, press Allow.", "es": "En \"Allow USB debugging?\" (¿permitir la depuración USB?) de la tele, marca Always allow, luego Abajo, Izquierda y pulsa Allow.", "es-MX": "En \"Allow USB debugging?\" (¿permitir la depuración USB?) de la TV, marca Always allow, luego Abajo, Izquierda y presiona Allow.", "it": "Su \"Allow USB debugging?\" (consentire il debug USB?) della TV, spunta Always allow, poi Giù, Sinistra e premi Allow.", "de": "Bei „Allow USB debugging?“ (USB-Debugging zulassen?) auf dem Fernseher Always allow anhaken, dann Runter, Links und Allow drücken.", "fr": "Sur « Allow USB debugging? » (autoriser le débogage USB ?) de la TV, cochez Always allow, puis Bas, Gauche et appuyez sur Allow.", "tr": "TV'deki \"Allow USB debugging?\" (USB hata ayıklamaya izin verilsin mi?) sorusunda Always allow'u işaretle, sonra Aşağı, Sol ve Allow'a bas.", "sr-Latn-RS": "Na televizoru, kod „Allow USB debugging?“ (dozvoliti USB otklanjanje grešaka?), označite Always allow, pa Dole, Levo i pritisnite Allow.", "pl": "Przy „Allow USB debugging?” (zezwolić na debugowanie USB?) na telewizorze zaznacz Always allow, potem w dół, w lewo i naciśnij Allow.", "nl": "Bij \"Allow USB debugging?\" (USB-foutopsporing toestaan?) op de tv: vink Always allow aan, dan Omlaag, Links en druk op Allow.", "cs": "U „Allow USB debugging?“ (povolit ladění USB?) na televizi zaškrtněte Always allow, pak dolů, doleva a stiskněte Allow.", "he": "בשאלה \"Allow USB debugging?\" (לאשר ניפוי באגים ב-USB?) בטלוויזיה מסמנים Always allow, ואז למטה, שמאלה ולוחצים Allow.", "ar": "عند سؤال \"Allow USB debugging?\" (السماح بتصحيح أخطاء USB؟) على التلفزيون، حدّد Always allow، ثم لأسفل، ثم لليسار واضغط Allow.", "pt": "Em \"Allow USB debugging?\" (permitir depuração USB?) na TV, marque Always allow, depois Baixo, Esquerda e aperte Allow.", "ro": "La \"Allow USB debugging?\" (permiți depanarea USB?) pe televizor, bifează Always allow, apoi Jos, Stânga și apasă Allow.", "zh-CN": "电视询问“Allow USB debugging?”（是否允许 USB 调试）时，勾选 Always allow，然后按下、按左，再按 Allow。"},
    allow_unanswered_h: { en: "Nobody answered the TV's Allow question.", es: 'Nadie respondió a la pregunta de permiso de la tele.', it: 'Nessuno ha risposto alla domanda di consenso della TV.', de: 'Niemand hat die Erlauben-Frage des Fernsehers beantwortet.', fr: "Personne n'a répondu à la question d'autorisation de la TV.", tr: 'TV\'nin izin sorusuna kimse cevap vermedi.', 'sr-Latn-RS': 'Niko nije odgovorio na pitanje televizora o dozvoli.', pl: 'Nikt nie odpowiedział na pytanie telewizora o zezwolenie.', nl: 'Niemand heeft de toestaan-vraag van de tv beantwoord.', cs: 'Nikdo neodpověděl na otázku televize o povolení.', he: 'אף אחד לא ענה לשאלת האישור של הטלוויזיה.', ar: 'لم يُجب أحد على سؤال السماح في التلفزيون.', pt: 'Ninguém respondeu à pergunta de permissão da TV.', ro: 'Nimeni nu a răspuns la întrebarea de permisiune a televizorului.', 'zh-CN': '没有人回答电视的允许提问。' },
    allow_unanswered_f: { en: 'Press Let the phone press keys, then look at the TV straight away and press Allow. If the TV shows no question, restart the TV and try again.',
      es: 'Pulsa Dejar que el móvil pulse teclas, mira la tele enseguida y pulsa Permitir. Si la tele no muestra ninguna pregunta, reiníciala y vuelve a intentarlo.',
      'es-MX': 'Presiona Dejar que el celular presione teclas, mira la tele enseguida y presiona Permitir. Si la tele no muestra ninguna pregunta, reiníciala e inténtalo de nuevo.',
      it: 'Premi Fai premere i tasti al telefono, guarda subito la TV e premi Consenti. Se la TV non mostra nessuna domanda, riavviala e riprova.',
      de: 'Drücke Handy Tasten drücken lassen, schau sofort auf den Fernseher und drücke Zulassen. Zeigt der Fernseher keine Frage, starte ihn neu und versuch es noch einmal.',
      fr: "Appuie sur Laisser le téléphone appuyer sur les touches, regarde tout de suite la TV et appuie sur Autoriser. Si la TV n'affiche aucune question, redémarre-la et réessaie.",
      tr: 'Telefon tuşlara bassın\'a bas, hemen TV\'ye bak ve İzin ver\'e bas. TV hiçbir soru göstermezse TV\'yi yeniden başlat ve tekrar dene.',
      'sr-Latn-RS': 'Pritisnite Neka telefon pritiska tastere, odmah pogledajte televizor i pritisnite Dozvoli. Ako televizor ne prikaže pitanje, ponovo ga pokrenite i pokušajte opet.',
      pl: 'Naciśnij Pozwól telefonowi naciskać klawisze, od razu spójrz na telewizor i naciśnij Zezwól. Jeśli telewizor nie pokaże pytania, uruchom go ponownie i spróbuj jeszcze raz.',
      nl: 'Druk op Telefoon toetsen laten indrukken, kijk meteen naar de tv en druk op Toestaan. Laat de tv geen vraag zien, start de tv dan opnieuw en probeer het nog eens.',
      cs: 'Stiskněte Nechat telefon mačkat tlačítka, hned se podívejte na televizi a stiskněte Povolit. Pokud televize žádnou otázku neukáže, restartujte ji a zkuste to znovu.',
      he: 'לחצו על לאפשר לטלפון ללחוץ על מקשים, הסתכלו מיד על הטלוויזיה ולחצו לאפשר. אם הטלוויזיה לא מציגה שאלה, הפעילו אותה מחדש ונסו שוב.',
      ar: 'اضغط السماح للهاتف بالضغط على الأزرار، ثم انظر فورًا إلى التلفزيون واضغط سماح. إذا لم يعرض التلفزيون أي سؤال، أعد تشغيله وحاول مرة أخرى.',
      pt: 'Aperte Deixar o celular apertar teclas, olhe logo para a TV e aperte Permitir. Se a TV não mostrar nenhuma pergunta, reinicie a TV e tente de novo.',
      ro: 'Apasă Lasă telefonul să apese taste, uită-te imediat la televizor și apasă Permite. Dacă televizorul nu arată nicio întrebare, repornește-l și încearcă din nou.',
      'zh-CN': '按让手机按键，然后马上看电视并按允许。如果电视没有显示提问，请重启电视后再试。' },
    ethernet_h: { en: 'The TV is on a network cable.', es: 'La tele está conectada por cable de red.', it: 'La TV è collegata con un cavo di rete.', de: 'Der Fernseher hängt an einem Netzwerkkabel.', fr: 'La TV est branchée par câble réseau.', tr: 'TV ağ kablosuyla bağlı.', 'sr-Latn-RS': 'Televizor je povezan mrežnim kablom.', pl: 'Telewizor jest podłączony kablem sieciowym.', nl: 'De tv zit aan een netwerkkabel.', cs: 'Televize je připojená síťovým kabelem.', he: 'הטלוויזיה מחוברת בכבל רשת.', ar: 'التلفزيون متصل بكابل شبكة.', pt: 'A TV está ligada por cabo de rede.', ro: 'Televizorul e conectat prin cablu de rețea.', 'zh-CN': '电视用的是网线。' },
    ethernet_f: { en: 'Wireless debugging only works on Wi-Fi. Unplug the cable and join the Wi-Fi on the TV. Or use the older TVs steps with Network debugging, which works on a cable.',
      es: 'La depuración inalámbrica solo funciona con Wi-Fi. Desconecta el cable y conecta la tele a la Wi-Fi. O usa los pasos para televisores más antiguos con Depuración de red, que funciona con cable.',
      'es-MX': 'La depuración inalámbrica solo funciona con Wi-Fi. Desconecta el cable y conecta la tele a la Wi-Fi. O usa los pasos para TVs más antiguas con Depuración de red, que funciona con cable.',
      it: 'Il debug wireless funziona solo in Wi-Fi. Stacca il cavo e collega la TV alla Wi-Fi. Oppure segui i passi per le TV più vecchie con il debug di rete, che funziona via cavo.',
      de: 'Debugging über WLAN geht nur mit WLAN. Zieh das Kabel ab und verbinde den Fernseher mit dem WLAN. Oder nimm die Schritte für ältere Fernseher mit Netzwerk-Debugging, das auch mit Kabel geht.',
      fr: "Le débogage sans fil ne marche qu'en Wi-Fi. Débranche le câble et connecte la TV au Wi-Fi. Ou suis les étapes des TV plus anciennes avec le débogage réseau, qui marche avec un câble.",
      tr: 'Kablosuz hata ayıklama yalnızca Wi-Fi ile çalışır. Kabloyu çıkar ve TV\'yi Wi-Fi\'ye bağla. Ya da kabloyla da çalışan Ağ hata ayıklama ile eski TV adımlarını izle.',
      'sr-Latn-RS': 'Bežično otklanjanje grešaka radi samo preko Wi-Fi mreže. Izvucite kabl i povežite televizor na Wi-Fi. Ili pratite korake za starije televizore sa Mrežnim otklanjanjem grešaka, koje radi i preko kabla.',
      pl: 'Debugowanie bezprzewodowe działa tylko przez Wi-Fi. Odłącz kabel i połącz telewizor z Wi-Fi. Albo użyj kroków dla starszych telewizorów z Debugowaniem sieciowym, które działa po kablu.',
      nl: 'Draadloze foutopsporing werkt alleen via wifi. Haal de kabel eruit en verbind de tv met de wifi. Of volg de stappen voor oudere tv\'s met Netwerkfoutopsporing, dat wel via een kabel werkt.',
      cs: 'Bezdrátové ladění funguje jen přes Wi-Fi. Odpojte kabel a připojte televizi k Wi-Fi. Nebo použijte postup pro starší televize s Laděním přes síť, které funguje i s kabelem.',
      he: 'ניפוי באגים אלחוטי עובד רק ב-Wi-Fi. נתקו את הכבל וחברו את הטלוויזיה ל-Wi-Fi. או השתמשו בשלבים לטלוויזיות ישנות עם ניפוי באגים ברשת, שעובד גם בכבל.',
      ar: 'تصحيح الأخطاء اللاسلكي يعمل عبر Wi-Fi فقط. افصل الكابل وصِل التلفزيون بشبكة Wi-Fi. أو اتبع خطوات أجهزة التلفزيون الأقدم مع تصحيح أخطاء الشبكة، الذي يعمل مع الكابل.',
      pt: 'A depuração por Wi-Fi só funciona no Wi-Fi. Tire o cabo e conecte a TV ao Wi-Fi. Ou siga os passos das TVs mais antigas com a Depuração de rede, que funciona no cabo.',
      ro: 'Remedierea erorilor wireless merge doar pe Wi-Fi. Scoate cablul și conectează televizorul la Wi-Fi. Sau urmează pașii pentru televizoare mai vechi cu Depanare prin rețea, care merge și pe cablu.',
      'zh-CN': '无线调试只能在 Wi-Fi 下使用。拔掉网线，让电视连接 Wi-Fi。或者按较旧电视的步骤使用网络调试，它在网线下也能用。' },
    wireless_off_h: { en: 'Wireless debugging is off.', es: 'La depuración inalámbrica está desactivada.', it: 'Il debug wireless è disattivato.', de: 'Debugging über WLAN ist aus.', fr: 'Le débogage sans fil est désactivé.', tr: 'Kablosuz hata ayıklama kapalı.', 'sr-Latn-RS': 'Bežično otklanjanje grešaka je isključeno.', pl: 'Debugowanie bezprzewodowe jest wyłączone.', nl: 'Draadloze foutopsporing staat uit.', cs: 'Bezdrátové ladění je vypnuté.', he: 'ניפוי באגים אלחוטי כבוי.', ar: 'تصحيح الأخطاء اللاسلكي متوقف.', pt: 'A depuração por Wi-Fi está desligada.', ro: 'Remedierea erorilor wireless este oprită.', 'zh-CN': '无线调试已关闭。' },
    wireless_off_f: { en: 'On the TV open Developer options and switch on Wireless debugging. Tick Always allow on this network. Then follow the newer TVs steps above.',
      es: 'En la tele abre Opciones para desarrolladores y activa Depuración inalámbrica. Marca Permitir siempre en esta red. Luego sigue los pasos para televisores más nuevos de arriba.',
      'es-MX': 'En la tele abre Opciones para desarrolladores y activa Depuración inalámbrica. Marca Permitir siempre en esta red. Luego sigue los pasos para TVs más nuevas de arriba.',
      it: 'Sulla TV apri Opzioni sviluppatore e attiva Debug wireless. Spunta Consenti sempre su questa rete. Poi segui i passi per le TV più recenti qui sopra.',
      de: 'Öffne am Fernseher die Entwickleroptionen und schalte Debugging über WLAN ein. Setze den Haken bei In diesem Netzwerk immer zulassen. Folge dann oben den Schritten für neuere Fernseher.',
      fr: "Sur la TV, ouvre Options pour les développeurs et active Débogage sans fil. Coche Toujours autoriser sur ce réseau. Puis suis les étapes des TV récentes ci-dessus.",
      tr: 'TV\'de Geliştirici seçenekleri\'ni aç ve Kablosuz hata ayıklama\'yı aç. Bu ağda her zaman izin ver\'i işaretle. Sonra yukarıdaki yeni TV adımlarını izle.',
      'sr-Latn-RS': 'Na televizoru otvorite Opcije za programere i uključite Bežično otklanjanje grešaka. Označite Uvek dozvoli na ovoj mreži. Zatim pratite korake za novije televizore iznad.',
      pl: 'Na telewizorze otwórz Opcje programisty i włącz Debugowanie bezprzewodowe. Zaznacz Zawsze zezwalaj w tej sieci. Potem wykonaj kroki dla nowszych telewizorów powyżej.',
      nl: 'Open op de tv Ontwikkelaarsopties en zet Draadloze foutopsporing aan. Vink Altijd toestaan op dit netwerk aan. Volg daarna de stappen voor nieuwere tv\'s hierboven.',
      cs: 'Na televizi otevřete Možnosti pro vývojáře a zapněte Bezdrátové ladění. Zaškrtněte Vždy povolit v této síti. Pak postupujte podle kroků pro novější televize výše.',
      he: 'בטלוויזיה פתחו אפשרויות למפתחים והפעילו ניפוי באגים אלחוטי. סמנו לאפשר תמיד ברשת הזו. אחר כך עקבו אחרי השלבים לטלוויזיות חדשות יותר למעלה.',
      ar: 'على التلفزيون افتح خيارات المطور وشغّل تصحيح الأخطاء اللاسلكي. حدّد السماح دائمًا على هذه الشبكة. ثم اتبع خطوات أجهزة التلفزيون الأحدث في الأعلى.',
      pt: 'Na TV abra Opções do desenvolvedor e ative a Depuração por Wi-Fi. Marque Sempre permitir nesta rede. Depois siga os passos das TVs mais novas acima.',
      ro: 'Pe televizor deschide Opțiuni dezvoltator și pornește Remedierea erorilor wireless. Bifează Permite întotdeauna în această rețea. Apoi urmează pașii pentru televizoare mai noi de mai sus.',
      'zh-CN': '在电视上打开开发者选项，打开无线调试。勾选始终允许在此网络上使用。然后按上面较新电视的步骤操作。' },
    needs_pairing_h: { en: 'Wireless debugging is on, but Couch TV is not paired yet.', es: 'La depuración inalámbrica está activada, pero Couch TV aún no está vinculado.', it: 'Il debug wireless è attivo, ma Couch TV non è ancora associato.', de: 'Debugging über WLAN ist an, aber Couch TV ist noch nicht gekoppelt.', fr: "Le débogage sans fil est activé, mais Couch TV n'est pas encore associé.", tr: 'Kablosuz hata ayıklama açık ama Couch TV henüz eşlenmedi.', 'sr-Latn-RS': 'Bežično otklanjanje grešaka je uključeno, ali Couch TV još nije uparen.', pl: 'Debugowanie bezprzewodowe jest włączone, ale Couch TV nie jest jeszcze sparowany.', nl: 'Draadloze foutopsporing staat aan, maar Couch TV is nog niet gekoppeld.', cs: 'Bezdrátové ladění je zapnuté, ale Couch TV ještě není spárovaný.', he: 'ניפוי באגים אלחוטי פועל, אבל Couch TV עוד לא מותאם.', ar: 'تصحيح الأخطاء اللاسلكي يعمل، لكن Couch TV لم يُقرن بعد.', pt: 'A depuração por Wi-Fi está ligada, mas o Couch TV ainda não está pareado.', ro: 'Remedierea erorilor wireless e pornită, dar Couch TV nu e asociat încă.', 'zh-CN': '无线调试已打开，但 Couch TV 还没有配对。' },
    needs_pairing_f: { en: 'In Wireless debugging on the TV choose Pair device with pairing code. Type the 6 digit code above and press Send the code.',
      es: 'En Depuración inalámbrica de la tele elige Vincular dispositivo con código de vinculación. Escribe arriba el código de 6 cifras y pulsa Enviar el código.',
      'es-MX': 'En Depuración inalámbrica de la tele elige Vincular dispositivo con código de vinculación. Escribe arriba el código de 6 dígitos y presiona Enviar el código.',
      it: 'In Debug wireless sulla TV scegli Associa dispositivo con codice di accoppiamento. Scrivi qui sopra il codice di 6 cifre e premi Invia il codice.',
      de: 'Wähle am Fernseher unter Debugging über WLAN Gerät über einen Kopplungscode koppeln. Gib oben den 6-stelligen Code ein und drücke Code senden.',
      fr: "Dans Débogage sans fil sur la TV, choisis Associer l'appareil avec un code d'association. Tape le code à 6 chiffres ci-dessus et appuie sur Envoyer le code.",
      tr: 'TV\'de Kablosuz hata ayıklama içinde Cihazı eşleme koduyla eşle\'yi seç. 6 haneli kodu yukarıya yaz ve Kodu gönder\'e bas.',
      'sr-Latn-RS': 'U Bežičnom otklanjanju grešaka na televizoru izaberite Uparite uređaj pomoću koda za uparivanje. Unesite šestocifreni kod iznad i pritisnite Pošalji kod.',
      pl: 'W Debugowaniu bezprzewodowym na telewizorze wybierz Sparuj urządzenie za pomocą kodu parowania. Wpisz powyżej 6-cyfrowy kod i naciśnij Wyślij kod.',
      nl: 'Kies op de tv in Draadloze foutopsporing Apparaat koppelen met koppelingscode. Typ de code van 6 cijfers hierboven en druk op Code versturen.',
      cs: 'V Bezdrátovém ladění na televizi zvolte Spárovat zařízení pomocí párovacího kódu. Napište výše šestimístný kód a stiskněte Odeslat kód.',
      he: 'בניפוי באגים אלחוטי בטלוויזיה בחרו התאמת מכשיר באמצעות קוד התאמה. הקלידו למעלה את הקוד בן 6 הספרות ולחצו שליחת הקוד.',
      ar: 'في تصحيح الأخطاء اللاسلكي على التلفزيون اختر إقران الجهاز باستخدام رمز الإقران. اكتب الرمز المكوّن من 6 أرقام في الأعلى واضغط إرسال الرمز.',
      pt: 'Em Depuração por Wi-Fi na TV, escolha Parear o dispositivo com um código de pareamento. Digite acima o código de 6 dígitos e aperte Enviar o código.',
      ro: 'În Remedierea erorilor wireless de pe televizor alege Asociază dispozitivul folosind codul de asociere. Scrie mai sus codul de 6 cifre și apasă Trimite codul.',
      'zh-CN': '在电视的无线调试中选择使用配对码配对设备。在上面输入 6 位数代码，然后按发送代码。' },
    port_closed_h: { en: "The TV's debugging connection is closed.", es: 'La conexión de depuración de la tele está cerrada.', it: 'La connessione di debug della TV è chiusa.', de: 'Die Debugging-Verbindung des Fernsehers ist zu.', fr: 'La connexion de débogage de la TV est fermée.', tr: 'TV\'nin hata ayıklama bağlantısı kapalı.', 'sr-Latn-RS': 'Veza za otklanjanje grešaka na televizoru je zatvorena.', pl: 'Połączenie debugowania telewizora jest zamknięte.', nl: 'De foutopsporingsverbinding van de tv is dicht.', cs: 'Ladicí spojení televize je zavřené.', he: 'חיבור ניפוי הבאגים של הטלוויזיה סגור.', ar: 'اتصال تصحيح الأخطاء في التلفزيون مغلق.', pt: 'A conexão de depuração da TV está fechada.', ro: 'Conexiunea de depanare a televizorului e închisă.', 'zh-CN': '电视的调试连接已关闭。' },
    port_closed_f: { en: 'Some TVs close it after a restart. In Developer options switch Wireless debugging (or Network debugging) off and on again, then press Let the phone press keys.',
      es: 'Algunas teles la cierran al reiniciarse. En Opciones para desarrolladores desactiva y vuelve a activar Depuración inalámbrica (o Depuración de red) y pulsa Dejar que el móvil pulse teclas.',
      'es-MX': 'Algunas teles la cierran al reiniciarse. En Opciones para desarrolladores desactiva y vuelve a activar Depuración inalámbrica (o Depuración de red) y presiona Dejar que el celular presione teclas.',
      it: 'Alcune TV la chiudono dopo un riavvio. In Opzioni sviluppatore disattiva e riattiva Debug wireless (o Debug di rete), poi premi Fai premere i tasti al telefono.',
      de: 'Manche Fernseher schließen sie nach einem Neustart. Schalte in den Entwickleroptionen Debugging über WLAN (oder Netzwerk-Debugging) aus und wieder ein und drücke dann Handy Tasten drücken lassen.',
      fr: "Certaines TV la ferment après un redémarrage. Dans Options pour les développeurs, désactive puis réactive Débogage sans fil (ou Débogage réseau), puis appuie sur Laisser le téléphone appuyer sur les touches.",
      tr: 'Bazı TV\'ler yeniden başlatınca bunu kapatır. Geliştirici seçenekleri\'nde Kablosuz hata ayıklama\'yı (veya Ağ hata ayıklama\'yı) kapatıp yeniden aç, sonra Telefon tuşlara bassın\'a bas.',
      'sr-Latn-RS': 'Neki televizori je zatvore posle ponovnog pokretanja. U Opcijama za programere isključite pa ponovo uključite Bežično otklanjanje grešaka (ili Mrežno otklanjanje grešaka), zatim pritisnite Neka telefon pritiska tastere.',
      pl: 'Niektóre telewizory zamykają je po ponownym uruchomieniu. W Opcjach programisty wyłącz i włącz ponownie Debugowanie bezprzewodowe (lub Debugowanie sieciowe), potem naciśnij Pozwól telefonowi naciskać klawisze.',
      nl: 'Sommige tv\'s sluiten die na een herstart. Zet in Ontwikkelaarsopties Draadloze foutopsporing (of Netwerkfoutopsporing) uit en weer aan, en druk daarna op Telefoon toetsen laten indrukken.',
      cs: 'Některé televize ho po restartu zavřou. V Možnostech pro vývojáře vypněte a znovu zapněte Bezdrátové ladění (nebo Ladění přes síť) a pak stiskněte Nechat telefon mačkat tlačítka.',
      he: 'יש טלוויזיות שסוגרות אותו אחרי הפעלה מחדש. באפשרויות למפתחים כבו והדליקו שוב ניפוי באגים אלחוטי (או ניפוי באגים ברשת), ואז לחצו על לאפשר לטלפון ללחוץ על מקשים.',
      ar: 'بعض أجهزة التلفزيون تغلقه بعد إعادة التشغيل. في خيارات المطور أوقف تصحيح الأخطاء اللاسلكي (أو تصحيح أخطاء الشبكة) ثم شغّله من جديد، ثم اضغط السماح للهاتف بالضغط على الأزرار.',
      pt: 'Algumas TVs fecham ao reiniciar. Em Opções do desenvolvedor, desligue e ligue de novo a Depuração por Wi-Fi (ou a Depuração de rede) e aperte Deixar o celular apertar teclas.',
      ro: 'Unele televizoare o închid după o repornire. În Opțiuni dezvoltator oprește și pornește din nou Remedierea erorilor wireless (sau Depanare prin rețea), apoi apasă Lasă telefonul să apese taste.',
      'zh-CN': '有些电视重启后会关闭它。在开发者选项中把无线调试（或网络调试）关掉再打开，然后按让手机按键。' },
    port_closed_fire_f: { en: 'On a Fire TV, in My Fire TV, Developer options, switch ADB debugging off and on again, then press Let the phone press keys.',
      es: 'En un Fire TV, en Mi Fire TV, Opciones para desarrolladores, desactiva y vuelve a activar Depuración ADB, y pulsa Dejar que el móvil pulse teclas.',
      'es-MX': 'En un Fire TV, en Mi Fire TV, Opciones para desarrolladores, desactiva y vuelve a activar Depuración ADB, y presiona Dejar que el celular presione teclas.',
      it: 'Su un Fire TV, in La mia Fire TV, Opzioni sviluppatore, disattiva e riattiva Debug ADB, poi premi Fai premere i tasti al telefono.',
      de: 'Auf einem Fire TV unter Mein Fire TV, Entwickleroptionen ADB-Debugging aus und wieder einschalten, dann Handy Tasten drücken lassen drücken.',
      fr: "Sur une Fire TV, dans Ma Fire TV, Options pour les développeurs, désactive puis réactive Débogage ADB, puis appuie sur Laisser le téléphone appuyer sur les touches.",
      tr: 'Fire TV\'de My Fire TV, Developer options içinde ADB debugging\'i kapatıp yeniden aç, sonra Telefon tuşlara bassın\'a bas.',
      'sr-Latn-RS': 'Na Fire TV-u, u My Fire TV, Developer options, isključite pa ponovo uključite ADB debugging, zatim pritisnite Neka telefon pritiska tastere.',
      pl: 'Na Fire TV, w My Fire TV, Developer options, wyłącz i włącz ponownie ADB debugging, potem naciśnij Pozwól telefonowi naciskać klawisze.',
      nl: 'Zet op een Fire TV in Mijn Fire TV, Ontwikkelaarsopties ADB-foutopsporing uit en weer aan, en druk daarna op Telefoon toetsen laten indrukken.',
      cs: 'Na Fire TV v My Fire TV, Developer options vypněte a znovu zapněte ADB debugging a pak stiskněte Nechat telefon mačkat tlačítka.',
      he: 'ב-Fire TV, ב-My Fire TV, Developer options, כבו והדליקו שוב את ADB debugging, ואז לחצו על לאפשר לטלפון ללחוץ על מקשים.',
      ar: 'على Fire TV، في My Fire TV، Developer options، أوقف ADB debugging ثم شغّله من جديد، ثم اضغط السماح للهاتف بالضغط على الأزرار.',
      pt: 'Num Fire TV, em Meu Fire TV, Opções do desenvolvedor, desligue e ligue de novo a Depuração ADB e aperte Deixar o celular apertar teclas.',
      ro: 'Pe un Fire TV, în My Fire TV, Developer options, oprește și pornește din nou ADB debugging, apoi apasă Lasă telefonul să apese taste.',
      'zh-CN': '在 Fire TV 上，进入 My Fire TV、Developer options，把 ADB debugging 关掉再打开，然后按让手机按键。' },
    no_wireless_fire_f: { en: 'On a Fire TV, in My Fire TV, Developer options, switch ADB debugging off and on again, then press Let the phone press keys.',
      es: 'En un Fire TV, en Mi Fire TV, Opciones para desarrolladores, desactiva y vuelve a activar Depuración ADB, y pulsa Dejar que el móvil pulse teclas.',
      'es-MX': 'En un Fire TV, en Mi Fire TV, Opciones para desarrolladores, desactiva y vuelve a activar Depuración ADB, y presiona Dejar que el celular presione teclas.',
      it: 'Su un Fire TV, in La mia Fire TV, Opzioni sviluppatore, disattiva e riattiva Debug ADB, poi premi Fai premere i tasti al telefono.',
      de: 'Auf einem Fire TV unter Mein Fire TV, Entwickleroptionen ADB-Debugging aus und wieder einschalten, dann Handy Tasten drücken lassen drücken.',
      fr: "Sur une Fire TV, dans Ma Fire TV, Options pour les développeurs, désactive puis réactive Débogage ADB, puis appuie sur Laisser le téléphone appuyer sur les touches.",
      tr: 'Fire TV\'de My Fire TV, Developer options içinde ADB debugging\'i kapatıp yeniden aç, sonra Telefon tuşlara bassın\'a bas.',
      'sr-Latn-RS': 'Na Fire TV-u, u My Fire TV, Developer options, isključite pa ponovo uključite ADB debugging, zatim pritisnite Neka telefon pritiska tastere.',
      pl: 'Na Fire TV, w My Fire TV, Developer options, wyłącz i włącz ponownie ADB debugging, potem naciśnij Pozwól telefonowi naciskać klawisze.',
      nl: 'Zet op een Fire TV in Mijn Fire TV, Ontwikkelaarsopties ADB-foutopsporing uit en weer aan, en druk daarna op Telefoon toetsen laten indrukken.',
      cs: 'Na Fire TV v My Fire TV, Developer options vypněte a znovu zapněte ADB debugging a pak stiskněte Nechat telefon mačkat tlačítka.',
      he: 'ב-Fire TV, ב-My Fire TV, Developer options, כבו והדליקו שוב את ADB debugging, ואז לחצו על לאפשר לטלפון ללחוץ על מקשים.',
      ar: 'على Fire TV، في My Fire TV، Developer options، أوقف ADB debugging ثم شغّله من جديد، ثم اضغط السماح للهاتف بالضغط على الأزرار.',
      pt: 'Num Fire TV, em Meu Fire TV, Opções do desenvolvedor, desligue e ligue de novo a Depuração ADB e aperte Deixar o celular apertar teclas.',
      ro: 'Pe un Fire TV, în My Fire TV, Developer options, oprește și pornește din nou ADB debugging, apoi apasă Lasă telefonul să apese taste.',
      'zh-CN': '在 Fire TV 上，进入 My Fire TV、Developer options，把 ADB debugging 关掉再打开，然后按让手机按键。' },
    no_wireless_h: { en: 'This TV has no Wireless debugging.', es: 'Esta tele no tiene depuración inalámbrica.', it: 'Questa TV non ha il debug wireless.', de: 'Dieser Fernseher hat kein Debugging über WLAN.', fr: "Cette TV n'a pas de débogage sans fil.", tr: 'Bu TV\'de kablosuz hata ayıklama yok.', 'sr-Latn-RS': 'Ovaj televizor nema bežično otklanjanje grešaka.', pl: 'Ten telewizor nie ma debugowania bezprzewodowego.', nl: 'Deze tv heeft geen draadloze foutopsporing.', cs: 'Tato televize nemá bezdrátové ladění.', he: 'לטלוויזיה הזו אין ניפוי באגים אלחוטי.', ar: 'هذا التلفزيون لا يحتوي على تصحيح الأخطاء اللاسلكي.', pt: 'Esta TV não tem depuração por Wi-Fi.', ro: 'Acest televizor nu are remedierea erorilor wireless.', 'zh-CN': '这台电视没有无线调试。' },
    no_wireless_f: { en: 'It is Android 10 or older, and that is fine. In Developer options switch on Network debugging (on some TVs, USB debugging), then press Let the phone press keys.',
      es: 'Tiene Android 10 o anterior, y no pasa nada. En Opciones para desarrolladores activa Depuración de red (en algunas teles, Depuración por USB) y pulsa Dejar que el móvil pulse teclas.',
      'es-MX': 'Tiene Android 10 o anterior, y no pasa nada. En Opciones para desarrolladores activa Depuración de red (en algunas teles, Depuración por USB) y presiona Dejar que el celular presione teclas.',
      it: 'È Android 10 o precedente, e va bene. In Opzioni sviluppatore attiva Debug di rete (su alcune TV, Debug USB), poi premi Fai premere i tasti al telefono.',
      de: 'Er hat Android 10 oder älter, das ist in Ordnung. Schalte in den Entwickleroptionen Netzwerk-Debugging ein (bei manchen Fernsehern USB-Debugging) und drücke dann Handy Tasten drücken lassen.',
      fr: "Elle a Android 10 ou plus ancien, et ce n'est pas grave. Dans Options pour les développeurs, active Débogage réseau (sur certaines TV, Débogage USB), puis appuie sur Laisser le téléphone appuyer sur les touches.",
      tr: 'Android 10 veya daha eski, sorun değil. Geliştirici seçenekleri\'nde Ağ hata ayıklama\'yı aç (bazı TV\'lerde USB hata ayıklama), sonra Telefon tuşlara bassın\'a bas.',
      'sr-Latn-RS': 'Ima Android 10 ili stariji, i to je u redu. U Opcijama za programere uključite Mrežno otklanjanje grešaka (na nekim televizorima Otklanjanje grešaka sa USB-a), zatim pritisnite Neka telefon pritiska tastere.',
      pl: 'Ma Androida 10 lub starszego i to nie problem. W Opcjach programisty włącz Debugowanie sieciowe (na niektórych telewizorach Debugowanie USB), potem naciśnij Pozwól telefonowi naciskać klawisze.',
      nl: 'Hij heeft Android 10 of ouder, en dat is prima. Zet in Ontwikkelaarsopties Netwerkfoutopsporing aan (op sommige tv\'s USB-foutopsporing) en druk dan op Telefoon toetsen laten indrukken.',
      cs: 'Má Android 10 nebo starší, a to nevadí. V Možnostech pro vývojáře zapněte Ladění přes síť (na některých televizích Ladění přes USB) a pak stiskněte Nechat telefon mačkat tlačítka.',
      he: 'יש בה Android 10 או ישן יותר, וזה בסדר. באפשרויות למפתחים הפעילו ניפוי באגים ברשת (בחלק מהטלוויזיות ניפוי באגים ב-USB), ואז לחצו על לאפשר לטלפון ללחוץ על מקשים.',
      ar: 'يعمل بنظام Android 10 أو أقدم، وهذا لا بأس به. في خيارات المطور شغّل تصحيح أخطاء الشبكة (في بعض أجهزة التلفزيون تصحيح أخطاء USB)، ثم اضغط السماح للهاتف بالضغط على الأزرار.',
      pt: 'Ela tem Android 10 ou anterior, e tudo bem. Em Opções do desenvolvedor, ative a Depuração de rede (em algumas TVs, Depuração USB) e aperte Deixar o celular apertar teclas.',
      ro: 'Are Android 10 sau mai vechi, și e în regulă. În Opțiuni dezvoltator pornește Depanare prin rețea (pe unele televizoare, Depanare USB), apoi apasă Lasă telefonul să apese taste.',
      'zh-CN': '它是 Android 10 或更早的版本，这没关系。在开发者选项中打开网络调试（有些电视叫 USB 调试），然后按让手机按键。' },
    unknown_h: { en: "The check couldn't find the cause.", es: 'La comprobación no encontró la causa.', 'es-MX': 'La revisión no encontró la causa.', it: 'Il controllo non ha trovato la causa.', de: 'Die Prüfung hat die Ursache nicht gefunden.', fr: "La vérification n'a pas trouvé la cause.", tr: 'Kontrol nedeni bulamadı.', 'sr-Latn-RS': 'Provera nije pronašla uzrok.', pl: 'Sprawdzenie nie znalazło przyczyny.', nl: 'De controle heeft de oorzaak niet gevonden.', cs: 'Kontrola nenašla příčinu.', he: 'הבדיקה לא מצאה את הסיבה.', ar: 'لم يجد الفحص السبب.', pt: 'A verificação não encontrou a causa.', ro: 'Verificarea nu a găsit cauza.', 'zh-CN': '检查没有找到原因。' },
    unknown_f: { en: 'Press Copy a report and send it with your question.', es: 'Pulsa Copiar un informe y envíalo con tu pregunta.', 'es-MX': 'Presiona Copiar un reporte y envíalo con tu pregunta.', it: 'Premi Copia un resoconto e invialo con la tua domanda.', de: 'Drücke Bericht kopieren und schick ihn mit deiner Frage.', fr: 'Appuie sur Copier un rapport et envoie-le avec ta question.', tr: 'Rapor kopyala\'ya bas ve sorunla birlikte gönder.', 'sr-Latn-RS': 'Pritisnite Kopiraj izveštaj i pošaljite ga uz pitanje.', pl: 'Naciśnij Kopiuj raport i wyślij go razem z pytaniem.', nl: 'Druk op Een verslag kopiëren en stuur het mee met je vraag.', cs: 'Stiskněte Zkopírovat zprávu a pošlete ji se svou otázkou.', he: 'לחצו העתקת דוח ושלחו אותו עם השאלה שלכם.', ar: 'اضغط نسخ تقرير وأرسله مع سؤالك.', pt: 'Aperte Copiar um relatório e envie junto com sua pergunta.', ro: 'Apasă Copiază un raport și trimite-l împreună cu întrebarea ta.', 'zh-CN': '按复制报告，把它和你的问题一起发出。' }
  };
  var CODES = ['ok', 'unreachable', 'fire_blocked', 'debugging_off', 'waiting_allow', 'allow_unanswered', 'ethernet', 'wireless_off', 'needs_pairing', 'port_closed', 'no_wireless', 'unknown'];

  function pick(list) {
    for (var i = 0; i < list.length; i++) {
      var l = String(list[i] || '');
      if (!l) continue;
      if (LANGS.indexOf(l) >= 0) return l;
      var base = l.split(/[-_]/)[0].toLowerCase();
      if (base === 'zh') return 'zh-CN';
      if (base === 'sr') return 'sr-Latn-RS';
      if (/^es-(MX|US|419)$/i.test(l)) return 'es-MX';
      if (LANGS.indexOf(base) >= 0) return base;
    }
    return 'en';
  }
  var tvLang = null;
  function lang() {
    var kept = null;
    try { kept = localStorage.getItem('couchtv.phone.lang'); } catch (e) { }
    var pw = window.PhoneWords && window.PhoneWords.lang ? window.PhoneWords.lang() : null;
    return pick([pw, tvLang, kept].concat(navigator.languages || [navigator.language]));
  }
  function t(key, l) {
    var row = W[key]; if (!row) return key;
    l = l || lang();
    return row[l] || (l === 'es-MX' && row.es) || row.en;
  }

  // the TV's answer plus a line from the phone; a phone that can't reach the TV writes its own
  function reportFor(j, code, l, err) {
    var head = j && j.report ? String(j.report) : ['Couch TV report', 'Check says: ' + code, 'The phone could not reach the TV: ' + String(err || 'no answer').replace(/(\d{1,3}\.){3}\d{1,3}/g, '[address]').slice(0, 120)].join('\n');
    return head + '\nPhone page language: ' + l;
  }

  function mount(el, opts) {
    opts = opts || {};
    var api = opts.api, timeoutMs = opts.timeoutMs || 9000;
    el.innerHTML = '<h3 class="cc-title"></h3><p class="cc-intro"></p>' +
      '<div class="row"><button type="button" class="quiet cc-check"></button><button type="button" class="quiet cc-copy"></button></div>' +
      '<p class="status cc-head" role="status"></p><p class="cc-fix"></p><p class="msg cc-msg" role="status"></p>' +
      '<textarea class="cc-report" readonly rows="8" style="display:none;width:100%;font:13px/1.35 ui-monospace,monospace"></textarea>';
    var q = function (c) { return el.querySelector('.' + c); };
    var last = { code: null, report: '', fire: false };
    function words() {
      var l = lang();
      el.setAttribute('dir', RTL[l] ? 'rtl' : 'ltr');
      el.setAttribute('lang', l);
      q('cc-title').textContent = t('title', l);
      q('cc-intro').textContent = t('intro', l);
      q('cc-check').textContent = t('check', l);
      q('cc-copy').textContent = t('copy', l);
      if (last.code) show(last.code);
    }
    function show(code) {
      var l = lang();
      if (CODES.indexOf(code) < 0) code = 'unknown';
      el.setAttribute('data-code', code);
      q('cc-head').className = 'status cc-head ' + (code === 'ok' ? 'ok' : 'bad');
      q('cc-head').textContent = code === 'ok' ? t('ok', l) : t(code + '_h', l);
      q('cc-fix').textContent = code === 'ok' ? '' : t(last.fire && W[code + '_fire_f'] ? code + '_fire_f' : code + '_f', l);
    }
    function run() {
      var l = lang();
      q('cc-head').className = 'status cc-head';
      q('cc-head').textContent = t('checking', l);
      q('cc-fix').textContent = ''; q('cc-msg').textContent = '';
      var timer, late = new Promise(function (res, rej) { timer = setTimeout(function () { var e = new TypeError('no answer in ' + Math.round(timeoutMs / 1000) + ' s'); rej(e); }, timeoutMs); });
      return Promise.race([api('GET', '/api/adb/check'), late]).then(function (j) {
        clearTimeout(timer);
        if (j.lang && !tvLang) { tvLang = j.lang; words(); l = lang(); }
        last.fire = !!j.fire_tv;
        last.code = CODES.indexOf(j.code) >= 0 ? j.code : 'unknown';
        last.report = reportFor(j, last.code, l);
        show(last.code);
        return last.code;
      }, function (e) {
        clearTimeout(timer);
        // fetch failing outright (TypeError) or no answer in time: the phone can't reach the TV
        last.fire = false;
        last.code = (e && e.name === 'TypeError') ? 'unreachable' : 'unknown';
        last.report = reportFor(null, last.code, l, e && e.message);
        show(last.code);
        return last.code;
      });
    }
    function copy() {
      var go = last.report ? Promise.resolve() : run();
      return go.then(function () {
        var text = last.report, box = q('cc-report'), l = lang();
        box.value = text; box.style.display = '';
        var done = function () { q('cc-msg').textContent = t('copied', l); return true; };
        var manual = function () { box.focus(); box.select(); q('cc-msg').textContent = t('copyfail', l); return false; };
        // http on the home network is not a secure context, so navigator.clipboard is often missing
        if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text).then(done, manual);
        try { box.focus(); box.select(); return document.execCommand('copy') ? done() : manual(); } catch (e) { return manual(); }
      });
    }
    q('cc-check').onclick = run;
    q('cc-copy').onclick = copy;
    var ctl = { run: run, copy: copy, words: words, setLang: function (l) { tvLang = l || null; words(); }, last: last };
    if (opts.lang) tvLang = opts.lang;
    words();
    if (opts.auto !== false) run();
    return ctl;
  }

  window.ConnectCheck = { mount: mount, codes: CODES.slice(), langs: LANGS.slice(), words: W, t: t, pick: pick };
})();
