# PLAN TLDR - "Prea Lung! N-am citit! stiri scurte"

## 1) Viziune si brand

**Nume site:** Prea Lung! N-am citit! stiri scurte
**Limba:** Romana
**Promisiune:** rezumate foarte scurte, clare si utile, cu link catre articolul complet.

### Pozitionare
- "Citesti esentialul in 20-40 secunde."
- Fiecare stire are:
  - titlu scurt
  - rezumat TLDR (2-4 propozitii)
  - "De ce conteaza"
  - link "Citeste pe larg"
  - imagine reprezentativa

### Identitate vizuala
- Stil modern, curat, mobile-first.
- Placeholder pentru logo in header (`<div class="logo-slot">LOGO</div>`).
- Paleta recomandata:
  - Fundal: `#0B0F1A`
  - Carduri: `#131A2A`
  - Accent: `#4F8CFF`
  - Text principal: `#EAF0FF`
  - Text secundar: `#A9B6D3`

---

## 2) Structura site-ului (MVP)

### Pagina principala
- Hero cu titlu: "Prea Lung! N-am citit! stiri scurte"
- Subtitlu: "Esentialul zilei, in romana, fara zgomot."
- Zona logo (placeholder)
- Sectiuni obligatorii:
  - **Stirile noastre preferate**
  - **Stiri amuzante**
  - **Tragedii**
  - **Politica**
  - **Tech**

### Sablon card stire (usor de completat)
- Imagine (thumbnail 16:9)
- Titlu
- Rezumat TLDR
- Sursa + data
- Buton/link: "Citeste pe larg"

Exemplu HTML:

```html
<article class="news-card">
  <img src="img/news/2026-07-13-exemplu.jpg" alt="Descriere imagine">
  <div class="news-card-content">
    <h3>Titlu scurt stire</h3>
    <p class="tldr">TLDR: Rezumat in 2-4 propozitii.</p>
    <p class="why">De ce conteaza: impact pe scurt.</p>
    <a href="https://sursa-externa.ro/articol-complet" target="_blank" rel="noopener noreferrer">Citeste pe larg</a>
  </div>
</article>
```

---

## 3) Cum sa fie usor de adaugat poze si linkuri

### Varianta simpla (fara CMS, cost minim)
- Tii datele stirilor intr-un fisier JSON (ex: `js/news.json`).
- Pui pozele in `img/news/`.
- `js/app.js` citeste JSON-ul si afiseaza automat cardurile pe categorii.

### Structura recomandata pentru fiecare stire

```json
{
  "id": "2026-07-13-001",
  "category": "tech",
  "title": "Titlu scurt",
  "summary": "TLDR: ...",
  "whyItMatters": "De ce conteaza: ...",
  "image": "img/news/2026-07-13-001.jpg",
  "imageAlt": "Descriere imagine",
  "sourceName": "Nume sursa",
  "sourceUrl": "https://exemplu.ro/articol",
  "publishedAt": "2026-07-13T08:00:00+03:00",
  "isPick": true
}
```

### Beneficii
- Nu editezi HTML pentru fiecare stire.
- Poti adauga rapid multe stiri pe zi.
- Este baza buna pentru autopublicare cu AI.

---

## 4) Hosting: cea mai ieftina solutie

### Recomandare #1 (aproape gratis)
- **GitHub Pages**: hosting static gratuit
- **Cloudflare Free**: CDN + SSL + cache + protectie de baza
- **Domeniu** (`.ro`/`.com`): singurul cost recurent important

Cost lunar estimat:
- Hosting: `0 EUR`
- CDN/SSL: `0 EUR`
- Total: in principal doar costul anual al domeniului

### Recomandare #2
- **Netlify** sau **Vercel** (free tier)
- Deploy simplu si preview per commit

### Ce sa eviti la inceput
- VPS dedicat pentru site static (cost inutil pentru faza MVP)

---

## 5) Plan AI pentru publicare automata (viitor)

### Pipeline minim viabil (low-cost)
1. Colectare surse (RSS/API/lista manuala)
2. Curatare si deduplicare
3. Rezumare AI in romana (`TLDR` + `De ce conteaza`)
4. Validare de siguranta (fara afirmatii neverificate)
5. Salvare in JSON/Markdown
6. Build + deploy automat (GitHub Actions)

