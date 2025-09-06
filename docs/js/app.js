(async function () {
  const el = document.getElementById("app");
  el.textContent = "Loading…";
  try {
    const res = await fetch("./config.json");
    const config = await res.json();

    el.innerHTML = `
      <div style="display:flex; gap:12px; align-items:center; flex-wrap:wrap;">
        <label>Mode:
          <select id="mode"></select>
        </label>
        <span id="modeEcho"></span>
      </div>
      <h3 style="margin-top:16px;">Categories</h3>
      <ul id="cats" style="padding-left:18px;"></ul>
    `;

    const modeSel = document.getElementById("mode");
    config.modes.forEach(m => {
      const opt = document.createElement("option");
      opt.value = m;
      opt.textContent = m;
      modeSel.appendChild(opt);
    });
    const modeEcho = document.getElementById("modeEcho");
    const updateEcho = () => (modeEcho.textContent = `(current: ${modeSel.value})`);
    modeSel.addEventListener("change", updateEcho);
    updateEcho();

    const cats = document.getElementById("cats");
    cats.innerHTML = config.categories.map(c => `<li>${c}</li>`).join("");

    console.log("Docs app ready");
  } catch (e) {
    el.innerHTML = `<p>Could not load <code>config.json</code>. Make sure it exists in <code>docs/</code>.</p>`;
    console.error(e);
  }
})();
