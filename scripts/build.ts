import { cp, mkdir, rm } from 'node:fs/promises';
import { marked } from 'marked';

const OUT = 'public';

const readme = await Bun.file('README.md').text();
const body = await marked.parse(readme);

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Hop</title>
<meta name="description" content="Share a song from Spotify, Apple Music, Deezer or Tidal, and open it on any of the others.">
<style>
  :root {
    color-scheme: light dark;
    --bg: #ffffff;
    --fg: #1f2328;
    --muted: #59636e;
    --border: #d1d9e0;
    --code-bg: #f6f8fa;
    --link: #0969da;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #0d1117;
      --fg: #f0f6fc;
      --muted: #9198a1;
      --border: #3d444d;
      --code-bg: #151b23;
      --link: #4493f8;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: var(--bg);
    color: var(--fg);
    font: 16px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
  }
  main { max-width: 720px; margin: 0 auto; padding: 48px 16px 64px; }
  h1 { margin: 0 0 32px; text-align: center; }
  h1 img { max-width: 100%; height: auto; }
  h2 { margin-top: 40px; padding-bottom: 6px; border-bottom: 1px solid var(--border); font-size: 1.4em; }
  a { color: var(--link); }
  code { font: 0.875em ui-monospace, SFMono-Regular, Menlo, monospace; }
  :not(pre) > code { padding: 0.2em 0.4em; border-radius: 6px; background: var(--code-bg); }
  pre { overflow-x: auto; padding: 16px; border-radius: 6px; background: var(--code-bg); }
  footer { margin-top: 48px; color: var(--muted); font-size: 0.875em; text-align: center; }
</style>
</head>
<body>
<main>
${body}
<footer><a href="https://github.com/jorisre/hop">github.com/jorisre/hop</a></footer>
</main>
</body>
</html>
`;

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });
await Bun.write(`${OUT}/index.html`, html);
await cp('assets', `${OUT}/assets`, { recursive: true });

console.log(`Built ${OUT}/index.html`);
