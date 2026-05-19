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

  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'Missing url' });
  }

  try {
    const meta = await getMusicMeta(url);
    return res.status(200).json(meta);
  } catch (e) {
    return res.status(500).json({
      error: e instanceof Error ? e.message : 'Unknown error'
    });
  }
}

async function getMusicMeta(url: string): Promise<MusicMeta> {
  const controller = new AbortController();

  const timeout = setTimeout(() => controller.abort(), TIMEOUT);

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

  let currentTag: 'title' | 'h1' | null = null;

  const decoder = new TextDecoder('utf-8');

  const parser = new Parser({
    onopentag(name, attrs) {
      // FAST EXIT (safe)
      if (ogTitle && artist) {
        controller.abort();
        return;
      }

      if (name === 'meta') {
        const key = (attrs.property || attrs.name || '').trim().toLowerCase();
        const content = attrs.content?.trim();

        if (!key || !content) return;

        if (key === 'og:title' && !ogTitle) {
          ogTitle = content;
          return;
        }

        if (key === 'twitter:title' && !twitterTitle) {
          twitterTitle = content;
          return;
        }

        // realistic music fields
        if (
          (key === 'music:musician' ||
            key === 'music:artist' ||
            key === 'og:audio:artist' ||
            key === 'twitter:audio:artist_name') &&
          !artist
        ) {
          artist = content;
        }

        return;
      }

      if (name === 'title' && !titleTag) {
        currentTag = 'title';
        return;
      }

      if (name === 'h1' && !h1) {
        currentTag = 'h1';
      }
    },

    ontext(text) {
      if (!currentTag) return;

      const value = text.trim();
      if (!value) return;

      if (currentTag === 'title' && !titleTag) {
        titleTag = value;
        return;
      }

      if (currentTag === 'h1' && !h1) {
        h1 = value;
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
      parser.write(decoder.decode(chunk, { stream: true }));
    }
  } catch (e) {
    if (!(e instanceof Error && e.name === 'AbortError')) {
      throw e;
    }
  } finally {
    parser.end();
  }

  return {
    name: ogTitle || twitterTitle || titleTag || h1,
    artist
  };
}