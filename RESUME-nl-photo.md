# RESUME nl-photo: a photo in a Photo or Art frame widget, end to end

Job: make "Put a photo in" a Photo or Art frame widget in couch-tv Studio (TD) work end to end, turned on.
Common rules: scratchpad nolater-common.md (worktree, TD backups, locks, words).

## Done
CT (this branch, commit d6ab3b6):
- tv-home/web/share-home.js: Share this home drops a widget's own photo (and a smart stack item's), like the background photo (privacy + the store refuses it).
- tests/test_share_home.js: +5 checks (59 pass; the new one fails without the fix).
- tests/test_widget_own_photo.js (new): gate keeps opts.image, widgets.js draws it for photo/artframe at every size, contain/cover. 116 pass.

TD (not git; backups in scratchpad td-backup-nl-photo/, same relative paths):
- app/send.js: window.TVSend = { widgetPhotos: true }; go() uploads each objects[].opts.image / items[].opts.image data: URL via POST /v1/assets (once per distinct photo), swaps in asset:<id>; sheet note #send-wphoto.
- app/designer.js: widgetPhotoJpeg (whole photo, long side <= 1280, white behind, <= ~400 KB, exposed as window.TVDesignerWidgetPhoto); photoFields comment; sellHandoff strips widget photos with a toast.
- app/ai-import.js: shapeOk widget photo paths (built in only).
- app/widget-text.js: OWN_PHOTO line for photo, artframe. app/tooltips.js: opt.image, widget.photo, widget.artframe.
- app/app-saves.js + app/mydesigns.js: cloud save leaves widget photos out and says so.
- server/lib/validate.mjs: WIDGET_PHOTO_PATHS, checkShape allows ASSET_REF (or built in) there; clean() placeholders past the TV gate (opt.photos), returns photos/droppedPhotos; widgetsOf, widgetPhotoIds, dropWidgetPhotos, inlineWidgetPhotos, tvAnswerChars, WIDGET_PHOTOS_MAX=6, TV_ANSWER_MAX.
- server/lib/db.mjs: design_photos table, purge/evict count it, addDesign in a transaction with photo_ids, photosOf, assetSize.
- server/store.mjs: publish clean(..., photos:true), photo kind check, too_big_for_tv check, share refuses droppedPhotos, fetch inlineWidgetPhotos.
- server/cloud/store-cloud.mjs, db-supabase.mjs (tvd_publish_v4 / tvd_take_v4, assetSizes), cloud/saves.mjs (drops widget photos, widget_photos_left_out).
- server/supabase/migrations/20261120120000_widget_photos.sql (NEW; applied ONLY to the local stack; must be applied to live before deploying the code).
- market/api/publish.mjs: dropWidgetPhotos(raw) before gating.
- tests: server/tests/widget-photo.test.mjs (7 pass), server/tests-cloud/widget-photo.test.mjs, scripts/widget-photo-checks.mjs (browser), scripts/ws-studio-panel-checks.mjs section 6 updated to the new truth.

## Test counts so far
- cd TD/server; node --test --test-concurrency=2 --test-timeout=180000 tests/*.test.mjs  -> 129/129 pass
- cd TD/server; node cloud/test-local.mjs  -> 117/117 pass (local Supabase, includes the 3 widget-photo cloud tests)
- node tests/test_share_home.js (CT) 59 pass; node tests/test_widget_own_photo.js (CT) 116 pass

## Left
1. Browser check: designer PORT=5591 node TD/app/server.mjs; store DATA_DIR=<scratch>/wp-store DESIGNER_ORIGINS=http://127.0.0.1:5591 PORT=5490 node TD/server/store.mjs; take browser.lock; node TD/scripts/widget-photo-checks.mjs 5591; rmdir lock. (First run broke on addWidget without an empty grid; fixed, rerunning.)
2. Run node TD/scripts/ws-studio-panel-checks.mjs (starts its own designer) under the browser lock.
3. Stop the two servers (pids in scratchpad wp-designer.pid, wp-store.pid).
4. Report. Known, not fixed (Group 2 renderers): Roku DesignDraw.brs designKeep only files top level opts.image, so a smart stack item's photo stays inline and can push the registry text past 15000 (design not kept); Roku dlSanWOpts drops items' image. tvOS fine. Market gallery and cloud saves do not keep widget photos (by design, message shown).
