/* ==========================================================
   NOVA — Digitālā studija · script.js
   1 Palīgfunkcijas · 2 Navigācija · 3 Ritināšanas efekti
   4 Teksta animācijas · 5 Peles efekti · 6 3D kubs · 7 Process
   8 Projekti un forma · 9 Three.js 3D skatuve (CD) · 10 Starts
   ========================================================== */
(() => {
  'use strict';

  /* ---------- 1. PALĪGFUNKCIJAS ---------- */
  const $ = (sel, ctx = document) => ctx.querySelector(sel);
  const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (t) => t * t * (3 - 2 * t);

  let heroShift = 0; // cik pikseļu hero saturs ir nobīdīts ritinot (vajadzīgs diska izkārtojumam)

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

  // Kopīgs peles / pirksta stāvoklis (nx, ny: -1 … 1)
  const pointer = { x: innerWidth / 2, y: innerHeight / 2, nx: 0, ny: 0 };
  window.addEventListener('pointermove', (e) => {
    pointer.x = e.clientX;
    pointer.y = e.clientY;
    pointer.nx = (e.clientX / innerWidth) * 2 - 1;
    pointer.ny = (e.clientY / innerHeight) * 2 - 1;
  }, { passive: true });

  // Viena kopīga animācijas cilpa visiem efektiem
  const frameFns = [];
  const onFrame = (fn) => frameFns.push(fn);
  const loop = (t) => {
    for (const fn of frameFns) fn(t);
    requestAnimationFrame(loop);
  };

  /* ---------- 1b. KRĀSU TĒMA: sistēmas (noklusējums) / gaišā / tumšā ---------- */
  // <html data-theme="light|dark"> — faktiskā tēma; <html data-theme-pref="system|light|dark"> — lietotāja izvēle.
  // Sākotnējo tēmu pirms atveidošanas uzliek neliels skripts <head>; šeit ir slēdzis un sistēmas izmaiņu sekošana.
  const THEME_KEY = 'theme';
  const THEME_META = { dark: '#06070d', light: '#f9f5f4' };
  const THEME_LABELS = {
    system: 'Krāsu tēma: pēc ierīces iestatījuma',
    light: 'Krāsu tēma: gaišā',
    dark: 'Krāsu tēma: tumšā',
  };
  const lightMedia = window.matchMedia('(prefers-color-scheme: light)');
  const systemTheme = () => (lightMedia.matches ? 'light' : 'dark');
  const currentTheme = () => (document.documentElement.dataset.theme === 'light' ? 'light' : 'dark');

  const readThemePref = () => {
    try {
      const v = localStorage.getItem(THEME_KEY);
      return v === 'light' || v === 'dark' ? v : 'system';
    } catch (err) { return 'system'; }
  };
  const saveThemePref = (pref) => {
    try {
      if (pref === 'system') localStorage.removeItem(THEME_KEY);
      else localStorage.setItem(THEME_KEY, pref);
    } catch (err) { /* privātais režīms / file:// — izvēle neuzglabājas, bet slēdzis strādā */ }
  };

  function applyTheme(pref) {
    const root = document.documentElement;
    const resolved = pref === 'system' ? systemTheme() : pref;
    const changed = root.dataset.theme !== resolved;
    root.dataset.theme = resolved;
    root.dataset.themePref = pref;
    const meta = $('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', THEME_META[resolved]);
    // Canvas / WebGL elementi nevar lasīt CSS — tie klausās šajā notikumā
    if (changed) window.dispatchEvent(new CustomEvent('themechange', { detail: { theme: resolved } }));
  }

  function initTheme() {
    const btn = $('#themeToggle');
    let pref = readThemePref();

    const sync = () => {
      if (!btn) return;
      btn.setAttribute('aria-label', THEME_LABELS[pref]);
      btn.title = THEME_LABELS[pref];
    };
    // Secība: sistēma → pretējā tēma → tā pati tēma (skaidri izvēlēta) → sistēma.
    // Tā katrs klikšķis redzami kaut ko maina, arī tad, ja ierīce jau ir gaišā režīmā.
    const nextPref = (cur) => {
      const sys = systemTheme();
      const opposite = sys === 'light' ? 'dark' : 'light';
      if (cur === 'system') return opposite;
      if (cur === opposite) return sys;
      return 'system';
    };

    applyTheme(pref);
    sync();

    btn?.addEventListener('click', () => {
      pref = nextPref(pref);
      saveThemePref(pref);
      applyTheme(pref);
      sync();
    });

    // Ierīces tēma mainās (piem., automātiski vakarā) — seko tikai tad, ja izvēlēts "sistēma"
    const onSystemChange = () => { if (pref === 'system') applyTheme('system'); };
    if (lightMedia.addEventListener) lightMedia.addEventListener('change', onSystemChange);
    else if (lightMedia.addListener) lightMedia.addListener(onSystemChange);

    // Izvēle mainīta citā cilnē
    window.addEventListener('storage', (e) => {
      if (e.key !== THEME_KEY && e.key !== null) return;
      pref = readThemePref();
      applyTheme(pref);
      sync();
    });
  }

  /* ---------- 2. NAVIGĀCIJA ---------- */
  function initNav() {
    const wrap = $('#navbar');
    const burger = $('#burger');
    const box = $('.nav-links');
    const indicator = $('#navIndicator');
    const links = $$('.nav-link');
    const body = document.body;

    const place = (el) => {
      if (!indicator || !box) return;
      if (!el || getComputedStyle(indicator).display === 'none') {
        indicator.style.opacity = '0';
        return;
      }
      const b = box.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      indicator.style.width = r.width + 'px';
      indicator.style.transform = `translateX(${r.left - b.left - box.clientLeft}px)`;
      indicator.style.opacity = '1';
    };
    const home = () => place(links.find((l) => l.classList.contains('active')));

    const setActive = (id) => {
      links.forEach((l) => {
        const on = l.getAttribute('href') === '#' + id;
        l.classList.toggle('active', on);
        if (on) l.setAttribute('aria-current', 'true');
        else l.removeAttribute('aria-current');
      });
      home();
    };

    // Indikators seko pelei virs saitēm
    links.forEach((l) => {
      l.addEventListener('pointerenter', () => { if (finePointer) place(l); });
      l.addEventListener('focus', () => place(l));
      l.addEventListener('blur', home);
    });
    box?.addEventListener('pointerleave', home);

    // Keep the active link deterministic when multiple sections cross the viewport at once.
    const sections = $$('main section[id]').filter((section) =>
      links.some((link) => link.getAttribute('href') === '#' + section.id));
    let spyTicking = false;
    const updateActive = () => {
      spyTicking = false;
      const threshold = innerHeight * 0.5;
      const current = sections.reduce((active, section) =>
        section.getBoundingClientRect().top <= threshold ? section : active, sections[0]);
      if (current) setActive(current.id);
    };
    const requestActiveUpdate = () => {
      if (!spyTicking) {
        spyTicking = true;
        requestAnimationFrame(updateActive);
      }
    };
    window.addEventListener('scroll', requestActiveUpdate, { passive: true });

    // Mobilā izvēlne
    const setMenu = (open) => {
      body.classList.toggle('menu-open', open);
      burger.setAttribute('aria-expanded', String(open));
      burger.setAttribute('aria-label', open ? 'Aizvērt izvēlni' : 'Atvērt izvēlni');
    };
    burger.addEventListener('click', () => setMenu(!body.classList.contains('menu-open')));
    [...links, ...$$('.nav-cta')].forEach((l) => l.addEventListener('click', () => setMenu(false)));
    window.addEventListener('keydown', (e) => { if (e.key === 'Escape') setMenu(false); });
    window.addEventListener('resize', () => {
      if (innerWidth > 900) setMenu(false);
      home();
      requestActiveUpdate();
    });

    // Josla kļūst kompaktāka ritinot
    const onScroll = () => wrap.classList.toggle('is-scrolled', scrollY > 24);
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();

    window.addEventListener('load', home);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(home);
    home();
    updateActive();
  }

  /* ---------- 3. RITINĀŠANAS EFEKTI ---------- */
  function initScrollEffects() {
    const bar = $('#scrollProgress');
    const heroInner = $('#heroInner');
    let ticking = false;

    const update = () => {
      ticking = false;
      const y = scrollY;
      const max = document.documentElement.scrollHeight - innerHeight;
      bar.style.transform = `scaleX(${max > 0 ? clamp(y / max, 0, 1) : 0})`;

      // Hero saturs lēni "aizpeld" ritinot
      if (heroInner && !reduceMotion) {
        if (y < innerHeight * 1.2) {
          const p = clamp(y / (innerHeight * 0.9), 0, 1);
          heroShift = y > 0 ? y * 0.18 : 0;
          heroInner.style.transform = y > 0 ? `translate3d(0, ${y * 0.18}px, 0)` : '';
          heroInner.style.opacity = y > 0 ? String(clamp(1 - p * 1.15, 0, 1)) : '';
        }
      }
    };
    window.addEventListener('scroll', () => {
      if (!ticking) { ticking = true; requestAnimationFrame(update); }
    }, { passive: true });
    window.addEventListener('resize', update);
    update();
  }

  // Tumšā palete ir oriģinālā; gaišā — tās pašas nokrāsas, bet pasteļtoņos
  const RETRO_RINGS = {
    dark: [
      [1, '#261342'],
      [0.86, '#45154e'],
      [0.7, '#64194b'],
      [0.54, '#8a1d43'],
      [0.38, '#b43832'],
      [0.22, '#744568'],
    ],
    light: [
      [1, '#e6d9f5'],
      [0.86, '#efd2ee'],
      [0.7, '#f6c9dc'],
      [0.54, '#fabfc8'],
      [0.38, '#fcae9f'],
      [0.22, '#e9bcd0'],
    ],
  };

  function initRetroBackground() {
    const canvas = $('#retroCanvas');
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;

    let lastDraw = 0;
    let lastPixelSize = 0;
    let lastWidth = 0;
    let lastHeight = 0;

    const draw = (ms) => {
      const width = innerWidth;
      const height = innerHeight;
      const phase = (ms % 9000) / 9000;
      const pixelSize = reduceMotion ? 2 : phase < 0.14 ? 1 : phase < 0.25
        ? 1 + smooth((phase - 0.14) / 0.11) * 17
        : phase < 0.55 ? 18 : phase < 0.66
          ? 18 - smooth((phase - 0.55) / 0.11) * 17 : 1;
      const cellSize = Math.max(1, Math.round(pixelSize));

      if (ms - lastDraw < 120 && cellSize === lastPixelSize && width === lastWidth && height === lastHeight) return;
      lastDraw = ms;
      lastPixelSize = cellSize;
      lastWidth = width;
      lastHeight = height;

      const pixelWidth = Math.ceil(width / cellSize);
      const pixelHeight = Math.ceil(height / cellSize);
      if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
        canvas.width = pixelWidth;
        canvas.height = pixelHeight;
      }

      const w = canvas.width;
      const h = canvas.height;
      const drift = reduceMotion ? 0 : Math.sin(ms * 0.00012) * w * 0.025;
      context.clearRect(0, 0, w, h);
      context.save();
      context.translate(w * 0.78 + drift, h * 0.2);
      context.rotate(-0.42);

      const rings = RETRO_RINGS[currentTheme()];
      for (const [scale, color] of rings) {
        context.beginPath();
        context.ellipse(0, 0, w * 0.84 * scale, h * 0.48 * scale, 0, 0, Math.PI * 2);
        context.fillStyle = color;
        context.fill();
      }
      context.restore();
    };

    draw(0);
    if (!reduceMotion) onFrame(draw);
    // Pārzīmējam uzreiz (arī ja kustības samazinātas un nav animācijas cilpas)
    window.addEventListener('themechange', () => { lastWidth = -1; draw(performance.now()); });
  }

  function initReveal() {
    // Secīga elementu parādīšanās grupās
    $$('[data-stagger]').forEach((group) => {
      $$(':scope > .reveal', group).forEach((el, i) => el.style.setProperty('--d', (i * 0.08).toFixed(2) + 's'));
    });

    const els = $$('.reveal');
    if (!('IntersectionObserver' in window)) {
      els.forEach((el) => el.classList.add('is-visible'));
      return;
    }
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (!e.isIntersecting) return;
        e.target.classList.add('is-visible');
        io.unobserve(e.target);
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
    els.forEach((el) => io.observe(el));
  }

  /* ---------- 4. TEKSTA ANIMĀCIJAS ---------- */
  function initCounters() {
    const els = $$('[data-count]');
    const animate = (el) => {
      const end = parseFloat(el.dataset.count);
      const suffix = el.dataset.suffix || '';
      if (reduceMotion) { el.textContent = end + suffix; return; }
      const dur = 1700;
      const t0 = performance.now();
      const step = (now) => {
        const p = clamp((now - t0) / dur, 0, 1);
        el.textContent = Math.round(end * (1 - Math.pow(1 - p, 4))) + suffix;
        if (p < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    };
    if (!reduceMotion) els.forEach((el) => { el.textContent = '0' + (el.dataset.suffix || ''); });

    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (!e.isIntersecting) return;
        io.unobserve(e.target);
        animate(e.target);
      });
    }, { threshold: 0.6 });
    els.forEach((el) => io.observe(el));
  }

  function initRotator() {
    const el = $('#rotator');
    if (!el || reduceMotion) return;
    const words = (el.dataset.words || '').split('|').filter(Boolean);
    if (words.length < 2) return;

    let w = 0;
    let c = words[0].length;
    let deleting = true;

    const tick = () => {
      const word = words[w];
      c += deleting ? -1 : 1;
      el.textContent = word.slice(0, c);
      let delay = deleting ? 40 : 85;
      if (!deleting && c === word.length) { deleting = true; delay = 1900; }
      else if (deleting && c === 0) { deleting = false; w = (w + 1) % words.length; delay = 320; }
      setTimeout(tick, delay);
    };
    setTimeout(tick, 2400);
  }

  function initMarquee() {
    const track = $('#marqueeTrack');
    if (!track) return;
    // Dublējam saturu, lai animācija būtu bezgalīga bez šuves
    Array.from(track.children).forEach((n) => track.appendChild(n.cloneNode(true)));
  }

  /* ---------- 5. PELES EFEKTI ---------- */
  // Gaismas plankums kartītēs, kas seko pelei
  function initSpotlight() {
    $$('.spot').forEach((el) => {
      el.addEventListener('pointermove', (e) => {
        const r = el.getBoundingClientRect();
        el.style.setProperty('--mx', e.clientX - r.left + 'px');
        el.style.setProperty('--my', e.clientY - r.top + 'px');
      });
    });
  }

  // 3D sasvēršanās kartītēm
  function initTilt() {
    if (!finePointer || reduceMotion) return;
    $$('.tilt').forEach((el) => {
      const max = parseFloat(el.dataset.tilt) || 8;
      el.addEventListener('pointermove', (e) => {
        const r = el.getBoundingClientRect();
        const px = (e.clientX - r.left) / r.width;
        const py = (e.clientY - r.top) / r.height;
        el.style.setProperty('--ry', ((px - 0.5) * 2 * max).toFixed(2) + 'deg');
        el.style.setProperty('--rx', (-(py - 0.5) * 2 * max).toFixed(2) + 'deg');
      });
      el.addEventListener('pointerleave', () => {
        el.style.setProperty('--rx', '0deg');
        el.style.setProperty('--ry', '0deg');
      });
    });
  }

  // "Magnētiskās" pogas
  function initMagnetic() {
    if (!finePointer || reduceMotion) return;
    $$('.magnetic').forEach((el) => {
      el.addEventListener('pointermove', (e) => {
        const r = el.getBoundingClientRect();
        const x = e.clientX - (r.left + r.width / 2);
        const y = e.clientY - (r.top + r.height / 2);
        el.style.transform = `translate(${(x * 0.22).toFixed(1)}px, ${(y * 0.3).toFixed(1)}px)`;
      });
      el.addEventListener('pointerleave', () => { el.style.transform = ''; });
    });
  }

  // Pielāgots kursors: mīksta gaisma + gredzens, kas pielāgojas elementam
  function initCursor() {
    if (!finePointer) return;
    const ring = $('#cursorRing');
    const glow = $('#cursorGlow');
    const label = $('.cursor-label', ring);
    let rx = pointer.x, ry = pointer.y, gx = pointer.x, gy = pointer.y;

    const show = () => { ring.classList.add('is-on'); glow.classList.add('is-on'); };
    const hide = () => { ring.classList.remove('is-on'); glow.classList.remove('is-on'); };
    window.addEventListener('pointermove', show, { passive: true, once: true });
    document.addEventListener('mouseleave', hide);
    document.addEventListener('mouseenter', show);

    document.addEventListener('pointerover', (e) => {
      if (document.body.classList.contains('is-spinning')) return; // velkot disku uzraksts nemainās
      const withLabel = e.target.closest('[data-cursor]');
      const link = e.target.closest('a, button, input, textarea, select, label');
      ring.classList.toggle('is-label', !!withLabel);
      ring.classList.toggle('is-link', !withLabel && !!link);
      label.textContent = withLabel ? withLabel.dataset.cursor : '';
    });
    const release = () => ring.classList.remove('is-down');
    document.addEventListener('pointerdown', () => ring.classList.add('is-down'));
    document.addEventListener('pointerup', release);
    document.addEventListener('pointercancel', release);
    window.addEventListener('blur', release);

    onFrame(() => {
      rx = lerp(rx, pointer.x, 0.22);
      ry = lerp(ry, pointer.y, 0.22);
      gx = lerp(gx, pointer.x, 0.08);
      gy = lerp(gy, pointer.y, 0.08);
      // Pozīciju liekam uz atsevišķās `translate` īpašības: tā tiek piemērota PIRMS `scale`,
      // tāpēc klikšķa saspiešana (scale) vairs nepārbīda apli.
      ring.style.translate = `calc(${rx.toFixed(1)}px - 50%) calc(${ry.toFixed(1)}px - 50%)`;
      glow.style.transform = `translate3d(${gx}px, ${gy}px, 0)`;
    });
  }

  // Peldošie logi un fona "orbi" seko pelei (parallax)
  function initParallax() {
    if (reduceMotion) return;
    const floats = $$('[data-depth]');
    const orbs = $$('.orb');
    let cx = 0, cy = 0;

    onFrame(() => {
      cx = lerp(cx, pointer.nx, 0.06);
      cy = lerp(cy, pointer.ny, 0.06);
      floats.forEach((el) => {
        const d = parseFloat(el.dataset.depth) || 20;
        el.style.transform = `translate3d(${(-cx * d).toFixed(2)}px, ${(-cy * d).toFixed(2)}px, 0)`;
      });
      orbs.forEach((o, i) => {
        const d = (i + 1) * 18;
        o.style.transform = `translate3d(${(cx * d).toFixed(1)}px, ${(cy * d - scrollY * 0.03 * (i + 1)).toFixed(1)}px, 0)`;
      });
    });
  }

  /* ---------- 6. 3D KUBS ---------- */
  function initCube() {
    const scene = $('#cubeScene');
    const cube = $('#cube');
    if (!scene || !cube) return;

    let rotX = -24, rotY = 35, velX = 0, velY = 0;
    let drag = false, lastX = 0, lastY = 0, visible = false;

    new IntersectionObserver(([e]) => { visible = e.isIntersecting; }).observe(scene);

    scene.addEventListener('pointerdown', (e) => {
      drag = true;
      lastX = e.clientX;
      lastY = e.clientY;
      scene.setPointerCapture(e.pointerId);
      scene.classList.add('is-drag');
    });
    scene.addEventListener('pointermove', (e) => {
      if (!drag) return;
      velY = (e.clientX - lastX) * 0.4;
      velX = -(e.clientY - lastY) * 0.4;
      lastX = e.clientX;
      lastY = e.clientY;
      rotY += velY;
      rotX += velX;
    });
    const end = () => { drag = false; scene.classList.remove('is-drag'); };
    scene.addEventListener('pointerup', end);
    scene.addEventListener('pointercancel', end);

    let lastScroll = scrollY;
    onFrame(() => {
      if (!visible) return;
      if (!drag) {
        velX *= 0.95;
        velY *= 0.95;
        rotX += velX;
        rotY += velY + (reduceMotion ? 0 : 0.28);
        rotX = lerp(rotX, -24, 0.012); // lēni atgriežas pie sākuma leņķa
      }
      // Ritināšana papildus pagriež kubu
      rotY += (scrollY - lastScroll) * 0.12;
      lastScroll = scrollY;
      cube.style.transform = `rotateX(${rotX.toFixed(2)}deg) rotateY(${rotY.toFixed(2)}deg)`;
    });
  }

  /* ---------- 7. PROCESA TIMELINE ---------- */
  function initTimeline() {
    const tl = $('#timeline');
    if (!tl) return;
    const steps = $$('.step', tl);

    const update = () => {
      const r = tl.getBoundingClientRect();
      const line = innerHeight * 0.6;
      tl.style.setProperty('--progress', (clamp((line - r.top) / r.height, 0, 1) * 100).toFixed(1) + '%');
      steps.forEach((s) => s.classList.toggle('is-active', s.getBoundingClientRect().top < line));
    };
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    update();
  }

  /* ---------- 8. PROJEKTI UN FORMA ---------- */
  function initFilter() {
    const btns = $$('.filter-btn');
    const cards = $$('.proj');
    if (!btns.length) return;

    btns.forEach((btn) => btn.addEventListener('click', () => {
      btns.forEach((b) => {
        b.classList.toggle('is-active', b === btn);
        b.setAttribute('aria-pressed', String(b === btn));
      });
      const f = btn.dataset.filter;
      cards.forEach((card) => {
        const match = f === 'all' || card.dataset.cat.split(' ').includes(f);
        if (match) {
          card.hidden = false;
          requestAnimationFrame(() => requestAnimationFrame(() => card.classList.remove('is-out')));
        } else {
          card.classList.add('is-out');
          setTimeout(() => { if (card.classList.contains('is-out')) card.hidden = true; }, 350);
        }
      });
    }));
  }

  function initForm() {
    const form = $('#contactForm');
    if (!form) return;

    const apiBaseUrl = '/api';
    const submitButton = $('#submitBtn', form);
    const submitLabel = $('.btn-label', submitButton);
    const formError = $('.form-error', form);

    const rules = {
      name: (v) => v.trim().length >= 2 || 'Lūdzu, ievadiet savu vārdu.',
      email: (v) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim()) || 'Lūdzu, ievadiet derīgu e-pasta adresi.',
      subject: (v) => v.trim().length >= 2 || 'Lūdzu, ievadiet e-pasta virsrakstu.',
      details: (v) => v.trim().length >= 10 || 'Aprakstam jābūt vismaz 10 rakstzīmes garam.',
      quantity: (v) => Number.isInteger(Number(v)) && Number(v) > 0 || 'Lūdzu, ievadiet vismaz 1 gabalu.',
      nonnegativeQuantity: (v) => /^\d+$/.test(v) || 'Lūdzu, ievadiet veselu skaitli, kas nav mazāks par 0.',
    };

    const panels = $$('[data-form-panel]', form);
    const sections = $$('[data-order-section]', form);
    const artworkInputs = $$('[data-artwork-input]', form);
    const fileLimit = 700 * 1024 * 1024;
    const euro = new Intl.NumberFormat('lv-LV', { style: 'currency', currency: 'EUR' });

    const updatePanels = () => {
      const selectedType = form.querySelector('input[name="requestType"]:checked').value;
      $('#submitBtn .btn-label').textContent = selectedType === 'order'
        ? 'Pabeigt pasūtījuma noformēšanu'
        : 'Pabeigt ziņas noformēšanu';
      panels.forEach((panel) => {
        const isActive = panel.dataset.formPanel === selectedType;
        panel.hidden = !isActive;
        $$('input, textarea, select', panel).forEach((input) => { input.disabled = !isActive; });
      });
      updateSections();
    };

    const validate = (input) => {
      const field = input.closest('.field');
      const result = rules[input.dataset.rule || input.name](input.value);
      const ok = result === true;
      field.classList.toggle('has-error', !ok);
      $('.field-error', field).textContent = ok ? '' : result;
      input.setAttribute('aria-invalid', String(!ok));
      return ok;
    };

    const selectedQuantity = (section) => Number($(`[name="quantity${section.dataset.orderSection[0].toUpperCase()}${section.dataset.orderSection.slice(1)}"]`, section).value);

    const updatePrices = () => {
      let total = 0;
      sections.forEach((section) => {
        const quantity = selectedQuantity(section);
        if (!quantity) return;
        const options = $$('[data-finish-option]:checked', section).length;
        const burning = $$('[data-burning-option]:checked', section).length;
        total += quantity * (Number(section.dataset.unitPrice) + options * 0.5 + burning * 0.25);
      });
      $('#orderTotal').textContent = euro.format(total);
      return total;
    };

    const updateFileList = (input) => {
      const panel = input.closest('.upload-panel');
      if (!panel) return;
      const key = input.name.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
      const list = $(`[data-file-list-for="${key}"]`, panel);
      if (!list) return;
      list.replaceChildren();
      const relatedInputs = $$('input[type="file"]', panel).filter((fileInput) => fileInput.name === input.name);
      relatedInputs.flatMap((fileInput) => Array.from(fileInput.files || [])).forEach((file) => {
        const item = document.createElement('li');
        const name = document.createElement('span');
        const details = document.createElement('small');
        const extension = file.name.includes('.') ? file.name.split('.').pop().toUpperCase() : 'Fails';
        name.className = 'file-name';
        name.textContent = file.name;
        details.textContent = `${extension} · ${file.type || 'nezināms tips'} · ${formatBytes(file.size)}`;
        item.append(name, details);
        list.append(item);
      });
    };

    const formatBytes = (bytes) => {
      if (bytes < 1024) return `${bytes} B`;
      const units = ['KB', 'MB', 'GB'];
      let size = bytes / 1024;
      let unit = 0;
      while (size >= 1024 && unit < units.length - 1) {
        size /= 1024;
        unit += 1;
      }
      return `${new Intl.NumberFormat('lv-LV', { maximumFractionDigits: 1 }).format(size)} ${units[unit]}`;
    };

    const burningInputs = () => $$('[data-burning-input]', form);

    const totalBurningSize = () => burningInputs()
      .filter((input) => !input.disabled)
      .reduce((sum, input) => sum + Array.from(input.files || []).reduce((size, file) => size + file.size, 0), 0);

    const updateBurningSizeError = () => {
      const totalSize = totalBurningSize();
      const overLimit = totalSize > fileLimit;
      burningInputs().forEach((input) => {
        const panel = input.closest('.upload-panel');
        let error = $('.upload-error', panel);
        if (!error) {
          error = document.createElement('span');
          error.className = 'field-error upload-error';
          error.setAttribute('role', 'alert');
          panel.append(error);
        }
        const showError = overLimit && !input.disabled;
        error.textContent = showError ? `Iededzināšanas failu kopējais lielums (${formatBytes(totalSize)}) pārsniedz 700 MB.` : '';
        input.setAttribute('aria-invalid', String(showError));
      });
      return !overLimit;
    };

    const updateSections = () => {
      sections.forEach((section) => {
        const quantityInput = $('input[type="number"]', section);
        const options = $('.section-options', section);
        const enabled = !quantityInput.disabled && Number(quantityInput.value) > 0;
        options.disabled = !enabled;

        $$('[data-artwork-panel]', section).forEach((artworkPanel) => {
          const selected = !!$(`[data-artwork-option="${artworkPanel.dataset.artworkPanel}"]:checked`, section);
          artworkPanel.hidden = !enabled || !selected;
          $$('[data-artwork-input]', artworkPanel).forEach((input) => {
            input.disabled = !enabled || !selected;
            input.required = enabled && selected;
          });
        });

        const caseArtworkPanel = $('[data-case-artwork-panel]', section);
        if (caseArtworkPanel) {
          const selected = !!$('[data-case-artwork-option]:checked', section);
          caseArtworkPanel.hidden = !enabled || !selected;
          $$('[data-artwork-input]', caseArtworkPanel).forEach((input) => {
            input.disabled = !enabled || !selected;
            input.required = enabled && selected;
          });
        }

        const burningSelected = !!$('[data-burning-option]:checked', section);
        const burningPanel = $('[data-burning-panel]', section);
        if (burningPanel) {
          burningPanel.hidden = !enabled || !burningSelected;
          $$('[data-burning-input]', burningPanel).forEach((input) => { input.disabled = !enabled || !burningSelected; });
        }
      });
      updatePrices();
      updateBurningSizeError();
    };

    const validateArtwork = () => {
      let valid = true;
      $$('[data-artwork-input]', form).filter((input) => !input.disabled).forEach((input) => {
        const panel = input.closest('.upload-panel');
        let error = $('.upload-error', panel);
        if (!error) {
          error = document.createElement('span');
          error.className = 'field-error upload-error';
          error.setAttribute('role', 'alert');
          panel.append(error);
        }
        const hasFile = input.files && input.files.length > 0;
        error.textContent = hasFile ? '' : 'Lūdzu, pievienojiet izvēlēto zīmējumu.';
        input.setAttribute('aria-invalid', String(!hasFile));
        if (!hasFile) valid = false;
      });
      return valid;
    };

    const validateBurningUploads = () => {
      let valid = true;
      sections.forEach((section) => {
        if (!Number($('input[type="number"]', section).value) || !$('[data-burning-option]:checked', section)) return;
        const inputs = $$('[data-burning-input]', section).filter((fileInput) => fileInput.files && fileInput.files.length);
        const input = $('[data-burning-input]', section);
        const panel = input.closest('.upload-panel');
        let error = $('.upload-error', panel);
        if (!error) {
          error = document.createElement('span');
          error.className = 'field-error upload-error';
          error.setAttribute('role', 'alert');
          panel.append(error);
        }
        const hasFiles = inputs.length > 0;
        error.textContent = hasFiles ? '' : 'Lūdzu, pievienojiet vismaz vienu failu iededzināšanai.';
        input.setAttribute('aria-invalid', String(!hasFiles));
        if (!hasFiles) valid = false;
      });
      return valid;
    };

    const validateOrder = () => {
      const quantities = sections.map((section) => $('input[type="number"]', section));
      const validQuantities = quantities.map((input) => validate(input));
      const hasItems = sections.some((section) => selectedQuantity(section) > 0);
      const firstQuantity = quantities[0];
      const firstField = firstQuantity.closest('.field');
      firstField.classList.toggle('has-error', !hasItems);
      $('.field-error', firstField).textContent = hasItems ? '' : 'Lūdzu, norādiet vismaz viena produkta daudzumu.';
      const artworkValid = validateArtwork();
      const burningFilesValid = validateBurningUploads();
      const fileSizeValid = updateBurningSizeError();
      return validQuantities.every(Boolean) && hasItems && artworkValid && burningFilesValid && fileSizeValid;
    };

    const activeInputs = () => $$('[data-validate]', form).filter((input) => !input.disabled);
    const onBurningFilesChanged = (input) => {
      const panel = input.closest('.upload-panel');
      if (!panel) return;
      updateFileList(input);
      const overLimit = totalBurningSize() > fileLimit;
      let error = $('.upload-error', panel);
      if (!error) {
        error = document.createElement('span');
        error.className = 'field-error upload-error';
        error.setAttribute('role', 'alert');
        panel.append(error);
      }
      if (overLimit) {
        error.textContent = 'Iededzināšanas failu kopējais lielums pārsniedz 700 MB. Izvēlieties mazākus failus.';
        const primaryInput = $('[data-burning-input]', panel);
        if (input !== primaryInput) input.closest('.additional-file-input').remove();
        else input.value = '';
        updateFileList(primaryInput);
      } else {
        error.textContent = '';
      }
      updateBurningSizeError();
    };

    updatePanels();
    $$('input[name="requestType"]', form).forEach((input) => input.addEventListener('change', updatePanels));

    const inputs = $$('[data-validate]', form);
    inputs.forEach((input) => {
      input.addEventListener('blur', () => { if (input.value) validate(input); });
      input.addEventListener('input', () => {
        if (input.closest('.field').classList.contains('has-error')) validate(input);
        if (input.matches('[type="number"]')) updateSections();
      });
    });

    $$('[data-finish-option], [data-burning-option], [data-artwork-option], [data-case-artwork-option]', form)
      .forEach((input) => input.addEventListener('change', updateSections));
    [...artworkInputs, ...burningInputs()].forEach((input) => input.addEventListener('change', () => {
      if (input.hasAttribute('data-burning-input')) {
        onBurningFilesChanged(input);
        return;
      }
      updateFileList(input);
      const uploadError = $('.upload-error', input.closest('.upload-panel'));
      if (uploadError && input.files && input.files.length) {
        uploadError.textContent = '';
        input.removeAttribute('aria-invalid');
      }
      updateBurningSizeError();
    }));
    $$('[data-add-burning-files]', form).forEach((button) => button.addEventListener('click', () => {
      const original = $(`#${button.dataset.addBurningFiles}`);
      const wrapper = document.createElement('div');
      wrapper.className = 'additional-file-input';
      const input = document.createElement('input');
      input.type = 'file';
      input.multiple = true;
      input.name = original.name;
      input.dataset.burningInput = '';
      input.setAttribute('aria-label', 'Papildu faili iededzināšanai');
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'remove-files-btn';
      remove.textContent = 'Noņemt šo failu izvēli';
      remove.addEventListener('click', () => {
        wrapper.remove();
        updateFileList(original);
        updateBurningSizeError();
      });
      input.addEventListener('change', () => onBurningFilesChanged(input));
      wrapper.append(input, remove);
      button.before(wrapper);
      input.click();
    }));

    form.addEventListener('reset', () => {
      setTimeout(() => {
        updatePanels();
        $$('.additional-file-input', form).forEach((wrapper) => wrapper.remove());
        $$('.has-error', form).forEach((field) => field.classList.remove('has-error'));
        $$('.field-error', form).forEach((error) => { error.textContent = ''; });
        $$('[aria-invalid]', form).forEach((input) => input.removeAttribute('aria-invalid'));
        artworkInputs.forEach(updateFileList);
        burningInputs().filter((input) => !input.closest('.additional-file-input')).forEach(updateFileList);
        updateBurningSizeError();
        formError.hidden = true;
      }, 0);
    });

    const postApi = async (path, body) => {
      const response = await fetch(`${apiBaseUrl}/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
        body: JSON.stringify(body),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || `Pieprasījums neizdevās (${response.status}).`);
      return result;
    };

    const submitForm = async (selectedType) => {
      const files = $$('input[type="file"]', form)
        .filter((input) => !input.disabled)
        .flatMap((input) => Array.from(input.files || []).map((file) => ({
          file,
          field: input.name,
        })));
      if (files.some((item) => item.file.size < 1 || item.file.size > fileLimit)) {
        throw new Error('Fails nedrīkst būt tukšs vai lielāks par 700 MB.');
      }
      const submission = {
        requestType: selectedType,
        name: $('[name="name"]', form).value.trim(),
        email: $('[name="email"]', form).value.trim(),
        files: [],
      };

      if (selectedType === 'order') {
        submission.items = sections
          .map((section) => ({
            product: section.dataset.orderSection,
            quantity: selectedQuantity(section),
            options: $$('input[type="checkbox"]:checked', section).map((input) => input.name),
          }))
          .filter((item) => item.quantity > 0);
        submission.details = $('[name="orderDetails"]', form).value.trim();
        submission.estimatedTotalCents = Math.round(updatePrices() * 100);
      } else {
        submission.subject = $(`[name="${selectedType}Subject"]`, form).value.trim();
        submission.details = $(`[name="${selectedType}Details"]`, form).value.trim();
      }

      if (selectedType === 'order') {
        const startedOrder = await postApi('start-order', {});
        submission.orderNumber = startedOrder.orderNumber;
      }

      for (const [index, item] of files.entries()) {
        submitLabel.textContent = `Augšupielādē failu ${index + 1}/${files.length}...`;
        const contentType = item.file.type || 'application/octet-stream';
        const signedUpload = await postApi('get-upload-url', {
          orderNumber: submission.orderNumber,
          fileName: item.file.name,
          fileType: contentType,
          fileSize: item.file.size,
          field: item.field,
        });
        const uploadResponse = await fetch(signedUpload.uploadUrl, {
          method: 'PUT',
          headers: { 'Content-Type': contentType, ...signedUpload.uploadHeaders },
          body: item.file,
        });
        if (!uploadResponse.ok) {
          throw new Error(`Neizdevās augšupielādēt failu "${item.file.name}" (HTTP ${uploadResponse.status}).`);
        }
        submission.files.push({
          key: signedUpload.fileKey,
          name: item.file.name,
          contentType,
          size: item.file.size,
          field: item.field,
        });
      }

      submitLabel.textContent = 'Nosūta informāciju...';
      return postApi('submit-order', submission);
    };

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const selectedType = form.querySelector('input[name="requestType"]:checked').value;
      const currentInputs = activeInputs().filter((input) => !input.matches('[type="number"]') || selectedType === 'order');
      const results = currentInputs.map(validate);
      const orderValid = selectedType !== 'order' || validateOrder();
      if (!results.every(Boolean) || !orderValid) {
        const firstInvalid = currentInputs.find((input) => input.getAttribute('aria-invalid') === 'true');
        if (firstInvalid) firstInvalid.focus();
        else if (selectedType === 'order') {
          const missingUpload = $('[data-artwork-input][aria-invalid="true"], [data-burning-input][aria-invalid="true"]', form);
          if (missingUpload) missingUpload.focus();
          else $('input[type="number"]', sections[0]).focus();
        }
        return;
      }

      submitButton.disabled = true;
      formError.hidden = true;
      formError.textContent = '';
      try {
        const result = await submitForm(selectedType);
        const successMessage = selectedType === 'order'
          ? `Pasūtījums ir nosūtīts. Numurs: ${result.orderNumber}. Faili saglabāti Cloudflare R2, bet informācija — Firebase.`
          : 'Ziņa ir nosūtīta un saglabāta Firebase.';
        form.reset();
        form.classList.add('is-sent');
        $('.form-success p', form).textContent = successMessage;
        setTimeout(() => form.classList.remove('is-sent'), 6000);
      } catch (error) {
        console.error('Neizdevās nosūtīt formu:', error);
        formError.textContent = error.message || 'Neizdevās nosūtīt formu. Lūdzu, mēģiniet vēlreiz.';
        formError.hidden = false;
      } finally {
        submitButton.disabled = false;
        if (!form.classList.contains('is-sent')) {
          submitLabel.textContent = selectedType === 'order'
            ? 'Pabeigt pasūtījuma noformēšanu'
            : 'Pabeigt ziņas noformēšanu';
        }
      }
    });
  }

  /* ---------- 9. THREE.JS 3D SKATUVE: stilizēts interaktīvs CD ---------- */

  /* ---- CD: konstantes, šeideri un uzdruka ---- */
  // R — diska rādiuss, HOLE — caurums, HUB — caurspīdīgā centra mala (visi normalizēti pret R), T — biezums
  const DISC = { R: 2.4, HOLE: 0.15, HUB: 0.34, T: 0.07 };

  const DISC_VERT = `
    varying vec2 vUv;
    varying vec2 vLocal;
    varying vec3 vRadial;
    varying vec3 vViewDir;
    varying vec3 vNormalV;

    void main() {
      vUv = uv;
      vLocal = position.xy;
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      vViewDir = -mv.xyz;
      vRadial = mat3(modelViewMatrix) * vec3(position.xy, 0.0);
      vNormalV = normalMatrix * normal;
      gl_Position = projectionMatrix * mv;
    }
  `;

  // Hologrāfiskā virsma: krāsa atkarīga no tā, kā "pusvektors" (gaisma + skatiens) guļ attiecībā pret
  // celiņa rādiusa virzienu — tāpat kā īstam CD, tāpēc, diskam sagāžoties, krāsu sektori slīd pāri.
  const DISC_FRAG = `
    uniform sampler2D uTex;
    uniform vec3 uLight;
    uniform float uTime;
    uniform float uR;
    uniform float uHole;
    uniform float uHub;
    uniform float uSpin;
    uniform float uPulse;
    uniform float uHover;

    varying vec2 vUv;
    varying vec2 vLocal;
    varying vec3 vRadial;
    varying vec3 vViewDir;
    varying vec3 vNormalV;

    float bump(float x, float w) {
      float d = x * w;
      return exp(-d * d);
    }

    vec3 holo(float t) {
      t = fract(t) * 5.0;
      float f = fract(t);
      f = f * f * (3.0 - 2.0 * f);
      vec3 c0 = vec3(0.13, 0.83, 0.93);
      vec3 c1 = vec3(0.49, 0.36, 1.00);
      vec3 c2 = vec3(1.00, 0.36, 0.66);
      vec3 c3 = vec3(1.00, 0.82, 0.48);
      vec3 c4 = vec3(0.36, 0.96, 0.66);
      if (t < 1.0) return mix(c0, c1, f);
      if (t < 2.0) return mix(c1, c2, f);
      if (t < 3.0) return mix(c2, c3, f);
      if (t < 4.0) return mix(c3, c4, f);
      return mix(c4, c0, f);
    }

    void main() {
      float r = length(vLocal) / uR;
      if (r < uHole) discard;

      bool front = gl_FrontFacing;
      vec3 N = normalize(vNormalV);
      if (!front) N = -N;
      vec3 V = normalize(vViewDir);
      vec3 L = normalize(uLight);
      vec3 Rd = normalize(vRadial);
      vec3 H = normalize(L + V);

      float g = dot(H, Rd);
      float fres = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 2.0);
      float glare = pow(1.0 - clamp(abs(g) * 1.4, 0.0, 1.0), 3.0);

      vec3 rain = holo(g * 1.9 + r * 0.25 + 0.04 * sin(uTime * 0.5));
      vec3 metal = mix(vec3(0.10, 0.11, 0.22), vec3(0.90, 0.93, 1.0), 0.30 + 0.70 * glare);
      vec3 col = mix(metal, rain, 0.62);
      col += glare * 0.22 + fres * 0.10 + uHover * 0.05;

      // uzdruka (celiņi, teksts, iedaļas); griežoties ātri — izplūst
      vec2 uv = front ? vUv : vec2(1.0 - vUv.x, vUv.y);
      vec4 tx = texture2D(uTex, uv);
      col = mix(col, tx.rgb, tx.a * (1.0 - uSpin * 0.85));

      // caurspīdīgais centrs
      float inHub = 1.0 - smoothstep(uHub - 0.003, uHub + 0.003, r);
      vec3 hubCol = vec3(0.82, 0.90, 1.0) * (0.45 + 0.55 * glare) + rain * 0.2;
      float hubA = clamp(0.20 + 0.50 * fres + 0.35 * glare, 0.0, 0.9);
      col = mix(col, hubCol, inHub);
      float alpha = mix(1.0, hubA, inHub);

      float edge = bump(r - uHub, 80.0);
      col += edge * 0.55;
      alpha = max(alpha, edge * 0.9);
      float rimHole = bump(r - uHole, 90.0);
      col += rimHole * 0.5;
      alpha = max(alpha, rimHole);

      // spilgta malas josla
      col = mix(col, vec3(0.97, 0.98, 1.0), smoothstep(0.975, 1.0, r) * 0.55);

      // klikšķa vilnis no centra uz malu
      col += bump(r - uPulse * 1.25, 12.0) * step(uPulse, 1.0) * vec3(0.90, 0.96, 1.0) * 0.85;

      if (!front) col *= 0.8;
      gl_FragColor = vec4(col, alpha);
    }
  `;

  // Diska uzdruka uz 2D kanvas: celiņi, apļveida teksts, iedaļas un asimetriski loki
  function drawDiscLabel(g, size) {
    const K = size / 2;
    const TAU = Math.PI * 2;
    const d = (deg) => (deg * Math.PI) / 180;
    const ink = (a) => `rgba(12, 14, 34, ${a})`;
    const ring = (r, w, a) => {
      g.strokeStyle = ink(a);
      g.lineWidth = w;
      g.beginPath();
      g.arc(0, 0, r * K, 0, TAU);
      g.stroke();
    };
    const arc = (r, a0, a1, w, a) => {
      g.strokeStyle = ink(a);
      g.lineWidth = w * K;
      g.lineCap = 'round';
      g.beginPath();
      g.arc(0, 0, r * K, a0, a1);
      g.stroke();
    };
    // Teksts pa apli; atstarpes vienmērīgi sadalītas, lai teksts noslēdzas bez šuves
    const arcText = (text, r, px, weight, alpha) => {
      g.font = `${weight} ${px}px "Space Grotesk", "Inter", system-ui, sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillStyle = ink(alpha);
      const unit = [...text].reduce((s, c) => s + g.measureText(c).width, 0);
      const circ = TAU * r * K;
      const chars = [...text.repeat(Math.max(1, Math.floor(circ / (unit * 1.25))))];
      const widths = chars.map((c) => g.measureText(c).width);
      const gap = (circ - widths.reduce((s, w) => s + w, 0)) / chars.length;
      let a = -Math.PI / 2;
      chars.forEach((c, i) => {
        a += widths[i] / 2 / (r * K);
        g.save();
        g.rotate(a);
        g.translate(r * K, 0);
        g.rotate(Math.PI / 2);
        g.fillText(c, 0, 0);
        g.restore();
        a += (widths[i] / 2 + gap) / (r * K);
      });
    };

    g.clearRect(0, 0, size, size);
    g.save();
    g.translate(K, K);

    // 1) celiņi
    g.lineWidth = Math.max(1, size / 1024);
    for (let r = DISC.HUB + 0.08, i = 0; r < 0.985; r += 0.0055, i++) ring(r, g.lineWidth, i % 8 === 0 ? 0.11 : 0.05);

    // 2) līnijas
    ring(DISC.HUB + 0.045, size / 330, 0.55);
    ring(DISC.HUB + 0.075, size / 900, 0.35);
    ring(0.79, size / 700, 0.35);
    ring(0.975, size / 420, 0.5);

    // 3) iedaļas pie malas
    for (let i = 0; i < 120; i++) {
      const a = (i / 120) * TAU;
      const long = i % 10 === 0;
      const r0 = long ? 0.915 : 0.935;
      g.strokeStyle = ink(long ? 0.75 : 0.42);
      g.lineWidth = size / (long ? 420 : 800);
      g.beginPath();
      g.moveTo(Math.cos(a) * r0 * K, Math.sin(a) * r0 * K);
      g.lineTo(Math.cos(a) * 0.96 * K, Math.sin(a) * 0.96 * K);
      g.stroke();
    }

    // 4) teksts
    arcText('  CDify  ', 0.865, size * 0.15 , 800, 0.85);
    arcText('SIDE A  ·  VOL. 01  ·  2026  ·  ', 0.555, size * 0.03, 600, 0.78);

    // 5) asimetriski loki un "play" trijstūris — pēc tiem redzams, ka disks griežas
    arc(0.69, d(-70), d(-10), 0.022, 0.9);
    arc(0.69, d(15), d(32), 0.022, 0.9);
    arc(0.69, d(40), d(46), 0.022, 0.9);
    arc(0.69, d(110), d(190), 0.01, 0.6);
    g.save();
    g.rotate(d(215));
    g.translate(0.69 * K, 0);
    g.rotate(Math.PI / 2);
    g.fillStyle = ink(0.9);
    g.beginPath();
    g.moveTo(0, -0.04 * K);
    g.lineTo(0.035 * K, 0.03 * K);
    g.lineTo(-0.035 * K, 0.03 * K);
    g.closePath();
    g.fill();
    g.restore();

    g.restore();
  }
  /* ---- CD: beigas ---- */

  function makeDiscTexture(size, aniso) {
    const cv = document.createElement('canvas');
    cv.width = cv.height = size;
    const g = cv.getContext('2d');
    drawDiscLabel(g, size);
    const tex = new THREE.CanvasTexture(cv);
    tex.anisotropy = aniso;
    return { tex, redraw() { drawDiscLabel(g, size); tex.needsUpdate = true; } };
  }

  function initScene() {
    const canvas = $('#bgCanvas');
    if (!canvas || !window.THREE) { document.body.classList.add('no-webgl'); return; }

    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    } catch (err) {
      document.body.classList.add('no-webgl');
      canvas.remove();
      return;
    }
    const isSmall = () => innerWidth < 900;
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, isSmall() ? 1.5 : 2));

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    camera.position.set(0, 0, 8);
    const camHalfH = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.position.z;

    // Hierarhija: rig (vieta + izmērs) → tilt (sekošana pelei) → disc (griešanās ap savu asi)
    const rig = new THREE.Group();
    const tilt = new THREE.Group();
    const disc = new THREE.Group();
    scene.add(rig);
    rig.add(tilt);
    tilt.add(disc);

    /* --- CD --- */
    const { R, HOLE, HUB, T } = DISC;
    const label = makeDiscTexture(isSmall() ? 1024 : 2048, Math.min(8, renderer.capabilities.getMaxAnisotropy()));
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => label.redraw());

    const uniforms = {
      uTex: { value: label.tex },
      uLight: { value: new THREE.Vector3(0.3, 0.3, 1) },
      uTime: { value: 0 },
      uR: { value: R },
      uHole: { value: HOLE - 0.004 },
      uHub: { value: HUB },
      uSpin: { value: 0 },
      uPulse: { value: 2 },
      uHover: { value: 0 },
    };
    const face = new THREE.Mesh(
      new THREE.RingGeometry(R * HOLE, R, 180, 1),
      new THREE.ShaderMaterial({ uniforms, vertexShader: DISC_VERT, fragmentShader: DISC_FRAG, side: THREE.DoubleSide, transparent: true })
    );

    // Biezums: ārmala un cauruma siena
    const edgeMat = new THREE.MeshPhongMaterial({ color: 0xc9d2ff, specular: 0xffffff, shininess: 120, emissive: 0x2b3170, side: THREE.DoubleSide });
    const outerGeo = new THREE.CylinderGeometry(R, R, T, 180, 1, true);
    outerGeo.rotateX(Math.PI / 2);
    const holeGeo = new THREE.CylinderGeometry(R * HOLE, R * HOLE, T, 72, 1, true);
    holeGeo.rotateX(Math.PI / 2);
    disc.add(face, new THREE.Mesh(outerGeo, edgeMat), new THREE.Mesh(holeGeo, edgeMat));

    // Mīksts spīdums aiz diska
    const halo = new THREE.Mesh(
      new THREE.PlaneGeometry(10, 10),
      new THREE.ShaderMaterial({
        uniforms: { uTime: { value: 0 }, uGain: { value: 0.55 }, uAlpha: { value: 1 } },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: `
          varying vec2 vUv;
          uniform float uTime;
          uniform float uGain;
          uniform float uAlpha;
          void main() {
            vec2 p = vUv - 0.5;
            float a = pow(max(0.0, 1.0 - length(p) * 2.0), 2.2);
            vec3 c = mix(vec3(0.49, 0.36, 1.0), vec3(0.13, 0.83, 0.93), 0.5 + 0.5 * sin(uTime * 0.4 + p.x * 3.0));
            gl_FragColor = vec4(c * a * uGain, a * uAlpha);
          }`,
      })
    );
    halo.position.z = -0.8;
    halo.renderOrder = -1;
    rig.add(halo);

    // Tumšajā tēmā halo "spīd" (additīvs); gaišajā additīvs maisījums pazustu, tāpēc tur — mīksts, tonēts caurspīdīgums
    const applySceneTheme = () => {
      const light = currentTheme() === 'light';
      const m = halo.material;
      m.blending = light ? THREE.NormalBlending : THREE.AdditiveBlending;
      m.premultipliedAlpha = light;
      m.uniforms.uGain.value = light ? 1.0 : 0.55;
      m.uniforms.uAlpha.value = light ? 0.32 : 1.0;
    };
    applySceneTheme();
    window.addEventListener('themechange', applySceneTheme);

    // Gaismas (malai); trešā seko pelei
    scene.add(new THREE.AmbientLight(0x8a90ff, 0.7));
    const l1 = new THREE.PointLight(0x22d3ee, 2.2, 30); l1.position.set(-5, 3, 5);
    const l2 = new THREE.PointLight(0xff5ca8, 1.8, 30); l2.position.set(5, -3, 4);
    const l3 = new THREE.PointLight(0x7c5cff, 2.6, 20); l3.position.set(0, 0, 4);
    scene.add(l1, l2, l3);

    /* --- izmēri un izkārtojums (pikseļos → pasaules vienības) --- */
    let lastW = 0, lastH = 0;
    const resize = () => {
      const w = innerWidth, h = innerHeight;
      // mobilajā ignorējam adreses joslas izraisītās nelielās augstuma izmaiņas
      if (w === lastW && Math.abs(h - lastH) < 150) return;
      lastW = w; lastH = h;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    window.addEventListener('resize', resize);
    resize();

    // Kur disks atrodas hero (pie .hero-visual) un kur — kad lapa noritināta (fonā)
    const layout = { hero: { x: 0, y: 0, r: 200 }, bg: { x: 0, y: 0, r: 160 } };
    const heroVisual = $('.hero-visual');
    const computeLayout = () => {
      const W = innerWidth, H = innerHeight;
      const rect = heroVisual ? heroVisual.getBoundingClientRect() : null;
      if (rect && rect.width > 40 && rect.height > 40) {
        layout.hero.x = rect.left + rect.width / 2;
        layout.hero.y = rect.top + scrollY - heroShift + rect.height / 2;
        layout.hero.r = Math.min(rect.width, rect.height) * 0.5 * 0.9;
      } else {
        // mobilajā .hero-visual ir paslēpts — disks atrodas virs virsraksta
        const top = 90, bottom = Math.max(top + 160, H * 0.4);
        layout.hero.x = W / 2;
        layout.hero.y = (top + bottom) / 2;
        layout.hero.r = clamp((bottom - top) / 2 + 26, 80, W * 0.4);
      }
      if (W < 900) Object.assign(layout.bg, { x: W / 2, y: H * 0.5, r: W * 0.4 });
      else Object.assign(layout.bg, { x: W * 0.2, y: H * 0.56, r: Math.min(W, H) * 0.24 });
    };
    computeLayout();
    window.addEventListener('resize', computeLayout);
    window.addEventListener('load', computeLayout);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(computeLayout);
    if ('ResizeObserver' in window) new ResizeObserver(computeLayout).observe($('#hero') || document.body);

    /* --- interaktivitāte: velc, lai griezt; klikšķis = grūdiens --- */
    const state = { x: 0, y: 0, hover: 0, spin: 0, opacity: 1 };
    const cur = { x: 0, y: 0, r: 1, p: 0 };      // diska pašreizējais centrs un rādiuss ekrānā (px)
    const speed = reduceMotion ? 0 : 1;
    const IDLE = reduceMotion ? 0 : -0.55;        // brīvgaita, rad/s (negatīvs = pulksteņrādītāja virzienā)
    let omega = IDLE;                             // pašreizējais griešanās ātrums
    let drag = null;
    let pulse = 2;                                // >1 = vilnis izslēgts
    let lastMs = 0;

    const inDisc = (x, y) => {
      const dx = x - cur.x, dy = y - cur.y, rr = cur.r * 1.06;
      return dx * dx + dy * dy <= rr * rr;
    };
    const blocked = (el) => !el || !el.closest || !!el.closest('a, button, input, textarea, select, label, header, .btn');

    window.addEventListener('pointerdown', (e) => {
      if ((e.pointerType === 'mouse' && e.button !== 0) || cur.p > 0.3 || blocked(e.target) || !inDisc(e.clientX, e.clientY)) return;
      const now = performance.now();
      drag = { id: e.pointerId, ang: Math.atan2(e.clientY - cur.y, e.clientX - cur.x), t: now, st: now, sx: e.clientX, sy: e.clientY, moved: 0 };
      document.body.classList.add('is-spinning');
    }, { passive: true });

    window.addEventListener('pointermove', (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      drag.moved = Math.max(drag.moved, Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy));
      const dx = e.clientX - cur.x, dy = e.clientY - cur.y;
      if (dx * dx + dy * dy < (cur.r * 0.12) ** 2) return;   // pārāk tuvu centram leņķis nestabils
      const a = Math.atan2(dy, dx);
      let da = a - drag.ang;
      if (da > Math.PI) da -= Math.PI * 2;
      else if (da < -Math.PI) da += Math.PI * 2;
      drag.ang = a;
      const now = performance.now();
      const dt = Math.max(1, now - drag.t) / 1000;
      drag.t = now;
      disc.rotation.z -= da;                                  // disks seko pirksta/peles apļveida kustībai
      omega = lerp(omega, clamp(-da / dt, -26, 26), 0.45);
    }, { passive: true });

    const endDrag = (e) => {
      if (!drag || (e && e.pointerId !== drag.id)) return;
      if (drag.moved < 6 && performance.now() - drag.st < 400) {   // ātrs klikšķis → grūdiens + vilnis
        omega += (Math.sign(omega) || -1) * 11;
        pulse = 0;
      }
      drag = null;
      document.body.classList.remove('is-spinning');
    };
    window.addEventListener('pointerup', endDrag);
    window.addEventListener('pointercancel', endDrag);
    window.addEventListener('blur', () => endDrag());

    onFrame((ms) => {
      const t = ms * 0.001 * speed;
      const dt = Math.min(0.05, Math.max(0.001, (ms - lastMs) / 1000));
      lastMs = ms;
      const W = innerWidth, H = innerHeight;
      const wpp = (2 * camHalfH) / H;                         // pasaules vienības uz pikseli (z = 0 plaknē)

      state.x = lerp(state.x, pointer.nx, 0.05);
      state.y = lerp(state.y, pointer.ny, 0.05);

      // Pozīcija un izmērs: hero → fonā, atkarībā no ritināšanas
      const p = smooth(clamp(scrollY / (H * 0.9), 0, 1));
      cur.p = p;
      state.hover = lerp(state.hover, finePointer && p < 0.3 && (drag || inDisc(pointer.x, pointer.y)) ? 1 : 0, 0.12);
      cur.x = lerp(layout.hero.x, layout.bg.x, p);
      cur.y = lerp(layout.hero.y, layout.bg.y, p);
      cur.r = lerp(layout.hero.r, layout.bg.r, p) * (1 + state.hover * 0.035);
      rig.position.set((cur.x - W / 2) * wpp, -(cur.y - H / 2) * wpp, 0);
      rig.scale.setScalar((cur.r * wpp) / R);

      const targetOpacity = lerp(1, 0.1, p);          // ritinot disks kļūst gandrīz caurspīdīgs
      if (Math.abs(targetOpacity - state.opacity) > 0.01) {
        state.opacity = targetOpacity;
        canvas.style.opacity = targetOpacity.toFixed(2);
      }

      // Griešanās: brīvgaita → inerce pēc atlaišanas
      if (!drag) {
        omega += (IDLE - omega) * (1 - Math.exp(-dt * 0.8));
        disc.rotation.z += omega * dt;
      } else if (performance.now() - drag.t > 70) {
        omega *= 0.8;                                         // disks "turēts" — ātrums krīt
      }
      state.spin = lerp(state.spin, clamp((Math.abs(omega) - 3) / 9, 0, 1), 0.15);

      // Sasvēršanās pret peli + ritināšana
      tilt.rotation.x = lerp(-0.55, -0.15, p) + state.y * 0.38 + Math.sin(t * 0.5) * 0.04 + scrollY * 0.0004;
      tilt.rotation.y = lerp(0.32, 0.5, p) + state.x * 0.5 + Math.cos(t * 0.4) * 0.05;

      // Šeidera parametri
      if (pulse <= 1.05) pulse += dt * 0.95;
      uniforms.uTime.value = t;
      uniforms.uSpin.value = state.spin;
      uniforms.uHover.value = state.hover;
      uniforms.uPulse.value = pulse;
      uniforms.uLight.value.set(-state.x * 0.9 + Math.sin(t * 0.35) * 0.5, -state.y * 0.7 + Math.cos(t * 0.27) * 0.35 + 0.3, 1);
      halo.material.uniforms.uTime.value = t;

      l3.position.set(state.x * 6, -state.y * 4, 4);

      renderer.render(scene, camera);
    });
  }

  /* ---------- 10. STARTS ---------- */
  // Katru moduli palaižam atsevišķi, lai viena kļūda nenogāztu visu lapu
  const safe = (fn) => { try { fn(); } catch (err) { console.error('[NOVA]', fn.name, err); } };

  function init() {
    const year = $('#year');
    if (year) year.textContent = new Date().getFullYear();

    // Vietturu saites (href="#") nevajag ritināt uz augšu
    document.addEventListener('click', (e) => {
      if (e.target.closest('a[href="#"]')) e.preventDefault();
    });

    [initTheme, initNav, initScrollEffects, initRetroBackground, initMarquee, initSpotlight, initTilt, initMagnetic,
      initCursor, initParallax, initCube, initTimeline, initFilter, initForm, initScene,
      initReveal, initCounters, initRotator].forEach(safe);

    requestAnimationFrame(loop);
  }

  init();
})();
