/* ==========================================================
   NOVA — Digitālā studija · script.js
   1 Palīgfunkcijas · 2 Navigācija · 3 Ritināšanas efekti
   4 Teksta animācijas · 5 Peles efekti · 6 3D kubs · 7 Process
   8 Projekti un forma · 9 Three.js 3D skatuve · 10 Starts
   ========================================================== */
(() => {
  'use strict';

  /* ---------- 1. PALĪGFUNKCIJAS ---------- */
  const $ = (sel, ctx = document) => ctx.querySelector(sel);
  const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (t) => t * t * (3 - 2 * t);

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

    // Scroll-spy
    const spy = new IntersectionObserver((entries) => {
      entries.forEach((e) => { if (e.isIntersecting) setActive(e.target.id); });
    }, { rootMargin: '-45% 0px -50% 0px' });
    $$('main section[id]').forEach((s) => spy.observe(s));

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
    });

    // Josla kļūst kompaktāka ritinot
    const onScroll = () => wrap.classList.toggle('is-scrolled', scrollY > 24);
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();

    window.addEventListener('load', home);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(home);
    home();
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
      const withLabel = e.target.closest('[data-cursor]');
      const link = e.target.closest('a, button, input, textarea, select, label');
      ring.classList.toggle('is-label', !!withLabel);
      ring.classList.toggle('is-link', !withLabel && !!link);
      label.textContent = withLabel ? withLabel.dataset.cursor : '';
    });
    document.addEventListener('pointerdown', () => ring.classList.add('is-down'));
    document.addEventListener('pointerup', () => ring.classList.remove('is-down'));

    onFrame(() => {
      rx = lerp(rx, pointer.x, 0.22);
      ry = lerp(ry, pointer.y, 0.22);
      gx = lerp(gx, pointer.x, 0.08);
      gy = lerp(gy, pointer.y, 0.08);
      ring.style.transform = `translate3d(${rx}px, ${ry}px, 0)`;
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

    const rules = {
      name: (v) => v.trim().length >= 2 || 'Lūdzu, ievadiet savu vārdu.',
      email: (v) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim()) || 'Lūdzu, ievadiet derīgu e-pasta adresi.',
      message: (v) => v.trim().length >= 10 || 'Ziņai jābūt vismaz 10 rakstzīmes garai.',
    };

    const validate = (input) => {
      const field = input.closest('.field');
      const result = rules[input.name](input.value);
      const ok = result === true;
      field.classList.toggle('has-error', !ok);
      $('.field-error', field).textContent = ok ? '' : result;
      input.setAttribute('aria-invalid', String(!ok));
      return ok;
    };

    const inputs = Object.keys(rules).map((n) => form.elements[n]);
    inputs.forEach((input) => {
      input.addEventListener('blur', () => { if (input.value) validate(input); });
      input.addEventListener('input', () => {
        if (input.closest('.field').classList.contains('has-error')) validate(input);
      });
    });

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const results = inputs.map(validate);
      if (!results.every(Boolean)) {
        inputs[results.indexOf(false)].focus();
        return;
      }

      const btn = $('#submitBtn');
      btn.classList.add('is-loading');
      btn.disabled = true;

      // TODO: šeit jāpievieno īsta sūtīšana (fetch uz savu API, Formspree, EmailJS u.c.)
      setTimeout(() => {
        btn.classList.remove('is-loading');
        btn.disabled = false;
        form.reset();
        form.classList.add('is-sent');
        setTimeout(() => form.classList.remove('is-sent'), 6000);
      }, 1400);
    });
  }

  /* ---------- 9. THREE.JS 3D SKATUVE ---------- */
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

    const group = new THREE.Group();
    scene.add(group);

    // Kodols
    const core = new THREE.Mesh(
      new THREE.IcosahedronGeometry(1.7, 1),
      new THREE.MeshStandardMaterial({ color: 0x3a2b9e, metalness: 0.55, roughness: 0.25, flatShading: true, emissive: 0x1b1450, emissiveIntensity: 0.6 })
    );
    group.add(core);

    const wire = new THREE.LineSegments(
      new THREE.WireframeGeometry(new THREE.IcosahedronGeometry(1.74, 1)),
      new THREE.LineBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0.55 })
    );
    group.add(wire);

    const shell = new THREE.Mesh(
      new THREE.IcosahedronGeometry(2.5, 2),
      new THREE.MeshBasicMaterial({ color: 0x7c5cff, wireframe: true, transparent: true, opacity: 0.12 })
    );
    group.add(shell);

    // Gredzeni ar pavadoņiem
    const ringMat = (color, opacity) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity });
    const ring1 = new THREE.Mesh(new THREE.TorusGeometry(3.1, 0.012, 8, 220), ringMat(0x22d3ee, 0.7));
    const ring2 = new THREE.Mesh(new THREE.TorusGeometry(3.6, 0.01, 8, 220), ringMat(0xff5ca8, 0.6));
    ring1.rotation.x = Math.PI / 2.4;
    ring2.rotation.set(Math.PI / 3, 0.6, 0);
    group.add(ring1, ring2);

    const sat1 = new THREE.Mesh(new THREE.SphereGeometry(0.09, 16, 16), new THREE.MeshBasicMaterial({ color: 0x22d3ee }));
    const sat2 = new THREE.Mesh(new THREE.SphereGeometry(0.075, 16, 16), new THREE.MeshBasicMaterial({ color: 0xff5ca8 }));
    ring1.add(sat1);
    ring2.add(sat2);

    // Daļiņas
    const N = isSmall() ? 700 : 1400;
    const pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const r = 4 + Math.random() * 9;
      const th = Math.random() * Math.PI * 2;
      const ph = Math.acos(2 * Math.random() - 1);
      pos[i * 3] = r * Math.sin(ph) * Math.cos(th);
      pos[i * 3 + 1] = r * Math.sin(ph) * Math.sin(th);
      pos[i * 3 + 2] = r * Math.cos(ph) * 0.6 - 3;
    }
    const pGeo = new THREE.BufferGeometry();
    pGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const particles = new THREE.Points(pGeo, new THREE.PointsMaterial({
      color: 0xb8c4ff, size: 0.035, transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    scene.add(particles);

    // Gaismas (viena seko pelei)
    scene.add(new THREE.AmbientLight(0x6a6fff, 0.6));
    const l1 = new THREE.PointLight(0x22d3ee, 2.2, 30); l1.position.set(-5, 3, 5);
    const l2 = new THREE.PointLight(0xff5ca8, 1.8, 30); l2.position.set(5, -3, 4);
    const l3 = new THREE.PointLight(0x7c5cff, 2.6, 20); l3.position.set(0, 0, 4);
    scene.add(l1, l2, l3);

    // Izmēri
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

    const state = { x: 0, y: 0, opacity: 1 };
    const speed = reduceMotion ? 0 : 1;

    onFrame((ms) => {
      const t = ms * 0.001 * speed;
      state.x = lerp(state.x, pointer.nx, 0.05);
      state.y = lerp(state.y, pointer.ny, 0.05);

      // Pozīcija atkarīga no ritināšanas: hero → fonā
      const p = smooth(clamp(scrollY / innerHeight, 0, 1));
      const small = isSmall();
      const heroX = small ? 0 : 2.6, heroY = small ? 1.55 : 0, heroS = small ? 0.52 : 1;
      const endX = small ? 0 : -3.4, endY = small ? 0.2 : -0.2, endS = 0.55;
      group.position.set(lerp(heroX, endX, p), lerp(heroY, endY, p), 0);
      group.scale.setScalar(lerp(heroS, endS, p));

      const targetOpacity = lerp(1, 0.32, p);
      if (Math.abs(targetOpacity - state.opacity) > 0.01) {
        state.opacity = targetOpacity;
        canvas.style.opacity = targetOpacity.toFixed(2);
      }

      group.rotation.y = t * 0.12 + state.x * 0.7 + scrollY * 0.0015;
      group.rotation.x = state.y * 0.4 + Math.sin(t * 0.3) * 0.1 + scrollY * 0.0006;

      const pulse = 1 + Math.sin(t * 1.5) * 0.015;
      core.scale.setScalar(pulse);
      wire.scale.setScalar(pulse);
      shell.rotation.y = -t * 0.08;

      ring1.rotation.y = t * 0.15;
      ring2.rotation.x = Math.PI / 3 + t * 0.1;
      sat1.position.set(Math.cos(t * 0.8) * 3.1, Math.sin(t * 0.8) * 3.1, 0);
      sat2.position.set(Math.cos(-t * 0.6 + 2) * 3.6, Math.sin(-t * 0.6 + 2) * 3.6, 0);

      particles.rotation.y = t * 0.02 + scrollY * 0.0003;
      l3.position.set(state.x * 6, -state.y * 4, 4);

      renderer.render(scene, camera);
    });
  }

  /* ---------- 10. STARTS ---------- */
  // Katru moduli palaižam atsevišķi, lai viena kļūda nenogāztu visu lapu
  const safe = (fn) => { try { fn(); } catch (err) { console.error('[NOVA]', fn.name, err); } };

  let started = false;
  function start() {
    if (started) return;
    started = true;
    document.body.classList.add('is-loaded');
    safe(initReveal);
    safe(initCounters);
    safe(initRotator);
  }

  function init() {
    const year = $('#year');
    if (year) year.textContent = new Date().getFullYear();

    // Vietturu saites (href="#") nevajag ritināt uz augšu
    document.addEventListener('click', (e) => {
      if (e.target.closest('a[href="#"]')) e.preventDefault();
    });

    [initNav, initScrollEffects, initMarquee, initSpotlight, initTilt, initMagnetic,
      initCursor, initParallax, initCube, initTimeline, initFilter, initForm, initScene].forEach(safe);

    requestAnimationFrame(loop);

    const delay = reduceMotion ? 0 : 650;
    if (document.readyState === 'complete') setTimeout(start, delay);
    else window.addEventListener('load', () => setTimeout(start, delay));
    setTimeout(start, 5000); // drošības tīkls, ja kāds resurss ielādējas pārāk ilgi
  }

  init();
})();
