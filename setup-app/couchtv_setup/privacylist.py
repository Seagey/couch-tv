"""The known ad, tracking and viewing-recognition apps (Android TV, Google TV, Fire TV): a copy of
tv-home/tools/privacy-list.txt, the list apply.sh reads for PRIVACY=1 (sources are named there, and in
docs/PRIVACY.md). Setup is shipped without that folder, so the packages live here as well;
tests/test_tidy.py fails if the two lists drift apart. One row per app: (package, kind). Kind is one
of "ads", "viewing" or "reports", and is the only part the page ever says.
"""

PRIVACY = [
    ("com.google.android.feedback", "reports"),
    ("com.google.android.adservices.api", "ads"),
    ("tv.alphonso.alphonso_eula", "viewing"),
    ("tv.samba.ssm.ui", "viewing"),
    ("tv.samba.ssm", "viewing"),
    ("com.sony.dtv.promos", "ads"),
    ("com.sony.dtv.sonyselect", "ads"),
    ("com.sony.dtv.notificationcenter", "ads"),
    ("com.miui.tv.analytics", "reports"),
    ("com.miui.analytics", "reports"),
    ("com.miui.msa.global", "ads"),
    ("com.amazon.tv.acr", "viewing"),
    ("com.amazon.hybridadidservice", "ads"),
    ("com.amazon.privacypassservice", "ads"),
    ("com.amazon.hedwig", "reports"),
    ("com.amazon.sneakpeek", "ads"),
    ("com.amazon.kso.blackbird", "ads"),
    ("com.amazon.wirelessmetrics.service", "reports"),
    ("com.amazon.perfcollection", "reports"),
    ("com.amazon.tv.fw.metrics", "reports"),
    ("com.amazon.dp.logger", "reports"),
    ("com.amazon.logan", "reports"),
    ("com.amazon.neo.minerva.logcat", "reports"),
    ("com.amazon.ceviche", "reports"),
    ("com.amazon.spiderpork", "reports"),
]
