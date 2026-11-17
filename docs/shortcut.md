# Building the Hop shortcut

Hop's shortcut runs from the Share Sheet. The first time it runs, it asks which app to open songs
in and remembers the answer. To change the app later, run Hop from the Shortcuts app.

## Details

- **Name:** Hop
- **Icon:** any glyph and color you like
- **Show in Share Sheet:** on
- **Share Sheet types:** URLs and Text only, so Hop appears only when sharing a link
- **If there's no input:** Continue

## Actions

1. **Comment**: `Hop: open any song in your favourite music app. github.com/jorisre/hop`
2. **Get URLs from** _Shortcut Input_
3. **Get File** from _Shortcuts_ at path `Hop/target.txt`, with _Error If Not Found_ turned off
4. **If** _any_ of these are true: _File_ does not have any value, _URLs_ does not have any value
   1. **List**: `Spotify`, `Apple Music`, `Deezer`, `Tidal`
   2. **Choose from List**: _List_, prompt `Open songs in…`
   3. **Save File**: _Chosen Item_ to _Shortcuts_ at `Hop/target.txt`, with _Ask Where to Save_ off
      and _Overwrite If File Exists_ on
   4. **Set Variable** `Target` to _Chosen Item_
5. **Otherwise**
   1. **Set Variable** `Target` to _File_
6. **End If**
7. **If** _URLs_ does not have any value
   1. **Show Notification**: `Hop will open songs in Target.`
   2. **Stop This Shortcut**
8. **End If**
9. **Get First Item from** _URLs_
10. **URL Encode** _Item from List_
11. **URL Encode** _Target_
12. **Get Contents of URL**:
    `https://hop.joris.re/api/resolve?url=<URL Encoded Text from step 10>&to=<URL Encoded Text from step 11>`
13. **Get Value for** `link` **in** _Contents of URL_
14. **If** _Dictionary Value_ has any value
    1. **Open URLs**: _Dictionary Value_
15. **Otherwise**
    1. **Get Value for** `error` **in** _Contents of URL_
    2. **Show Notification**: `Hop couldn't find this song (Dictionary Value)`
16. **End If**

## Sharing

1. In the Shortcuts app, long-press Hop, then tap **Share** → **Copy iCloud Link**.
2. Put the link in the README's Setup section.

The first time Hop runs, iOS asks for permission to connect to `hop.joris.re`. This only
happens once.
