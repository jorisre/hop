import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Parser } from 'htmlparser2';

type PlatformId = 'spotify' | 'appleMusic' | 'deezer' | 'tidal';

type PlatformLinks = Record<PlatformId, string | null>;

type MusicMeta = {
  name: string | null;
  artist: string | null;
  platforms: PlatformLinks;
};

type ApiResponse = (MusicMeta & { link?: string | null }) | { error: string };

type Logger = (...args: unknown[]) => void;

const HEADERS = {
  'user-agent': 'Mozilla/5.0',
  accept: 'text/html,application/xhtml+xml',
  'accept-language': 'fr-FR,fr;q=0.9'
};

const TIMEOUT = 2500;
const MAX_BYTES = 256 * 1024;
const MAX_CHUNKS = 50;

const HOSTS: Record<PlatformId, string[]> = {
  spotify: ['spotify.com', 'spotify.link'],
  appleMusic: ['music.apple.com', 'itunes.apple.com'],
  deezer: ['deezer.com', 'deezer.page.link'],
  tidal: ['tidal.com']
};

/** Accepts ids and display names: "appleMusic", "Apple Music", "apple"... */
const TARGETS: Record<string, PlatformId> = {
  spotify: 'spotify',
  applemusic: 'appleMusic',
  apple: 'appleMusic',
  deezer: 'deezer',
  tidal: 'tidal'
};

function parseTarget(raw: string): PlatformId | null {
  return TARGETS[raw.toLowerCase().replace(/[^a-z]/g, '')] ?? null;
}

const SEARCH: Record<PlatformId, (q: string) => string> = {
  spotify: (q) => `https://open.spotify.com/search/${q}`,
  appleMusic: (q) => `https://music.apple.com/search?term=${q}`,
  deezer: (q) => `https://www.deezer.com/search/${q}`,
  tidal: (q) => `https://tidal.com/search?q=${q}`
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const started = performance.now();
  const url = req.query.url;
  const rawTarget = req.query.to;
  const debug = req.query.debug === '1';

  const log: Logger = (...args) => {
    if (debug) console.log('[hop]', ...args);
  };

  let source: PlatformId | null = null;
  let target: PlatformId | null = null;
  let artistFound = false;

  const reply = (status: number, body: ApiResponse) => {
    // One line per request, used for usage stats in Vercel Logs and Observability.
    // Never includes the shared url or track details.
    console.log(
      JSON.stringify({
        event: 'resolve',
        status,
        source,
        to: target,
        artist: artistFound,
        ms: Math.round(performance.now() - started)
      })
    );
    return res.status(status).json(body);
  };

  if (!url || typeof url !== 'string') {
    return reply(400, { error: 'Missing url' });
  }

  source = detectPlatform(url);
  if (!source) {
    return reply(400, { error: 'Unsupported url' });
  }

  if (rawTarget !== undefined) {
    target = typeof rawTarget === 'string' ? parseTarget(rawTarget) : null;
    if (!target) {
      return reply(400, { error: 'Unsupported target' });
    }
  }

  try {
    const meta = await getMusicMeta(url, source, log);
    if (!meta.name) {
      return reply(404, { error: 'Not found' });
    }

    artistFound = Boolean(meta.artist);
    res.setHeader('cache-control', 'public, s-maxage=86400, stale-while-revalidate=604800');
    return reply(200, target ? { ...meta, link: meta.platforms[target] } : meta);
  } catch (e) {
    return reply(500, {
      error: e instanceof Error ? e.message : 'Unknown error'
    });
  }
}

function detectPlatform(raw: string): PlatformId | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;

  const host = u.hostname.toLowerCase();
  for (const id of Object.keys(HOSTS) as PlatformId[]) {
    if (HOSTS[id].some((h) => host === h || host.endsWith(`.${h}`))) return id;
  }
  return null;
}

function buildPlatforms(
  name: string | null,
  artist: string | null,
  source: PlatformId,
  sourceUrl: string
): PlatformLinks {
  const links: PlatformLinks = {
    spotify: null,
    appleMusic: null,
    deezer: null,
    tidal: null
  };

  if (!name) return links;

  const q = encodeURIComponent(artist ? `${name} ${artist}` : name);
  for (const id of Object.keys(SEARCH) as PlatformId[]) {
    links[id] = SEARCH[id](q);
  }
  links[source] = sourceUrl;

  return links;
}

const clean = (s: string | null | undefined): string | null => {
  const v = s?.replace(/[‎‏]/g, '').replace(/\s+/g, ' ').trim();
  return v ? v : null;
};

const PLATFORM_SUFFIX =
  /(?:\s*[|\-–—]\s*|\s+(?:on|sur|auf|en)\s+)(?:Spotify|Deezer|TIDAL|Apple\s+Music)\s*$/i;
const BY_ARTIST = /\s+(?:by|par|von|de)\s+(.+)$/i;

/**
 * Split a title such as "Song - Single by Artist | Spotify" or
 * "Song by Artist on Apple Music" into its parts. The "by Artist" part is only
 * trusted when a platform suffix was present, so "Stand by Me" stays intact.
 */
function parseTitle(raw: string | null): { name: string | null; artist: string | null } {
  let t = clean(raw);
  if (!t) return { name: null, artist: null };

  if (!PLATFORM_SUFFIX.test(t)) return { name: t, artist: null };
  t = t.replace(PLATFORM_SUFFIX, '');

  let artist: string | null = null;
  const by = t.match(BY_ARTIST);
  if (by) {
    artist = clean(by[1]);
    t = t.slice(0, by.index);
  }

  t = t.replace(/\s*[-–—]\s*(?:song and lyrics|chanson et paroles|single|EP|album)\s*$/i, '');

  return { name: clean(t), artist };
}

