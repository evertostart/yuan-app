(function () {
  "use strict";

  const QUESTIONS = [
    "How is your body right now?",
    "What pulled you away from yourself today?",
    "What was one genuine moment today?",
    "What do you want to bring into tomorrow?",
  ];

  const STORAGE_KEY = "yuan-reflections";
  const API_KEY_STORAGE = "yuan-api-key";
  const API_URL = "https://api.deepseek.com/chat/completions";
  const MODEL = "deepseek-chat";

  const SYSTEM_PROMPT = `You are 元 (Yuan), a gentle evening reflection companion. The user is doing a quiet end-of-day practice.

Respond to their answer with warmth, thoughtfulness, and zero judgment. Keep your reply concise — 2 to 4 sentences. Acknowledge what they shared without fixing, lecturing, or diagnosing. Use plain, human language. You may be quietly poetic but never grandiose. Do not ask questions unless one soft invitation feels natural. Do not use bullet points or headers.`;

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
    historyList: $("history-list"),
    historyEmpty: $("history-empty"),
    sessionDate: $("session-date"),
    sessionEntries: $("session-entries"),
    apiKeyInput: $("api-key"),
    settingsSaved: $("settings-saved"),
    btnReflect: $("btn-reflect"),
  };

  let currentStep = 0;
  let currentSession = null;
  let viewingSessionId = null;

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

  function formatDateShort(iso) {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
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
    currentSession = {
      id: Date.now().toString(),
      createdAt: new Date().toISOString(),
      entries: [],
    };

    resetReflectionUI();
    updateProgress();
    showView("reflect");
    els.answerInput.focus();
  }

  async function callDeepSeek(question, answer) {
    const apiKey = getApiKey();
    if (!apiKey) {
      throw new Error("No API key configured.");
    }

    const userMessage = `Evening reflection question: "${question}"\n\nUser's answer:\n${answer}`;

    const res = await fetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userMessage },
        ],
        temperature: 0.8,
        max_tokens: 300,
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

  async function handleSubmit(e) {
    e.preventDefault();

    const answer = els.answerInput.value.trim();
    if (!answer) return;

    const question = QUESTIONS[currentStep];
    setLoading(true);

    try {
      const response = await callDeepSeek(question, answer);

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

  function handleNext() {
    const isLast = currentStep === QUESTIONS.length - 1;

    if (isLast) {
      const sessions = loadSessions();
      sessions.unshift(currentSession);
      saveSessions(sessions);
      currentSession = null;
      renderHistory();
      showView("complete");
      return;
    }

    currentStep += 1;
    resetReflectionUI();
    updateProgress();
    els.answerInput.focus();
  }

  function renderHistory() {
    const sessions = loadSessions();
    els.historyList.innerHTML = "";
    els.historyEmpty.hidden = sessions.length > 0;

    sessions.forEach((session) => {
      const li = document.createElement("li");
      li.className = "history-item";

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "history-btn";
      btn.dataset.id = session.id;

      const preview =
        session.entries[0]?.answer?.slice(0, 80) || "Empty reflection";

      btn.innerHTML = `
        <span class="history-date">${formatDateShort(session.createdAt)}</span>
        <span class="history-preview">${escapeHtml(preview)}</span>
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
    els.sessionDate.textContent = formatDate(session.createdAt);
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
      const sessions = loadSessions();
      if (sessions.length > 0) {
        openSession(sessions[0].id);
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

  function init() {
    bindEvents();
    renderHistory();

    const savedKey = getApiKey();
    if (savedKey) {
      els.apiKeyInput.value = savedKey;
    }
  }

  init();
})();
