(function () {
  "use strict";

  const QUESTIONS = [
    "How is your body right now?",
    "What pulled you away from yourself today?",
    "What was one genuine moment today?",
    "What do you want to bring into tomorrow?",
  ];

  const STORAGE_KEY = "yuan-reflections";
  const PATTERNS_CACHE_KEY = "yuan-patterns-cache";
  const API_KEY_STORAGE = "yuan-api-key";
  const TRIAL_START_KEY = "yuan_trial_start";
  const PREMIUM_KEY = "yuan_premium";
  const PATTERNS_MIN_SESSIONS = 7;
  const TRIAL_DAYS = 30;
  const PATTERNS_WEEK_MS = 7 * 24 * 60 * 60 * 1000;
  const FREE_API_DELAY_MS = 450;
  const API_URL = "https://api.deepseek.com/chat/completions";
  const MODEL = "deepseek-chat";

  const RECENT_SESSION_COUNT = 7;

  const RESPONSE_GUIDELINES = `You are 元 (Yuan). Respond to their answer with warmth, thoughtfulness, and zero judgment. Keep your reply concise — 2 to 4 sentences. Acknowledge what they shared without fixing, lecturing, or diagnosing. Use plain, human language. You may be quietly poetic but never grandiose. Do not ask questions unless one soft invitation feels natural. Do not use bullet points or headers.`;

  const SUMMARY_PROMPT = `You are 元 (Yuan). The user has finished a four-question evening reflection. Read the full session and write a brief, warm summary in 1 to 2 sentences. Capture the emotional thread of the evening without judging or advising. Use plain language. No bullet points or headers.`;

  const PATTERNS_PROMPT = `You are 元 (Yuan). Based on these reflections, identify 3 genuine patterns in this person's life — their energy rhythms, recurring struggles, moments of joy, and progress over time. Write it warmly, like a friend who has been paying close attention.

Format your response as exactly 3 numbered paragraphs. Each paragraph must start with "1.", "2.", or "3." followed by the pattern. One pattern per paragraph. No titles, bullet points, or extra commentary.`;

  const $ = (id) => document.getElementById(id);

  const views = {
    home: $("view-home"),
    reflect: $("view-reflect"),
    complete: $("view-complete"),
    history: $("view-history"),
    session: $("view-session"),
    settings: $("view-settings"),
  };

  const els = {
    progressBar: $("progress-bar"),
    stepLabel: $("step-label"),
    questionText: $("question-text"),
    answerForm: $("answer-form"),
    answerInput: $("answer-input"),
    btnSubmit: $("btn-submit"),
    responsePanel: $("response-panel"),
    responseText: $("response-text"),
    btnNext: $("btn-next"),
    patternsSection: $("patterns-section"),
    patternsLoading: $("patterns-loading"),
    patternsContent: $("patterns-content"),
    patternsError: $("patterns-error"),
    historyList: $("history-list"),
    historyEmpty: $("history-empty"),
    sessionDate: $("session-date"),
    sessionSummary: $("session-summary"),
    sessionEntries: $("session-entries"),
    apiKeyInput: $("api-key"),
    settingsSaved: $("settings-saved"),
    btnReflect: $("btn-reflect"),
  };

  let currentStep = 0;
  let currentSession = null;
  let viewingSessionId = null;
  let lastSavedSessionId = null;
  let patternsFetchPromise = null;

  function getApiKey() {
    return localStorage.getItem(API_KEY_STORAGE) || "";
  }

  function setApiKey(key) {
    localStorage.setItem(API_KEY_STORAGE, key.trim());
  }

  function loadSessions() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  function saveSessions(sessions) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
  }

  function formatDate(iso) {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  }

  function formatTime(iso) {
    const d = new Date(iso);
    return d.toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
    });
  }

  function formatDateShort(iso) {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  }

  function formatDateTime(iso) {
    return `${formatDate(iso)} · ${formatTime(iso)}`;
  }

  function sortSessionsChronologically(sessions) {
    return [...sessions].sort(
      (a, b) => new Date(a.completedAt || a.createdAt) - new Date(b.completedAt || b.createdAt)
    );
  }

  function sessionPreviewText(session) {
    if (session.summary) return session.summary;
    const first = session.entries[0]?.answer?.trim();
    if (first) return first.slice(0, 120);
    return "Evening reflection";
  }

  function getRecentSessions(count = RECENT_SESSION_COUNT) {
    const sessions = sortSessionsChronologically(loadSessions());
    return sessions.slice(-count);
  }

  function formatSessionForContext(session) {
    const when = formatDateTime(session.completedAt || session.createdAt);
    const parts = [`[${when}]`];

    if (session.summary) {
      parts.push(`Summary: ${session.summary}`);
    }

    session.entries.forEach((entry, index) => {
      parts.push(`Q${index + 1}: ${entry.question}`);
      parts.push(`Answer: ${entry.answer}`);
      if (entry.response) {
        parts.push(`元: ${entry.response}`);
      }
    });

    return parts.join("\n");
  }

  function getPatternsFingerprint(sessions) {
    if (sessions.length === 0) return "";
    const last = sessions[sessions.length - 1];
    return `${sessions.length}:${last.id}:${last.completedAt || last.createdAt}`;
  }

  function loadPatternsCache() {
    try {
      const raw = localStorage.getItem(PATTERNS_CACHE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function savePatternsCache(cache) {
    localStorage.setItem(PATTERNS_CACHE_KEY, JSON.stringify(cache));
  }

  function formatAllSessionsForPatterns(sessions) {
    return sessions.map(formatSessionForContext).join("\n\n---\n\n");
  }

  function parsePatterns(text) {
    const items = text
      .split(/\n(?=[1-3]\.\s)/)
      .map((part) => part.trim())
      .filter(Boolean);

    if (items.length >= 2) {
      return items.map((item) => item.replace(/^[1-3]\.\s*/, ""));
    }

    return [text.trim()];
  }

  function setPatternsLoading(loading) {
    els.patternsLoading.hidden = !loading;
    if (loading) {
      els.patternsContent.hidden = true;
      els.patternsError.hidden = true;
    }
  }

  function displayPatterns(text) {
    const items = parsePatterns(text);
    els.patternsContent.innerHTML = items
      .map(
        (item, index) => `
          <div class="patterns-item">
            <span class="patterns-item__number">${index + 1}</span>
            <p class="patterns-item__text">${escapeHtml(item)}</p>
          </div>
        `
      )
      .join("");

    els.patternsError.hidden = true;
    els.patternsLoading.hidden = true;
    els.patternsContent.hidden = false;
  }

  function showPatternsError(message) {
    els.patternsError.textContent = message;
    els.patternsError.hidden = false;
    els.patternsLoading.hidden = true;
    els.patternsContent.hidden = true;
  }

  async function fetchPatterns(sessions) {
    if (!getApiKey()) {
      throw new Error("Add your DeepSeek API key in Settings to see patterns.");
    }

    const transcript = formatAllSessionsForPatterns(sessions);
    return callDeepSeek(
      [
        { role: "system", content: PATTERNS_PROMPT },
        { role: "user", content: transcript },
      ],
      550
    );
  }

  async function renderPatterns(sessions) {
    if (sessions.length < PATTERNS_MIN_SESSIONS) {
      els.patternsSection.hidden = true;
      return;
    }

    els.patternsSection.hidden = false;
    const fingerprint = getPatternsFingerprint(sessions);
    const cached = loadPatternsCache();

    if (cached?.fingerprint === fingerprint && cached.content) {
      displayPatterns(cached.content);
      return;
    }

    if (!patternsFetchPromise) {
      setPatternsLoading(true);
      patternsFetchPromise = fetchPatterns(sessions)
        .then((content) => {
          savePatternsCache({ fingerprint, content });
          displayPatterns(content);
        })
        .catch((err) => {
          showPatternsError(err.message);
        })
        .finally(() => {
          patternsFetchPromise = null;
        });
    }

    await patternsFetchPromise;
  }

  function buildReflectionSystemPrompt(recentSessions) {
    const historyBlock =
      recentSessions.length > 0
        ? recentSessions.map(formatSessionForContext).join("\n\n")
        : "(No prior sessions yet — this may be your first evening together.)";

    return `You are a compassionate evening reflection companion. You have been with this user for some time. Here are their recent reflections:

${historyBlock}

Use this history to notice patterns, reference past moments when relevant, and make the user feel genuinely known — not just heard tonight, but remembered over time. Never be generic. Always be personal.

${RESPONSE_GUIDELINES}`;
  }

  function showView(name) {
    Object.values(views).forEach((v) => v.classList.remove("view--active"));
    views[name].classList.add("view--active");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function setLoading(loading) {
    els.btnSubmit.disabled = loading;
    els.answerInput.disabled = loading;
    els.btnSubmit.classList.toggle("is-loading", loading);
  }

  function resetReflectionUI() {
    els.responsePanel.hidden = true;
    els.answerForm.hidden = false;
    els.answerInput.value = "";
    els.responseText.textContent = "";
    els.btnNext.textContent = "Next question";
  }

  function updateProgress() {
    const pct = ((currentStep) / QUESTIONS.length) * 100;
    els.progressBar.style.width = `${pct}%`;
    els.stepLabel.textContent = `Question ${currentStep + 1} of ${QUESTIONS.length}`;
    els.questionText.textContent = QUESTIONS[currentStep];
  }

  function startSession() {
    if (!getApiKey()) {
      showView("settings");
      els.apiKeyInput.focus();
      return;
    }

    currentStep = 0;
    const recentSessions = getRecentSessions();
    currentSession = {
      id: Date.now().toString(),
      createdAt: new Date().toISOString(),
      entries: [],
      systemPrompt: buildReflectionSystemPrompt(recentSessions),
    };

    resetReflectionUI();
    updateProgress();
    showView("reflect");
    els.answerInput.focus();
  }

  async function callDeepSeek(messages, maxTokens = 300) {
    const apiKey = getApiKey();
    if (!apiKey) {
      throw new Error("No API key configured.");
    }

    const res = await fetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages,
        temperature: 0.8,
        max_tokens: maxTokens,
      }),
    });

    if (!res.ok) {
      const errBody = await res.text();
      let message = `API error (${res.status})`;
      try {
        const parsed = JSON.parse(errBody);
        message = parsed.error?.message || message;
      } catch {
        if (errBody) message = errBody.slice(0, 200);
      }
      throw new Error(message);
    }

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error("Empty response from API.");
    }
    return content.trim();
  }

  async function respondToAnswer(question, answer) {
    const userMessage = `Evening reflection question: "${question}"\n\nUser's answer:\n${answer}`;
    const systemPrompt =
      currentSession?.systemPrompt || buildReflectionSystemPrompt([]);
    return callDeepSeek([
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ]);
  }

  async function generateSessionSummary(session) {
    const transcript = session.entries
      .map(
        (entry, index) =>
          `Question ${index + 1}: ${entry.question}\nUser: ${entry.answer}\n元: ${entry.response}`
      )
      .join("\n\n");

    try {
      return await callDeepSeek(
        [
          { role: "system", content: SUMMARY_PROMPT },
          { role: "user", content: transcript },
        ],
        150
      );
    } catch {
      const snippet = session.entries
        .map((e) => e.answer.trim())
        .filter(Boolean)
        .join(" ")
        .slice(0, 100);
      return snippet ? `An evening of quiet reflection — ${snippet}…` : "An evening of quiet reflection.";
    }
  }

  function setFinishing(finishing) {
    els.btnNext.disabled = finishing;
    els.btnNext.textContent = finishing ? "Saving tonight…" : els.btnNext.textContent;
  }

  async function handleSubmit(e) {
    e.preventDefault();

    const answer = els.answerInput.value.trim();
    if (!answer) return;

    const question = QUESTIONS[currentStep];
    setLoading(true);

    try {
      const response = await respondToAnswer(question, answer);

      currentSession.entries.push({
        question,
        answer,
        response,
      });

      els.responseText.textContent = response;
      els.responsePanel.hidden = false;
      els.answerForm.hidden = true;

      const isLast = currentStep === QUESTIONS.length - 1;
      els.btnNext.textContent = isLast ? "Finish reflection" : "Next question";
    } catch (err) {
      alert(`Could not reach 元 right now.\n\n${err.message}\n\nCheck your API key in Settings.`);
    } finally {
      setLoading(false);
    }
  }

  async function handleNext() {
    const isLast = currentStep === QUESTIONS.length - 1;

    if (isLast) {
      setFinishing(true);

      try {
        const completedAt = new Date().toISOString();
        const summary = await generateSessionSummary(currentSession);

        const { systemPrompt, ...sessionData } = currentSession;
        const savedSession = {
          ...sessionData,
          completedAt,
          summary,
        };

        const sessions = loadSessions();
        sessions.push(savedSession);
        saveSessions(sessions);

        lastSavedSessionId = savedSession.id;
        currentSession = null;
        renderHistory();
        showView("complete");
      } catch (err) {
        alert(`Could not save tonight's reflection.\n\n${err.message}`);
      } finally {
        setFinishing(false);
        els.btnNext.textContent = "Finish reflection";
      }
      return;
    }

    currentStep += 1;
    resetReflectionUI();
    updateProgress();
    els.answerInput.focus();
  }

  function renderHistory() {
    const sessions = sortSessionsChronologically(loadSessions());
    renderPatterns(sessions);
    els.historyList.innerHTML = "";
    els.historyEmpty.hidden = sessions.length > 0;

    sessions.forEach((session) => {
      const li = document.createElement("li");
      li.className = "history-item";

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "history-btn";
      btn.dataset.id = session.id;

      const when = session.completedAt || session.createdAt;

      btn.innerHTML = `
        <span class="history-date">${formatDateShort(when)}</span>
        <span class="history-time">${escapeHtml(formatTime(when))}</span>
        <span class="history-preview">${escapeHtml(sessionPreviewText(session))}</span>
      `;

      btn.addEventListener("click", () => openSession(session.id));
      li.appendChild(btn);
      els.historyList.appendChild(li);
    });
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  function openSession(id) {
    const sessions = loadSessions();
    const session = sessions.find((s) => s.id === id);
    if (!session) return;

    viewingSessionId = id;
    const when = session.completedAt || session.createdAt;
    els.sessionDate.textContent = formatDateTime(when);

    if (session.summary) {
      els.sessionSummary.textContent = session.summary;
      els.sessionSummary.hidden = false;
    } else {
      els.sessionSummary.textContent = "";
      els.sessionSummary.hidden = true;
    }

    els.sessionEntries.innerHTML = "";

    session.entries.forEach((entry) => {
      const article = document.createElement("article");
      article.className = "entry";
      article.innerHTML = `
        <p class="entry-question">${escapeHtml(entry.question)}</p>
        <p class="entry-answer">${escapeHtml(entry.answer)}</p>
        <p class="entry-response">${escapeHtml(entry.response)}</p>
      `;
      els.sessionEntries.appendChild(article);
    });

    showView("session");
  }

  function bindEvents() {
    $("btn-home").addEventListener("click", () => showView("home"));
    $("btn-start").addEventListener("click", startSession);
    $("btn-reflect").addEventListener("click", startSession);
    $("btn-history").addEventListener("click", () => {
      renderHistory();
      showView("history");
    });
    $("btn-settings").addEventListener("click", () => {
      els.apiKeyInput.value = getApiKey();
      els.settingsSaved.hidden = true;
      showView("settings");
    });

    els.answerForm.addEventListener("submit", handleSubmit);
    els.btnNext.addEventListener("click", handleNext);

    $("btn-back-history").addEventListener("click", () => {
      renderHistory();
      showView("history");
    });

    $("btn-done").addEventListener("click", () => showView("home"));

    $("btn-view-session").addEventListener("click", () => {
      if (lastSavedSessionId) {
        openSession(lastSavedSessionId);
        return;
      }
      const sessions = sortSessionsChronologically(loadSessions());
      if (sessions.length > 0) {
        openSession(sessions[sessions.length - 1].id);
      }
    });

    $("settings-form").addEventListener("submit", (e) => {
      e.preventDefault();
      setApiKey(els.apiKeyInput.value);
      els.settingsSaved.hidden = false;
      setTimeout(() => {
        els.settingsSaved.hidden = true;
      }, 2500);
    });
  }

  function updateHomeScreen() {
    const greetingEl = document.getElementById('hero-greeting');
    const streakEl = document.getElementById('hero-streak');
    if (greetingEl) greetingEl.textContent = getTimeGreeting();
    const streak = getStreak();
    if (streakEl) streakEl.textContent = streak > 0 
      ? streak + ' evening' + (streak > 1 ? 's' : '') + ' in a row' 
      : '';
  }
  function init() {
    bindEvents();
    updateHomeScreen();
    renderHistory();

    const savedKey = getApiKey();
    if (savedKey) {
      els.apiKeyInput.value = savedKey;
    }
  }

  init();
})();
