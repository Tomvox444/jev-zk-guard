(() => {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduce) {
    document.querySelectorAll(".flow-step, .prim-list li").forEach((el) => {
      el.classList.add("in");
    });
    return;
  }

  const targets = document.querySelectorAll(".flow-step, .prim-list li");
  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add("in");
        io.unobserve(entry.target);
      }
    },
    { rootMargin: "0px 0px -8% 0px", threshold: 0.2 },
  );

  targets.forEach((el, i) => {
    el.style.transitionDelay = `${(i % 3) * 90}ms`;
    io.observe(el);
  });
})();
