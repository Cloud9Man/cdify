(() => {
  'use strict';

  const $ = (selector, context = document) => context.querySelector(selector);
  const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

  const themeKey = 'theme';
  const themeButton = $('#themeToggle');
  const themeLabels = {
    system: 'Krāsu tēma: pēc ierīces iestatījuma',
    light: 'Krāsu tēma: gaišā',
    dark: 'Krāsu tēma: tumšā'
  };
  const lightMedia = window.matchMedia('(prefers-color-scheme: light)');
  const systemTheme = () => lightMedia.matches ? 'light' : 'dark';
  const readTheme = () => {
    try {
      const value = localStorage.getItem(themeKey);
      return value === 'light' || value === 'dark' ? value : 'system';
    } catch {
      return 'system';
    }
  };
  let themePreference = readTheme();

  const applyTheme = () => {
    const resolved = themePreference === 'system' ? systemTheme() : themePreference;
    document.documentElement.dataset.theme = resolved;
    document.documentElement.dataset.themePref = themePreference;
    themeButton.setAttribute('aria-label', themeLabels[themePreference]);
    themeButton.title = themeLabels[themePreference];
    const meta = $('meta[name="theme-color"]');
    if (meta) meta.content = resolved === 'light' ? '#fff8f3' : '#090714';
  };
  const nextTheme = (current) => {
    const opposite = systemTheme() === 'light' ? 'dark' : 'light';
    return current === 'system' ? opposite : current === opposite ? systemTheme() : 'system';
  };

  applyTheme();
  themeButton.addEventListener('click', () => {
    themePreference = nextTheme(themePreference);
    try {
      if (themePreference === 'system') localStorage.removeItem(themeKey);
      else localStorage.setItem(themeKey, themePreference);
    } catch {}
    applyTheme();
  });
  if (lightMedia.addEventListener) lightMedia.addEventListener('change', () => {
    if (themePreference === 'system') applyTheme();
  });
  window.addEventListener('storage', (event) => {
    if (event.key !== themeKey && event.key !== null) return;
    themePreference = readTheme();
    applyTheme();
  });

  const menu = $('#faqNavMenu');
  const burger = $('#faqBurger');
  const indicator = $('#faqNavIndicator');
  const links = [...menu.querySelectorAll('.nav-link')];
  const navLinks = menu.querySelector('.nav-links');

  const placeIndicator = (link = menu.querySelector('.nav-link.active')) => {
    if (!indicator || !link) return;
    const box = navLinks.getBoundingClientRect();
    const rect = link.getBoundingClientRect();
    indicator.style.width = `${rect.width}px`;
    indicator.style.transform = `translateX(${rect.left - box.left - navLinks.clientLeft}px)`;
    indicator.style.opacity = '1';
  };
  links.forEach((link) => {
    link.addEventListener('pointerenter', () => {
      if (finePointer) placeIndicator(link);
    });
  });
  navLinks.addEventListener('pointerleave', () => placeIndicator());
  window.addEventListener('load', () => placeIndicator());
  window.addEventListener('resize', () => placeIndicator());
  placeIndicator();

  const setMenu = (open) => {
    document.body.classList.toggle('menu-open', open);
    burger.setAttribute('aria-expanded', String(open));
    burger.setAttribute('aria-label', open ? 'Aizvērt izvēlni' : 'Atvērt izvēlni');
  };
  burger.addEventListener('click', () => setMenu(!document.body.classList.contains('menu-open')));
  menu.querySelectorAll('a').forEach((link) => link.addEventListener('click', () => setMenu(false)));
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && document.body.classList.contains('menu-open')) {
      setMenu(false);
      burger.focus();
    }
  });
  window.addEventListener('resize', () => {
    if (innerWidth > 1100) setMenu(false);
  });

  const search = $('#faqSearch');
  document.querySelectorAll('.faq-card').forEach((card) => {
    const question = card.querySelector('h3');
    if (!question) return;
    const details = document.createElement('details');
    details.className = 'faq-card';
    const summary = document.createElement('summary');
    summary.textContent = question.textContent;
    details.append(summary);
    while (question.nextSibling) details.append(question.nextSibling);
    card.replaceWith(details);
  });
  const cards = [...document.querySelectorAll('.faq-card')];
  const empty = $('#faqEmpty');
  search.addEventListener('input', () => {
    const query = search.value.trim().toLocaleLowerCase('lv');
    let visible = 0;
    cards.forEach((card) => {
      const matches = !query || card.textContent.toLocaleLowerCase('lv').includes(query);
      card.classList.toggle('is-hidden', !matches);
      if (matches) visible += 1;
    });
    document.querySelectorAll('.faq-section').forEach((section) => {
      const hasVisibleCard = [...section.querySelectorAll('.faq-card')]
        .some((card) => !card.classList.contains('is-hidden'));
      section.style.display = hasVisibleCard ? '' : 'none';
    });
    empty.classList.toggle('is-visible', visible === 0);
  });

  $('#year').textContent = new Date().getFullYear();
  $('#faqBackToTop').addEventListener('click', (event) => {
    event.preventDefault();
    window.scrollTo({ top: 0, left: 0, behavior: 'smooth' });
  });
})();
