# Bring in your past Netflix and YouTube history (option B)

Optional. With your past viewing in, the picks start smart instead of empty. (Keep watching fills
from what is watched on each TV, per person; imported history does not go in it.)
You download your own files from Netflix and Google and drop them in a folder on the bridge
computer. **Nothing signs in to anything and nothing is sent anywhere**: the bridge only reads the
files, and everything it learns stays in `bridge/data/` (ignored by git).

## 1. Get the files

**Netflix, one profile at a time (quick).** On a computer, sign in to Netflix, pick the profile,
then **Account, Profiles, that profile, Viewing activity** (or go to netflix.com/viewingactivity).
At the bottom press **Download all**. You get `NetflixViewingHistory.csv` (title and date). Do it
once per profile.

**Netflix, the whole account (better, takes a day or two).** **Account, Security and privacy,
Download your personal information** (netflix.com/account/getmyinfo). Netflix emails a link to a
zip. It has `CONTENT_INTERACTION/ViewingActivity.csv`, which names the profile on every row and
says how long each sitting lasted, so the bridge can tell a show you finished from one you gave up
on. Trailers and previews in it are skipped.

**YouTube (Google Takeout).** Go to takeout.google.com, press **Deselect all**, tick **YouTube and
YouTube Music**, press **All YouTube data included** and keep only **history**. Choosing JSON
instead of HTML for the history is tidier, but either works. Google emails a zip with
`watch-history.json` (or `watch-history.html`). Ads and removed videos are skipped; YouTube Music
plays are kept and marked as music.

## 2. Put them in the inbox

The inbox is `bridge/data/inbox/` (create it if it is not there). Zips can go in as they are.

The bridge works out **whose** history a file is from its file or folder name, matching each
person's `id` or `name` from `config.json`. The easiest way is a folder per person:

```
bridge/data/inbox/
  person1/NetflixViewingHistory.csv
  person2/NetflixViewingHistory.csv
  person1/takeout-20300101.zip
  both/NetflixViewingHistory.csv        # "both", "shared" or "together": the whole house
```

The whole-account Netflix file names the profile on each row, so it can go straight in the inbox:
a profile whose name matches a person goes to them, and anything else (a Kids profile, a guest)
stays unassigned rather than borrowing someone's name. Kids profiles are always left out of the
household's taste.

## 3. Import

The bridge checks the inbox every hour by itself. To do it now, either:

```sh
.venv/bin/python bridge/history_import.py            # add --keep to leave the files in place
curl -X POST -H 'Content-Type: application/json' -d '{}' http://your-computer.local:5400/api/import
```

It prints what it read from each file (rows, new rows, which people). Files that were read move to
`bridge/data/inbox/done/`. A file it did not recognise stays where it was, with a note. Importing
the same file twice adds nothing twice. The taste profile is rebuilt after every import.

## Undo

Delete `bridge/data/imported.jsonl` (everything imported) and `bridge/data/taste.json`, then
restart the bridge. Your own downloads in `bridge/data/inbox/done/` can be deleted too.
