import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Parser } from 'htmlparser2';

type MusicMeta = {
  name: string | null;
  artist: string | null;
};

type ApiResponse =
  | MusicMeta
  | {
      error: string;
    };

const HEADERS = {
  'user-agent': 'Mozilla/5.0',
  accept: 'text/html,application/xhtml+xml'
};

const FETCH_TIMEOUT = 4000;

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  const url = getQueryParam(req, 'url');

  if (!url) {
    return res.status(400).json({
      error: 'Missing url query parameter'
    });
  }

  try {
    const meta = await getMusicMeta(url);

    return res.status(200).json(meta);
  } catch (error) {
    return res.status(500).json({
      error: getErrorMessage(error)
    });
  }
}

async function getMusicMeta(url: string): Promise<MusicMeta> {
  const controller = new AbortController();

  const timeout = setTimeout(() => {
    controller.abort();
  }, FETCH_TIMEOUT);

  let response: Response;

  try {
    response = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: HEADERS
    });
  } catch (error) {
    clearTimeout(timeout);

    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('Request timeout');
    }

    throw error;
  }

  clearTimeout(timeout);

  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`);
  }

  if (!response.body) {
    throw new Error('Empty response body');
  }

  let ogTitle: string | null = null;
  let twitterTitle: string | null = null;
  let titleTag: string | null = null;
  let h1: string | null = null;

  let artist: string | null = null;

  let currentTag: 'title' | 'h1' | null = null;

  const parser = new Parser(
    {
      onopentag(name, attrs) {
        if (ogTitle && artist) {
          controller.abort();
          return;
        }

        if (name === 'meta') {
          const key = (attrs.property || attrs.name || '').trim().toLowerCase();

          const content = attrs.content?.trim();

          if (!key || !content) {
            return;
          }

          if (key === 'og:title' && !ogTitle) {
            ogTitle = content;
            return;
          }

          if (key === 'twitter:title' && !twitterTitle) {
            twitterTitle = content;
            return;
          }

          if (key === 'twitter:audio:artist_name' && !artist) {
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
        if (!currentTag) {
          return;
        }

        const value = text.trim();

        if (!value) {
          return;
        }

        if (currentTag === 'title' && !titleTag) {
          titleTag = value;
          return;
        }

        if (currentTag === 'h1' && !h1) {
          h1 = value;
        }
      },

      onclosetag(tagname) {
        if (tagname === currentTag) {
          currentTag = null;
        }
      }
    },
    {
      decodeEntities: false
    }
  );

  try {
    for await (const chunk of response.body as AsyncIterable<string | Buffer>) {
      parser.write(chunk.toString());
    }
  } catch (error) {
    if (!(error instanceof Error && error.name === 'AbortError')) {
      throw error;
    }
  } finally {
    parser.end();
  }

  return {
    name: ogTitle || twitterTitle || titleTag || h1,
    artist
  };
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return 'Unknown error';
}

function getQueryParam(req: VercelRequest, key: string): string | null {
  if (!req.url) {
    return null;
  }

  const base = `http://${req.headers.host || 'localhost'}`;
  const parsedUrl = new URL(req.url, base);
  const value = parsedUrl.searchParams.get(key);

  return value?.trim() || null;
}
