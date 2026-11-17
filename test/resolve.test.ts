import { afterEach, describe, expect, mock, test } from 'bun:test';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import handler from '../api/resolve.ts';

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

/** Serve `html` in small chunks so the parser sees split tags and text. */
function mockFetch(html: string, status = 200, chunkSize = 32) {
  const fn = mock(async () => {
    const bytes = new TextEncoder().encode(html);
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < bytes.length; i += chunkSize) {
          controller.enqueue(bytes.slice(i, i + chunkSize));
        }
        controller.close();
      }
    });
    return new Response(body, { status });
  });
  globalThis.fetch = fn as unknown as typeof fetch;
  return fn;
}

type Body = {
  name?: string | null;
  artist?: string | null;
  platforms: Record<'spotify' | 'appleMusic' | 'deezer' | 'tidal', string | null>;
  error?: string;
};

type Result = { status: number; body: Body; headers: Record<string, string> };

async function resolve(url?: string): Promise<Result> {
  const result = { status: 0, body: {}, headers: {} } as Result;
  const res = {
    setHeader(key: string, value: string) {
      result.headers[key] = value;
      return res;
    },
    status(code: number) {
      result.status = code;
      return res;
    },
    json(body: unknown) {
      result.body = body as Body;
      return res;
    }
  };
  const query = url === undefined ? {} : { url };
  await handler({ query } as unknown as VercelRequest, res as unknown as VercelResponse);
  return result;
}

