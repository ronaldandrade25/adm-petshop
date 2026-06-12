// links.js
import { showNotification } from "./firebase.js";

export function initLinksTab() {
  if (window.__linksTabStarted) return;
  window.__linksTabStarted = true;

  document.querySelectorAll("#linkMain [data-copy-link]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const url = btn.dataset.copyLink || "";
      if (!url) return;

      try {
        await navigator.clipboard.writeText(url);
      } catch {
        const ta = document.createElement("textarea");
        ta.value = url;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        ta.remove();
      }

      showNotification("Link copiado!");
    });
  });
}
