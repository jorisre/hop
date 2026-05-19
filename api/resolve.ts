import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Parser } from 'htmlparser2';

type MusicMeta = {
  name: string | null;
  artist: string | null;
  spotify: string | null;
};

type ApiResponse =
  | MusicMeta
  | { error: string };

const HEADERS = {
  'user-agent': 'Mozilla/5.0',
  accept: 'text/html,application/xhtml+xml',
  'accept-language': 'fr-FR,fr;q=0.9'
};

const TIMEOUT = 2500;

type Logger = (...args: unknown[]) => void;

export default async function handler(
  req: VercelRequest,
  res: VercelResponse<ApiResponse>
) {
  const url = req.query.url;
  const debug = req.query.debug === '1';

  const log: Logger = (...args) => {
    if (debug) console.log(...args);
  };

  if (!url || typeof url !== 'string') {
    return res.status(400).json({
      error: 'Missing url'
    });
  }

  try {
    const meta = await getMusicMeta(url, log);

    return res.status(200).json(meta);
  } catch (e) {
    return res.status(500).json({
      error: e instanceof Error ? e.message : 'Unknown error'
    });
  }
}

async function getMusicMeta(
  url: string,
  log: Logger
): Promise<MusicMeta> {
  const controller = new AbortController();

  const timeout = setTimeout(() => {
    controller.abort();
  }, TIMEOUT);

  const response = await fetch(url, {
    redirect: 'follow',
    signal: controller.signal,
    headers: HEADERS
  });

  clearTimeout(timeout);

  if (!response.ok || !response.body) {
    throw new Error(`Request failed: ${response.status}`);
  }

  let ogTitle: string | null = null;
  let twitterTitle: string | null = null;
  let titleTag: string | null = null;
  let h1: string | null = null;

  let artist: string | null = null;

  let jsonLDName: string | null = null;
  let jsonLDArtist: string | null = null;

  let currentTag: 'title' | 'h1' | 'script' | null =
    null;

  let shouldStop = false;

  let chunkCount = 0;
  let totalBytes = 0;

  const parser = new Parser(
    {
      onopentag(name, attrs) {
        // META TAGS
        if (name === 'meta') {
          const key = (
            attrs.property ||
            attrs.name ||
            ''
          )
            .trim()
            .toLowerCase();

          const content = attrs.content?.trim();

          if (!key || !content) return;

          // TITLE PRIORITY
          if (key === 'og:title' && !ogTitle) {
            ogTitle = content;
            return;
          }

          if (
            key === 'twitter:title' &&
            !twitterTitle
          ) {
            twitterTitle = content;
            return;
          }

          // ARTIST
          if (
            (key === 'twitter:audio:artist_name' ||
              key === 'music:artist' ||
              key === 'music:musician' ||
              key === 'og:audio:artist') &&
            !artist
          ) {
            artist = content;
          }

          return;
        }

        // TITLE
        if (name === 'title' && !titleTag) {
          currentTag = 'title';
          return;
        }

        // H1
        if (name === 'h1' && !h1) {
          currentTag = 'h1';
          return;
        }

        // JSON-LD
        if (
          name === 'script' &&
          attrs.type === 'application/ld+json'
        ) {
          currentTag = 'script';
        }
      },

      ontext(text) {
        if (!currentTag) return;

        const value = text.trim();

        if (!value) return;

        // TITLE TAG
        if (
          currentTag === 'title' &&
          !titleTag
        ) {
          titleTag = value;
          return;
        }

        // H1
        if (currentTag === 'h1' && !h1) {
          h1 = value;
          return;
        }

        // JSON-LD
        if (
          currentTag === 'script' &&
          (!jsonLDName || !jsonLDArtist)
        ) {
          try {
            const json = JSON.parse(value);

            if (
              typeof json?.name === 'string' &&
              !jsonLDName
            ) {
              jsonLDName = json.name.trim();
            }

            if (
              typeof json?.byArtist?.name ===
                'string' &&
              !jsonLDArtist
            ) {
              jsonLDArtist =
                json.byArtist.name.trim();
            }

            if (
              typeof json?.author?.name ===
                'string' &&
              !jsonLDArtist
            ) {
              jsonLDArtist =
                json.author.name.trim();
            }
          } catch {}
        }
      },

      onclosetag(tag) {
        if (tag === currentTag) {
          currentTag = null;
        }

        // 🚀 stop after </head>
        if (tag === 'head') {
          shouldStop = true;
        }
      }
    },
    {
      decodeEntities: false
    }
  );

  try {
    for await (const chunk of response.body) {
      chunkCount++;
      totalBytes += chunk.length;

      // 🚀 Node runtime optimized path
      parser.write(chunk.toString());

      const name =
        ogTitle ||
        twitterTitle ||
        jsonLDName ||
        titleTag ||
        h1;

      const finalArtist =
        artist || jsonLDArtist;

      // 🚀 fastest successful exit
      if (name && finalArtist) {
        shouldStop = true;
      }

      // 🚀 safety stop
      if (
        totalBytes > 256 * 1024 ||
        chunkCount > 50
      ) {
        shouldStop = true;
      }

      if (shouldStop) {
        controller.abort();
        break;
      }
    }
  } catch (e) {
    if (
      !(
        e instanceof Error &&
        e.name === 'AbortError'
      )
    ) {
      throw e;
    }
  } finally {
    parser.end();
  }

  // FINAL PRIORITY RESOLUTION
  const name =
    ogTitle ||
    twitterTitle ||
    jsonLDName ||
    titleTag ||
    h1;

  const finalArtist =
    artist || jsonLDArtist;

  const spotify =
    name && finalArtist
      ? `https://open.spotify.com/search/${encodeURIComponent(
          `${name} ${finalArtist}`
        )}`
      : null;

  log('[Pulse] Result:', {
    name,
    artist: finalArtist,
    spotify
  });

  return {
    name,
    artist: finalArtist,
    spotify
  };
}