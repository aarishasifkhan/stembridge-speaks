/**
 * STEMBridge Speaks — Bridgee the Chameleon
 * ------------------------------------------------------------
 * A floating mascot + AI tutor chat widget. Bridgee can answer
 * language-learning questions in any of the 7 languages STEMBridge
 * Speaks teaches, and gives lesson-aware answers when embedded in
 * the Learn Grammar section.
 *
 * Usage:
 *   <script src="/js/mascot-tutor.js"></script>
 *
 * Optional, to make answers lesson-aware:
 *   window.MascotTutor.setContext({
 *     language: "german",          // current course language
 *     unitTitle: "Nouns, Gender & Articles",
 *     chunkContext: "..."          // plain text of what's on screen right now
 *   });
 */
(function () {
  "use strict";

  const COLORS = {
    forest: "#1B4332",
    forestDark: "#12301F",
    gold: "#E8A33D",
    cream: "#FBF7EE",
    sage: "#E3EAE0",
    ink: "#22281E",
    brick: "#8C4A3A",
  };

  const MASCOT_NAME = "Bridgee";
  const HISTORY_LIMIT = 20;

  let context = { language: "german", unitTitle: null, chunkContext: null };

  // Each language gets its own hue so Bridgee visibly recolors when the
  // active language changes — a real payoff for "chameleon," not just
  // idle animation. Spread evenly around the color wheel.
  const LANGUAGE_HUES = {
    german: 0,
    english: 51,
    spanish: 103,
    mandarin: 154,
    russian: 206,
    arabic: 257,
    hebrew: 309,
  };

  function applyLanguageHue(languageKey) {
    if (!els.root) return;
    const hue = LANGUAGE_HUES[languageKey] ?? 0;
    els.root.style.setProperty("--mascot-hue", `${hue}deg`);
  }
  let history = []; // {role: 'user'|'assistant', text}
  let panelOpen = false;
  let greetedForLanguage = null;
  let sending = false;

  // ---------- styles ----------

  function injectStyles() {
    const style = document.createElement("style");
    style.textContent = `
      #mascot-widget * { box-sizing: border-box; }
      #mascot-widget {
        position: fixed;
        bottom: 20px;
        right: 20px;
        z-index: 9998;
        font-family: "Work Sans", -apple-system, sans-serif;
        --mascot-hue: 0deg;
      }
      #mascot-fab {
        width: 66px;
        height: 66px;
        border-radius: 50%;
        border: none;
        background: ${COLORS.gold};
        box-shadow: 0 6px 18px rgba(18,48,31,0.35);
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 6px;
        position: relative;
        transition: transform 0.15s ease;
        animation: mascotIdleBounce 3.2s ease-in-out infinite;
      }
      #mascot-fab:hover { transform: scale(1.06); }
      #mascot-fab svg { width: 100%; height: 100%; overflow: visible; }
      .mascot-colorshift {
        animation: mascotColorShift 7s ease-in-out infinite;
        transform-origin: 100px 110px;
        filter: hue-rotate(var(--mascot-hue, 0deg));
      }
      @keyframes mascotColorShift {
        0%, 100% { filter: hue-rotate(var(--mascot-hue, 0deg)); }
        50% { filter: hue-rotate(calc(var(--mascot-hue, 0deg) - 22deg)); }
      }
      @media (prefers-reduced-motion: reduce) {
        .mascot-colorshift { animation: none; }
      }
      @keyframes mascotIdleBounce {
        0%, 100% { transform: translateY(0); }
        50% { transform: translateY(-5px); }
      }
      #mascot-hint {
        position: absolute;
        bottom: 76px;
        right: 0;
        background: ${COLORS.forestDark};
        color: ${COLORS.cream};
        padding: 8px 12px;
        border-radius: 10px;
        font-size: 12.5px;
        white-space: nowrap;
        box-shadow: 0 4px 12px rgba(0,0,0,0.25);
        opacity: 0;
        transform: translateY(6px);
        transition: opacity 0.25s ease, transform 0.25s ease;
        pointer-events: none;
      }
      #mascot-hint.show { opacity: 1; transform: translateY(0); }
      #mascot-hint::after {
        content: "";
        position: absolute;
        bottom: -5px;
        right: 24px;
        width: 10px;
        height: 10px;
        background: ${COLORS.forestDark};
        transform: rotate(45deg);
      }

      #mascot-panel {
        position: fixed;
        bottom: 96px;
        right: 20px;
        width: 340px;
        max-width: calc(100vw - 24px);
        height: 480px;
        max-height: 70vh;
        background: ${COLORS.cream};
        border-radius: 18px;
        box-shadow: 0 20px 60px rgba(0,0,0,0.3);
        display: flex;
        flex-direction: column;
        overflow: hidden;
        opacity: 0;
        transform: translateY(16px) scale(0.97);
        pointer-events: none;
        transition: opacity 0.2s ease, transform 0.2s ease;
        z-index: 9999;
      }
      #mascot-panel.open {
        opacity: 1;
        transform: translateY(0) scale(1);
        pointer-events: auto;
      }
      @media (max-width: 600px) {
        #mascot-panel {
          bottom: 0;
          right: 0;
          left: 0;
          width: 100%;
          max-width: 100%;
          height: 78vh;
          max-height: 78vh;
          border-radius: 18px 18px 0 0;
        }
        #mascot-fab { width: 58px; height: 58px; }
      }

      #mascot-panel-header {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 12px 14px;
        background: ${COLORS.forestDark};
        color: ${COLORS.cream};
        flex-shrink: 0;
      }
      #mascot-panel-header svg { width: 34px; height: 34px; flex-shrink: 0; }
      #mascot-panel-header .mascot-header-text {
        flex: 1;
        min-width: 0;
      }
      #mascot-panel-header .mascot-title {
        font-family: "Fraunces", serif;
        font-weight: 700;
        font-size: 15px;
      }
      #mascot-panel-header .mascot-subtitle {
        font-size: 11px;
        opacity: 0.75;
        font-weight: 400;
        font-family: "Work Sans", sans-serif;
      }
      #mascot-close {
        background: none;
        border: none;
        color: ${COLORS.cream};
        font-size: 18px;
        cursor: pointer;
        opacity: 0.75;
        padding: 4px 6px;
      }
      #mascot-close:hover { opacity: 1; }

      #mascot-messages {
        flex: 1;
        overflow-y: auto;
        padding: 14px;
        display: flex;
        flex-direction: column;
        gap: 10px;
      }
      .mascot-msg-row { display: flex; width: 100%; }
      .mascot-msg-row.user { justify-content: flex-end; }
      .mascot-msg-row.bot { justify-content: flex-start; }
      .mascot-bubble {
        max-width: 82%;
        padding: 9px 13px;
        border-radius: 12px;
        font-size: 13.5px;
        line-height: 1.45;
        white-space: pre-wrap;
      }
      .mascot-bubble.user {
        background: ${COLORS.sage};
        color: ${COLORS.ink};
        border-bottom-right-radius: 3px;
      }
      .mascot-bubble.bot {
        background: ${COLORS.forestDark};
        color: ${COLORS.cream};
        border-bottom-left-radius: 3px;
      }
      .mascot-typing {
        display: flex;
        gap: 4px;
        padding: 4px 2px;
      }
      .mascot-typing span {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: ${COLORS.cream};
        opacity: 0.6;
        animation: mascotTypingBounce 1s infinite ease-in-out;
      }
      .mascot-typing span:nth-child(2) { animation-delay: 0.15s; }
      .mascot-typing span:nth-child(3) { animation-delay: 0.3s; }
      @keyframes mascotTypingBounce {
        0%, 80%, 100% { transform: translateY(0); opacity: 0.5; }
        40% { transform: translateY(-4px); opacity: 1; }
      }

      #mascot-input-row {
        display: flex;
        gap: 8px;
        padding: 10px;
        border-top: 1px solid rgba(27,67,50,0.1);
        flex-shrink: 0;
        background: ${COLORS.cream};
      }
      #mascot-input {
        flex: 1;
        min-width: 0;
        font-family: "Work Sans", sans-serif;
        font-size: 13.5px;
        padding: 9px 12px;
        border-radius: 18px;
        border: 1px solid rgba(27,67,50,0.25);
        background: #fff;
        color: ${COLORS.ink};
      }
      #mascot-input:disabled { opacity: 0.6; }
      #mascot-send {
        width: 36px;
        height: 36px;
        border-radius: 50%;
        border: none;
        background: ${COLORS.gold};
        color: ${COLORS.forestDark};
        font-size: 15px;
        cursor: pointer;
        flex-shrink: 0;
      }
      #mascot-send:disabled { opacity: 0.6; cursor: default; }
    `;
    document.head.appendChild(style);
  }

  // ---------- mascot SVG ----------
  // Bridgee: a small cartoon chameleon, forest-green + gold, wearing a
  // tiny graduation cap. Built from simple rounded shapes so it renders
  // crisply at any size without any external assets or 3D engine.
  function mascotSVG(idSuffix) {
    return `
    <svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <defs>
        <linearGradient id="bodyGrad${idSuffix}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#3E9767"/>
          <stop offset="100%" stop-color="#1B4332"/>
        </linearGradient>
        <radialGradient id="cheekGrad${idSuffix}" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stop-color="#F0B25A"/>
          <stop offset="100%" stop-color="#E8A33D" stop-opacity="0.4"/>
        </radialGradient>
      </defs>
      <g class="mascot-colorshift">
        <!-- tail -->
        <path d="M150 150 C 175 150, 178 128, 160 120 C 178 118, 180 96, 160 96"
              fill="none" stroke="url(#bodyGrad${idSuffix})" stroke-width="13" stroke-linecap="round"/>
        <path d="M150 150 C 175 150, 178 128, 160 120 C 178 118, 180 96, 160 96"
              fill="none" stroke="#0D2318" stroke-width="15.5" stroke-linecap="round" opacity="0.18"/>
        <!-- feet -->
        <ellipse cx="78" cy="177" rx="15" ry="8.5" fill="#12301F"/>
        <ellipse cx="126" cy="177" rx="15" ry="8.5" fill="#12301F"/>
        <!-- body -->
        <ellipse cx="102" cy="141" rx="47" ry="39" fill="url(#bodyGrad${idSuffix})" stroke="#0D2318" stroke-width="3"/>
        <!-- belly highlight -->
        <ellipse cx="102" cy="150" rx="26" ry="20" fill="#5CB884" opacity="0.35"/>
        <!-- arms -->
        <path d="M62 130 Q45 120 43 100" fill="none" stroke="#2E7D4F" stroke-width="10" stroke-linecap="round"/>
        <path d="M142 130 Q159 118 161 132" fill="none" stroke="#2E7D4F" stroke-width="10" stroke-linecap="round"/>
        <path d="M62 130 Q45 120 43 100" fill="none" stroke="#0D2318" stroke-width="12.5" stroke-linecap="round" opacity="0.15"/>
        <path d="M142 130 Q159 118 161 132" fill="none" stroke="#0D2318" stroke-width="12.5" stroke-linecap="round" opacity="0.15"/>
        <!-- head -->
        <circle cx="100" cy="82" r="53" fill="url(#bodyGrad${idSuffix})" stroke="#0D2318" stroke-width="3"/>
        <!-- head highlight -->
        <ellipse cx="82" cy="58" rx="24" ry="16" fill="#5CB884" opacity="0.3"/>
        <!-- casque nubs -->
        <circle cx="80" cy="36" r="7.5" fill="#2E7D4F" stroke="#0D2318" stroke-width="2"/>
        <circle cx="120" cy="36" r="7.5" fill="#2E7D4F" stroke="#0D2318" stroke-width="2"/>
        <!-- cheeks -->
        <circle cx="64" cy="96" r="10" fill="url(#cheekGrad${idSuffix})"/>
        <circle cx="136" cy="96" r="10" fill="url(#cheekGrad${idSuffix})"/>
      </g>
      <!-- graduation cap: deliberately NOT gold, so it never disappears against
           the gold floating button; cream + brick keep it readable anywhere -->
      <g>
        <rect x="64" y="27" width="70" height="11" rx="3" fill="#8C4A3A" stroke="#0D2318" stroke-width="2" transform="rotate(-6 100 32)"/>
        <rect x="88" y="13" width="36" height="18" rx="3" fill="#FBF7EE" stroke="#0D2318" stroke-width="2" transform="rotate(-6 108 22)"/>
        <line x1="129" y1="31" x2="135" y2="54" stroke="#12301F" stroke-width="2.5"/>
        <circle cx="135" cy="56" r="4" fill="#12301F"/>
      </g>
      <!-- eyes -->
      <circle cx="75" cy="78" r="19" fill="#FBF7EE" stroke="#0D2318" stroke-width="2.5"/>
      <circle cx="125" cy="78" r="19" fill="#FBF7EE" stroke="#0D2318" stroke-width="2.5"/>
      <circle cx="78" cy="80" r="9" fill="#12301F"/>
      <circle cx="122" cy="80" r="9" fill="#12301F"/>
      <circle cx="81.5" cy="75.5" r="3.2" fill="#FBF7EE"/>
      <circle cx="125.5" cy="75.5" r="3.2" fill="#FBF7EE"/>
      <circle cx="76" cy="83" r="1.4" fill="#FBF7EE" opacity="0.7"/>
      <circle cx="120" cy="83" r="1.4" fill="#FBF7EE" opacity="0.7"/>
      <!-- smile -->
      <path d="M82 106 Q100 120 118 106" fill="none" stroke="#0D2318" stroke-width="4" stroke-linecap="round"/>
    </svg>`;
  }

  // ---------- DOM construction ----------

  let els = {};

  function buildWidget() {
    const wrap = document.createElement("div");
    wrap.id = "mascot-widget";
    wrap.innerHTML = `
      <div id="mascot-panel" role="dialog" aria-label="${MASCOT_NAME} — AI language tutor">
        <div id="mascot-panel-header">
          ${mascotSVG("panel")}
          <div class="mascot-header-text">
            <div class="mascot-title">${MASCOT_NAME}</div>
            <div class="mascot-subtitle">Your STEMBridge language buddy</div>
          </div>
          <button id="mascot-close" aria-label="Close chat">×</button>
        </div>
        <div id="mascot-messages"></div>
        <div id="mascot-input-row">
          <input id="mascot-input" type="text" placeholder="Ask about grammar, vocab, anything..." />
          <button id="mascot-send" aria-label="Send">➤</button>
        </div>
      </div>
      <div id="mascot-hint">Doubt about this lesson? Ask me! 👋</div>
      <button id="mascot-fab" aria-label="Open ${MASCOT_NAME}, your AI language tutor">
        ${mascotSVG("fab")}
      </button>
    `;
    document.body.appendChild(wrap);

    els.root = wrap;
    els.panel = wrap.querySelector("#mascot-panel");
    els.fab = wrap.querySelector("#mascot-fab");
    els.hint = wrap.querySelector("#mascot-hint");
    els.close = wrap.querySelector("#mascot-close");
    els.messages = wrap.querySelector("#mascot-messages");
    els.input = wrap.querySelector("#mascot-input");
    els.send = wrap.querySelector("#mascot-send");

    els.fab.addEventListener("click", togglePanel);
    els.close.addEventListener("click", closePanel);
    els.send.addEventListener("click", handleSend);
    els.input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") handleSend();
    });

    // Show a one-time hint bubble a couple seconds after load to invite
    // the first click, then fade it out.
    setTimeout(() => {
      if (!panelOpen) els.hint.classList.add("show");
    }, 2200);
    setTimeout(() => {
      els.hint.classList.remove("show");
    }, 8000);
  }

  function scrollMessagesToBottom() {
    els.messages.scrollTop = els.messages.scrollHeight;
  }

  function addBubble(role, text) {
    const row = document.createElement("div");
    row.className = "mascot-msg-row " + (role === "user" ? "user" : "bot");
    const bubble = document.createElement("div");
    bubble.className = "mascot-bubble " + (role === "user" ? "user" : "bot");
    bubble.textContent = text;
    row.appendChild(bubble);
    els.messages.appendChild(row);
    scrollMessagesToBottom();
    return bubble;
  }

  function addTypingIndicator() {
    const row = document.createElement("div");
    row.className = "mascot-msg-row bot";
    row.id = "mascot-typing-row";
    row.innerHTML = `<div class="mascot-bubble bot"><div class="mascot-typing"><span></span><span></span><span></span></div></div>`;
    els.messages.appendChild(row);
    scrollMessagesToBottom();
  }

  function removeTypingIndicator() {
    const row = document.getElementById("mascot-typing-row");
    if (row) row.remove();
  }

  function languageLabel(key) {
    const labels = {
      german: "German",
      english: "English",
      spanish: "Spanish",
      mandarin: "Mandarin",
      russian: "Russian",
      arabic: "Arabic",
      hebrew: "Hebrew",
    };
    return labels[key] || "your language";
  }

  function maybeGreet() {
    if (greetedForLanguage === context.language) return;
    greetedForLanguage = context.language;
    const lessonBit = context.unitTitle
      ? ` I see you're on "${context.unitTitle}" (${languageLabel(context.language)}) — ask me about that, or about any of the 7 languages here.`
      : ` Ask me about German, English, Spanish, Mandarin, Russian, Arabic, or Hebrew — grammar, vocab, anything.`;
    addBubble("bot", `Hi, I'm ${MASCOT_NAME} 🦎${lessonBit}`);
  }

  // ---------- panel open/close ----------

  function togglePanel() {
    if (panelOpen) closePanel();
    else openPanel();
  }

  function openPanel() {
    panelOpen = true;
    els.panel.classList.add("open");
    els.hint.classList.remove("show");
    maybeGreet();
    setTimeout(() => els.input.focus(), 150);
  }

  function closePanel() {
    panelOpen = false;
    els.panel.classList.remove("open");
  }

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && panelOpen) closePanel();
  });

  // ---------- sending messages ----------

  async function handleSend() {
    const text = els.input.value.trim();
    if (!text || sending) return;
    sending = true;
    els.input.value = "";
    els.input.disabled = true;
    els.send.disabled = true;

    addBubble("user", text);
    history.push({ role: "user", text });
    addTypingIndicator();

    try {
      const res = await fetch("/api/tutor-help", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          language: context.language,
          unitTitle: context.unitTitle,
          chunkContext: context.chunkContext,
          history: history.slice(-HISTORY_LIMIT),
        }),
      });
      const data = await res.json();
      removeTypingIndicator();

      if (!res.ok) {
        addBubble(
          "bot",
          data.error || "Sorry, I couldn't answer that just now.",
        );
      } else {
        addBubble("bot", data.reply);
        history.push({ role: "assistant", text: data.reply });
        history = history.slice(-HISTORY_LIMIT);
      }
    } catch (err) {
      console.error("Mascot tutor request failed:", err);
      removeTypingIndicator();
      addBubble("bot", "I couldn't reach the server just now — try again?");
    } finally {
      sending = false;
      els.input.disabled = false;
      els.send.disabled = false;
      els.input.focus();
    }
  }

  // ---------- init ----------

  function init() {
    injectStyles();
    buildWidget();
    applyLanguageHue(context.language);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  // ---------- public API ----------

  window.MascotTutor = {
    /**
     * Tell Bridgee what the learner is currently looking at, so answers
     * can be lesson-aware. Call this whenever the active language or
     * lesson changes.
     */
    setContext({ language, unitTitle, chunkContext } = {}) {
      if (language && language !== context.language) {
        context.language = language;
        applyLanguageHue(language);
      }
      context.unitTitle = unitTitle || null;
      context.chunkContext = chunkContext
        ? String(chunkContext).slice(0, 1500)
        : null;
    },
    open: openPanel,
    close: closePanel,
  };
})();
