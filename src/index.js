export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const pathname = url.pathname;

    // Enforce rate limiting using ratelimit binding
    const clientIP = request.headers.get("CF-Connecting-IP") || "unknown";

    // Updated: use documented ratelimit API
    const { success } = await env.whiodigital_site_ratelimit.limit({ key: clientIP });

    if (!success) {
      return new Response("Too Many Requests", { status: 429 });
    }

    if (pathname === '/utils/list-articles') {
      return handleListArticles(env);
    }

    return new Response('Not Found', { status: 404 });
  }
};

async function handleListArticles(env) {
  const owner = 'xyt6151';
  const repo = 'whio-digital-site';
  const branch = 'main';
  const githubToken = env.GITHUB_TOKEN; // optional

  const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/articles?ref=${branch}`;

  const headers = {
    'Accept': 'application/vnd.github.v3+json',
  };
  if (githubToken) {
    headers['Authorization'] = `token ${githubToken}`;
  }

  try {
    const dirResp = await fetch(apiUrl, { headers });
    if (!dirResp.ok) {
      return new Response(`GitHub API error: ${dirResp.status}`, { status: 500 });
    }
    const files = await dirResp.json();

    const mdFiles = files.filter(f => f.name.endsWith('.md'));

    const articles = await Promise.all(mdFiles.map(async (file) => {
      try {
        const rawResp = await fetch(file.download_url);
        if (!rawResp.ok) throw new Error('Failed to fetch raw markdown');
        const rawText = await rawResp.text();

        // Extract YAML front matter
        const match = /^---\s*([\s\S]*?)\s*---/.exec(rawText);
        let meta = {};
        if (match) {
          try {
            meta = parseYAML(match[1]);
          } catch (e) {
            console.warn(`YAML parse error in ${file.name}:`, e);
          }
        }

        // Respect 'show' flag (default true)
        const show = meta.show !== 'false';

        return show ? {
          slug: file.name.replace(/\.md$/, ''),
          title: meta.title || file.name,
          description: meta.description || '',
          date: meta.date || '',
          url: file.download_url,
        } : null;
      } catch (e) {
        console.warn(`Error processing ${file.name}:`, e);
        return null;
      }
    }));

    const filtered = articles.filter(Boolean);

    filtered.sort((a, b) => new Date(b.date) - new Date(a.date));

    return new Response(JSON.stringify(filtered, null, 2), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(`Worker error: ${err.message}`, { status: 500 });
  }
}

// Minimal YAML parser (safe, no deps)
function parseYAML(yamlText) {
  const lines = yamlText.split('\n');
  const result = {};
  for (const line of lines) {
    const match = /^(\w+):\s*(.*)$/.exec(line);
    if (match) {
      const key = match[1].trim();
      let value = match[2].trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      result[key] = value;
    }
  }
  return result;
} 