### Stack recomandat
- Orchestrare: **GitHub Actions**
- Model AI: provider cu pret/token bun
- Stocare continut: Git repo (`json`/`md`)
- Publicare: GitHub Pages / Netlify

### Reguli editoriale anti-halucinatii
- AI nu inventeaza fapte.
- Sursa este obligatorie la fiecare stire.
- Campuri interne recomandate: `confidence_score`, `needs_human_review`.
- Pentru subiecte sensibile (tragedii/politica), review uman inainte de publicare.

---

## 6) SEO care conteaza din prima zi

### SEO tehnic
- `title` unic pe pagina
- `meta description` clar
- `lang="ro"` in HTML
- Open Graph + Twitter cards
- `sitemap.xml` + `robots.txt`
- URL-uri curate (ex: `/politica/guvern-buget-2026`)
- Performanta Core Web Vitals (imagini optimizate, lazy-load)

### SEO de continut
- Titluri orientate pe intentie de cautare
- Rezumate concise, fara clickbait agresiv
- Internal linking intre stiri similare
- Pagini solide de categorie: Politica, Tech etc.

### Structured Data
- `NewsArticle` (schema.org) per articol
- `Organization` pentru brand + logo
- `BreadcrumbList` pentru navigatie

---

## 7) Cum faci site-ul popular

### Distributie
- Telegram + WhatsApp Channel + Facebook + X
- Postari automate dupa publicare (titlu + fraza + link)
- Newsletter zilnic: "TLDR de dimineata" (top 5)

### Cadenta editoriala
- 2-3 valuri pe zi (dimineata, pranz, seara)
- Sectiunea "Stirile noastre preferate" actualizata zilnic
- Recap saptamanal

### Hooks de produs
- Buton "Trimite prietenului"
- Badge "Citire 30 sec"
- Sectiune "Cele mai citite azi"

### KPI minim
- trafic organic
- CTR social
- timp mediu pe pagina
- rata de revenire
- top categorii

---

## 8) Implementare practica in proiectul actual

Stare curenta observata:
- `index.html` este boilerplate
- `css/style.css` contine in principal stiluri default HTML5 Boilerplate
- `js/app.js` este gol

### Ce sa implementezi imediat
- In `index.html`:
  - header cu logo placeholder + titlu brand
  - navigatie categorii
  - sectiuni pentru cele 5 categorii
  - template card
- In `css/style.css`:
  - layout modern, responsive, grid/card
- In `js/app.js`:
  - incarcare `news.json`
  - filtrare pe categorii
  - render carduri
- Fisiere noi:
  - `js/news.json`
  - imagini in `img/news/`

---

## 9) Structura directoare recomandata

```text
TLDR/
  index.html
  css/
    style.css
  js/
    app.js
    news.json
  img/
    news/
      2026-07-13-001.jpg
      2026-07-13-002.jpg
```

---

## 10) Roadmap pe etape

### Etapa 1 (1-2 zile)
- Layout modern + sectiuni + 20 stiri demo

### Etapa 2 (2-4 zile)
- JSON-driven rendering + filtre pe categorii + cautare simpla

### Etapa 3 (3-7 zile)
- SEO complet + sitemap + schema + OG tags

### Etapa 4 (1-2 saptamani)
- Pipeline AI semi-automat cu review uman

### Etapa 5
- Newsletter + social auto-posting + dashboard analytics

---

## 11) Note legale si editoriale

- Respecta drepturile de autor (imagini licentiate sau proprii).
- Foloseste citate scurte si include sursa/link.
- Adauga pagini: Termeni, Confidentialitate, Contact.
- Pentru stiri sensibile: limbaj neutru + surse credibile.

---

## 12) Rezumat executiv

"Prea Lung! N-am citit! stiri scurte" poate porni foarte ieftin ca site static, cu arhitectura simpla bazata pe JSON + carduri pe categorii. Asta permite publicare rapida acum si migrare usoara spre autopublicare AI mai tarziu, fara refactor major. Prioritatile sunt UX clar, SEO corect, consistenta editoriala si distributie zilnica.
