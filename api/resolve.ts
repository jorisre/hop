import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Parser } from 'htmlparser2';

type MusicMeta = {
  name: string | null;
  artist: string | null;
};

type ApiResponse =
  | MusicMeta
  | { error: string };

const HEADERS = {
  'user-agent': 'Mozilla/5.0',
  accept: 'text/html,application/xhtml+xml'
};

const TIMEOUT = 4000;
type Logger = (...args: unknown[]) => void;

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  const url = req.query.url;
  const debug = req.query.debug === '1';
  const log: Logger = (...args) => {
    if (debug) {
      console.log(...args);
    }
  };

  log('[Pulse] Incoming request:', url);

  if (!url || typeof url !== 'string') {
    log('[Pulse] Missing URL');
      return res.status(400).json({ error: 'Missing url' } satisfies ApiResponse);
  }

  try {
    const meta = await getMusicMeta(url, log);
    log('[Pulse] Final result:', meta);

    return res.status(200).json(meta satisfies ApiResponse);
  } catch (e) {
    log('[Pulse] ERROR:', e);

    return res.status(500).json({
      error: e instanceof Error ? e.message : 'Unknown error'
    } satisfies ApiResponse);
  }
}

async function getMusicMeta(url: string, log: Logger): Promise<MusicMeta> {
  const controller = new AbortController();

  const timeout = setTimeout(() => {
    log('[Pulse] Timeout triggered');
    controller.abort();
  }, TIMEOUT);

  log('[Pulse] Fetching URL...');

  const response = await fetch(url, {
    redirect: 'follow',
    signal: controller.signal,
    headers: HEADERS
  });

  clearTimeout(timeout);

  log('[Pulse] Response status:', response.status);
  log('[Pulse] Content-Type:', response.headers.get('content-type'));

  if (!response.ok || !response.body) {
    throw new Error(`Request failed: ${response.status}`);
  }

  let ogTitle: string | null = null;
  let twitterTitle: string | null = null;
  let titleTag: string | null = null;
  let h1: string | null = null;
  let artist: string | null = null;

  let currentTag: 'title' | 'h1' | null = null;

  let chunkCount = 0;
  let totalBytes = 0;
  let shouldStop = false;
  let insideHead = false;

  const decoder = new TextDecoder('utf-8');

  const parser = new Parser({
    onopentag(name, attrs) {
      if (name === 'head') {
        insideHead = true;
      }

      if (name === 'meta') {
        const key = (attrs.property || attrs.name || '')
          .trim()
          .toLowerCase();

        const content = attrs.content?.trim();

        if (!key || !content) return;

        if (key === 'og:title' && !ogTitle) {
          ogTitle = content;
          log('[Pulse] og:title found:', ogTitle);
        }

        if (key === 'twitter:title' && !twitterTitle) {
          twitterTitle = content;
          log('[Pulse] twitter:title found:', twitterTitle);
        }

        if (
          (key === 'twitter:audio:artist_name') &&
          !artist
        ) {
          artist = content;
          log('[Pulse] artist found:', artist);
        }
      }

      if (name === 'title' && !titleTag) {
        currentTag = 'title';
      }

      if (name === 'h1' && !h1) {
        currentTag = 'h1';
      }
    },

    ontext(text) {
      const value = text.trim();
      if (!value) return;

      if (currentTag === 'title' && !titleTag) {
        titleTag = value;
        log('[Pulse] <title> found:', titleTag);
      }

      if (currentTag === 'h1' && !h1) {
        h1 = value;
        log('[Pulse] <h1> found:', h1);
      }
    },

    onclosetag(tag) {
      if (tag === 'head') {
        insideHead = false;
      }

      if (tag === currentTag) {
        currentTag = null;
      }

      if (!insideHead && (ogTitle || twitterTitle || titleTag || h1)) {
        shouldStop = true;
      }
    }
  });

  try {
    for await (const chunk of response.body) {
      chunkCount++;
      totalBytes += chunk.length;

      const text = decoder.decode(chunk, { stream: true });

      log(`[Pulse] Chunk #${chunkCount} size=${text.length}`);

      parser.write(text);

      if ((ogTitle || twitterTitle) && artist) {
        shouldStop = true;
      }

      if (shouldStop) {
        log('[Pulse] Enough metadata found, stopping early');
        controller.abort();
        break;
      }

      if (totalBytes > 256 * 1024 || chunkCount > 50) {
        log('[Pulse] Stream safety stop triggered');
        controller.abort();
        break;
      }
    }
  } catch (e) {
    log('[Pulse] Stream error:', e);
    if (!(e instanceof Error && e.name === 'AbortError')) {
      throw e;
    }
  } finally {
    parser.end();
  }

  log('[Pulse] Parsed values:', {
    ogTitle,
    twitterTitle,
    titleTag,
    h1,
    artist
  });

  return {
    name: ogTitle || twitterTitle || titleTag || h1,
    artist
  };
}
