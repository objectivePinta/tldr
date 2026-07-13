# Prea Lung! N-am citit! stiri scurte

Site static de stiri scurte in romana, construit cu HTML + CSS + JS, cu datele stirilor in JSON. MVP-ul este complet, responsive, SEO-optimizat si pregatit pentru lansare.

## Caracteristici MVP

- ✅ 5 categorii principale (Stirile noastre preferate, Amuzante, Tragedii, Politica, Tech)
- ✅ Light/dark theme cu persistenta
- ✅ Design modern responsive (mobile-first, 44px tap targets)
- ✅ JSON-driven (ușor de adăugat știri fără să editezi HTML)
- ✅ SEO complet: title, OG, JSON-LD Organization
- ✅ sitemap.xml + feed.xml (RSS) pentru indexare și distribuție

## Structura folderelor

```
TLDR/
  index.html              # Homepage cu 5 categorii
  css/style.css           # Design modern, light/dark theme
  js/app.js               # Logica: incarca JSON, filtreaza, randeaza
  js/news.json            # DATELE STIRILOR (editeaza asta)
  img/news/               # Imagini ale stirilor (thumbnail 16:9)
  sitemap.xml             # Pentru Google Search Console
  feed.xml                # RSS feed pentru agregatori si social
  PLAN_TLDR.md            # Planul complet al proiectului
```

## Workflow editorial: Adauga o stire in 30 secunde

### Pasul 1: Pregateste imaginea
- Alege o imagine aspect 16:9 (ex: 800x450px, 1200x675px)
- Salveaza in `img/news/` cu nume clar (ex: `2026-07-13-ai-model.jpg`)

### Pasul 2: Adauga stirea in `js/news.json`
Deschide `js/news.json` și adăugă obiectul la început (pentru a apărea pe top):

```json
{
  "id": "2026-07-13-unique-id",
  "category": "tech",
  "title": "Titlu scurt, sub 60 caractere",
  "summary": "TLDR: Rezumat în 1-2 propoziții. Max 150 caractere.",
  "whyItMatters": "De ce conteaza: contextul rapid. Max 100 caractere.",
  "image": "img/news/2026-07-13-ai-model.jpg",
  "imageAlt": "Descriere scurta pentru accesibilitate",
  "sourceName": "Sursa stirei (ex: HotNews)",
  "sourceUrl": "https://articol-lung-original.ro",
  "publishedAt": "2026-07-13T14:30:00+03:00",
  "isPick": false
}
```

**Campuri obligatorii:**
- `id` - unic, format `YYYY-MM-DD-cuvant`
- `category` - una din: `funny`, `tragedy`, `politics`, `tech`
- `title`, `summary`, `whyItMatters`, `sourceUrl`, `publishedAt`

**Campuri speciale:**
- `isPick: true` - afiseaza stirea in "Stirile noastre preferate"

### Pasul 3: Test local
```powershell
npm start
```
Deschide browser-ul și verifica ca stirea apare cu poza și link-ul corect.

### Pasul 4: Build pentru productie
```powershell
npm run build
```
Fisierele finale sunt in `dist/` - gata de upload.

## Setup inițial (o singură dată)

```powershell
npm install
npm start
```

## Comenzi zilnice

```powershell
# Dezvoltare local
npm start

# Build productie
npm run build

# Test (compile check)
npm test
```

## Lansare pe GitHub Pages (gratis)

Deploy-ul este pregatit prin workflow-ul `deploy-pages.yml`.

1. Creeaza repo pe GitHub si impinge codul pe ramura `main`.
2. In GitHub: `Settings -> Pages -> Build and deployment -> Source = GitHub Actions`.
3. Fa push pe `main`; workflow-ul construieste `dist/` si publica automat.
4. URL-ul va aparea in tab-ul `Actions` la job-ul `Deploy to GitHub Pages`.

## SEO + Distribuție

### Before launch (critici)
1. Inlocuieste `https://exemplu.ro` cu domeniul real in `index.html` (OG + JSON-LD).
2. Daca ramai pe GitHub Pages, ajusteaza `https://tldr.ro` in `sitemap.xml`, `feed.xml`, `robots.txt`, `index.html`.
3. Submit sitemap.xml in Google Search Console.
4. Submit feed.xml la Feedly, IFTTT, Zapier (auto-posting).

### Fișiere SEO incluse
- `sitemap.xml` - paginile și categoriile principale
- `feed.xml` - RSS feed cu toate stirile (actualizat manual; vezi: generator RSS dinamic din `news.json`)
- `robots.txt` - deja includat, permite Google
- `meta` tags - title, description, OG, lang="ro"

## Social auto-posting (viitor)

Pentru a face feed.xml dinamic (generat automat din `news.json`), poti folosi:
- GitHub Actions script (weekly) să regenereze feed.xml
- Zapier/IFTTT pe feed.xml → Telegram, X, Facebook
- AI autopublishing (pasul 5 din PLAN_TLDR.md)

