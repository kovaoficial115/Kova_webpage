/**
 * Parallax suave: los elementos con [data-parallax="<velocidad>"] se desplazan un poco más lento que la página
 * mientras su sección cruza la pantalla. La velocidad es una fracción de la altura del elemento (0.08 = 8 %);
 * negativa, se mueve en sentido contrario. El movimiento se amortigua (no va pegado a la rueda) para que se sienta
 * orgánico, solo se calcula mientras la sección está visible y se desactiva con «reducir movimiento».
 */
const reduce = matchMedia('(prefers-reduced-motion: reduce)');

export function initParallax(root = document) {
  const items = [...root.querySelectorAll('[data-parallax]')].map((el) => ({
    el,
    speed: Number(el.dataset.parallax) || 0,
    host: el.closest('[data-parallax-host]') ?? el.parentElement,
    current: 0,
    target: 0,
  }));
  if (!items.length || !('IntersectionObserver' in window)) return;

  const visible = new Set();
  let frame = 0;

  const measure = () => {
    const vh = innerHeight;
    visible.forEach((it) => {
      const r = it.host.getBoundingClientRect();
      // -1 cuando la sección entra por abajo, 0 en el centro de la pantalla, 1 cuando sale por arriba.
      const progress = Math.max(-1, Math.min(1, (vh / 2 - (r.top + r.height / 2)) / ((vh + r.height) / 2)));
      it.target = progress * it.speed * it.el.offsetHeight;
    });
  };

  const tick = () => {
    frame = 0;
    let moving = false;
    visible.forEach((it) => {
      it.current += (it.target - it.current) * 0.12;
      if (Math.abs(it.target - it.current) < 0.05) it.current = it.target;
      else moving = true;
      it.el.style.translate = `0 ${it.current.toFixed(2)}px`;
    });
    if (moving) frame = requestAnimationFrame(tick);
  };

  const update = () => {
    if (reduce.matches || !visible.size) return;
    measure();
    if (!frame) frame = requestAnimationFrame(tick);
  };

  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      items.filter((it) => it.host === e.target).forEach((it) => (e.isIntersecting ? visible.add(it) : visible.delete(it)));
    });
    update();
  }, { rootMargin: '10% 0px' });
  new Set(items.map((it) => it.host)).forEach((h) => io.observe(h));

  const toggle = () => {
    document.documentElement.classList.toggle('has-parallax', !reduce.matches);
    if (reduce.matches) {
      cancelAnimationFrame(frame);
      frame = 0;
      items.forEach((it) => { it.current = it.target = 0; it.el.style.translate = ''; });
    } else update();
  };
  reduce.addEventListener?.('change', toggle);
  addEventListener('scroll', update, { passive: true });
  addEventListener('resize', update, { passive: true });
  toggle();
}
