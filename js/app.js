const NEWS_DATA_PATH = 'js/news.json';
const FALLBACK_IMAGE = 'icon.png';
const THEME_STORAGE_KEY = 'tldr-theme';

function getPreferredTheme() {
  const saved = localStorage.getItem(THEME_STORAGE_KEY);
  if (saved === 'light' || saved === 'dark') {
    return saved;
  }

  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  const toggle = document.getElementById('theme-toggle');
  if (!toggle) {
    return;
  }

  const darkEnabled = theme === 'dark';
  toggle.setAttribute('aria-pressed', darkEnabled ? 'true' : 'false');
  toggle.setAttribute('aria-label', darkEnabled ? 'Activeaza tema luminoasa' : 'Activeaza tema intunecata');
  toggle.textContent = darkEnabled ? 'Mod luminos' : 'Mod intunecat';
}

function setupThemeToggle() {
  const initialTheme = getPreferredTheme();
  applyTheme(initialTheme);

  const toggle = document.getElementById('theme-toggle');
  if (!toggle) {
    return;
  }

  toggle.addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme') || 'light';
    const nextTheme = current === 'dark' ? 'light' : 'dark';
    localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
    applyTheme(nextTheme);
  });
}

function formatDate(isoDate) {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) {
	return '';
  }

  return new Intl.DateTimeFormat('ro-RO', {
	day: '2-digit',
	month: 'short',
	year: 'numeric',
  }).format(date);
}

function byNewest(a, b) {
  return new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime();
}

function renderCard(newsItem, template) {
  const fragment = template.content.cloneNode(true);
  const image = fragment.querySelector('.news-image');
  const meta = fragment.querySelector('.news-meta');
  const title = fragment.querySelector('.news-title');
  const summary = fragment.querySelector('.tldr');
  const why = fragment.querySelector('.why');
  const link = fragment.querySelector('.news-link');

  image.src = newsItem.image || FALLBACK_IMAGE;
  image.alt = newsItem.imageAlt || newsItem.title;
  image.addEventListener('error', () => {
	image.src = FALLBACK_IMAGE;
  });

  const dateLabel = formatDate(newsItem.publishedAt);
  meta.textContent = `${newsItem.sourceName}${dateLabel ? ` - ${dateLabel}` : ''}`;
  title.textContent = newsItem.title;
  summary.textContent = newsItem.summary;
  why.textContent = newsItem.whyItMatters;
  link.href = newsItem.sourceUrl;

  return fragment;
}

function renderCategory(container, items, template) {
  container.innerHTML = '';

  if (!items.length) {
	const empty = document.createElement('p');
	empty.className = 'empty-category';
	empty.textContent = 'Momentan nu exista stiri in aceasta categorie.';
	container.appendChild(empty);
	return;
  }

  items.forEach((item) => container.appendChild(renderCard(item, template)));
}

function getCategoryItems(newsItems, category) {
  if (category === 'picks') {
	return newsItems.filter((item) => item.isPick).sort(byNewest);
  }

  return newsItems.filter((item) => item.category === category).sort(byNewest);
}

async function loadNews() {
  const response = await fetch(NEWS_DATA_PATH, { cache: 'no-store' });
  if (!response.ok) {
	throw new Error(`Nu am putut incarca datele: ${response.status}`);
  }
  const payload = await response.json();
  return Array.isArray(payload) ? payload : [];
}

async function init() {
  const template = document.getElementById('news-card-template');
  const categoryContainers = Array.from(document.querySelectorAll('.news-grid[data-category]'));

  try {
	const newsItems = await loadNews();
	categoryContainers.forEach((container) => {
	  const category = container.dataset.category;
	  renderCategory(container, getCategoryItems(newsItems, category), template);
	});
  } catch (error) {
	categoryContainers.forEach((container) => {
	  container.innerHTML = '<p class="empty-category">Datele nu au putut fi incarcate. Incearca din nou.</p>';
	});
	// eslint-disable-next-line no-console
	console.error(error);
  }
}

setupThemeToggle();
init();

