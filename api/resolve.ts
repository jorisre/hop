import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Parser } from 'htmlparser2';

export const config = {
  runtime: 'edge'
};

type MusicMeta = {
  name: string | null;
  artist: string | null;
  spotify: {
    url: string | null;
  };
};

const HEADERS = {
  'user-agent': 'Mozilla/5.0',
  accept: 'text/html,application/xhtml+xml',
  'accept-language': 'fr-FR,fr;q=0.9'
};

const TIMEOUT = 2500;

type Logger = (...args: unknown[]) => void;

export default async function handler(req: VercelRequest) {
  const url = req.query.url as string | undefined;
  const debug = req.query.debug === '1';

  const log: Logger = (...args) => {
    if (debug) console.log(...args);
  };

  if (!url) {
    return Response.json({ error: 'Missing url' }, { status: 400 });
  }

  try {
    const meta = await getMusicMeta(url, log);
    return Response.json(meta);
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

async function getMusicMeta(
  url: string,
  log: Logger
): Promise<MusicMeta> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT);

  const res = await fetch(url, {
    redirect: 'follow',
    signal: controller.signal,
    headers: HEADERS
  });

  clearTimeout(timeout);

  if (!res.ok || !res.body) {
    throw new Error(`Request failed: ${res.status}`);
  }

  let ogTitle: string | null = null;
  let twitterTitle: string | null = null;
  let titleTag: string | null = null;
  let h1: string | null = null;
  let artist: string | null = null;

  let jsonLDName: string | null = null;
  let jsonLDArtist: string | null = null;

  let currentTag: 'title' | 'h1' | 'script' | null = null;

  let insideHead = true;
  let shouldStop = false;

  const parser = new Parser(
    {
      onopentag(name, attrs) {
        if (name === 'head') {
          insideHead = true;
        }

        // META TAGS
        if (name === 'meta') {
          const key = (attrs.property || attrs.name || '')
            .trim()
            .toLowerCase();

          const content = attrs.content;

          if (!key || !content) return;

          if (key === 'og:title' && !ogTitle) {
            ogTitle = content.trim();
          }

          if (key === 'twitter:title' && !twitterTitle) {
            twitterTitle = content.trim();
          }

          if (
            (key === 'music:artist' ||
              key === 'music:musician' ||
              key === 'twitter:audio:artist_name') &&
            !artist
          ) {
            artist = content.trim();
          }
        }

        // TITLE / H1
        if (name === 'title' && !titleTag) {
          currentTag = 'title';
        }

        if (name === 'h1' && !h1) {
          currentTag = 'h1';
        }

        // JSON-LD (CRITICAL FOR MUSIC SITES)
        if (
          name === 'script' &&
          attrs.type === 'application/ld+json'
        ) {
          currentTag = 'script';
        }
      },

      ontext(text) {
        const value = text.trim();
        if (!value) return;

        // TITLE
        if (currentTag === 'title' && !titleTag) {
          titleTag = value;
        }

        // H1
        if (currentTag === 'h1' && !h1) {
          h1 = value;
        }

        // JSON-LD parsing (lightweight safe parse)
        if (currentTag === 'script' && !jsonLDName && !jsonLDArtist) {
          try {
            const json = JSON.parse(value);

            if (json?.name) jsonLDName = json.name;

            if (json?.byArtist?.name) {
              jsonLDArtist = json.byArtist.name;
            }

            if (json?.author?.name) {
              jsonLDArtist = json.author.name;
            }
          } catch {}
        }
      },

      onclosetag(tag) {
        if (tag === 'head') {
          insideHead = false;

          // HEAD IS ENOUGH IN 95% CASES
          if (ogTitle || twitterTitle || jsonLDName) {
            shouldStop = true;
          }
        }

        if (tag === currentTag) {
          currentTag = null;
        }
      }
    },
    {
      decodeEntities: false
    }
  );

  try {
    for await (const chunk of res.body) {
      parser.write(chunk);

      const name =
        ogTitle ||
        twitterTitle ||
        jsonLDName ||
        titleTag ||
        h1;

      const finalArtist = artist || jsonLDArtist;

      // 🚀 EARLY EXIT STRATEGY
      if (name && finalArtist) {
        shouldStop = true;
      }

      if (shouldStop) {
        controller.abort();
        break;
      }
    }
  } catch (e) {
    if (!(e instanceof Error && e.name === 'AbortError')) {
      throw e;
    }
  } finally {
    parser.end();
  }

  // FINAL RESOLUTION STRATEGY
  const name =
    ogTitle ||
    twitterTitle ||
    jsonLDName ||
    titleTag ||
    h1;

  const finalArtist = artist || jsonLDArtist;

  const spotify =
    name && finalArtist
      ? {
          url: `https://open.spotify.com/search/${encodeURIComponent(
            `${name} ${finalArtist}`
          )}`
        }
      : { url: null };

  return {
    name,
    artist: finalArtist,
    spotify: spotify.url
  };
}