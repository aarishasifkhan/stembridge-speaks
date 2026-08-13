/**
 * STEMBridge Speaks — Select-to-Read-Aloud
 * ------------------------------------------------------------
 * Highlight any word, phrase, or sentence anywhere on the page and a
 * small 🔊 button appears next to the selection. Clicking it sends the
 * selected text to the existing /tts endpoint and plays it back with
 * the correct neural voice for that language.
 *
 * Usage on a page:
 *   <script src="/js/read-aloud.js"></script>
 *
 * If a page displays Latin-script content in more than one language
 * (e.g. German examples next to English explanations), tell this
 * script which language is currently "in scope" whenever it changes:
 *
 *   window.ReadAloud.setLanguage("german");
 *
 * Script-based languages (Hebrew, Arabic, Russian, Mandarin) are
 * detected automatically from the selected characters and don't need
 * setLanguage() to be called, though it's harmless if you do.
 *
 * You can also tag a specific element/container with a data-lang
 * attribute to override detection for anything selected inside it,
 * e.g. <div data-lang="spanish">...</div>. This takes priority over
 * the page-wide setLanguage() value.
 */
(function () {
  "use strict";

  const DEFAULT_LANGUAGE = "english";
  const MAX_CHARS = 400; // keep individual TTS requests reasonably short
  const SUPPORTED_LANGUAGES = new Set([
    "german",
    "english",
    "spanish",
    "mandarin",
    "russian",
    "arabic",
    "hebrew",
  ]);

  let pageLanguage = null;
  let popupEl = null;
  let currentAudio = null;
  let selectionTimer = null;

  // ---------- language detection ----------

  function detectByScript(text) {
    if (/[\u0590-\u05FF]/.test(text)) return "hebrew";
    if (/[\u0600-\u06FF]/.test(text)) return "arabic";
    if (/[\u0400-\u04FF]/.test(text)) return "russian";
    if (/[\u4E00-\u9FFF\u3400-\u4DBF]/.test(text)) return "mandarin";
    return null;
  }

  function nearestDataLang(node) {
    let el = node && node.nodeType === 1 ? node : node && node.parentElement;
    while (el) {
      if (
        el.dataset &&
        el.dataset.lang &&
        SUPPORTED_LANGUAGES.has(el.dataset.lang)
      ) {
        return el.dataset.lang;
      }
      el = el.parentElement;
    }
    return null;
  }

  function resolveLanguage(text, anchorNode) {
    return (
      nearestDataLang(anchorNode) ||
      detectByScript(text) ||
      pageLanguage ||
      DEFAULT_LANGUAGE
    );
  }

  // ---------- helpers ----------

  function isEditableContext(node) {
    let el = node && node.nodeType === 1 ? node : node && node.parentElement;
    while (el) {
      const tag = el.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || el.isContentEditable)
        return true;
      el = el.parentElement;
    }
    return false;
  }

  function stopAnyPlayback() {
    if (currentAudio) {
      currentAudio.pause();
      currentAudio = null;
    }
  }

  // ---------- popup button ----------

  function createPopup() {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.id = "read-aloud-btn";
    btn.setAttribute("aria-label", "Read selection aloud");
    btn.textContent = "🔊";
    Object.assign(btn.style, {
      position: "absolute",
      zIndex: "9999",
      display: "none",
      alignItems: "center",
      justifyContent: "center",
      width: "38px",
      height: "38px",
      borderRadius: "50%",
      border: "none",
      background: "#1B4332",
      color: "#FBF7EE",
      fontSize: "16px",
      lineHeight: "1",
      cursor: "pointer",
      boxShadow: "0 4px 14px rgba(0,0,0,0.28)",
      transition: "transform 0.12s ease",
      padding: "0",
    });
    btn.addEventListener("mouseenter", () => {
      btn.style.transform = "scale(1.1)";
    });
    btn.addEventListener("mouseleave", () => {
      btn.style.transform = "scale(1)";
    });
    // Prevent mousedown on the button from collapsing the text selection
    // before the click handler runs.
    btn.addEventListener("mousedown", (e) => e.preventDefault());
    document.body.appendChild(btn);
    return btn;
  }

  function getPopup() {
    if (!popupEl) popupEl = createPopup();
    return popupEl;
  }

  function hidePopup() {
    if (popupEl) popupEl.style.display = "none";
  }

  function positionPopup(rect) {
    const btn = getPopup();
    const gap = 10;
    const btnSize = 38;

    let top = rect.top + window.scrollY - btnSize - gap;
    if (top < window.scrollY + 4) {
      // not enough room above; place below the selection instead
      top = rect.bottom + window.scrollY + gap;
    }

    let left = rect.left + window.scrollX + rect.width / 2 - btnSize / 2;
    const minLeft = window.scrollX + 6;
    const maxLeft = window.scrollX + window.innerWidth - btnSize - 6;
    left = Math.max(minLeft, Math.min(left, maxLeft));

    btn.style.top = top + "px";
    btn.style.left = left + "px";
    btn.style.display = "flex";
  }

  // ---------- playback ----------

  async function playText(text, lang, btn) {
    stopAnyPlayback();
    const original = btn.textContent;
    btn.textContent = "⏳";
    btn.disabled = true;
    try {
      const res = await fetch("/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, language: lang, level: "B2" }),
      });
      const data = await res.json();
      if (!data.audio) throw new Error("No audio returned from /tts");

      currentAudio = new Audio("data:audio/mp3;base64," + data.audio);
      currentAudio.onended = () => {
        btn.textContent = original;
        btn.disabled = false;
      };
      currentAudio.onerror = () => {
        btn.textContent = original;
        btn.disabled = false;
      };
      await currentAudio.play();
    } catch (err) {
      console.error("Read-aloud playback failed:", err);
      btn.textContent = original;
      btn.disabled = false;
    }
  }

  // ---------- selection handling ----------

  function handleSelection() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
      hidePopup();
      return;
    }

    const text = sel.toString().trim();
    if (!text) {
      hidePopup();
      return;
    }

    if (isEditableContext(sel.anchorNode)) {
      hidePopup();
      return;
    }

    const range = sel.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    if (!rect || (rect.width === 0 && rect.height === 0)) {
      hidePopup();
      return;
    }

    const clipped = text.length > MAX_CHARS ? text.slice(0, MAX_CHARS) : text;
    const lang = resolveLanguage(clipped, sel.anchorNode);

    positionPopup(rect);
    const btn = getPopup();
    btn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      playText(clipped, lang, btn);
    };
  }

  function scheduleHandleSelection(delay) {
    clearTimeout(selectionTimer);
    selectionTimer = setTimeout(handleSelection, delay);
  }

  document.addEventListener("mouseup", () => scheduleHandleSelection(10));
  document.addEventListener("touchend", () => scheduleHandleSelection(250));

  // Backstop for selections that change without mouseup/touchend firing
  // cleanly (e.g. dragging selection handles on mobile), and for hiding
  // the button once a selection is cleared.
  document.addEventListener("selectionchange", () => {
    clearTimeout(selectionTimer);
    selectionTimer = setTimeout(() => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed) hidePopup();
    }, 250);
  });

  document.addEventListener("mousedown", (e) => {
    if (popupEl && !popupEl.contains(e.target)) hidePopup();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") hidePopup();
  });

  window.addEventListener("scroll", hidePopup, true);
  window.addEventListener("resize", hidePopup);

  // ---------- public API ----------

  window.ReadAloud = {
    /**
     * Tell the script which language is currently "in scope" on this
     * page, for Latin-script content that unicode detection can't
     * distinguish (German/Spanish/English etc.). Call this whenever
     * the page's active language changes.
     */
    setLanguage(langKey) {
      pageLanguage = SUPPORTED_LANGUAGES.has(langKey) ? langKey : null;
    },
  };
})();
