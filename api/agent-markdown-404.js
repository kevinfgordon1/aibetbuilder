'use strict';
// Markdown 404 for Accept: text/markdown on unknown paths. HTML 404s stay on
// Vercel's default. Body is the same text as public/md/404.md.
const BODY = "# Page not found\n\nThat path is not a page on aibetbuilder. It may be mistyped, or the page may have moved.\n\n- [Home](https://www.aibetbuilder.io/)\n- [llms.txt](https://www.aibetbuilder.io/llms.txt)\n- [Support](https://www.aibetbuilder.io/support)\n";

module.exports = function handler(_req, res) {
  res.statusCode = 404;
  res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
  res.setHeader('Vary', 'Accept');
  res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
  res.end(BODY);
};
