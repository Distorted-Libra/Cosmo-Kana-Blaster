(() => {
  const waveBanner = document.getElementById("waveBanner");
  const resetBtn = document.getElementById("resetBtn");

  function clearWaveBanner() {
    if (!waveBanner) return;
    waveBanner.textContent = "";
    waveBanner.classList.remove("is-visible", "is-boss");
  }

  window.addEventListener("keydown", event => {
    if (event.key !== "Escape") return;
    setTimeout(clearWaveBanner, 0);
  });

  if (resetBtn) {
    resetBtn.addEventListener("click", () => {
      setTimeout(clearWaveBanner, 0);
    });
  }
})();
