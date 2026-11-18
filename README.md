# Hop

Share a song from Spotify, Apple Music, Deezer or Tidal, and open it on any of the others.

Hop is a small API used by an iOS Shortcut. Send it a track link and it returns the title, the artist, and a link for each platform.

## Setup

1. Install the shortcut: [Hop for iOS Shortcuts](https://www.icloud.com/shortcuts/0000000000000000000000000000000)
2. When adding it, type the app you want songs to open in: Spotify, Apple Music, Deezer or
   Tidal. To change it later, edit the shortcut's first Text action.
3. Open a song in any supported app, tap **Share**, then **Hop**.

## Usage

```
GET /api/resolve?url=<encoded track url>&to=<spotify|appleMusic|deezer|tidal>
```

`to` is optional. When it's set, the response includes `link`, the link for that platform.

```json
{
  "name": "Bohemian Rhapsody",
  "artist": "Queen",
  "link": "https://open.spotify.com/search/...",
  "platforms": {
    "spotify": "https://open.spotify.com/search/...",
    "appleMusic": "https://music.apple.com/...",
    "deezer": "https://www.deezer.com/search/...",
    "tidal": "https://tidal.com/search?q=..."
  }
}
```

## Development

```bash
bun install
```

```bash
bun run dev
```

```bash
bun test
```

```bash
bun fmt
```

## License

MIT