## AI autopublishing (implementat)

Pipeline-ul AI este in `scripts/news-pipeline.js` si ruleaza local sau din GitHub Actions.

### Fisiere noi pentru AI
- `scripts/news-pipeline.js` - colectare RSS/Reddit, dedup, sumarizare, safety, publish
- `ai/sources.json` - sursele monitorizate + subreddituri + whitelist de domenii + cuvinte blocate
- `prompts/summarize-ro.md` - prompt sumarizare in romana
- `prompts/safety-check-ro.md` - prompt validare risc legal/editorial
- `.github/workflows/news-pipeline.yml` - rulare programata (cron) + manual

### Cum rulezi local

```powershell
# verifica utilitarele pipeline (fara internet)
npm run ai:self-test

# ruleaza pipeline pe surse reale, fara sa scrie fisiere
npm run ai:dry-run

# ruleaza pipeline si actualizeaza js/news.json + feed.xml + sitemap.xml
npm run ai:run
```

### Configurare AI provider

Pipeline-ul foloseste API OpenAI-compatible daca exista cheia `OPENAI_API_KEY`.
Fara cheie, intra automat in fallback heuristic (tot produce drafturi).

Poti porni de la `\.env.example` pentru variabilele locale.

```powershell
$env:OPENAI_API_KEY="<cheia-ta>"
$env:OPENAI_MODEL="gpt-4o-mini"
$env:ALLOWED_DOMAINS="hotnews.ro,digi24.ro,reuters.com,bbc.com,theverge.com,techcrunch.com"
$env:BLOCKED_PATTERNS="[P],sponsorizat,publicitate,advertorial,parteneriat,promo"
$env:REDDIT_SUBREDDITS="worldnews,technology,europe"
npm run ai:run
```

### Unde adaugi subreddituri

Ai doua variante:

1. In `ai/sources.json`

```json
{
  "subreddits": ["worldnews", "technology", "europe"]
}
```

2. Din environment, fara sa modifici fisierul:

```powershell
$env:REDDIT_SUBREDDITS="worldnews,technology,europe,romania"
npm run ai:dry-run
```

Accepta forme precum:
- `worldnews`
- `r/worldnews`
- `https://www.reddit.com/r/worldnews/`

Pipeline-ul le transforma automat in feed-uri RSS Reddit.

### Filtrare anti-advertorial si whitelist

Pipeline-ul filtreaza candidatii inainte de AI:
- respinge articole cu pattern-uri de advertorial (`[P]`, `sponsorizat`, `publicitate`, `advertorial` etc.)
- accepta doar domenii din whitelist
- suporta subdomenii (`www.digi24.ro` este acceptat pentru regula `digi24.ro`)

Ordinea configurarii:
1. daca exista `ALLOWED_DOMAINS` / `BLOCKED_PATTERNS` in environment, ele au prioritate
2. altfel se foloseste configuratia din `ai/sources.json`

Exemplu `ai/sources.json`:

```json
{
  "subreddits": ["worldnews", "technology"],
  "allowedDomains": ["hotnews.ro", "digi24.ro", "bbc.com"],
  "blockedPatterns": ["[P]", "sponsorizat", "advertorial"],
  "rss": [],
  "reddit": []
}
```

### Setari GitHub (pentru automatizare completa)
1. Repo -> `Settings -> Secrets and variables -> Actions`
2. Adauga:
   - `OPENAI_API_KEY`
   - `OPENAI_MODEL` (optional, ex: `gpt-4o-mini`)
3. Workflow-ul `AI News Pipeline` ruleaza automat la orele din cron si poate fi pornit manual din `Actions`.

### Guardrails incluse
- deduplicare prin `fingerprint`
- `needsHumanReview=true` implicit pe subiecte `politics`/`tragedy`
- blocare auto-publicare pentru `legalRisk=high`
- sursa obligatorie (`sourceUrl`, `sourceName`)
- whitelist de domenii pentru auto-publicare
- blocare advertoriale / continut promo marcat

## Dosare importante

- **PLAN_TLDR.md** - strategie completă: branding, AI autopublishing, analytics, roadmap
- **webpack config** - build static cu copy CSS/JS/JSON/imagini
- **theme persistence** - dark mode salvat în localStorage

## Stare MVP

✅ Gata de lansare:
- Homepage cu 5 categorii
- 10 stiri demo
- SEO + sitemap + RSS
- Mobile-friendly (44px tap targets, sticky nav)
- Light/dark theme
- Build process

📋 Next (după lansare):
- AI autopublishing (GitHub Actions)
- Newsletter Substack/email
- Social auto-posting
- Analytics (Plausible/SimpleAnalytics)
- Pagini dedicate per categorie

