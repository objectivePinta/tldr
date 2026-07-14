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
const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'qwen2.5:3b-instruct';
const DEFAULT_BLOCKED_PATTERNS = ['[p]', 'sponsorizat', 'publicitate', 'advertorial', 'parteneriat', 'promo'];
const BOT_USER_AGENT = 'TLDRBot/1.0 (+https://objectivepinta.github.io/tldr/)';
const AI_PROVIDER = 'ollama';
const REQUIRE_OPENAI_SUMMARY = true;
const OPENAI_MAX_RETRIES = 3;
const OPENAI_RETRY_BASE_MS = 1200;
const TITLE_MAX_CHARS = 80;
const SUMMARY_MAX_CHARS = 255;
const DIGEST_MAX_SOURCES = 8;
const SUPPORTED_CATEGORIES = ['funny', 'tragedy', 'politics', 'tech', 'sports', 'weather', 'health', 'business', 'science', 'culture'];
const BRAND_LOGO_ASSET = 'img.png';
const SENSITIVE_CATEGORIES = ['politics', 'tragedy', 'health'];

function parseCsvEnv(value) {
  return String(value || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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
    maxItems: Number(argMap.get('--max-items') || 100),
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

function normalizeUrlWithBase(input, baseUrl) {
  if (!input) {
    return '';
  }

  try {
    const parsed = baseUrl ? new URL(input.trim(), baseUrl) : new URL(input.trim());
    parsed.hash = '';
    return parsed.toString();
  } catch (error) {
    return String(input).trim();
  }
}

function extractFirstImageUrl(rawText, baseUrl) {
  const text = String(rawText || '');
  const candidates = [
    /<media:content[^>]*\burl=["']([^"']+)["'][^>]*>/i,
    /<enclosure[^>]*\burl=["']([^"']+)["'][^>]*>/i,
    /<meta[^>]+(?:property|name)=["']og:image(?::secure_url)?["'][^>]*\bcontent=["']([^"']+)["'][^>]*>/i,
    /<meta[^>]+\bcontent=["']([^"']+)["'][^>]*(?:property|name)=["']og:image(?::secure_url)?["'][^>]*>/i,
    /<meta[^>]+(?:property|name)=["']twitter:image(?::src)?["'][^>]*\bcontent=["']([^"']+)["'][^>]*>/i,
    /<meta[^>]+\bcontent=["']([^"']+)["'][^>]*(?:property|name)=["']twitter:image(?::src)?["'][^>]*>/i,
    /<img[^>]*\bsrc=["']([^"']+)["'][^>]*>/i,
  ];

  for (const pattern of candidates) {
    const match = text.match(pattern);
    if (!match || !match[1]) {
      continue;
    }

    const url = normalizeUrlWithBase(match[1], baseUrl);
    if (url.startsWith('http')) {
      return url;
    }
  }

  return '';
}

async function fetchArticleImage(candidateUrl) {
  if (!candidateUrl || !candidateUrl.startsWith('http')) {
    return '';
  }

  try {
    const response = await fetch(candidateUrl, {
      headers: { 'User-Agent': BOT_USER_AGENT },
    });

    if (!response.ok) {
      return '';
    }

    const contentType = String(response.headers.get('content-type') || '').toLowerCase();
    if (contentType && !contentType.includes('text/html') && !contentType.includes('application/xhtml+xml')) {
      return '';
    }

    const html = await response.text();
    return extractFirstImageUrl(html, response.url || candidateUrl);
  } catch (error) {
    return '';
  }
}

function normalizeSubredditName(input) {
  return String(input || '')
    .trim()
    .replace(/^https?:\/\/www\.reddit\.com\//i, '')
    .replace(/^r\//i, '')
    .replace(/^\/?r\//i, '')
    .replace(/^\/+|\/+$/g, '')
    .replace(/\.rss$/i, '');
}

function buildRedditRssSource(subredditName) {
  const normalized = normalizeSubredditName(subredditName);
  if (!normalized) {
    return null;
  }

  return {
    name: `Reddit r/${normalized} (RSS)`,
    url: `https://www.reddit.com/r/${normalized}/.rss`,
  };
}

function getHostname(input) {
  try {
    return new URL(normalizeUrl(input)).hostname.toLowerCase();
  } catch (error) {
    return '';
  }
}

function matchesDomainRule(hostname, domainRule) {
  const normalizedRule = String(domainRule || '').toLowerCase().trim();
  if (!hostname || !normalizedRule) {
    return false;
  }

  return hostname === normalizedRule || hostname.endsWith(`.${normalizedRule}`);
}

function getFilteringRules(sourceConfig) {
  const configuredDomains = parseCsvEnv(process.env.ALLOWED_DOMAINS).length
    ? parseCsvEnv(process.env.ALLOWED_DOMAINS)
    : (sourceConfig.allowedDomains || []);

  const configuredPatterns = parseCsvEnv(process.env.BLOCKED_PATTERNS).length
    ? parseCsvEnv(process.env.BLOCKED_PATTERNS)
    : (sourceConfig.blockedPatterns || DEFAULT_BLOCKED_PATTERNS);

  return {
    allowedDomains: configuredDomains.map((entry) => entry.toLowerCase()),
    blockedPatterns: configuredPatterns.map((entry) => entry.toLowerCase()),
  };
}

function getConfiguredSubreddits(sourceConfig) {
  const envSubreddits = parseCsvEnv(process.env.REDDIT_SUBREDDITS);
  const configured = envSubreddits.length ? envSubreddits : (sourceConfig.subreddits || []);

  return [...new Set(configured.map(normalizeSubredditName).filter(Boolean))];
}

function normalizeSourceConfig(sourceConfig) {
  const subreddits = getConfiguredSubreddits(sourceConfig);
  const redditRssSources = subreddits
    .map(buildRedditRssSource)
    .filter(Boolean);

  return {
    rss: [...(sourceConfig.rss || []), ...redditRssSources],
    reddit: sourceConfig.reddit || [],
    subreddits,
  };
}

function isAdvertorialCandidate(candidate, blockedPatterns) {
  const haystack = `${candidate.title} ${candidate.description} ${candidate.sourceName}`.toLowerCase();
  return blockedPatterns.some((pattern) => haystack.includes(String(pattern).toLowerCase()));
}

function isAllowedDomain(url, allowedDomains) {
  if (!allowedDomains.length) {
    return true;
  }

  const hostname = getHostname(url);
  return allowedDomains.some((domainRule) => matchesDomainRule(hostname, domainRule));
}

function filterCandidates(candidates, filteringRules) {
  const accepted = [];
  const skipped = [];

  candidates.forEach((candidate) => {
    if (isAdvertorialCandidate(candidate, filteringRules.blockedPatterns)) {
      skipped.push({ candidate, reason: 'blocked-pattern' });
      return;
    }

    if (!isAllowedDomain(candidate.url, filteringRules.allowedDomains)) {
      skipped.push({ candidate, reason: 'domain-not-allowlisted' });
      return;
    }

    accepted.push(candidate);
  });

  return { accepted, skipped };
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
  const value = normalizeTextFingerprint(text);
  if (/(\bmeteo\b|\bvremea\b|\bvijelie\b|\bfurtuna\b|\bploi torentiale\b|\baverse\b|\bcanicula\b|\bninsoare\b|\bcod galben\b|\bcod portocaliu\b|\bcod rosu\b|\banm\b)/.test(value)) {
    return 'weather';
  }
  if (/(\bstem\b|\bcercetare\b|\bdescoperire\b|\bstiinta\b|\bexperiment\b|\bnasa\b|\bspatiu\b|\bunivers\b|\bfizica\b|\bchimie\b|\bbiologie\b)/.test(value)) {
    return 'science';
  }
  if (/(\bfotbal\b|\btenis\b|\bfifa\b|\buefa\b|\bgol\b|\bcampionat\b|\bliga\b|\bmeci\b|\bcupa mondiala\b|\bolimpiad\w*\b|\bsport\b)/.test(value)) {
    return 'sports';
  }
  if (/(\bspital\b|\bmedic\w*\b|\bsanatate\b|\bboala\b|\bepidemie\b|\bvirus\b|\bvaccin\b|\bebola\b|\bcovid\b|\btratament\b)/.test(value)) {
    return 'health';
  }
  if (/(\bbursa\b|\beconomie\b|\binflatie\b|\bcompanie\b|\bafaceri\b|\bbusiness\b|\binvestitie\b|\bifn\b|\bbanci\b|\blei\b|\beuro\b|\bpiata\b|\bprofit\b|\bfaliment\b|\brating\b|\bfinant\w*\b)/.test(value)) {
    return 'business';
  }
  if (/(\bcultura\b|\bteatru\b|\bfilm\b|\bfestival\b|\bcarte\b|\bmuzeu\b|\barta\b|\bconcert\b|\bopera\b|\bexpozitie\b|\bpoezie\b|\bidentitate vizuala\b|\btotemuri\b|\bsimboluri\b|\bliceu\b|\bscoala\b|\beducatie\b|\belev\b|\blifestyle\b|\bretete\b|\baliment\w*\b|\bingredient\w*\b)/.test(value)) {
    return 'culture';
  }
  if (/(\balegeri\b|\bparlament\b|\bguvern\b|\bpresedinte\b|\bpolitic\w*\b|\bminister\b|\bpartid\b|\bcoalitie\b|\bsenat\b|\bdeputat\b|\bprimar\b|\bconstitutie\b|\blege\b|\bzelenski\b|\bmacron\b|\btrump\b|\bnato\b|\buniunea europeana\b)/.test(value)) {
    return 'politics';
  }
  if (/(\baccident\b|\bdeces\b|\bmort\b|\bincend\w*\b|\bcutremur\b|\binundat\w*\b|\btraged\w*\b|\bimpuscat\w*\b|\bexplozie\b|\bvictime\b|\braniti\b|\bgroaza\b|\bpompier\w*\b)/.test(value)) {
    return 'tragedy';
  }
  if (/(\bstartup\b|\bai\b|\btehnolog\w*\b|\btech\b|\bsoftware\b|\btelefon\b|\bchip\b|\bgadget\b|\binternet\b|\b5g\b|\bmicrosoft\b|\bapple\b|\bgoogle\b|\bopenai\b|\bnvidia\b|\bdatacenter\b|\bgoogle maps\b)/.test(value)) {
    return 'tech';
  }
  return 'funny';
}

function decideCategory(candidate) {
  const content = normalizeTextFingerprint(`${candidate.title} ${candidate.description}`);
  const sourceName = normalizeTextFingerprint(candidate.sourceName || '');
  const sourceUrl = normalizeTextFingerprint(candidate.sourceUrl || candidate.url || '');

  if (/(\bmeteo\b)/.test(sourceUrl) || /(\banm\b|\bcod galben\b|\bcod portocaliu\b|\bcod rosu\b|\bcanicula\b|\bvijelie\b|\bfurtuna\b|\baverse\b)/.test(content)) {
    return 'weather';
  }

  if (/(\bstem\b|\bcercetare\b|\bdescoperire\b|\bstiinta\b|\bexperiment\b|\bnasa\b|\bspatiu\b|\bunivers\b|\bfizica\b|\bchimie\b|\bbiologie\b)/.test(content)) {
    return 'science';
  }

  if (/(\bsport\b|\bfotbal\b|\btenis\b|\bcampionat\b|\bfifa\b|\buefa\b|\bolimpiad\w*\b|\bmeci\b|\bliga\b)/.test(sourceUrl) || /(\bsport\b|\bfotbal\b|\btenis\b|\bcampionat\b|\bfifa\b|\buefa\b|\bolimpiad\w*\b|\bmeci\b|\bliga\b|\bgol\b|\bsemifinala\b)/.test(content)) {
    return 'sports';
  }

  if (/(\beconomie\b|\beconomic\b|\bbusiness\b|\bbani\b|\bfinante\b)/.test(sourceUrl) || /(\beconomie\b|\binflatie\b|\bcompanie\b|\bafaceri\b|\bbusiness\b|\binvestitie\b|\bifn\b|\bbanci\b|\blei\b|\beuro\b|\bpiata\b|\bprofit\b|\bfaliment\b|\brating\b|\bagentiile de rating\b|\bfinant\w*\b)/.test(content)) {
    return 'business';
  }

  if (/(\baccident\b|\bdeces\b|\bmort\b|\bincend\w*\b|\bcutremur\b|\binundat\w*\b|\btraged\w*\b|\bimpuscat\w*\b|\bexplozie\b|\bvictime\b|\braniti\b|\bgroaza\b|\bpompier\w*\b)/.test(content)) {
    return 'tragedy';
  }

  if (/(\bpolitica\b)/.test(sourceUrl) || /(\bpolitica\b)/.test(sourceName) || /(\balegeri\b|\bparlament\b|\bguvern\b|\bpresedinte\b|\bpolitic\w*\b|\bminister\b|\bpartid\b|\bcoalitie\b|\bsenat\b|\bdeputat\b|\bprimar\b|\bconstitutie\b|\blege\b|\bzelenski\b|\bmacron\b|\btrump\b|\bnato\b|\barmistitiu\b|\bhouthi\b|\barabiei saudite\b|\borientul mijlociu\b|\brazboi\b|\bconflict\b)/.test(content)) {
    return 'politics';
  }

  if (/(\bsanatate\b|\bhealth\b)/.test(sourceUrl) || /(\bspital\b|\bmedic\w*\b|\bsanatate\b|\bboala\b|\bepidemie\b|\bvirus\b|\bvaccin\b|\bebola\b|\bcovid\b|\btratament\b)/.test(content)) {
    return 'health';
  }

  if (/(\bcultura\b|\blifestyle\b)/.test(sourceUrl) || /(\bcultura\b|\bteatru\b|\bfilm\b|\bfestival\b|\bcarte\b|\bmuzeu\b|\barta\b|\bconcert\b|\bopera\b|\bexpozitie\b|\bpoezie\b|\bidentitate vizuala\b|\btotemuri\b|\bsimboluri\b|\bliceu\b|\bscoala\b|\beducatie\b|\belev\b|\bretete\b|\baliment\w*\b|\bingredient\w*\b|\btapioca\b)/.test(content)) {
    return 'culture';
  }

  return inferCategory(content);
}

function normalizeTextFingerprint(input) {
  return String(input || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function titleTokens(input) {
  const stopWords = new Set(['si', 'sau', 'din', 'despre', 'pentru', 'dupa', 'care', 'sunt', 'este', 'fost', 'intr', 'intrun', 'intr-o', 'un', 'una', 'unei', 'unei', 'la', 'de', 'cu', 'pe', 'in', 'anunta', 'anunt', 'video']);
  return normalizeTextFingerprint(input)
    .split(' ')
    .filter((token) => token.length > 2 && !stopWords.has(token));
}

function tokenOverlapScore(a, b) {
  const left = new Set(titleTokens(a));
  const right = new Set(titleTokens(b));
  if (!left.size || !right.size) {
    return 0;
  }

  let intersection = 0;
  left.forEach((token) => {
    if (right.has(token)) {
      intersection += 1;
    }
  });

  return intersection / Math.max(left.size, right.size);
}

function mergeSources(existingSources, additionalSources) {
  const byUrl = new Map();
  [...(existingSources || []), ...(additionalSources || [])].forEach((source) => {
    if (!source?.url) {
      return;
    }
    const url = normalizeUrl(source.url);
    if (!byUrl.has(url)) {
      byUrl.set(url, {
        name: source.name || source.sourceName || 'Sursa',
        url,
      });
    }
  });
  return Array.from(byUrl.values());
}

function toSourceList(item) {
  if (Array.isArray(item.sources) && item.sources.length) {
    return mergeSources(item.sources, []);
  }

  if (item.sourceUrl) {
    return [{ name: item.sourceName || 'Sursa', url: normalizeUrl(item.sourceUrl) }];
  }

  if (item.url) {
    return [{ name: item.sourceName || 'Sursa', url: normalizeUrl(item.url) }];
  }

  return [];
}

function areLikelySameStory(left, right) {
  const leftPrimaryUrl = left.sourceUrl || left.url || toSourceList(left)[0]?.url || '';
  const rightPrimaryUrl = right.sourceUrl || right.url || toSourceList(right)[0]?.url || '';
  if (leftPrimaryUrl && rightPrimaryUrl && normalizeUrl(leftPrimaryUrl) === normalizeUrl(rightPrimaryUrl)) {
    return true;
  }

  const leftCategory = left.category || decideCategory(left);
  const rightCategory = right.category || decideCategory(right);
  if (leftCategory !== rightCategory) {
    return false;
  }

  const leftTime = new Date(left.publishedAt).getTime();
  const rightTime = new Date(right.publishedAt).getTime();
  const withinWindow = Math.abs(leftTime - rightTime) <= 36 * 60 * 60 * 1000;
  if (!withinWindow) {
    return false;
  }

  const leftTitle = normalizeTextFingerprint(left.title);
  const rightTitle = normalizeTextFingerprint(right.title);
  if (!leftTitle || !rightTitle) {
    return false;
  }

  if (leftTitle === rightTitle || leftTitle.includes(rightTitle) || rightTitle.includes(leftTitle)) {
    return true;
  }

  return tokenOverlapScore(left.title, right.title) >= 0.5;
}

function fallbackSummarize(candidate) {
  const category = decideCategory(candidate);
  return {
    title: candidate.title.slice(0, TITLE_MAX_CHARS),
    summary: `TLDR: ${candidate.description ? candidate.description.slice(0, SUMMARY_MAX_CHARS - 6) : candidate.title}`,
    whyItMatters: 'De ce conteaza: oferim context rapid si link direct catre sursa completa.',
    category,
    confidenceScore: 0.55,
    needsHumanReview: SENSITIVE_CATEGORIES.includes(category),
  };
}

async function callOpenAI(promptText) {
  let lastError = null;

  for (let attempt = 1; attempt <= OPENAI_MAX_RETRIES; attempt += 1) {
    try {
      console.log(`    [OpenAI Attempt ${attempt}/${OPENAI_MAX_RETRIES}]`);
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
        console.log(`    [OpenAI Error] Status: ${response.status}`);
        const shouldRetry = response.status === 429 || response.status >= 500;
        if (shouldRetry && attempt < OPENAI_MAX_RETRIES) {
          console.log(`    [Retry] Waiting ${OPENAI_RETRY_BASE_MS * attempt}ms before retry...`);
          await sleep(OPENAI_RETRY_BASE_MS * attempt);
          continue;
        }
        throw new Error(`OpenAI error ${response.status}`);
      }

      const payload = await response.json();
      const content = payload.choices?.[0]?.message?.content || '{}';
      const parsed = JSON.parse(content);
      console.log(`    [OpenAI Success] Response received`);
      return parsed;
    } catch (error) {
      console.log(`    [OpenAI Exception] ${error.message}`);
      lastError = error;
      if (attempt < OPENAI_MAX_RETRIES) {
        console.log(`    [Retry] Waiting ${OPENAI_RETRY_BASE_MS * attempt}ms before retry...`);
        await sleep(OPENAI_RETRY_BASE_MS * attempt);
        continue;
      }
    }
  }

  throw lastError || new Error('OpenAI request failed');
}

async function callOllama(promptText) {
  let lastError = null;

  for (let attempt = 1; attempt <= OPENAI_MAX_RETRIES; attempt += 1) {
    try {
      console.log(`    [Ollama Attempt ${attempt}/${OPENAI_MAX_RETRIES}]`);
      const response = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: OLLAMA_MODEL,
          stream: false,
          format: 'json',
          options: { temperature: 0.2 },
          messages: [
            { role: 'system', content: 'Return JSON only.' },
            { role: 'user', content: promptText },
          ],
        }),
      });

      if (!response.ok) {
        console.log(`    [Ollama Error] Status: ${response.status}`);
        const shouldRetry = response.status === 429 || response.status >= 500;
        if (shouldRetry && attempt < OPENAI_MAX_RETRIES) {
          console.log(`    [Retry] Waiting ${OPENAI_RETRY_BASE_MS * attempt}ms before retry...`);
          await sleep(OPENAI_RETRY_BASE_MS * attempt);
          continue;
        }
        throw new Error(`Ollama error ${response.status}`);
      }

      const payload = await response.json();
      const content = payload.message?.content || '{}';
      const parsed = JSON.parse(content);
      console.log('    [Ollama Success] Response received');
      return parsed;
    } catch (error) {
      console.log(`    [Ollama Exception] ${error.message}`);
      lastError = error;
      if (attempt < OPENAI_MAX_RETRIES) {
        console.log(`    [Retry] Waiting ${OPENAI_RETRY_BASE_MS * attempt}ms before retry...`);
        await sleep(OPENAI_RETRY_BASE_MS * attempt);
        continue;
      }
    }
  }

  throw lastError || new Error('Ollama request failed');
}

async function callLLM(promptText) {
  if (AI_PROVIDER === 'ollama') {
    return callOllama(promptText);
  }

  return callOpenAI(promptText);
}

async function checkOllamaAvailability() {
  try {
    const response = await fetch(`${OLLAMA_BASE_URL}/api/tags`, {
      headers: { 'Content-Type': 'application/json' },
    });
    return response.ok;
  } catch (error) {
    return false;
  }
}

async function summarizeCandidate(candidate, summarizePrompt, safetyPrompt) {
  const fallback = fallbackSummarize(candidate);
  if (AI_PROVIDER === 'openai' && !OPENAI_API_KEY) {
    return {
      ...fallback,
      legalRisk: fallback.needsHumanReview ? 'medium' : 'low',
      safetyReason: 'Fallback mode without OPENAI_API_KEY',
      generatedBy: 'fallback-heuristic',
      usedFallback: true,
    };
  }

  try {
    const editorial = await callLLM(
      `${summarizePrompt}\n\nSOURCE TITLE: ${candidate.title}\nSOURCE URL: ${candidate.url}\nSOURCE NAME: ${candidate.sourceName}\nSOURCE EXCERPT: ${candidate.description}`,
    );

    const safety = await callLLM(
      `${safetyPrompt}\n\nTITLE: ${editorial.title || fallback.title}\nSUMMARY: ${editorial.summary || fallback.summary}\nSOURCE URL: ${candidate.url}`,
    );

    const category = decideCategory(candidate);

    return {
      title: String(editorial.title || fallback.title).slice(0, TITLE_MAX_CHARS),
      summary: String(editorial.summary || fallback.summary).slice(0, SUMMARY_MAX_CHARS),
      whyItMatters: String(editorial.whyItMatters || fallback.whyItMatters).slice(0, 180),
      category,
      confidenceScore: Math.max(0, Math.min(1, Number(editorial.confidenceScore ?? fallback.confidenceScore))),
      needsHumanReview: Boolean(editorial.needsHumanReview) || SENSITIVE_CATEGORIES.includes(category),
      legalRisk: ['low', 'medium', 'high'].includes(safety.legalRisk) ? safety.legalRisk : 'medium',
      safetyReason: String(safety.reason || 'Safety validation completed').slice(0, 180),
      generatedBy: AI_PROVIDER === 'ollama' ? `ollama:${OLLAMA_MODEL}` : OPENAI_MODEL,
      usedFallback: false,
    };
  } catch (error) {
    return {
      ...fallback,
      legalRisk: fallback.needsHumanReview ? 'medium' : 'low',
      safetyReason: `Fallback after AI error: ${error.message}`,
      generatedBy: 'fallback-heuristic',
      usedFallback: true,
    };
  }
}

async function fetchRssFeed(source) {
  const response = await fetch(source.url, {
    headers: { 'User-Agent': BOT_USER_AGENT },
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
    image: extractFirstImageUrl(block, source.url),
  }));
}

async function fetchRedditFeed(source) {
  const response = await fetch(source.url, {
    headers: { 'User-Agent': BOT_USER_AGENT },
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
      image: normalizeUrl(post.preview?.images?.[0]?.source?.url || post.thumbnail || ''),
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
    image: candidate.image || BRAND_LOGO_ASSET,
    imageAlt: summaryData.title,
    sourceName: candidate.sourceName,
    sourceUrl: candidate.url,
    sources: mergeSources(toSourceList(candidate), []),
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
  const merged = [];

  newsItems.forEach((item) => {
    const existing = merged.find((candidate) => areLikelySameStory(candidate, item));
    if (!existing) {
      merged.push({
        ...item,
        fingerprint: item.fingerprint || makeFingerprint(item.sourceUrl, item.title),
        sources: mergeSources(toSourceList(item), []),
      });
      return;
    }

    existing.sources = mergeSources(existing.sources, toSourceList(item));
    if (new Date(item.publishedAt).getTime() > new Date(existing.publishedAt).getTime()) {
      existing.publishedAt = item.publishedAt;
    }
    if (item.confidenceScore > existing.confidenceScore) {
      existing.title = item.title;
      existing.summary = item.summary;
      existing.whyItMatters = item.whyItMatters;
      existing.image = item.image || existing.image;
      existing.imageAlt = item.imageAlt || existing.imageAlt;
      existing.category = item.category;
      existing.confidenceScore = item.confidenceScore;
      existing.needsHumanReview = item.needsHumanReview;
      existing.legalRisk = item.legalRisk;
      existing.safetyReason = item.safetyReason;
      existing.generatedBy = item.generatedBy;
      existing.generatedAt = item.generatedAt;
    }

    const primarySource = existing.sources[0] || { name: existing.sourceName, url: existing.sourceUrl };
    existing.sourceName = primarySource.name;
    existing.sourceUrl = primarySource.url;
  });

  return merged.sort((a, b) => {
    const aDigest = a.category === 'digest' ? 1 : 0;
    const bDigest = b.category === 'digest' ? 1 : 0;
    if (aDigest !== bDigest) {
      return bDigest - aDigest;
    }
    return new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime();
  });
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
      (item) => `    <item>\n      <title>${escapeXml(item.title)}</title>\n      <link>${escapeXml(item.sourceUrl)}</link>\n      <category>${escapeXml(item.category)}</category>\n      <pubDate>${escapeXml(toRssDate(item.publishedAt))}</pubDate>\n      <description><![CDATA[${item.summary} ${item.whyItMatters}]]></description>\n      <media:content url="${escapeXml(`${SITE_URL.replace(/\/$/, '')}/${BRAND_LOGO_ASSET}`)}" medium="image" />\n      <source url="${escapeXml(item.sourceUrl)}">${escapeXml(item.sourceName)}</source>\n    </item>`,
    )
    .join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:media="http://search.yahoo.com/mrss/">\n  <channel>\n    <title>Prea Lung! N-am citit! stiri scurte</title>\n    <link>${escapeXml(SITE_URL)}</link>\n    <description>Stiri scurte in romana: esentialul zilei in 20-40 de secunde, cu link direct catre articolul complet.</description>\n    <language>ro</language>\n    <lastBuildDate>${escapeXml(new Date().toUTCString())}</lastBuildDate>\n    <image>\n      <url>${escapeXml(`${SITE_URL.replace(/\/$/, '')}/${BRAND_LOGO_ASSET}`)}</url>\n      <title>Prea Lung! N-am citit! stiri scurte</title>\n      <link>${escapeXml(SITE_URL)}</link>\n    </image>\n${itemsXml}\n  </channel>\n</rss>\n`;

  fs.writeFileSync(FEED_PATH, xml, 'utf8');
}

function regenerateSitemap() {
  const base = SITE_URL.endsWith('/') ? SITE_URL : `${SITE_URL}/`;
  const urls = [base];
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
  assert.strictEqual(inferCategory('ANM anunta cod galben de vijelii si averse'), 'weather');
  assert.strictEqual(inferCategory('FIFA confirma semifinala Cupei Mondiale'), 'sports');
  assert.strictEqual(inferCategory('Medicii testeaza un nou vaccin in spital'), 'health');
  assert.strictEqual(inferCategory('Bancile si IFN-urile raporteaza profit si inflatie'), 'business');
  assert.strictEqual(inferCategory('Cercetare NASA despre spatiu si biologie'), 'science');
  assert.strictEqual(inferCategory('Festival de film si expozitie de arta contemporana'), 'culture');
  assert.ok(slugify('Știre Nouă!').startsWith('stire-noua'));
  assert.strictEqual(matchesDomainRule('news.hotnews.ro', 'hotnews.ro'), true);
  assert.strictEqual(matchesDomainRule('example.net', 'hotnews.ro'), false);
  assert.strictEqual(
    isAdvertorialCandidate(
      { title: '[P] Oferta speciala', description: 'publicitate', sourceName: 'Exemplu' },
      DEFAULT_BLOCKED_PATTERNS,
    ),
    true,
  );
  assert.strictEqual(isAllowedDomain('https://www.digi24.ro/stire', ['digi24.ro']), true);
  assert.strictEqual(isAllowedDomain('https://spam.example.org/post', ['digi24.ro']), false);
  assert.strictEqual(normalizeSubredditName('r/worldnews'), 'worldnews');
  assert.strictEqual(normalizeSubredditName('https://www.reddit.com/r/technology/'), 'technology');
  assert.strictEqual(buildRedditRssSource('technology').url, 'https://www.reddit.com/r/technology/.rss');
  assert.strictEqual(
    extractFirstImageUrl('<meta property="og:image" content="/img/hero.jpg" />', 'https://news.example.com/post'),
    'https://news.example.com/img/hero.jpg',
  );
  const fallback = fallbackSummarize({
    title: 'X'.repeat(140),
    description: 'Y'.repeat(500),
  });
  assert.ok(fallback.title.length <= TITLE_MAX_CHARS);
  assert.ok(fallback.summary.length <= SUMMARY_MAX_CHARS);
  assert.strictEqual(decideCategory({ title: 'ANM anunta cod galben de vijelii', description: '' }), 'weather');
  assert.strictEqual(decideCategory({ title: 'Daniel Daianu, inaintea discutiilor cu agentiile de rating', description: '' }), 'business');
  assert.strictEqual(decideCategory({ title: 'Armistitiu in Orientul Mijlociu', description: 'Houthi au lansat rachete asupra Arabiei Saudite' }), 'politics');
  assert.strictEqual(decideCategory({ title: 'Merita sa duci copilul la un liceu privat?', description: 'Parinti si elevi analizeaza oferta educationala' }), 'culture');
  assert.strictEqual(decideCategory({ title: 'Alex Rusu, trei medalii la Olimpiada Internationala STEM', description: '' }), 'science');
  assert.strictEqual(decideCategory({ title: 'Ce este faina de tapioca si in ce retete poate fi folosita', description: '' }), 'culture');
  assert.strictEqual(decideCategory({ title: 'Intrarile in judetul Timis vor avea o noua identitate vizuala', description: '' }), 'culture');
  assert.strictEqual(decideCategory({ title: 'Imagini de groaza din locuinta unde erau tinute 115 pisici', description: '' }), 'tragedy');
  const digestFallback = fallbackDigest([
    { title: 'A', summary: 'TLDR: Prima stire foarte scurta.' },
    { title: 'B', summary: 'TLDR: A doua stire foarte scurta.' },
  ]);
  assert.ok(digestFallback.title.length <= TITLE_MAX_CHARS);
  assert.ok(digestFallback.summary.length <= SUMMARY_MAX_CHARS);
  assert.ok(digestFallback.summary.startsWith('TLDR:'));
  const digestSources = buildDigestSources([
    { sourceName: 'Digi24', sourceUrl: 'https://www.digi24.ro/politica/articol-1' },
    { sourceName: 'Digi24', sourceUrl: 'https://www.digi24.ro/economie/articol-2' },
    { sourceName: 'HotNews', sourceUrl: 'https://hotnews.ro/stire-1' },
  ]);
  assert.strictEqual(digestSources.length, 2);
  assert.strictEqual(
    isSingleStoryDigest('TLDR: ANM emite cod galben de vijelii in Bucuresti.', [
      { title: 'ANM emite cod galben de vijelii in Bucuresti' },
      { title: 'Bursa inchide pe plus' },
    ]),
    true,
  );
  assert.strictEqual(
    areLikelySameStory(
      { title: 'ANM emite cod galben de vijelii in Bucuresti', description: '', publishedAt: '2026-07-14T08:00:00.000Z', category: 'weather', sourceUrl: 'https://a.ro/1' },
      { title: 'Meteorologii anunta cod galben de vijelii pentru Capitala', description: '', publishedAt: '2026-07-14T09:00:00.000Z', category: 'weather', sourceUrl: 'https://b.ro/2' },
    ),
    true,
  );
  console.log('Self-test passed.');
}

async function collectCandidates(sourceConfig) {
  const all = [];
  const normalizedSources = normalizeSourceConfig(sourceConfig);

  for (const source of normalizedSources.rss) {
    try {
      const items = await fetchRssFeed(source);
      all.push(...items);
    } catch (error) {
      console.warn(`[WARN] ${error.message}`);
    }
  }

  for (const source of normalizedSources.reddit) {
    try {
      const items = await fetchRedditFeed(source);
      all.push(...items);
    } catch (error) {
      console.warn(`[WARN] ${error.message}`);
    }
  }

  if (normalizedSources.subreddits.length) {
    console.log(`Configured subreddits: ${normalizedSources.subreddits.join(', ')}`);
  }

  return all.filter(isValidCandidate);
}

function sourceDistribution(items) {
  return items.reduce((accumulator, item) => {
    const key = item.sourceName || 'unknown';
    accumulator[key] = (accumulator[key] || 0) + 1;
    return accumulator;
  }, {});
}

function stripTldrPrefix(text) {
  return String(text || '').replace(/^TLDR:\s*/i, '').trim();
}

function buildDigestSources(generatedNews) {
  const allSources = generatedNews.flatMap((item) => {
    if (Array.isArray(item.sources) && item.sources.length) {
      return item.sources;
    }
    return item.sourceUrl ? [{ name: item.sourceName || 'Sursa', url: item.sourceUrl }] : [];
  });

  const merged = mergeSources(allSources, []);
  const compact = [];
  const seenPublishers = new Set();

  for (const source of merged) {
    const publisherKey = getHostname(source.url) || normalizeTextFingerprint(source.name || 'sursa');
    if (!publisherKey || seenPublishers.has(publisherKey)) {
      continue;
    }

    seenPublishers.add(publisherKey);
    compact.push(source);
    if (compact.length >= DIGEST_MAX_SOURCES) {
      break;
    }
  }

  return compact;
}

function fallbackDigest(generatedNews) {
  const pieces = generatedNews
    .slice(0, 4)
    .map((item) => stripTldrPrefix(item.summary))
    .filter(Boolean)
    .map((summary) => summary.replace(/\.$/, ''));

  const title = `TLDR-ul zilei: ${new Date().toISOString().slice(0, 10)}`.slice(0, TITLE_MAX_CHARS);
  const summary = `TLDR: ${pieces.join('; ')}`.slice(0, SUMMARY_MAX_CHARS);

  return {
    title,
    summary,
    whyItMatters: 'De ce conteaza: vezi pe scurt ideile-cheie din toate stirile noi.',
  };
}

function isSingleStoryDigest(summaryText, generatedNews) {
  const normalizedSummary = normalizeTextFingerprint(stripTldrPrefix(summaryText));
  if (!normalizedSummary) {
    return true;
  }

  return generatedNews.some((item) => tokenOverlapScore(normalizedSummary, item.title) >= 0.75);
}

async function summarizeDigest(generatedNews) {
  const fallback = fallbackDigest(generatedNews);
  if (!generatedNews.length) {
    return fallback;
  }

  const compactItems = generatedNews.map((item, index) => ({
    index: index + 1,
    title: item.title,
    summary: stripTldrPrefix(item.summary),
    category: item.category,
  }));

  const prompt = [
    'Esti editor pentru un site romanesc de stiri scurte.',
    `Primesti ${compactItems.length} rezumate deja publicabile.`,
    'Scrie un singur digest foarte scurt in romana.',
    `Titlul trebuie sa fie exact: "${fallback.title}"`,
    'Rezumatul trebuie sa combine idei din mai multe stiri, nu doar dintr-una singura.',
    'Returneaza DOAR JSON valid in forma:',
    '{"title":"max 80", "summary":"max 255, incepe cu TLDR:", "whyItMatters":"max 180, incepe cu De ce conteaza:"}',
    'Nu inventa fapte si nu repeta ideile.',
    '',
    `INPUT: ${JSON.stringify(compactItems)}`,
  ].join('\n');

  try {
    const result = await callLLM(prompt);
    const title = fallback.title;
    const summaryRaw = String(result.summary || fallback.summary).slice(0, SUMMARY_MAX_CHARS);
    const whyRaw = String(result.whyItMatters || fallback.whyItMatters).slice(0, 180);
    const summary = summaryRaw.startsWith('TLDR:') ? summaryRaw : `TLDR: ${summaryRaw}`;
    const whyItMatters = whyRaw.startsWith('De ce conteaza:') ? whyRaw : `De ce conteaza: ${whyRaw}`;

    if (isSingleStoryDigest(summary, generatedNews)) {
      return fallback;
    }

    return {
      title,
      summary,
      whyItMatters,
    };
  } catch (error) {
    return fallback;
  }
}

async function buildDigestNewsItem(generatedNews, existingNews) {
  if (generatedNews.length < 2) {
    return null;
  }

  const digestText = await summarizeDigest(generatedNews);
  const sources = buildDigestSources(generatedNews);
  const primarySource = sources[0] || { name: 'TLDR Romania', url: SITE_URL };
  const day = new Date().toISOString().slice(0, 10);

  return {
    id: `${day}-digest-${String(existingNews.length + generatedNews.length + 1).padStart(3, '0')}`,
    category: 'digest',
    title: digestText.title,
    summary: digestText.summary,
    whyItMatters: digestText.whyItMatters,
    image: BRAND_LOGO_ASSET,
    imageAlt: digestText.title,
    sourceName: primarySource.name,
    sourceUrl: primarySource.url,
    sources,
    publishedAt: new Date().toISOString(),
    isPick: true,
    origin: 'digest',
    fingerprint: makeFingerprint(`digest:${day}`, digestText.title),
    confidenceScore: 0.9,
    needsHumanReview: false,
    legalRisk: 'low',
    safetyReason: 'Digest compus din rezumatele deja publicabile.',
    generatedBy: AI_PROVIDER === 'ollama' ? `ollama:${OLLAMA_MODEL}` : OPENAI_MODEL,
    generatedAt: new Date().toISOString(),
  };
}

function selectCandidatesForProcessing(candidates, maxItems) {
  const target = Math.max(1, maxItems);
  const maxPerSource = 2;
  const grouped = new Map();

  candidates
    .slice()
    .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime())
    .forEach((candidate) => {
      const sourceKey = candidate.sourceName || 'unknown';
      if (!grouped.has(sourceKey)) {
        grouped.set(sourceKey, []);
      }
      grouped.get(sourceKey).push(candidate);
    });

  const selected = [];
  const counts = new Map();
  const sourceKeys = Array.from(grouped.keys());

  let progressed = true;
  while (selected.length < target && progressed) {
    progressed = false;
    for (const sourceKey of sourceKeys) {
      const queue = grouped.get(sourceKey);
      const currentCount = counts.get(sourceKey) || 0;
      if (!queue.length || currentCount >= maxPerSource || selected.length >= target) {
        continue;
      }

      selected.push(queue.shift());
      counts.set(sourceKey, currentCount + 1);
      progressed = true;
    }
  }

  if (selected.length < target) {
    const leftovers = [];
    grouped.forEach((queue) => leftovers.push(...queue));
    leftovers
      .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime())
      .slice(0, target - selected.length)
      .forEach((candidate) => selected.push(candidate));
  }

  return selected;
}

function mergeDuplicateCandidates(candidates) {
  const merged = [];

  candidates
    .slice()
    .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime())
    .forEach((candidate) => {
      const normalizedCandidate = {
        ...candidate,
        category: decideCategory(candidate),
        sources: mergeSources(toSourceList(candidate), []),
      };

      const existing = merged.find((item) => areLikelySameStory(item, normalizedCandidate));
      if (!existing) {
        merged.push(normalizedCandidate);
        return;
      }

      existing.sources = mergeSources(existing.sources, normalizedCandidate.sources);
      if (!existing.image && normalizedCandidate.image) {
        existing.image = normalizedCandidate.image;
      }
      if (String(normalizedCandidate.description || '').length > String(existing.description || '').length) {
        existing.description = normalizedCandidate.description;
      }
      if (new Date(normalizedCandidate.publishedAt).getTime() > new Date(existing.publishedAt).getTime()) {
        existing.publishedAt = normalizedCandidate.publishedAt;
      }
    });

  return merged;
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
  const filteringRules = getFilteringRules(sourceConfig);
  const existingNews = readJson(NEWS_JSON_PATH);

  if (AI_PROVIDER === 'ollama') {
    console.log(`[LLM] Provider: ollama | model=${OLLAMA_MODEL} | host=${OLLAMA_BASE_URL}`);
    const ollamaReady = await checkOllamaAvailability();
    if (!ollamaReady) {
      console.warn('[LLM] Ollama is not reachable. Start it with: ollama serve');
      console.warn(`[LLM] Then pull the model once: ollama pull ${OLLAMA_MODEL}`);
    }
  } else {
    console.log(`[LLM] Provider: openai | model=${OPENAI_MODEL}`);
  }

  const existingFingerprints = new Set(existingNews.map((item) => item.fingerprint || makeFingerprint(item.sourceUrl, item.title)));
  const candidates = await collectCandidates(sourceConfig);
  console.log(`\n[Candidates Collected] Total: ${candidates.length}`);
  const { accepted: filteredCandidates, skipped: skippedCandidates } = filterCandidates(candidates, filteringRules);

  if (skippedCandidates.length) {
    const skipSummary = skippedCandidates.reduce((accumulator, item) => {
      accumulator[item.reason] = (accumulator[item.reason] || 0) + 1;
      return accumulator;
    }, {});
    console.log(`Filtered out ${skippedCandidates.length} candidate(s): ${JSON.stringify(skipSummary)}`);
  }

  const freshCandidates = filteredCandidates.filter((candidate) => !existingFingerprints.has(makeFingerprint(candidate.url, candidate.title)));
  console.log(`[Fresh Candidates] Total: ${freshCandidates.length} (not in existing news)`);
  console.log(`[Fresh Candidates by Source] ${JSON.stringify(sourceDistribution(freshCandidates))}`);
  const mergedCandidates = mergeDuplicateCandidates(freshCandidates);
  console.log(`[Merged Candidate Stories] Total: ${mergedCandidates.length}`);
  const limited = selectCandidatesForProcessing(mergedCandidates, options.maxItems);
  console.log(`[Processing Queue] Total: ${limited.length} (max ${options.maxItems})\n`);
  console.log(`[Processing Queue by Source] ${JSON.stringify(sourceDistribution(limited))}`);

  const generatedNews = [];
  for (const candidate of limited) {
    console.log(`[URL] ${candidate.url}`);
    console.log(`  Source: ${candidate.sourceName}`);
    console.log(`  Title: ${candidate.title}`);

    if (!candidate.image) {
      candidate.image = await fetchArticleImage(candidate.url);
      console.log(`  Image: ${candidate.image || '(none extracted)'}`);
    }

    const summaryData = await summarizeCandidate(candidate, summarizePrompt, safetyPrompt);
    console.log(`  AI Summary:`);
    console.log(`    Title: "${summaryData.title}"`);
    console.log(`    Summary: "${summaryData.summary.slice(0, 100)}..."`);
    console.log(`    Category: ${summaryData.category}`);
    console.log(`    Confidence: ${summaryData.confidenceScore.toFixed(2)}`);
    console.log(`    Legal Risk: ${summaryData.legalRisk}`);
    console.log(`    Used Fallback: ${summaryData.usedFallback}`);
    console.log(`    Needs Review: ${summaryData.needsHumanReview}`);

    if (REQUIRE_OPENAI_SUMMARY && summaryData.usedFallback) {
      console.log(`  ❌ REJECTED: Fallback mode (requires real AI summary)\n`);
      continue;
    }

    const canAutoPublish = summaryData.legalRisk !== 'high' && (summaryData.confidenceScore >= 0.72 || summaryData.needsHumanReview);
    if (!canAutoPublish) {
      console.log(`  ❌ REJECTED: Auto-publish rules (legalRisk=${summaryData.legalRisk}, confidence=${summaryData.confidenceScore.toFixed(2)})\n`);
      continue;
    }

    const newsItem = buildNewsItem(candidate, summaryData, [...existingNews, ...generatedNews]);
    generatedNews.push(newsItem);
    console.log(`  ✅ PUBLISHED\n`);
  }

  const digestItem = await buildDigestNewsItem(generatedNews, existingNews);
  if (digestItem) {
    generatedNews.unshift(digestItem);
    console.log(`[DIGEST] Added combined digest item from ${generatedNews.length - 1} generated stories.`);
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

