#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');
const assert = require('assert');

const ROOT = path.resolve(__dirname, '..');
const NEWS_JSON_PATH = path.join(ROOT, 'js', 'news.json');
const SOURCES_PATH = path.join(ROOT, 'ai', 'sources.json');
const PROMPT_SUMMARIZE_PATH = path.join(ROOT, 'prompts', 'summarize-ro.md');
const PROMPT_SAFETY_PATH = path.join(ROOT, 'prompts', 'safety-check-ro.md');
const FEED_PATH = path.join(ROOT, 'feed.xml');
const SITEMAP_PATH = path.join(ROOT, 'sitemap.xml');

const SITE_URL = process.env.SITE_URL || 'https://objectivepinta.github.io/tldr/';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

function parseArgs(argv) {
  const flags = new Set(argv.filter((arg) => arg.startsWith('--')));
  const argMap = new Map();
  argv.forEach((arg) => {
    if (!arg.startsWith('--') || !arg.includes('=')) {
      return;
    }
    const [key, value] = arg.split('=');
    argMap.set(key, value);
  });

  return {
    dryRun: flags.has('--dry-run'),
    commit: flags.has('--commit'),
    selfTest: flags.has('--self-test'),
    maxItems: Number(argMap.get('--max-items') || 8),
  };
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, payload) {
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function htmlDecode(input) {
  return String(input || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractTag(block, tagName) {
  const regex = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'i');
  const match = block.match(regex);
  return match ? htmlDecode(match[1]) : '';
}

function normalizeUrl(input) {
  if (!input) {
    return '';
  }

  try {
    const parsed = new URL(input.trim());
    parsed.hash = '';
    return parsed.toString();
  } catch (error) {
    return input.trim();
  }
}

function slugify(input) {
  return String(input || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

function makeFingerprint(url, title) {
  return crypto.createHash('sha1').update(`${normalizeUrl(url)}|${String(title).toLowerCase()}`).digest('hex');
}

function inferCategory(text) {
  const value = text.toLowerCase();
  if (/(alegeri|parlament|guvern|presedinte|politic|minister)/.test(value)) {
    return 'politics';
  }
  if (/(accident|deces|mort|incendiu|cutremur|inundat|traged)/.test(value)) {
    return 'tragedy';
  }
  if (/(startup|ai|tehnolog|tech|software|telefon|chip|gadget|internet|5g)/.test(value)) {
    return 'tech';
  }
  return 'funny';
}

function fallbackSummarize(candidate) {
  const category = inferCategory(`${candidate.title} ${candidate.description}`);
  return {
    title: candidate.title.slice(0, 80),
    summary: `TLDR: ${candidate.description ? candidate.description.slice(0, 180) : candidate.title}`,
    whyItMatters: 'De ce conteaza: oferim context rapid si link direct catre sursa completa.',
    category,
    confidenceScore: 0.55,
    needsHumanReview: category === 'politics' || category === 'tragedy',
  };
}

async function callOpenAI(promptText) {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'Return JSON only.' },
        { role: 'user', content: promptText },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI error ${response.status}`);
  }

  const payload = await response.json();
  const content = payload.choices?.[0]?.message?.content || '{}';
  return JSON.parse(content);
}

async function summarizeCandidate(candidate, summarizePrompt, safetyPrompt) {
  const fallback = fallbackSummarize(candidate);
  if (!OPENAI_API_KEY) {
    return {
      ...fallback,
      legalRisk: fallback.needsHumanReview ? 'medium' : 'low',
      safetyReason: 'Fallback mode without OPENAI_API_KEY',
      generatedBy: 'fallback-heuristic',
    };
  }

  try {
    const editorial = await callOpenAI(
      `${summarizePrompt}\n\nSOURCE TITLE: ${candidate.title}\nSOURCE URL: ${candidate.url}\nSOURCE NAME: ${candidate.sourceName}\nSOURCE EXCERPT: ${candidate.description}`,
    );

    const safety = await callOpenAI(
      `${safetyPrompt}\n\nTITLE: ${editorial.title || fallback.title}\nSUMMARY: ${editorial.summary || fallback.summary}\nSOURCE URL: ${candidate.url}`,
    );

    const category = ['funny', 'tragedy', 'politics', 'tech'].includes(editorial.category)
      ? editorial.category
      : fallback.category;

    return {
      title: String(editorial.title || fallback.title).slice(0, 80),
      summary: String(editorial.summary || fallback.summary).slice(0, 240),
      whyItMatters: String(editorial.whyItMatters || fallback.whyItMatters).slice(0, 180),
      category,
      confidenceScore: Math.max(0, Math.min(1, Number(editorial.confidenceScore ?? fallback.confidenceScore))),
      needsHumanReview: Boolean(editorial.needsHumanReview) || category === 'politics' || category === 'tragedy',
      legalRisk: ['low', 'medium', 'high'].includes(safety.legalRisk) ? safety.legalRisk : 'medium',
      safetyReason: String(safety.reason || 'Safety validation completed').slice(0, 180),
      generatedBy: OPENAI_MODEL,
    };
  } catch (error) {
    return {
      ...fallback,
      legalRisk: fallback.needsHumanReview ? 'medium' : 'low',
      safetyReason: `Fallback after AI error: ${error.message}`,
      generatedBy: 'fallback-heuristic',
    };
  }
}

async function fetchRssFeed(source) {
  const response = await fetch(source.url, {
    headers: { 'User-Agent': 'TLDRBot/1.0 (+https://objectivepinta.github.io/tldr/)' },
  });

  if (!response.ok) {
    throw new Error(`RSS fetch failed for ${source.name}: ${response.status}`);
  }

  const xml = await response.text();
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].map((match) => match[1]);

  return items.slice(0, 20).map((block) => ({
    sourceType: 'rss',
    sourceName: source.name,
    title: extractTag(block, 'title'),
    url: normalizeUrl(extractTag(block, 'link')),
    publishedAt: extractTag(block, 'pubDate') || new Date().toISOString(),
    description: extractTag(block, 'description') || extractTag(block, 'content:encoded'),
  }));
}

async function fetchRedditFeed(source) {
  const response = await fetch(source.url, {
    headers: { 'User-Agent': 'TLDRBot/1.0 (+https://objectivepinta.github.io/tldr/)' },
  });

  if (!response.ok) {
    throw new Error(`Reddit fetch failed for ${source.name}: ${response.status}`);
  }

  const payload = await response.json();
  const children = payload?.data?.children || [];

  return children.slice(0, 20).map((node) => {
    const post = node.data || {};
    return {
      sourceType: 'reddit',
      sourceName: source.name,
      title: htmlDecode(post.title || ''),
      url: normalizeUrl(post.url_overridden_by_dest || post.url || ''),
      publishedAt: post.created_utc ? new Date(post.created_utc * 1000).toISOString() : new Date().toISOString(),
      description: htmlDecode(post.selftext || post.title || ''),
    };
  });
}

function isValidCandidate(candidate) {
  return Boolean(candidate.title && candidate.url && candidate.url.startsWith('http'));
}

function buildNewsItem(candidate, summaryData, existingNews) {
  const now = new Date();
  const day = now.toISOString().slice(0, 10);
  const baseSlug = slugify(summaryData.title || candidate.title) || 'stire';
  const counter = String(existingNews.length + 1).padStart(3, '0');

  return {
    id: `${day}-${counter}-${baseSlug.slice(0, 18)}`,
    category: summaryData.category,
    title: summaryData.title,
    summary: summaryData.summary.startsWith('TLDR:') ? summaryData.summary : `TLDR: ${summaryData.summary}`,
    whyItMatters: summaryData.whyItMatters.startsWith('De ce conteaza:')
      ? summaryData.whyItMatters
      : `De ce conteaza: ${summaryData.whyItMatters}`,
    image: 'icon.png',
    imageAlt: summaryData.title,
    sourceName: candidate.sourceName,
    sourceUrl: candidate.url,
    publishedAt: new Date(candidate.publishedAt).toISOString(),
    isPick: summaryData.confidenceScore >= 0.82 && !summaryData.needsHumanReview,
    origin: candidate.sourceType,
    fingerprint: makeFingerprint(candidate.url, candidate.title),
    confidenceScore: Number(summaryData.confidenceScore.toFixed(2)),
    needsHumanReview: summaryData.needsHumanReview,
    legalRisk: summaryData.legalRisk,
    safetyReason: summaryData.safetyReason,
    generatedBy: summaryData.generatedBy,
    generatedAt: new Date().toISOString(),
  };
}

function dedupeNews(newsItems) {
  const seen = new Set();
  const deduped = [];

  newsItems.forEach((item) => {
    const key = item.fingerprint || makeFingerprint(item.sourceUrl, item.title);
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    deduped.push({ ...item, fingerprint: key });
  });

  return deduped.sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());
}

function escapeXml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function toRssDate(iso) {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? new Date().toUTCString() : date.toUTCString();
}

function regenerateFeed(newsItems) {
  const top = newsItems.slice(0, 30);
  const itemsXml = top
    .map(
      (item) => `    <item>\n      <title>${escapeXml(item.title)}</title>\n      <link>${escapeXml(item.sourceUrl)}</link>\n      <category>${escapeXml(item.category)}</category>\n      <pubDate>${escapeXml(toRssDate(item.publishedAt))}</pubDate>\n      <description><![CDATA[${item.summary} ${item.whyItMatters}]]></description>\n      <media:content url="${escapeXml(`${SITE_URL.replace(/\/$/, '')}/icon.png`)}" medium="image" />\n      <source url="${escapeXml(item.sourceUrl)}">${escapeXml(item.sourceName)}</source>\n    </item>`,
    )
    .join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:media="http://search.yahoo.com/mrss/">\n  <channel>\n    <title>Prea Lung! N-am citit! stiri scurte</title>\n    <link>${escapeXml(SITE_URL)}</link>\n    <description>Stiri scurte in romana: esentialul zilei in 20-40 de secunde, cu link direct catre articolul complet.</description>\n    <language>ro</language>\n    <lastBuildDate>${escapeXml(new Date().toUTCString())}</lastBuildDate>\n    <image>\n      <url>${escapeXml(`${SITE_URL.replace(/\/$/, '')}/icon.png`)}</url>\n      <title>Prea Lung! N-am citit! stiri scurte</title>\n      <link>${escapeXml(SITE_URL)}</link>\n    </image>\n${itemsXml}\n  </channel>\n</rss>\n`;

  fs.writeFileSync(FEED_PATH, xml, 'utf8');
}

function regenerateSitemap() {
  const base = SITE_URL.endsWith('/') ? SITE_URL : `${SITE_URL}/`;
  const urls = [base, `${base}#picks`, `${base}#amuzante`, `${base}#tragedii`, `${base}#politica`, `${base}#tech`];
  const today = new Date().toISOString().slice(0, 10);
  const blocks = urls
    .map(
      (url, index) => `  <url>\n    <loc>${escapeXml(url)}</loc>\n    <lastmod>${today}</lastmod>\n    <changefreq>daily</changefreq>\n    <priority>${index === 0 ? '1.0' : '0.8'}</priority>\n  </url>`,
    )
    .join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${blocks}\n</urlset>\n`;
  fs.writeFileSync(SITEMAP_PATH, xml, 'utf8');
}

function runSelfTest() {
  const fp1 = makeFingerprint('https://a.com/item', 'Test');
  const fp2 = makeFingerprint('https://a.com/item#x', 'Test');
  assert.strictEqual(fp1, fp2);
  assert.strictEqual(inferCategory('Guvern si parlament discutie'), 'politics');
  assert.strictEqual(inferCategory('Noutati AI si startup'), 'tech');
  assert.strictEqual(inferCategory('Accident grav pe autostrada'), 'tragedy');
  assert.ok(slugify('Știre Nouă!').startsWith('stire-noua'));
  console.log('Self-test passed.');
}

async function collectCandidates(sourceConfig) {
  const all = [];

  for (const source of sourceConfig.rss || []) {
    try {
      const items = await fetchRssFeed(source);
      all.push(...items);
    } catch (error) {
      console.warn(`[WARN] ${error.message}`);
    }
  }

  for (const source of sourceConfig.reddit || []) {
    try {
      const items = await fetchRedditFeed(source);
      all.push(...items);
    } catch (error) {
      console.warn(`[WARN] ${error.message}`);
    }
  }

  return all.filter(isValidCandidate);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.selfTest) {
    runSelfTest();
    return;
  }

  const summarizePrompt = fs.readFileSync(PROMPT_SUMMARIZE_PATH, 'utf8');
  const safetyPrompt = fs.readFileSync(PROMPT_SAFETY_PATH, 'utf8');
  const sourceConfig = readJson(SOURCES_PATH);
  const existingNews = readJson(NEWS_JSON_PATH);

  const existingFingerprints = new Set(existingNews.map((item) => item.fingerprint || makeFingerprint(item.sourceUrl, item.title)));
  const candidates = await collectCandidates(sourceConfig);

  const freshCandidates = candidates.filter((candidate) => !existingFingerprints.has(makeFingerprint(candidate.url, candidate.title)));
  const limited = freshCandidates.slice(0, Math.max(1, options.maxItems));

  const generatedNews = [];
  for (const candidate of limited) {
    const summaryData = await summarizeCandidate(candidate, summarizePrompt, safetyPrompt);
    const canAutoPublish = summaryData.legalRisk !== 'high' && (summaryData.confidenceScore >= 0.72 || summaryData.needsHumanReview);
    if (!canAutoPublish) {
      continue;
    }

    const newsItem = buildNewsItem(candidate, summaryData, [...existingNews, ...generatedNews]);
    generatedNews.push(newsItem);
  }

  if (!generatedNews.length) {
    console.log('No new news items generated.');
    return;
  }

  const merged = dedupeNews([...generatedNews, ...existingNews]).slice(0, 180);

  if (options.dryRun) {
    console.log(`Dry run: ${generatedNews.length} news items generated.`);
    console.log(generatedNews.map((item) => `- ${item.title} [${item.category}]`).join('\n'));
    return;
  }

  writeJson(NEWS_JSON_PATH, merged);
  regenerateFeed(merged);
  regenerateSitemap();

  console.log(`Generated ${generatedNews.length} news items and updated news/feed/sitemap.`);

  if (options.commit) {
    execSync('git add js/news.json feed.xml sitemap.xml', { stdio: 'inherit', cwd: ROOT });
    execSync('git commit -m "Auto-publish news pipeline update"', { stdio: 'inherit', cwd: ROOT });
    execSync('git push origin main', { stdio: 'inherit', cwd: ROOT });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

