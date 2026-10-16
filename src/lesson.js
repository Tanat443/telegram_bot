export function renderLessonPage({ videoUrl = "", posterUrl = "", sent = false, error = "", values = {} } = {}) {
  return `<!doctype html>
<html lang="kk">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="Халал инвестицияға 5 қадам туралы тегін сабақ.">
  <title>Тегін сабақ — Халал инвестицияға 5 қадам</title>
  <style>
    :root { --ink:#11231c; --muted:#66716c; --paper:#f2efe6; --surface:#fffdf7; --green:#163f31; --lime:#dff36d; --orange:#ef865d; --line:rgba(17,35,28,.14); --shadow:0 30px 90px rgba(18,52,40,.16); }
    * { box-sizing:border-box; }
    html, body { margin:0; min-height:100%; }
    body { color:var(--ink); background:radial-gradient(circle at 85% 5%,rgba(223,243,109,.45),transparent 31rem),radial-gradient(circle at 0 100%,rgba(239,134,93,.16),transparent 28rem),var(--paper); font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
    body::before { content:""; position:fixed; inset:0; pointer-events:none; opacity:.18; background-image:url("data:image/svg+xml,%3Csvg viewBox='0 0 180 180' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.8' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='.12'/%3E%3C/svg%3E"); z-index:20; }
    button, input { font:inherit; }
    .lesson { width:min(1560px,100%); min-height:100svh; margin:0 auto; padding:clamp(22px,3vw,48px); display:grid; grid-template-columns:minmax(440px,.9fr) minmax(560px,1.1fr); grid-template-rows:minmax(0,1fr) auto; gap:clamp(24px,3vw,50px); overflow:hidden; position:relative; }
    .copy { align-self:center; max-width:680px; position:relative; z-index:1; }
    .eyebrow { display:inline-flex; align-items:center; gap:12px; color:var(--green); font-size:clamp(13px,1.1vw,17px); font-weight:900; letter-spacing:.14em; text-transform:uppercase; }
    .eyebrow::before { content:""; width:42px; height:3px; background:var(--orange); }
    h1 { max-width:740px; margin:clamp(18px,2vh,28px) 0; font-size:clamp(46px,5vw,82px); line-height:.94; letter-spacing:-.065em; font-weight:880; }
    h1 span { color:var(--green); }
    .lead { max-width:660px; margin:0; color:var(--muted); font-size:clamp(17px,1.45vw,23px); line-height:1.5; }
    .consultation-copy { margin-top:clamp(26px,4vh,46px); padding-top:clamp(22px,3vh,34px); border-top:1px solid var(--line); }
    .consultation-copy h2 { max-width:650px; margin:0 0 12px; font-size:clamp(25px,2.2vw,38px); line-height:1.04; letter-spacing:-.045em; }
    .consultation-copy p { max-width:650px; margin:7px 0; color:var(--muted); font-size:clamp(14px,1.05vw,17px); line-height:1.45; }
    .cta-row { display:flex; align-items:center; gap:18px; margin-top:22px; }
    .button { border:0; border-radius:999px; min-height:58px; padding:16px 24px; color:#fff; background:var(--green); box-shadow:0 17px 42px rgba(22,63,49,.24); font-weight:850; cursor:pointer; transition:transform .2s ease,box-shadow .2s ease; }
    .button:hover { transform:translateY(-2px); box-shadow:0 21px 48px rgba(22,63,49,.3); }
    .micro { max-width:230px; color:var(--muted); font-size:12px; line-height:1.4; }
    .video-column { min-width:0; min-height:0; display:flex; align-items:center; }
    .video-shell { width:100%; padding:12px; border-radius:34px; background:#081712; box-shadow:var(--shadow); position:relative; overflow:hidden; }
    .video-label { position:absolute; left:30px; top:30px; z-index:2; padding:9px 13px; border-radius:999px; color:#fff; background:rgba(8,23,18,.74); backdrop-filter:blur(12px); font-size:12px; font-weight:900; letter-spacing:.1em; }
    .video-shell video, .video-shell iframe { width:100%; max-height:calc(100svh - 150px); aspect-ratio:16/9; display:block; border:0; border-radius:24px; background:#06100c; }
    .video-empty { width:100%; aspect-ratio:16/9; max-height:calc(100svh - 150px); border-radius:24px; display:grid; place-items:center; color:#fff; background:radial-gradient(circle at center,#265241,#06100c 70%); }
    .video-empty span { width:96px; height:96px; border-radius:50%; display:grid; place-items:center; background:var(--lime); color:var(--green); font-size:35px; padding-left:6px; }
    .risk { grid-column:1/-1; display:flex; justify-content:space-between; gap:28px; padding-top:18px; border-top:1px solid var(--line); color:var(--muted); font-size:12px; }
    .risk strong { color:var(--ink); white-space:nowrap; }
    dialog { width:min(760px,calc(100% - 28px)); max-height:min(880px,calc(100svh - 28px)); padding:0; border:0; border-radius:28px; color:var(--ink); background:var(--surface); box-shadow:0 36px 110px rgba(5,27,19,.34); overflow:hidden; }
    dialog::backdrop { background:rgba(7,24,18,.64); backdrop-filter:blur(10px); }
    .modal-scroll { max-height:min(880px,calc(100svh - 28px)); overflow-y:auto; padding:clamp(28px,5vw,54px); }
    .close { position:absolute; right:18px; top:18px; width:42px; height:42px; border:1px solid var(--line); border-radius:50%; color:var(--ink); background:rgba(255,255,255,.82); font-size:23px; line-height:1; cursor:pointer; z-index:2; }
    .modal-title { max-width:620px; margin:0 48px 16px 0; font-size:clamp(29px,4vw,46px); line-height:.98; letter-spacing:-.05em; }
    .modal-intro { max-width:650px; margin:8px 0; color:var(--muted); font-size:16px; line-height:1.5; }
    .form-error { margin:20px 0; padding:13px 15px; border-radius:13px; color:#812c2c; background:#fde7df; font-weight:700; }
    form { margin-top:30px; }
    fieldset { margin:0 0 24px; padding:0; border:0; }
    legend, .field-label { display:block; width:100%; margin-bottom:10px; font-size:15px; font-weight:850; }
    .text-input { width:100%; min-height:54px; border:1px solid var(--line); border-radius:14px; color:var(--ink); background:#fff; padding:14px 16px; outline:0; }
    .text-input:focus { border-color:var(--green); box-shadow:0 0 0 3px rgba(22,63,49,.1); }
    .radio-list { display:grid; gap:9px; }
    .radio-option { display:flex; align-items:flex-start; gap:12px; padding:13px 15px; border:1px solid var(--line); border-radius:14px; background:#fff; cursor:pointer; }
    .radio-option:has(input:checked) { border-color:var(--green); background:#edf2e7; box-shadow:inset 0 0 0 1px var(--green); }
    .radio-option input { margin-top:4px; accent-color:var(--green); }
    .submit { width:100%; }
    .hp { position:absolute; left:-9999px; width:1px; height:1px; overflow:hidden; }
    .success { text-align:center; padding:64px 20px; }
    .success-mark { width:78px; height:78px; margin:0 auto 22px; border-radius:50%; display:grid; place-items:center; color:var(--green); background:var(--lime); font-size:36px; font-weight:900; }
    .success h2 { margin:0; font-size:34px; letter-spacing:-.04em; }
    @media (min-width:781px) and (max-height:950px) {
      html, body { overflow:hidden; }
      .lesson { height:100svh; min-height:0; padding:24px 36px 18px; gap:20px 42px; }
      .copy { min-height:0; }
      h1 { margin:13px 0 16px; font-size:clamp(44px,4.45vw,68px); }
      .lead { font-size:clamp(16px,1.2vw,19px); }
      .consultation-copy { margin-top:20px; padding-top:18px; }
      .consultation-copy h2 { margin-bottom:8px; font-size:clamp(24px,1.9vw,31px); }
      .consultation-copy p { margin:5px 0; font-size:clamp(13px,.95vw,15px); }
      .cta-row { margin-top:16px; }
      .button { min-height:52px; padding:13px 21px; }
      .risk { padding-top:10px; }
    }
    @media (max-width:1050px) { .lesson { grid-template-columns:1fr 1fr; padding:24px; gap:24px; } h1 { font-size:clamp(42px,5.7vw,64px); } .consultation-copy { margin-top:24px; padding-top:20px; } .consultation-copy h2 { font-size:26px; } }
    @media (max-width:780px) { .lesson { min-height:100svh; height:auto; grid-template-columns:1fr; grid-template-rows:auto auto auto; overflow:visible; padding:22px 16px; } .copy { max-width:none; } h1 { max-width:680px; font-size:clamp(43px,12vw,66px); } .lead { font-size:16px; } .video-column { grid-row:2; } .video-shell video,.video-shell iframe,.video-empty { max-height:none; } .risk { grid-column:1; } }
    @media (max-width:520px) { h1 { font-size:42px; } .cta-row,.risk { display:grid; } .button { width:100%; } .micro { max-width:none; } .video-shell { padding:7px; border-radius:22px; } .video-shell video,.video-shell iframe,.video-empty { border-radius:16px; } .video-label { left:18px; top:18px; } .modal-scroll { padding:28px 20px; } }
    @media (prefers-reduced-motion:reduce) { * { transition:none!important; } }
  </style>
</head>
<body>
  <main class="lesson">
    <section class="copy">
      <div class="eyebrow">Тегін сабақ</div>
      <h1>Алғашқы акцияңды алмас бұрын: <span>халал инвестицияға 5 қадам</span></h1>
      <p class="lead">Инвестицияны неден бастау, халал акцияны қалай тексеру және қандай қателерден сақтану керегін осы сабақта түсіндірдім.</p>
      <div class="consultation-copy">
        <h2>Өзіңнің неден бастауың керегін білгің келе ме?</h2>
        <p>Тегін консультацияда мақсатыңды, тәжірибеңді және инвестицияға қатысты сұрақтарыңды бірге талқылаймыз.</p>
        <p>Саған сәйкес келсе, 5 айлық сүйемелдеу бағдарламасының форматы мен шарттарын түсіндіремін.</p>
        <div class="cta-row">
          <button class="button" type="button" data-open-consultation>Тегін консультацияға жазылу</button>
          <span class="micro">Қысқа сауалнаманы толтыр — кездесуге дайындалуыма көмектеседі.</span>
        </div>
      </div>
    </section>
    <section class="video-column" aria-label="Сабақ видеосы">
      <div class="video-shell"><div class="video-label">Сабақ видеосы</div>${renderVideo(videoUrl, posterUrl)}</div>
    </section>
    <footer class="risk"><strong>Инвестицияда шығын тәуекелі бар.</strong><span>Табысқа кепілдік берілмейді.</span></footer>
  </main>
  <dialog id="consultationDialog"${error || sent ? " data-auto-open" : ""}>
    <button class="close" type="button" data-close-consultation aria-label="Жабу">×</button>
    <div class="modal-scroll">${sent ? renderSuccess() : renderForm(error, values)}</div>
  </dialog>
  <script>
    const dialog = document.getElementById('consultationDialog');
    document.querySelectorAll('[data-open-consultation]').forEach((button) => button.addEventListener('click', () => dialog.showModal()));
    document.querySelectorAll('[data-close-consultation]').forEach((button) => button.addEventListener('click', () => dialog.close()));
    dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); });
    if (dialog.hasAttribute('data-auto-open')) dialog.showModal();
  </script>
</body>
</html>`;
}

