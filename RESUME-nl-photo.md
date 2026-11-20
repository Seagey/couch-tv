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
- server/supabase/migrations/20261121060000_widget_photos.sql (NEW; applied ONLY to the local stack; must be applied to live before deploying the code).
- market/api/publish.mjs: dropWidgetPhotos(raw) before gating.
- tests: server/tests/widget-photo.test.mjs (7 pass), server/tests-cloud/widget-photo.test.mjs, scripts/widget-photo-checks.mjs (browser), scripts/ws-studio-panel-checks.mjs section 6 updated to the new truth.

Roku (round 3, commit 34d2fdf):
- roku/channel/components/DesignLib.brs: dlSanWOpts keeps opts.image (dlImgOk: real JPEG/PNG inside the design, built in, or kept:N), so a smart stack item keeps its photo like a widget on its own (the top level check in dlSanObject moved here).
- roku/channel/components/DesignDraw.brs: designKeep files every widget photo AND each stack item's photo in cachefs: (designKeepPhoto, numbered 1 to 99), so none stays inline in the registry (15000 chars).
- tests/test_roku_design.py: +3 tests (Gate.test_a_smart_stack_item_keeps_its_own_photo_like_a_widget_on_its_own; SceneWidgetPhotos x2: two photos each over 15000 chars, design kept, registry has kept:1.jpg/kept:2.jpg and no data:, the kept design draws both). The scene copy maps cachefs:/ to tmp:/cachefs- (brs has no cachefs volume). Without the .brs fix: 3 of 34 fail; with it 34/34.

## Test counts (round 3, 21 Nov)
- CT: python3 -m unittest discover -s tests -p "test_roku*.py" -> 90/90 OK (test_roku_design 34/34). Needs `npm ci --prefix roku` once.
- CT: node tests/test_share_home.js 59 pass; node tests/test_widget_own_photo.js 116 pass
- cd TD/server; node --test --test-concurrency=2 --test-timeout=180000 tests/*.test.mjs  -> 129/129 pass
- cd TD/server; node cloud/test-local.mjs  -> 117/117 pass (local Supabase, includes the 3 widget-photo cloud tests)
- Browser, 20 Nov 19:29 (previous builder): widget-photo-checks.mjs 26/26 (log scratchpad wp-run.log). Rerun pending below.

## Round 3 session (21 Nov 05:10 to 05:37), stopped by the coordinator
- No TD file changed this round (so td-backup-nl-photo-r3/ was not needed; round 1 to 2 backups are in scratchpad td-backup-nl-photo/).
- Stopped the previous builder's designer (pid 20647) and store (20648) left running since 20 Nov 18:19.
- Browser checks NOT rerun: browser.lock was held by other branches from 05:16 to at least 05:37. No lock of ours left behind, no server of ours running.
- `npm ci --prefix roku` was run in this worktree (roku/node_modules, git ignored) for brs and bsc.

## Round 4 (21 Nov 05:40 to 05:55): all checks rerun, finished
- No TD or CT code changed this round. All counts rerun on the current TD files:
  - CT: test_roku* 90/90 OK; test_share_home 59 pass; test_widget_own_photo 116 pass
  - TD server: node --test tests/*.test.mjs 129/129 pass; node cloud/test-local.mjs 117/117 pass
  - Browser (under browser.lock, 05:51:48 to 05:53:34; script scratchpad nl-photo-browser-run.sh, log nl-photo-browser-r4.log): widget-photo-checks.mjs 26 of 26 passed; ws-studio-panel-checks.mjs 80 of 80 passed. 106 PASS lines, 0 FAIL. Both servers stopped, lock freed.
- Note: widget-photo-checks.mjs reads the TV gate from couch-tv/wt-studio-src/tv-home/web (a TD script constant), not this worktree; this worktree's gate is covered by test_widget_own_photo.js.

## Round 5 (21 Nov 06:15 to 06:45): Fable NO-GO fixes (coordinator items 1, 2, 3, 5, 6)
TD backups before editing: scratchpad td-backup-nl-photo-r5/ (same relative paths).
1. Migration renamed 20261120120000_widget_photos.sql -> 20261121060000_widget_photos.sql (20261120120000 is creator_invites on the live project jthgozqyudlflrgihbyt). Names updated in server/cloud/db-supabase.mjs:29, server/tests-cloud/widget-photo.test.mjs:2, this file, COORDINATOR-HANDOVER.md:859. Local tv-designer-store stack history row renamed to match (supabase_migrations.schema_migrations, local only). NOT pushed.
   AFTER the live push, before the code is promoted, check by SQL on live that these exist:
   select to_regclass('public.tvd_design_photos'); select proname from pg_proc where proname in ('tvd_publish_v4','tvd_take_v4');  (expect the table and both functions)
2. Gallery file path: market/api/publish.mjs check op drops widget photos on its copy (dropWidgetPhotos after splitPicture) and adds PHOTO_LEFT ("The photo in a widget stays with you. In the gallery that widget shows each buyer's own photos.") to changes; prepare() returns photosLeft and the new listing and seller edit answers add the same line. importers/lib/checks.mjs runChecks judges a copy with dropWidgetPhotos, returns photosLeft, leaves the design untouched (Open a file keeps the photo).
   Tests: importers/tests/widget-photo.test.mjs (new, 4 pass); market/tests/widget-photo-unit.mjs (new, 5 pass; against the old publish.mjs 3 of 5 fail); market/tests/widget-photo.spec.mjs (new, real share through the local gallery stack).
3. app/send.js: uploaded widget photos kept in a module map { asset, at }; reused under 50 minutes (store keeps an unused upload 60); expired ones pruned each send; cleared when the store answers photo_not_found (post() now carries j.error as e.code).
5. app/send.js dropUnsendable(): before a send, a widget opts.image (and a stack item's) that is neither a data: JPEG/PNG/WebP nor a built in backgrounds/ name is taken out.
6. server/lib/validate.mjs WPH_BACK \d{1,3} -> \d{1,4}.
   3 and 5 tested in scripts/widget-photo-checks.mjs (6 new checks per viewport: second send 0 uploads same asset; photo_not_found words; next send 1 upload; 51 minutes later 1 upload; household name set up; sent without it and the design goes). The script now takes TV_WEB (the run points it at this worktree's tv-home/web).
Counts (round 5): TD server 129/129; cloud test-local 117/117; importers widget-photo 4/4 (all importers 25/26: format.test "every preset meets the schema" fails on d.objects not iterable, a preset not touched by this branch); market widget-photo-unit 5/5; market widget-photo.spec 1/1 (Playwright desktop, local gallery stack, log scratchpad nl-photo-market-r5.log); browser widget-photo-checks 38 of 38, ws-studio-panel-checks 80 of 80 (118 PASS, 0 FAIL, log scratchpad nl-photo-browser-r5.log); CT test_share_home 59, test_widget_own_photo 116.

## Left (nothing in scope)
- Supabase migration 20261121060000_widget_photos.sql is NOT on the live database: the coordinator asks the owner. Market gallery and cloud saves do not keep widget photos (by design, message shown). tvOS fine.
