const NEWS_DATA_PATH = 'js/news.json';

const CATEGORY_LABELS = {
  funny: 'Amuzant',
  tragedy: 'Tragedie',
  politics: 'Politica',
  tech: 'Tech',
  sports: 'Sport',
  weather: 'Meteo',
  health: 'Sanatate',
  business: 'Business',
  science: 'Stiinta',
  culture: 'Cultura',
  digest: 'Digest',
};

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

function normalizeSummary(text) {
  const value = String(text || '').trim();
  return value.replace(/^TLDR:\s*/i, '');
}

function toCategoryLabel(category) {
  if (CATEGORY_LABELS[category]) {
    return CATEGORY_LABELS[category];
  }

  const value = String(category || 'general');
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}

function getAvailableCategories(newsItems) {
  return [...new Set(newsItems.map((item) => item.category).filter(Boolean))].sort();
}

function getSourcesForItem(newsItem) {
  if (Array.isArray(newsItem.sources) && newsItem.sources.length) {
    return newsItem.sources;
  }

  if (newsItem.sourceUrl) {
    return [{ name: newsItem.sourceName || 'Sursa', url: newsItem.sourceUrl }];
  }

  return [];
}

function renderItem(newsItem, template, index) {
  const fragment = template.content.cloneNode(true);
  const rank = fragment.querySelector('.news-rank');
  const title = fragment.querySelector('.news-link-title');
  const tag = fragment.querySelector('.news-category-tag');
  const meta = fragment.querySelector('.news-meta');
  const summary = fragment.querySelector('.tldr');
  const sources = fragment.querySelector('.news-sources');
  const link = fragment.querySelector('.news-link');

  if (newsItem.category === 'digest') {
    fragment.querySelector('.news-item').classList.add('category--digest');
  }

  const dateLabel = formatDate(newsItem.publishedAt);
  const sourceList = getSourcesForItem(newsItem);
  const maxDisplayedSources = newsItem.category === 'digest' ? 8 : sourceList.length;
  const displayedSources = sourceList.slice(0, maxDisplayedSources);
  const primarySource = sourceList[0] || { name: newsItem.sourceName, url: newsItem.sourceUrl };

  rank.textContent = `${index + 1}.`;
  title.textContent = newsItem.title;
  title.href = primarySource.url || '#';
  tag.textContent = toCategoryLabel(newsItem.category);
  meta.textContent = `${primarySource.name || 'Sursa'}${dateLabel ? ` - ${dateLabel}` : ''}`;
  summary.textContent = normalizeSummary(newsItem.summary);
  link.href = primarySource.url || '#';

  sources.innerHTML = '';
  if (sourceList.length > 1) {
    const label = document.createElement('span');
    label.textContent = 'Surse: ';
    sources.appendChild(label);
  }

  displayedSources.forEach((source, sourceIndex) => {
    const anchor = document.createElement('a');
    anchor.href = source.url;
    anchor.target = '_blank';
    anchor.rel = 'noopener noreferrer';
    anchor.textContent = source.name;
    sources.appendChild(anchor);

    if (sourceIndex < displayedSources.length - 1) {
      sources.appendChild(document.createTextNode(' · '));
    }
  });

  if (sourceList.length > displayedSources.length) {
    if (displayedSources.length) {
      sources.appendChild(document.createTextNode(' · '));
    }
    const more = document.createElement('span');
    more.textContent = `+${sourceList.length - displayedSources.length} surse`;
    sources.appendChild(more);
  }

  if (!sourceList.length) {
    sources.textContent = '';
  }

  return fragment;
}

function renderFeed(container, items, template) {
  container.innerHTML = '';

  if (!items.length) {
    container.innerHTML = '<p class="empty-category">Momentan nu exista stiri pentru filtrul selectat.</p>';
    return;
  }

  items.forEach((item, index) => {
    container.appendChild(renderItem(item, template, index));
  });
}

function buildFilterNav(nav, categories, onFilterSelect) {
  nav.innerHTML = '';

  const filters = [{ key: 'all', label: 'toate' }, ...categories.map((category) => ({
    key: category,
    label: toCategoryLabel(category).toLowerCase(),
  }))];

  filters.forEach((filter, index) => {
    const link = document.createElement('a');
    link.href = '#news-root';
    link.textContent = filter.label;
    link.dataset.filter = filter.key;
    if (index === 0) {
      link.classList.add('is-active');
      link.setAttribute('aria-current', 'page');
    }

    link.addEventListener('click', (event) => {
      event.preventDefault();
      onFilterSelect(filter.key);
    });

    nav.appendChild(link);
  });
}

function setActiveFilter(nav, filter) {
  const links = Array.from(nav.querySelectorAll('a[data-filter]'));
  links.forEach((link) => {
    const isActive = link.dataset.filter === filter;
    link.classList.toggle('is-active', isActive);
    if (isActive) {
      link.setAttribute('aria-current', 'page');
    } else {
      link.removeAttribute('aria-current');
    }
  });
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
  const listContainer = document.getElementById('news-list');
  const filterNav = document.getElementById('filter-nav');

  if (!template || !listContainer || !filterNav) {
    return;
  }

  try {
    const newsItems = (await loadNews()).sort(byNewest);
    const categories = getAvailableCategories(newsItems);

    const renderByFilter = (filter) => {
      const filtered = filter === 'all'
        ? newsItems
        : newsItems.filter((item) => item.category === filter);
      renderFeed(listContainer, filtered, template);
      setActiveFilter(filterNav, filter);
    };

    buildFilterNav(filterNav, categories, renderByFilter);
    renderByFilter('all');
  } catch (error) {
    listContainer.innerHTML = '<p class="empty-category">Datele nu au putut fi incarcate. Incearca din nou.</p>';
    // eslint-disable-next-line no-console
    console.error(error);
  }
}

init();
