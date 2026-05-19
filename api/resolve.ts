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

export default async function handler(
  req: VercelRequest,
  res: VercelResponse<ApiResponse>
) {
  const url = req.query.url;

  console.log('[Pulse] Incoming request:', url);

  if (!url || typeof url !== 'string') {
    console.log('[Pulse] Missing URL');
    return res.status(400).json({ error: 'Missing url' });
  }

  try {
    const meta = await getMusicMeta(url);
    console.log('[Pulse] Final result:', meta);

    return res.status(200).json(meta);
  } catch (e) {
    console.error('[Pulse] ERROR:', e);

    return res.status(500).json({
      error: e instanceof Error ? e.message : 'Unknown error'
    });
  }
}

async function getMusicMeta(url: string): Promise<MusicMeta> {
  const controller = new AbortController();

  const timeout = setTimeout(() => {
    console.log('[Pulse] Timeout triggered');
    controller.abort();
  }, TIMEOUT);

  console.log('[Pulse] Fetching URL...');

  const response = await fetch(url, {
    redirect: 'follow',
    signal: controller.signal,
    headers: HEADERS
  });

  clearTimeout(timeout);

  console.log('[Pulse] Response status:', response.status);
  console.log('[Pulse] Content-Type:', response.headers.get('content-type'));

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

  const decoder = new TextDecoder('utf-8');

  const parser = new Parser({
    onopentag(name, attrs) {
      if (name === 'meta') {
        const key = (attrs.property || attrs.name || '')
          .trim()
          .toLowerCase();

        const content = attrs.content?.trim();

        if (!key || !content) return;

        if (key === 'og:title' && !ogTitle) {
          ogTitle = content;
          console.log('[Pulse] og:title found:', ogTitle);
        }

        if (key === 'twitter:title' && !twitterTitle) {
          twitterTitle = content;
          console.log('[Pulse] twitter:title found:', twitterTitle);
        }

        if (
          (key === 'twitter:audio:artist_name') &&
          !artist
        ) {
          artist = content;
          console.log('[Pulse] artist found:', artist);
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
        console.log('[Pulse] <title> found:', titleTag);
      }

      if (currentTag === 'h1' && !h1) {
        h1 = value;
        console.log('[Pulse] <h1> found:', h1);
      }
    },

    onclosetag(tag) {
      if (tag === currentTag) {
        currentTag = null;
      }
    }
  });

  try {
    for await (const chunk of response.body) {
      chunkCount++;

      const text = decoder.decode(chunk, { stream: true });

      console.log(`[Pulse] Chunk #${chunkCount} size=${text.length}`);

      parser.write(text);

      if (chunkCount > 50) {
        console.log('[Pulse] Too many chunks, aborting safety stop');
        controller.abort();
        break;
      }
    }
  } catch (e) {
    console.log('[Pulse] Stream error:', e);
    if (!(e instanceof Error && e.name === 'AbortError')) {
      throw e;
    }
  } finally {
    parser.end();
  }

  console.log('[Pulse] Parsed values:', {
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