function renderForm(error, values) {
  return `<h2 class="modal-title">Халал инвестицияны неден бастау керегін бірге анықтайық</h2>
    <p class="modal-intro">Асқат Құралмен тегін консультацияға қатысу үшін қысқа сауалнаманы толтыр.</p>
    <p class="modal-intro">Мақсатыңды, тәжірибеңді және саған кедергі болып тұрған сұрақтарды талқылаймыз.</p>
    ${error ? `<div class="form-error">${esc(error)}</div>` : ""}
    <form method="post" action="/lesson/consultation">
      <div class="hp" aria-hidden="true"><label>Website<input name="website" tabindex="-1" autocomplete="off"></label></div>
      <fieldset><label class="field-label" for="name">1. Атың</label><input class="text-input" id="name" name="name" value="${esc(values.name || "")}" placeholder="Атыңды жаз" autocomplete="name" maxlength="80" required></fieldset>
      <fieldset><label class="field-label" for="contact">2. WhatsApp нөмірің</label><input class="text-input" id="contact" name="contact" value="${esc(values.contact || "")}" placeholder="+7 ___ ___ __ __" autocomplete="tel" inputmode="tel" maxlength="24" required></fieldset>
      <fieldset><legend>3. Инвестициядағы тәжірибең қандай?</legend><div class="radio-list">
        ${radioOption("experience", "none", "Әлі бастаған жоқпын", values.experience)}
        ${radioOption("experience", "account", "Брокерлік шотым бар, бірақ неден бастарымды білмеймін", values.experience)}
        ${radioOption("experience", "tried", "Инвестиция жасап көрдім, нақты жүйем жоқ", values.experience)}
        ${radioOption("experience", "portfolio", "Портфелім бар, білімімді тереңдеткім келеді", values.experience)}
      </div></fieldset>
      <fieldset><legend>4. Инвестиция арқылы қандай мақсатқа жеткің келеді?</legend><div class="radio-list">
        ${radioOption("goal", "capital", "Өзіме немесе балама ұзақ мерзімге капитал жинау", values.goal)}
        ${radioOption("goal", "halal", "Жинағымды халал жолмен инвестициялау", values.goal)}
        ${radioOption("goal", "income", "Қосымша табыс мүмкіндіктерін зерттеу", values.goal)}
        ${radioOption("goal", "manage", "Қазіргі портфелімді басқаруды үйрену", values.goal)}
      </div></fieldset>
      <button class="button submit" type="submit">Тегін консультацияға жазылу</button>
    </form>`;
}