describe('validation', () => {
  test('rejects a missing url', async () => {
    const r = await resolve();
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('Missing url');
  });

  test('rejects an invalid url', async () => {
    const r = await resolve('not a url');
    expect(r.status).toBe(400);
  });

  test('rejects unsupported hosts without fetching', async () => {
    const fetchMock = mockFetch('');
    for (const url of [
      'https://example.com/track/1',
      'https://notspotify.com/track/1',
      'ftp://open.spotify.com/track/1'
    ]) {
      const r = await resolve(url);
      expect(r.status).toBe(400);
      expect(r.body.error).toBe('Unsupported url');
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('spotify', () => {
  test('reads og:title and twitter:audio:artist_name', async () => {
    mockFetch(`<html><head>
      <title>Don&#39;t Stop Me Now - song and lyrics by Queen | Spotify</title>
      <meta property="og:title" content="Don&#39;t Stop Me Now"/>
      <meta name="twitter:audio:artist_name" content="Queen"/>
    </head><body></body></html>`);

    const url = 'https://open.spotify.com/track/7hQJA50XrCWABAu5v6QZ4i';
    const r = await resolve(url);

    expect(r.status).toBe(200);
    expect(r.body).toEqual({
      name: "Don't Stop Me Now",
      artist: 'Queen',
      platforms: {
        spotify: url,
        appleMusic: "https://music.apple.com/search?term=Don't%20Stop%20Me%20Now%20Queen",
        deezer: "https://www.deezer.com/search/Don't%20Stop%20Me%20Now%20Queen",
        tidal: "https://tidal.com/search?q=Don't%20Stop%20Me%20Now%20Queen"
      }
    });
    expect(r.headers['cache-control']).toContain('s-maxage');
  });

  test('falls back to the <title> tag', async () => {
    mockFetch(`<html><head>
      <title>Blinding Lights - Single by The Weeknd | Spotify</title>
    </head></html>`);

    const r = await resolve('https://open.spotify.com/track/1');
    expect(r.body.name).toBe('Blinding Lights');
    expect(r.body.artist).toBe('The Weeknd');
  });

  test('accepts spotify.link short links', async () => {
    mockFetch(
      `<head><meta property="og:title" content="Song"><meta name="twitter:audio:artist_name" content="Artist"></head>`
    );
    const r = await resolve('https://spotify.link/abc');
    expect(r.status).toBe(200);
    expect(r.body.platforms.spotify).toBe('https://spotify.link/abc');
  });
});

describe('apple music', () => {
  test('finds MusicRecording in a JSON-LD array', async () => {
    mockFetch(`<html><head>
      <title>&#x200E;Bohemian Rhapsody par Queen sur Apple Music</title>
      <script type="application/ld+json">[
        {"@type":"WebSite","name":"Apple Music"},
        {"@context":"http://schema.org","@type":"MusicRecording","name":"Bohemian Rhapsody",
         "byArtist":[{"@type":"MusicGroup","name":"Queen"}]}
      ]</script>
    </head></html>`);

    const url = 'https://music.apple.com/fr/album/bohemian-rhapsody/1440650428?i=1440650711';
    const r = await resolve(url);

    expect(r.status).toBe(200);
    expect(r.body.name).toBe('Bohemian Rhapsody');
    expect(r.body.artist).toBe('Queen');
    expect(r.body.platforms.appleMusic).toBe(url);
    expect(r.body.platforms.spotify).toBe(
      'https://open.spotify.com/search/Bohemian%20Rhapsody%20Queen'
    );
  });

  test('cleans "by Artist on Apple Music" from og:title', async () => {
    mockFetch(`<head><meta property="og:title" content="Halo by Beyoncé on Apple Music"></head>`);
    const r = await resolve('https://music.apple.com/us/song/halo/1');
    expect(r.body.name).toBe('Halo');
    expect(r.body.artist).toBe('Beyoncé');
  });
});

describe('deezer', () => {
  test('finds MusicRecording inside @graph and decodes entities', async () => {
    mockFetch(`<html><head>
      <title>Rock &amp; Roll - Led Zeppelin - Deezer</title>
      <meta property="og:title" content="Rock &amp; Roll"/>
      <meta property="music:musician" content="https://www.deezer.com/artist/848"/>
      <script type="application/ld+json">{"@graph":[
        {"@type":"MusicRecording","name":"Rock & Roll","byArtist":{"name":"Led Zeppelin"}}
      ]}</script>
    </head></html>`);

    const r = await resolve('https://www.deezer.com/fr/track/3135556');
    expect(r.body.name).toBe('Rock & Roll');
    expect(r.body.artist).toBe('Led Zeppelin');
    expect(r.body.platforms.tidal).toBe(
      'https://tidal.com/search?q=Rock%20%26%20Roll%20Led%20Zeppelin'
    );
  });
});

describe('tidal', () => {
  test('splits "Song by Artist on TIDAL"', async () => {
    mockFetch(`<html><head>
      <title>Song Name by Some Artist on TIDAL</title>
    </head></html>`);

    const url = 'https://tidal.com/browse/track/77646172';
    const r = await resolve(url);
    expect(r.body.name).toBe('Song Name');
    expect(r.body.artist).toBe('Some Artist');
    expect(r.body.platforms.tidal).toBe(url);
  });
});

describe('title parsing', () => {
  test('keeps "by" inside real titles', async () => {
    mockFetch(
      `<head><meta property="og:title" content="Stand by Me"><meta name="twitter:audio:artist_name" content="Ben E. King"></head>`
    );
    const r = await resolve('https://open.spotify.com/track/1');
    expect(r.body.name).toBe('Stand by Me');
    expect(r.body.artist).toBe('Ben E. King');
  });

  test('returns null artist and name-only search links when no artist is found', async () => {
    mockFetch(`<head><meta property="og:title" content="Lonely Song"></head>`);
    const r = await resolve('https://open.spotify.com/track/1');
    expect(r.body.artist).toBeNull();
    expect(r.body.platforms.deezer).toBe('https://www.deezer.com/search/Lonely%20Song');
  });
});

describe('errors', () => {
  test('returns 404 when no title is found', async () => {
    mockFetch('<html><head></head><body></body></html>');
    const r = await resolve('https://open.spotify.com/track/1');
    expect(r.status).toBe(404);
    expect(r.body.error).toBe('Not found');
  });

  test('returns 500 when the page responds with an error', async () => {
    mockFetch('nope', 503);
    const r = await resolve('https://open.spotify.com/track/1');
    expect(r.status).toBe(500);
    expect(r.body.error).toBe('Request failed: 503');
  });

  test('stops reading once title and artist are found', async () => {
    const head = `<head><meta property="og:title" content="Song"><meta name="twitter:audio:artist_name" content="Artist">`;
    let chunks = 0;
    globalThis.fetch = (async () => {
      const body = new ReadableStream<Uint8Array>({
        pull(controller) {
          chunks++;
          controller.enqueue(
            new TextEncoder().encode(chunks === 1 ? head : '<p>filler</p>'.repeat(100))
          );
        }
      });
      return new Response(body);
    }) as unknown as typeof fetch;

    const r = await resolve('https://open.spotify.com/track/1');
    expect(r.status).toBe(200);
    expect(r.body.name).toBe('Song');
    expect(chunks).toBeLessThan(5);
  });
});
