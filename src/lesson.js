const STEPS = [
  ["01", "Мақсат пен бюджет", "Инвестицияға не үшін кіретініңді және қандай сомадан қауіпсіз бастауға болатынын анықтау."],
  ["02", "Халал сүзгісі", "Компанияның қызметі мен қаржылық көрсеткіштерін шариғат талаптарына сай тексеру."],
  ["03", "Компанияны зерттеу", "Акция бағасына емес, бизнестің сапасына, табысына және тұрақтылығына қарау."],
  ["04", "Алғашқы сатып алу", "Брокерді, валютаны және сатып алу тәсілін түсініп, алғашқы қадамды жоспарлау."],
  ["05", "Тәуекелді басқару", "Бар ақшаны бір акцияға салмай, эмоция мен асығыстықтан қорғану."
  ]
];

export function renderLessonPage({ videoUrl = "", posterUrl = "", sent = false, error = "", values = {} } = {}) {
  return `<!doctype html>
<html lang="kk">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="Халал инвестицияға алғашқы қадамдар туралы тегін сабақ.">
  <title>Тегін сабақ — Халал инвестицияға 5 қадам</title>
  <style>
    :root {
      --ink: #10211b;
      --muted: #66726d;
      --paper: #f4f0e7;
      --paper-strong: #fffdf8;
      --green: #173e31;
      --green-soft: #dfe9df;
      --lime: #d8f06a;
      --orange: #f08a5d;
      --line: rgba(16,33,27,.14);
      --radius: 28px;
      --shadow: 0 28px 80px rgba(19,47,37,.13);
    }
    * { box-sizing: border-box; }
    html { scroll-behavior: smooth; }
    body {
      margin: 0;
      color: var(--ink);
      background:
        radial-gradient(circle at 86% 4%, rgba(216,240,106,.38), transparent 24rem),
        radial-gradient(circle at 0% 36%, rgba(240,138,93,.13), transparent 28rem),
        var(--paper);
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      line-height: 1.55;
    }
    body::before {
      content: "";
      position: fixed;
      inset: 0;
      pointer-events: none;
      opacity: .2;
      background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 180 180' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.8' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='.12'/%3E%3C/svg%3E");
      z-index: 20;
    }
    a { color: inherit; }
    button, input, textarea, select { font: inherit; }
    .wrap { width: min(1180px, calc(100% - 40px)); margin: 0 auto; }
    .nav {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 20px;
      padding: 22px 0;
      position: relative;
      z-index: 2;
    }
    .brand { display: flex; align-items: center; gap: 11px; font-weight: 850; letter-spacing: -.03em; }
    .brand-mark { width: 34px; height: 34px; border-radius: 50%; background: var(--green); color: var(--lime); display: grid; place-items: center; font-size: 17px; }
    .nav-link { color: var(--muted); text-decoration: none; font-size: 14px; font-weight: 700; }
    .hero {
      display: grid;
      grid-template-columns: minmax(0, 1.18fr) minmax(320px, .82fr);
      gap: clamp(32px, 6vw, 82px);
      align-items: center;
      min-height: 700px;
      padding: 60px 0 96px;
      position: relative;
    }
    .eyebrow { display: inline-flex; align-items: center; gap: 10px; color: var(--green); font-size: 13px; font-weight: 900; letter-spacing: .12em; text-transform: uppercase; }
    .eyebrow::before { content: ""; width: 34px; height: 2px; background: var(--orange); }
    h1 { margin: 22px 0 24px; max-width: 820px; font-size: clamp(48px, 7.2vw, 92px); line-height: .95; letter-spacing: -.065em; font-weight: 860; }
    h1 span { color: var(--green); }
    .lead { max-width: 700px; color: var(--muted); font-size: clamp(18px, 2vw, 22px); line-height: 1.55; }
    .hero-actions { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 34px; }
    .button {
      border: 0;
      border-radius: 999px;
      padding: 15px 22px;
      min-height: 54px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
      text-decoration: none;
      cursor: pointer;
      font-weight: 850;
      transition: transform .2s ease, box-shadow .2s ease, background .2s ease;
    }
    .button:hover { transform: translateY(-2px); }
    .button.primary { color: #fff; background: var(--green); box-shadow: 0 16px 38px rgba(23,62,49,.23); }
    .button.primary::after { content: "↘"; color: var(--lime); font-size: 20px; }
    .button.secondary { border: 1px solid var(--line); background: rgba(255,253,248,.55); }
    .hero-card {
      min-height: 500px;
      border-radius: 190px 190px 30px 30px;
      color: #fff;
      background: var(--green);
      box-shadow: var(--shadow);
      padding: 42px 38px;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      position: relative;
      overflow: hidden;
      isolation: isolate;
    }
    .hero-card::before { content: "5"; position: absolute; right: -14px; bottom: -95px; font-size: 390px; line-height: 1; font-weight: 900; color: rgba(216,240,106,.12); z-index: -1; }
    .orbit { width: 176px; height: 176px; margin: 4px auto 20px; border: 1px solid rgba(255,255,255,.23); border-radius: 50%; display: grid; place-items: center; position: relative; }
    .orbit::before, .orbit::after { content: ""; position: absolute; border: 1px solid rgba(216,240,106,.32); border-radius: 50%; }
    .orbit::before { inset: 17px -17px; transform: rotate(48deg); }
    .orbit::after { inset: -17px 17px; transform: rotate(-48deg); }
    .orbit strong { width: 94px; height: 94px; border-radius: 50%; display: grid; place-items: center; background: var(--lime); color: var(--green); font-size: 46px; }
    .card-copy small { color: rgba(255,255,255,.62); text-transform: uppercase; letter-spacing: .14em; font-weight: 800; }
    .card-copy h2 { font-size: 28px; line-height: 1.12; letter-spacing: -.035em; margin: 11px 0 0; }
    .section { padding: 104px 0; }
    .section-head { display: grid; grid-template-columns: .7fr 1.3fr; gap: 48px; align-items: end; margin-bottom: 42px; }
    .kicker { color: var(--orange); font-size: 13px; font-weight: 900; text-transform: uppercase; letter-spacing: .12em; }
    .section h2 { font-size: clamp(36px, 5vw, 64px); line-height: 1.02; letter-spacing: -.055em; margin: 9px 0 0; }
    .section-intro { max-width: 600px; color: var(--muted); font-size: 18px; justify-self: end; }
    .video-shell { background: #0a1914; border-radius: var(--radius); padding: 12px; box-shadow: var(--shadow); position: relative; }
    .video-shell video, .video-shell iframe { width: 100%; aspect-ratio: 16/9; display: block; border: 0; border-radius: 19px; background: #07110e; }
    .video-empty { aspect-ratio: 16/9; border-radius: 19px; display: grid; place-items: center; text-align: center; padding: 30px; color: #fff; background: radial-gradient(circle at center, #244b3c, #07110e 72%); }
    .video-empty span { width: 86px; height: 86px; border-radius: 50%; display: grid; place-items: center; margin: 0 auto 18px; background: var(--lime); color: var(--green); font-size: 31px; padding-left: 5px; }
    .video-label { position: absolute; left: 30px; top: 30px; z-index: 2; padding: 8px 12px; border-radius: 999px; color: #fff; background: rgba(7,17,14,.72); backdrop-filter: blur(12px); font-size: 12px; font-weight: 850; letter-spacing: .08em; text-transform: uppercase; }
    .steps { display: grid; grid-template-columns: repeat(5, minmax(0,1fr)); border-top: 1px solid var(--line); }
    .step { padding: 26px 20px 12px; border-right: 1px solid var(--line); }
    .step:last-child { border-right: 0; }
    .step-num { color: var(--orange); font-size: 12px; font-weight: 900; letter-spacing: .12em; }
    .step h3 { font-size: 20px; line-height: 1.15; letter-spacing: -.025em; min-height: 46px; margin: 24px 0 12px; }
    .step p { color: var(--muted); font-size: 14px; margin: 0; }
    .consultation { padding: 80px 0 100px; }
    .consultation-shell { display: grid; grid-template-columns: .9fr 1.1fr; overflow: hidden; border-radius: 36px; background: var(--green); box-shadow: var(--shadow); }
    .consultation-copy { color: #fff; padding: clamp(34px, 6vw, 74px); position: relative; overflow: hidden; }
    .consultation-copy::after { content: ""; width: 280px; height: 280px; border: 1px solid rgba(216,240,106,.22); border-radius: 50%; position: absolute; right: -110px; bottom: -130px; box-shadow: 0 0 0 42px rgba(216,240,106,.05), 0 0 0 82px rgba(216,240,106,.035); }
    .consultation-copy .kicker { color: var(--lime); }
    .consultation-copy h2 { max-width: 620px; font-size: clamp(38px, 5vw, 66px); line-height: .98; letter-spacing: -.055em; margin: 16px 0 24px; }
    .consultation-copy p { color: rgba(255,255,255,.7); font-size: 17px; max-width: 560px; }
    .consultation-copy ul { margin: 34px 0 0; padding: 0; list-style: none; display: grid; gap: 13px; }
    .consultation-copy li { display: flex; gap: 12px; align-items: flex-start; }
    .consultation-copy li::before { content: "✓"; width: 24px; height: 24px; flex: 0 0 24px; border-radius: 50%; display: grid; place-items: center; color: var(--green); background: var(--lime); font-size: 12px; font-weight: 900; }
    .form-card { margin: 12px; border-radius: 27px; background: var(--paper-strong); padding: clamp(26px, 5vw, 54px); }
    .form-card h3 { margin: 0 0 6px; font-size: 26px; letter-spacing: -.035em; }
    .form-card > p { margin: 0 0 26px; color: var(--muted); }
    .form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    .field.full { grid-column: 1 / -1; }
    .field label { display: block; font-size: 13px; font-weight: 800; margin-bottom: 7px; }
    .field input, .field select, .field textarea { width: 100%; border: 1px solid var(--line); border-radius: 13px; color: var(--ink); background: #fff; padding: 13px 14px; outline: none; transition: border-color .2s, box-shadow .2s; }
    .field textarea { min-height: 105px; resize: vertical; }
    .field input:focus, .field select:focus, .field textarea:focus { border-color: var(--green); box-shadow: 0 0 0 3px rgba(23,62,49,.1); }
    .consent { display: flex; align-items: flex-start; gap: 10px; margin: 18px 0; color: var(--muted); font-size: 12px; }
    .consent input { margin-top: 3px; accent-color: var(--green); }
    .form-card .button { width: 100%; }
    .form-error { margin: 0 0 18px; padding: 12px 14px; border-radius: 12px; color: #7b2727; background: #fde8e2; font-size: 14px; font-weight: 700; }
    .success { padding: 22px; border-radius: 17px; color: var(--green); background: var(--green-soft); }
    .success strong { display: block; font-size: 22px; margin-bottom: 5px; }
    .risk { padding: 24px 0 42px; border-top: 1px solid var(--line); color: var(--muted); font-size: 13px; display: flex; justify-content: space-between; gap: 30px; }
    [data-reveal] { opacity: 0; transform: translateY(20px); transition: opacity .65s ease, transform .65s ease; }
    [data-reveal].visible { opacity: 1; transform: none; }
    .hp { position: absolute; left: -9999px; width: 1px; height: 1px; overflow: hidden; }
    @media (max-width: 900px) {
      .hero { grid-template-columns: 1fr; min-height: 0; padding-top: 45px; }
      .hero-card { min-height: 420px; border-radius: 140px 140px 26px 26px; }
      .section-head, .consultation-shell { grid-template-columns: 1fr; }
      .section-intro { justify-self: start; }
      .steps { grid-template-columns: 1fr 1fr; }
      .step { border-bottom: 1px solid var(--line); }
      .step:nth-child(2n) { border-right: 0; }
      .step:last-child { grid-column: 1 / -1; }
    }
    @media (max-width: 580px) {
      .wrap { width: min(100% - 24px, 1180px); }
      .nav-link { display: none; }
      .hero { padding: 34px 0 72px; }
      h1 { font-size: clamp(44px, 15vw, 66px); }
      .hero-actions, .hero-actions .button { width: 100%; }
      .hero-card { min-height: 380px; padding: 34px 26px; }
      .section { padding: 76px 0; }
      .steps { grid-template-columns: 1fr; }
      .step, .step:nth-child(2n), .step:last-child { grid-column: auto; border-right: 0; }
      .step h3 { min-height: 0; margin-top: 14px; }
      .form-grid { grid-template-columns: 1fr; }
      .field.full { grid-column: auto; }
      .consultation { padding-top: 52px; }
      .consultation-shell { border-radius: 26px; }
      .risk { display: grid; }
    }
    @media (prefers-reduced-motion: reduce) {
      html { scroll-behavior: auto; }
      *, *::before, *::after { animation-duration: .01ms !important; transition-duration: .01ms !important; }
      [data-reveal] { opacity: 1; transform: none; }
    }
  </style>
</head>
<body>
  <header class="wrap nav">
    <div class="brand"><span class="brand-mark">H</span><span>HALAL INVEST</span></div>
    <a class="nav-link" href="#consultation">Тегін консультация →</a>
  </header>

  <main>
    <section class="wrap hero">
      <div data-reveal>
        <div class="eyebrow">Тегін сабақ</div>
        <h1>Алғашқы акцияңды алмас бұрын: <span>халал инвестицияға 5 қадам</span></h1>
        <p class="lead">Инвестицияны неден бастау, халал акцияны қалай тексеру және қандай қателерден сақтану керегін осы сабақта түсіндірдім.</p>
        <div class="hero-actions">
          <a class="button primary" href="#video">Сабақты көру</a>
          <a class="button secondary" href="#consultation">Консультацияға жазылу</a>
        </div>
      </div>
      <aside class="hero-card" data-reveal>
        <div class="orbit"><strong>5</strong></div>
        <div class="card-copy">
          <small>Жүйелі бастау</small>
          <h2>Түсінікті қадамдар.<br>Артық уәде жоқ.</h2>
        </div>
      </aside>
    </section>

    <section id="video" class="section">
      <div class="wrap">
        <div class="section-head" data-reveal>
          <div><div class="kicker">Сабақ видеосы</div><h2>Алдымен негізін түсініп ал</h2></div>
          <p class="section-intro">Видеоны асықпай көр. Маңызды ойларды жазып отыр — кейін өз мақсатыңа сай нақты жоспар құру оңайырақ болады.</p>
        </div>
        <div class="video-shell" data-reveal>
          <div class="video-label">Тегін сабақ</div>
          ${renderVideo(videoUrl, posterUrl)}
        </div>
      </div>
    </section>

    <section class="section">
      <div class="wrap">
        <div class="section-head" data-reveal>
          <div><div class="kicker">Сабақтың картасы</div><h2>Бес негізгі қадам</h2></div>
          <p class="section-intro">Мақсат — бірден көп акция алу емес. Алдымен шешім қабылдаудың дұрыс жүйесін қалыптастыру.</p>
        </div>
        <div class="steps" data-reveal>
          ${STEPS.map(([number, title, text]) => `<article class="step"><div class="step-num">${number}</div><h3>${esc(title)}</h3><p>${esc(text)}</p></article>`).join("")}
        </div>
      </div>
    </section>

    <section id="consultation" class="wrap consultation">
      <div class="consultation-shell" data-reveal>
        <div class="consultation-copy">
          <div class="kicker">Келесі қадам</div>
          <h2>Өзіңнің неден бастауың керегін білгің келе ме?</h2>
          <p>Тегін консультацияда мақсатыңды, тәжірибеңді және инвестицияға қатысты сұрақтарыңды бірге талқылаймыз.</p>
          <p>Саған сәйкес келсе, 5 айлық сүйемелдеу бағдарламасының форматы мен шарттарын түсіндіремін.</p>
          <ul>
            <li>Мақсатың мен бастапқы жағдайыңды анықтаймыз</li>
            <li>Негізгі сұрақтарыңа нақты бағыт беремін</li>
            <li>Саған сәйкес форматты қысымсыз талқылаймыз</li>
          </ul>
        </div>
        <div class="form-card">
          ${sent ? renderSuccess() : renderForm(error, values)}
        </div>
      </div>
    </section>
  </main>

  <footer class="wrap risk">
    <strong>Маңызды ескерту</strong>
    <span>Инвестицияда шығын тәуекелі бар. Табысқа кепілдік берілмейді. Материал жеке инвестициялық ұсыныс болып саналмайды.</span>
  </footer>

  <script>
    const revealItems = document.querySelectorAll('[data-reveal]');
    if ('IntersectionObserver' in window && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      const observer = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add('visible');
          observer.unobserve(entry.target);
        }
      }, { threshold: .12 });
      revealItems.forEach((item) => observer.observe(item));
    } else {
      revealItems.forEach((item) => item.classList.add('visible'));
    }
  </script>
</body>
</html>`;
}