type JsonLD = { name: string | null; artist: string | null };

function readJsonLD(node: unknown, out: JsonLD): void {
  if (!node || typeof node !== 'object') return;

  if (Array.isArray(node)) {
    for (const n of node) readJsonLD(n, out);
    return;
  }

  const obj = node as Record<string, unknown>;

  if ('@graph' in obj) readJsonLD(obj['@graph'], out);

  const type = obj['@type'];
  const types = Array.isArray(type) ? type : [type];
  const isTrack = types.some((t) => t === 'MusicRecording');

  if (!isTrack) return;

  if (!out.name && typeof obj.name === 'string') out.name = clean(obj.name);

  if (!out.artist) {
    const by = obj.byArtist ?? obj.author;
    const first = Array.isArray(by) ? by[0] : by;
    if (typeof first === 'string') out.artist = clean(first);
    else if (
      first &&
      typeof first === 'object' &&
      typeof (first as { name?: unknown }).name === 'string'
    ) {
      out.artist = clean((first as { name: string }).name);
    }
  }
}

async function getMusicMeta(url: string, source: PlatformId, log: Logger): Promise<MusicMeta> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT);

  let ogTitle: string | null = null;
  let twitterTitle: string | null = null;
  let titleTag: string | null = null;
  let h1: string | null = null;
  let artist: string | null = null;
  let musician: string | null = null;
  const ld: JsonLD = { name: null, artist: null };

  let currentTag: 'title' | 'h1' | 'script' | null = null;
  let scriptBuffer = '';
  let titleBuffer = '';
  let h1Buffer = '';
  let shouldStop = false;
  let finalUrl = url;

  const pickName = () =>
    parseTitle(ogTitle).name ||
    ld.name ||
    parseTitle(twitterTitle).name ||
    parseTitle(titleTag).name ||
    clean(h1);

  const pickArtist = () =>
    clean(artist) ||
    ld.artist ||
    musician ||
    parseTitle(ogTitle).artist ||
    parseTitle(twitterTitle).artist ||
    parseTitle(titleTag).artist;

  try {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: HEADERS
    });

    if (!response.ok || !response.body) {
      throw new Error(`Request failed: ${response.status}`);
    }

    if (response.url) finalUrl = response.url;
    log('fetched', response.status, finalUrl);

    const parser = new Parser(
      {
        onopentag(tag, attrs) {
          if (tag === 'meta') {
            const key = (attrs.property || attrs.name || '').trim().toLowerCase();
            const content = attrs.content?.trim();
            if (!key || !content) return;

            if (key === 'og:title' && !ogTitle) ogTitle = content;
            else if (key === 'twitter:title' && !twitterTitle) twitterTitle = content;
            else if (key === 'twitter:audio:artist_name' && !artist) artist = content;
            else if (key === 'music:musician' && !musician && !/^https?:\/\//i.test(content)) {
              musician = content;
            }
            return;
          }

          if (tag === 'title' && !titleTag) {
            currentTag = 'title';
            titleBuffer = '';
          } else if (tag === 'h1' && !h1) {
            currentTag = 'h1';
            h1Buffer = '';
          } else if (tag === 'script' && attrs.type === 'application/ld+json') {
            currentTag = 'script';
            scriptBuffer = '';
          }
        },

        ontext(text) {
          if (currentTag === 'script') {
            scriptBuffer += text;
            return;
          }

          if (currentTag === 'title') titleBuffer += text;
          else if (currentTag === 'h1') h1Buffer += text;
        },

        onclosetag(tag) {
          if (tag === 'script' && currentTag === 'script') {
            try {
              readJsonLD(JSON.parse(scriptBuffer), ld);
            } catch {}
            scriptBuffer = '';
          }

          if (tag === 'title' && currentTag === 'title') titleTag = clean(titleBuffer);
          if (tag === 'h1' && currentTag === 'h1') h1 = clean(h1Buffer);

          if (tag === currentTag) currentTag = null;
          if (tag === 'head') shouldStop = true;
        }
      },
      { decodeEntities: true }
    );

    const decoder = new TextDecoder();
    let chunkCount = 0;
    let totalBytes = 0;

    try {
      for await (const chunk of response.body) {
        chunkCount++;
        totalBytes += chunk.length;

        parser.write(decoder.decode(chunk, { stream: true }));

        if (pickName() && pickArtist()) shouldStop = true;
        if (totalBytes > MAX_BYTES || chunkCount > MAX_CHUNKS) shouldStop = true;

        if (shouldStop) break;
      }
    } finally {
      // Stop downloading the rest of the page.
      controller.abort();
    }

    parser.end();
  } catch (e) {
    const aborted = e instanceof Error && e.name === 'AbortError';
    if (!aborted || (!pickName() && !pickArtist())) {
      if (!aborted) throw e;
      throw new Error('Request timed out');
    }
  } finally {
    clearTimeout(timeout);
  }

  const name = pickName();
  const finalArtist = pickArtist();

  log({ name, artist: finalArtist });

  return {
    name,
    artist: finalArtist,
    platforms: buildPlatforms(name, finalArtist, source, url)
  };
}