function renderSuccess() { return `<div class="success"><div class="success-mark">✓</div><h2>Өтінім қабылданды</h2></div>`; }
function radioOption(name, value, label, selected) { return `<label class="radio-option"><input type="radio" name="${name}" value="${value}"${String(value) === String(selected || "") ? " checked" : ""} required><span>${esc(label)}</span></label>`; }

function renderVideo(videoUrl, posterUrl) {
  const url = safeMediaUrl(videoUrl);
  if (!url) return `<div class="video-empty"><span>▶</span></div>`;
  const youtubeId = youtubeVideoId(url);
  if (youtubeId) return `<iframe src="https://www.youtube-nocookie.com/embed/${encodeURIComponent(youtubeId)}" title="Халал инвестицияға 5 қадам" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe>`;
  const poster = safeMediaUrl(posterUrl);
  return `<video controls playsinline preload="metadata"${poster ? ` poster="${esc(poster)}"` : ""}><source src="${esc(url)}">Браузеріңіз видеоны қолдамайды.</video>`;
}

function youtubeVideoId(value) {
  try { const url = new URL(value); if (url.hostname === "youtu.be") return url.pathname.slice(1).split("/")[0]; if (url.hostname.endsWith("youtube.com")) { if (url.pathname === "/watch") return url.searchParams.get("v") || ""; if (url.pathname.startsWith("/embed/")) return url.pathname.split("/")[2] || ""; } } catch { return ""; }
  return "";
}
function safeMediaUrl(value) { const url = String(value || "").trim(); return /^https?:\/\//i.test(url) || url.startsWith("/") ? url : ""; }
function esc(value) { return String(value ?? "").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#39;"); }