function renderVideo(videoUrl, posterUrl) {
  const url = safeMediaUrl(videoUrl);
  if (!url) {
    return `<div class="video-empty"><div><span>▶</span><strong>Сабақ видеосы осында жарияланады</strong></div></div>`;
  }

  const youtubeId = youtubeVideoId(url);
  if (youtubeId) {
    return `<iframe src="https://www.youtube-nocookie.com/embed/${encodeURIComponent(youtubeId)}" title="Халал инвестицияға 5 қадам" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe>`;
  }

  return `<video controls playsinline preload="metadata"${safeMediaUrl(posterUrl) ? ` poster="${esc(safeMediaUrl(posterUrl))}"` : ""}><source src="${esc(url)}">Браузеріңіз видеоны қолдамайды.</video>`;
}

function renderForm(error, values) {
  return `
    <h3>Тегін консультацияға жазылу</h3>
    <p>Қысқа сауалнаманы толтыр — кездесуге дайындалуыма көмектеседі.</p>
    ${error ? `<div class="form-error">${esc(error)}</div>` : ""}
    <form method="post" action="/lesson/consultation">
      <div class="hp" aria-hidden="true"><label>Website<input name="website" tabindex="-1" autocomplete="off"></label></div>
      <div class="form-grid">
        <div class="field">
          <label for="name">Атың</label>
          <input id="name" name="name" value="${esc(values.name || "")}" autocomplete="name" maxlength="80" required>
        </div>
        <div class="field">
          <label for="contact">Telegram немесе телефон</label>
          <input id="contact" name="contact" value="${esc(values.contact || "")}" autocomplete="tel" maxlength="120" placeholder="@username немесе +7..." required>
        </div>
        <div class="field full">
          <label for="experience">Инвестициядағы тәжірибең</label>
          <select id="experience" name="experience" required>
            ${selectOption("", "Таңда", values.experience)}
            ${selectOption("none", "Әлі бастаған жоқпын", values.experience)}
            ${selectOption("beginner", "Аздап тәжірибем бар", values.experience)}
            ${selectOption("active", "Қазір инвестиция жасап жүрмін", values.experience)}
          </select>
        </div>
        <div class="field full">
          <label for="goal">Қазір сен үшін ең маңызды сұрақ қандай?</label>
          <textarea id="goal" name="goal" maxlength="800" required>${esc(values.goal || "")}</textarea>
        </div>
      </div>
      <label class="consent"><input type="checkbox" name="consent" value="yes" required><span>Өтінімді өңдеуге және консультация туралы хабарласуға келісемін.</span></label>
      <button class="button primary" type="submit">Тегін консультацияға жазылу</button>
    </form>`;
}

function renderSuccess() {
  return `<div class="success"><strong>Өтінім қабылданды ✓</strong><span>Жауаптарың сақталды. Көрсеткен байланыс арнасы арқылы саған хабарласамыз.</span></div>`;
}

function selectOption(value, label, selected) {
  return `<option value="${esc(value)}"${String(value) === String(selected || "") ? " selected" : ""}>${esc(label)}</option>`;
}

function youtubeVideoId(value) {
  try {
    const url = new URL(value);
    if (url.hostname === "youtu.be") return url.pathname.slice(1).split("/")[0];
    if (url.hostname.endsWith("youtube.com")) {
      if (url.pathname === "/watch") return url.searchParams.get("v") || "";
      if (url.pathname.startsWith("/embed/")) return url.pathname.split("/")[2] || "";
    }
  } catch {
    return "";
  }
  return "";
}

function safeMediaUrl(value) {
  const url = String(value || "").trim();
  if (/^https?:\/\//i.test(url) || url.startsWith("/")) return url;
  return "";
}

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
