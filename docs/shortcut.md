# Building the Hop shortcut

Hop's shortcut runs from the Share Sheet. When someone adds it from the iCloud link, an import
question asks which app to open songs in.

## Details

- **Name:** Hop
- **Icon:** any glyph and color you like
- **Show in Share Sheet:** on
- **Share Sheet types:** URLs and Text only, so Hop appears only when sharing a link
- **If there's no input:** Stop and Respond, with `Share a song link to use Hop.`

## Actions

1. **Comment**: `Hop: open any song in your favourite music app. github.com/jorisre/hop`
2. **Text**: `Spotify`
3. **Get URLs from** _Shortcut Input_
4. **Get First Item from** _URLs_
5. **URL Encode** _Item from List_
6. **URL Encode** _Text_ (from step 2)
7. **Get Contents of URL**:
   `https://hop.joris.re/api/resolve?url=<URL Encoded Text from step 5>&to=<URL Encoded Text from step 6>`
8. **Get Value for** `link` **in** _Contents of URL_
9. **If** _Dictionary Value_ has any value
   1. **Open URLs**: _Dictionary Value_
10. **Otherwise**
    1. **Get Value for** `error` **in** _Contents of URL_
    2. **Show Notification**: `Hop couldn't find this song (Dictionary Value)`
11. **End If**

## Import question

In the shortcut's settings, open **Setup** (Import Questions) and add a question on the Text
action from step 2:

- **Question:** `Which app should Hop open songs in? Spotify, Apple Music, Deezer or Tidal`
- **Default answer:** `Spotify`

The API ignores case and spaces, so `apple music`, `AppleMusic` and `apple` all work. To change
the app later, edit the Text action or add the shortcut again from the link.

## Sharing

1. In the Shortcuts app, long-press Hop, then tap **Share** → **Copy iCloud Link**.
2. Put the link in the README's Setup section.

The first time Hop runs, iOS asks for permission to connect to `hop.joris.re`. This only
happens once.
