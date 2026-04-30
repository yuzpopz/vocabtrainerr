"use strict";

// ─────────────────────────────────────────────
// DATA
// ─────────────────────────────────────────────

const ellipsis = "\u200A.\u200A.\u200A.";

const DEFAULT_DATA = {
  words: [],
  mastery: {},
  sessions: []
};

let appData = JSON.parse(JSON.stringify(DEFAULT_DATA));

// ─────────────────────────────────────────────
// PERSISTENCE
// ─────────────────────────────────────────────

function saveToStorage() {
  try {
    localStorage.setItem('vocabtrainerr_data', JSON.stringify(appData));
  } catch (e) {}
}

function loadFromStorage() {
  try {
    const raw = localStorage.getItem('vocabtrainerr_data');
    if (raw) {
      const parsed = JSON.parse(raw);
      // merge words, keeping user additions
      if (parsed.words && parsed.words.length > 0) appData.words = parsed.words;
      if (parsed.mastery) appData.mastery = parsed.mastery;
      if (parsed.sessions) appData.sessions = parsed.sessions;
    }
  } catch (e) {}
}

let hasUnsavedChanges = false;

function saveToStorage() {
  try {
    localStorage.setItem('vocabtrainerr_data', JSON.stringify(appData));
    hasUnsavedChanges = true;
  } catch (e) {}
}

function exportJSON() {
  const blob = new Blob([JSON.stringify(appData, null, 2)], {
    type: 'application/json'
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'vocabtrainerr.json';
  a.click();
  URL.revokeObjectURL(url);
  
  hasUnsavedChanges = false; 
  
  showToast('JSON file downloaded successfully.');
}

window.addEventListener('beforeunload', (e) => {
  if (hasUnsavedChanges) {
    e.preventDefault();
    e.returnValue = ''; 
  }
});

// ─────────────────────────────────────────────
// MASTERY HELPERS
// ─────────────────────────────────────────────

function getMastery(word) {
  return appData.mastery[word] || {
    attempts: 0,
    correct_first_try: 0,
    hint_used_count: 0,
    times_seen: 0,
    score: 0
  };
}

function masteryLevel(word) {
  const m = getMastery(word);
  if (m.times_seen === 0) return 'new';
  const score = m.score / Math.max(m.times_seen, 1);
  if (score >= 0.8) return 'mastered';
  if (score >= 0.5) return 'proficient';
  return 'attempted';
}

function masteryScore(word) {
  const m = getMastery(word);
  if (m.times_seen === 0) return 0;
  return m.score / m.times_seen;
}

// ─────────────────────────────────────────────
// SPACED REPETITION SELECTION
// ─────────────────────────────────────────────

function selectSessionWords() {
  const words = appData.words;
  const n = 6;

  // Score each word: lower = more priority
  const scored = words.map(w => {
    const m = getMastery(w.word);
    const level = masteryLevel(w.word);
    let priority;
    if (level === 'new') {
      priority = 0; // highest priority
    } else if (level === 'attempted') {
      priority = 1 + Math.random() * 0.5;
    } else if (level === 'proficient') {
      priority = 2 + Math.random() * 1;
    } else { // mastered
      priority = 4 + Math.random() * 3; // rarely
    }
    // Boost words that frequently needed hints
    const hintPenalty = (m.hint_used_count / Math.max(m.times_seen, 1)) * 0.5;
    // Boost words with low score
    const scorePenalty = (1 - masteryScore(w.word)) * 0.8;
    return {
      word: w,
      priority: priority - hintPenalty - scorePenalty
    };
  });

  scored.sort((a, b) => a.priority - b.priority);

  // Take top candidates but with some randomness
  const pool = scored.slice(0, Math.min(words.length, Math.max(n * 2, 8)));
  shuffle(pool);
  return pool.slice(0, n).map(x => x.word);
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ─────────────────────────────────────────────
// WORD COUNT GATE
// ─────────────────────────────────────────────

function checkWordCount() {
  const enough = appData.words.length >= 6;

  // Overview "Start new session" button
  const overviewBtn = document.querySelector('#panel-overview .btn-primary[onclick="startSession()"]');
  if (overviewBtn) {
    overviewBtn.disabled = !enough;
    overviewBtn.classList.toggle('btn-disabled-gate', !enough);
  }

  // Learn "Begin session" button
  const learnBtn = document.querySelector('#learn-idle .btn-primary[onclick="startSession()"]');
  if (learnBtn) {
    learnBtn.disabled = !enough;
    learnBtn.classList.toggle('btn-disabled-gate', !enough);
  }

  // Learn idle copy
  const idleHeading = document.querySelector('#learn-idle h1');
  const idleBody = document.querySelector('#learn-idle p:not(.q-pos)');
  if (idleHeading) {
    idleHeading.textContent = enough ? 'Ready to learn?' : 'Insufficient words.';
  }
  if (idleBody) {
    idleBody.innerHTML = enough
      ? 'Each session presents six carefully chosen words. Words you find difficult come up more often, while mastered words are reviewed occasionally.'
      : 'You need at least 6 words to start a session. Head over to the <strong>Manage</strong> tab to add or import words in order to get started!';
  }
}

// ─────────────────────────────────────────────
// SESSION STATE
// ─────────────────────────────────────────────

let session = null;

function startSession() {
  if (appData.words.length < 6) return;
  const selected = selectSessionWords();
  session = {
    words: selected,
    currentIdx: 0,
    results: [],
    current: null
  };
  switchTab('learn');
  renderQuestion();
}

function renderQuestion() {
  document.getElementById('learn-idle').style.display = 'none';
  document.getElementById('learn-complete').style.display = 'none';
  document.getElementById('learn-active').style.display = 'block';

  const wordObj = session.words[session.currentIdx];
  const allDefs = [...wordObj.definitions];
  shuffle(allDefs);

  session.current = {
    wordObj,
    shuffledDefs: allDefs,
    attempts: 0,
    hintUsed: false,
    answeredCorrect: false
  };

  // Pips
  const pips = document.getElementById('session-pips');
  pips.innerHTML = '';
  for (let i = 0; i < session.words.length; i++) {
    const pip = document.createElement('div');
    pip.className = 'progress-pip' + (i < session.currentIdx ? ' done' : i === session.currentIdx ? ' current' : '');
    pips.appendChild(pip);
  }

  document.getElementById('q-pos').textContent = wordObj.part_of_speech;
  document.getElementById('q-word').textContent = wordObj.word;

  // Hint
  const hintContent = document.getElementById('hint-content');
  hintContent.style.display = 'none';
  hintContent.innerHTML = '';
  document.getElementById('hint-toggle').textContent = 'Show';

  // Options
  const letters = ['A', 'B', 'C', 'D', 'E'];
  const list = document.getElementById('options-list');
  list.innerHTML = '';
  allDefs.forEach((def, i) => {
    const btn = document.createElement('button');
    btn.className = 'option-btn';
    btn.dataset.correct = def.is_correct;
    btn.onclick = () => handleAnswer(btn, def.is_correct);
    btn.innerHTML = `<span class="option-letter">${letters[i]}</span><span>${def.definition}</span>`;
    list.appendChild(btn);
  });

  document.getElementById('result-area').innerHTML = '';
  document.getElementById('next-btn').style.display = 'none';
}

function toggleHint() {
  const content = document.getElementById('hint-content');
  const btn = document.getElementById('hint-toggle');
  const wordObj = session.current.wordObj;

  if (content.style.display === 'none') {
    content.innerHTML = `<div class="hint-sentence">${renderBold(wordObj.example)}</div>`;
    content.style.display = 'block';
    btn.textContent = 'Hide';
    session.current.hintUsed = true;
  } else {
    content.style.display = 'none';
    btn.textContent = 'Show';
  }
}

function renderBold(text) {
  return text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
}

function handleAnswer(btn, isCorrect) {
  if (session.current.answeredCorrect) return;
  session.current.attempts++;

  const allBtns = document.querySelectorAll('.option-btn');

  if (isCorrect) {
    btn.classList.add('correct');
    session.current.answeredCorrect = true;
    playSound('correct');

    // Fade out wrong
    allBtns.forEach(b => {
      if (b !== btn) {
        b.classList.add('faded');
        b.disabled = true;
      }
    });
    btn.disabled = true;

    // Show sentence if not already shown
    if (!session.current.hintUsed) {
      const content = document.getElementById('hint-content');
      content.innerHTML = `<div class="hint-sentence">${renderBold(session.current.wordObj.example)}</div>`;
      content.style.display = 'block';
      document.getElementById('hint-toggle').textContent = 'Hide';
    }

    // Show next - label depends on whether this is the last question
    const nextBtn = document.getElementById('next-btn');
    const isLastQuestion = session.currentIdx === session.words.length - 1;
    nextBtn.textContent = isLastQuestion ? 'Finish' : 'Next word →';
    nextBtn.style.display = 'inline-flex';
    nextBtn.focus();

    // Update mastery
    updateMastery(session.current.wordObj.word, session.current.attempts, session.current.hintUsed);

    // Record result
    session.results.push({
      word: session.current.wordObj.word,
      attempts: session.current.attempts,
      hintUsed: session.current.hintUsed
    });

  } else {
    btn.classList.add('incorrect');
    btn.disabled = true;
    playSound('incorrect');
    setTimeout(() => {
      btn.classList.remove('incorrect');
      btn.classList.add('faded');
    }, 600);
  }
}

function updateMastery(word, attempts, hintUsed) {
  if (!appData.mastery[word]) {
    appData.mastery[word] = {
      attempts: 0,
      correct_first_try: 0,
      hint_used_count: 0,
      times_seen: 0,
      score: 0
    };
  }
  const m = appData.mastery[word];
  m.times_seen++;
  m.attempts += attempts;
  if (attempts === 1 && !hintUsed) m.correct_first_try++;
  if (hintUsed) m.hint_used_count++;
  // Score: 1 for first try no hint, 0.7 first try with hint, 0.4 multiple tries no hint, 0.2 multiple+hint
  let score = 0;
  if (attempts === 1 && !hintUsed) score = 1;
  else if (attempts === 1 && hintUsed) score = 0.7;
  else if (!hintUsed) score = Math.max(0.1, 0.6 - (attempts - 2) * 0.15);
  else score = Math.max(0.05, 0.3 - (attempts - 2) * 0.1);
  m.score += score;
  saveToStorage();
}

function nextQuestion() {
  session.currentIdx++;
  if (session.currentIdx >= session.words.length) {
    finishSession();
  } else {
    renderQuestion();
  }
}

function finishSession() {
  document.getElementById('learn-active').style.display = 'none';
  document.getElementById('learn-complete').style.display = 'block';
  playSound('finish');

  const firstTry = session.results.filter(r => r.attempts === 1 && !r.hintUsed).length;
  const withHint = session.results.filter(r => r.hintUsed).length;
  const struggled = session.results.filter(r => r.attempts > 2).length;

  const stats = document.getElementById('complete-stats');
  stats.innerHTML = `
    <div class="complete-stat"><div class="complete-stat-num" style="color:var(--accent)">${firstTry}</div><div class="complete-stat-label">First try</div></div>
    <div class="complete-stat"><div class="complete-stat-num" style="color:var(--gold)">${withHint}</div><div class="complete-stat-label">Used hint</div></div>
    <div class="complete-stat"><div class="complete-stat-num" style="color:var(--warn)">${struggled}</div><div class="complete-stat-label">Struggled</div></div>
    <div class="complete-stat"><div class="complete-stat-num">${session.words.length}</div><div class="complete-stat-label">Total words</div></div>
  `;

  // Save session
  const sessionRecord = {
    id: Date.now(),
    date: new Date().toISOString(),
    results: session.results
  };
  appData.sessions.unshift(sessionRecord);
  saveToStorage();
  renderOverview();
  renderWordTable();
}

// ─────────────────────────────────────────────
// OVERVIEW
// ─────────────────────────────────────────────

function renderOverview() {
  // Dynamic greeting — only update once per hour (change 6)
  const greetingEl = document.getElementById('greeting-text');
  if (greetingEl) {
    const now = Date.now();
    const currentHour = new Date().getHours();
    const lastGreetingHour = localStorage.getItem('vocabtrainerr_greeting_hour');
    const lastGreetingText = localStorage.getItem('vocabtrainerr_greeting_text');

    if (!lastGreetingText || lastGreetingHour === null || parseInt(lastGreetingHour) !== currentHour) {
      const nouns = ['Lexicon', 'Vocab', 'Word'];
      const titles = ['Master', 'Wizard', 'Warrior', 'Sensei', 'Titan'];
      const noun = nouns[Math.floor(Math.random() * nouns.length)];
      const title = titles[Math.floor(Math.random() * titles.length)];
      const descriptor = Math.random() < 0.1 ? 'The Word Alchemist' : `${noun} ${title}`;

      const hour = currentHour;
      const lastSeenRaw = localStorage.getItem('vocabtrainerr_last_seen');
      localStorage.setItem('vocabtrainerr_last_seen', now);

      let greeting;
      const daysSince = lastSeenRaw ? (now - parseInt(lastSeenRaw)) / (1000 * 60 * 60 * 24) : 0;

      if (!lastSeenRaw || daysSince > 5) {
        const opts = ['Long time no see', "It’s been a while", "You’ve been missed", "Haven’t seen you in a bit"];
        greeting = opts[Math.floor(Math.random() * opts.length)];
      } else {
        const timeOpts = [`Good ${hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening'}`];
        const generalOpts = ['Welcome back', 'Great to see you again', 'Back at it again', 'Feels nice to be back', 'Welcome aboard'];
        const allOpts = [...timeOpts, ...generalOpts];
        greeting = allOpts[Math.floor(Math.random() * allOpts.length)];
      }

      const newGreetingText = `${greeting}, ${descriptor}!`;
      localStorage.setItem('vocabtrainerr_greeting_text', newGreetingText);
      localStorage.setItem('vocabtrainerr_greeting_hour', currentHour);
      greetingEl.textContent = newGreetingText;
    } else {
      greetingEl.textContent = lastGreetingText;
    }
  }

  let mastered = 0,
    proficient = 0,
    attempted = 0,
    unseen = 0;
  appData.words.forEach(w => {
    const level = masteryLevel(w.word);
    if (level === 'mastered') mastered++;
    else if (level === 'proficient') proficient++;
    else if (level === 'attempted') attempted++;
    else unseen++;
  });
  const total = appData.words.length;

  document.getElementById('stat-mastered').textContent = mastered;
  document.getElementById('stat-proficient').textContent = proficient;
  document.getElementById('stat-attempted').textContent = attempted;
  document.getElementById('stat-new').textContent = unseen;

  document.getElementById('prog-mastered').style.width = (mastered / total * 100) + '%';
  document.getElementById('prog-proficient').style.width = (proficient / total * 100) + '%';
  document.getElementById('prog-attempted').style.width = (attempted / total * 100) + '%';

  // Sessions
  const list = document.getElementById('sessions-list');
  if (appData.sessions.length === 0) {
    list.innerHTML = '<div class="empty"><div class="empty-icon"><span class="material-symbols-outlined" style="font-size:2rem;color:var(--ink-muted)">book_ribbon</span></div><p>No sessions yet. Start learning!</p></div>';
    checkWordCount();
    return;
  }
  list.innerHTML = '';
  appData.sessions.forEach(s => {
    const d = new Date(s.date);
    const dateStr = d.toLocaleDateString('en-GB', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric'
    });
    const timeStr = d.toLocaleTimeString('en-GB', {
      hour: '2-digit',
      minute: '2-digit'
    });
    const firstTry = s.results.filter(r => r.attempts === 1 && !r.hintUsed).length;
    const item = document.createElement('div');
    item.className = 'session-item';
    item.innerHTML = `
      <div class="session-item-left">
        <div class="session-date">${dateStr} at ${timeStr}</div>
        <div class="session-meta">${s.results.length} words · ${firstTry} first-try correct</div>
      </div>
      <div class="session-score">${firstTry}/${s.results.length}</div>
    `;
    item.onclick = () => showSessionDetail(s);
    list.appendChild(item);
  });

  checkWordCount();
}

function showSessionDetail(s) {
  const modal = document.getElementById('session-modal');
  const inner = document.getElementById('session-modal-inner');
  const d = new Date(s.date);
  const dateStr = d.toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  });

  let rows = s.results.map(r => {
    let badge;
    if (r.attempts === 1 && !r.hintUsed) badge = '<span class="badge badge-correct">First try</span>';
    else if (r.hintUsed && r.attempts === 1) badge = '<span class="badge badge-hint">Used hint</span>';
    else if (r.hintUsed) badge = '<span class="badge badge-hint">Hint + ' + r.attempts + ' tries</span>';
    else if (r.attempts > 2) badge = '<span class="badge badge-struggled">' + r.attempts + ' tries</span>';
    else badge = '<span class="badge badge-struggled">' + r.attempts + ' tries</span>';
    return `<div class="session-word-row"><span class="word-italic">${r.word}</span>${badge}</div>`;
  }).join('');

  inner.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:20px">
      <div>
        <h3 style="margin-bottom:4px">Session details</h3>
        <h2>${dateStr}</h2>
      </div>
      <button class="btn btn-ghost" onclick="document.getElementById('session-modal').style.display='none'" style="padding:6px"><span class="material-symbols-outlined">close</span></button>
    </div>
    <div class="session-word-list">${rows}</div>
  `;
  modal.style.display = 'flex';
}

function closeModal(e) {
  if (e.target.id === 'session-modal') document.getElementById('session-modal').style.display = 'none';
}

// ─────────────────────────────────────────────
// MANAGE
// ─────────────────────────────────────────────

function renderWordTable(filter = '') {
  const tbody = document.getElementById('word-table-body');
  const countDisplay = document.getElementById('word-count-display');
  const words = appData.words.filter(w => w.word.toLowerCase().includes(filter.toLowerCase()));
  if (countDisplay) {
    if (words.length === 0) {
      countDisplay.style.display = 'none';
    } else {
      countDisplay.style.display = 'block';
      if (filter !== '') {
        countDisplay.textContent = `Words found: ${words.length}`;
      } else {
        countDisplay.textContent = `Total words: ${words.length}`;
      }
    }
  }
  if (words.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--ink-muted);padding:32px">No words found.</td></tr>';
    return;
  }
  tbody.innerHTML = words.map(w => {
    const level = masteryLevel(w.word);
    const m = getMastery(w.word);
    const badgeLabels = {
      mastered: 'Mastered',
      proficient: 'Proficient',
      attempted: 'Attempted',
      new: 'New'
    };
    return `<tr>
      <td><span class="word-italic">${w.word}</span></td>
      <td><span class="pos-tag pos-${w.part_of_speech}">${w.part_of_speech}</span></td>
      <td><span class="mastery-badge ${level}">${badgeLabels[level]}</span></td>
      <td style="color:var(--ink-muted);font-size:0.82rem">${m.times_seen}</td>
    </tr>`;
  }).join('');
}

function filterTable(val) {
  renderWordTable(val);
}

let addFormOpen = false;

function toggleAddForm() {
  addFormOpen = !addFormOpen;
  const overlay = document.getElementById('add-form-overlay');
  if (addFormOpen) {
    overlay.classList.add('open');
    // Build incorrect def inputs
    const incRows = document.getElementById('inc-rows');
    incRows.innerHTML = '';
    for (let i = 1; i <= 4; i++) {
      incRows.innerHTML += `<div style="margin-bottom:9px">
        <input class="input" type="text" id="inc-def-${i}" placeholder="Incorrect definition ${i}${ellipsis}" oninput="handleIncDefInput(${i})">
      </div>`;
    }
    // Clear errors
    ['new-word', 'new-pos', 'new-example', 'new-def-correct'].forEach(id => clearFieldError(id));
    document.getElementById('err-inc-defs').classList.remove('visible');
  } else {
    overlay.classList.remove('open');
    resetAddForm();
  }
}

function handleAddFormOverlayClick(e) {
  if (e.target.id === 'add-form-overlay') toggleAddForm();
}

function resetAddForm() {
  ['new-word', 'new-example', 'new-def-correct'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  const pos = document.getElementById('new-pos');
  if (pos) pos.value = '';
}

function handleIncDefInput(i) {
  const fieldEl = document.getElementById(`inc-def-${i}`);
  if (fieldEl && fieldEl.value.trim()) {
    fieldEl.classList.remove('field-error');
  }
  updateIncDefsGroupError();
}

function updateIncDefsGroupError() {
  const errEl = document.getElementById('err-inc-defs');
  if (!errEl) return;
  // Check if any inc-def fields are still empty
  const anyEmpty = [1,2,3,4].some(i => {
    const f = document.getElementById(`inc-def-${i}`);
    return f && !f.value.trim();
  });
  if (anyEmpty) {
    errEl.textContent = 'All 4 incorrect definitions are required.';
    errEl.classList.add('visible');
  } else {
    errEl.textContent = '';
    errEl.classList.remove('visible');
  }
}

function setFieldError(id, msg) {
  const el = document.getElementById(id);
  if (el) {
    el.classList.add('field-error');
    // Attach blur/input listener for re-trigger on empty (change 4)
    if (!el._errorRelistener) {
      el._errorRelistener = true;
      const recheck = () => {
        const val = (el.tagName === 'SELECT' ? el.value : el.value.trim());
        if (!val) {
          el.classList.add('field-error');
          const eEl = document.getElementById('err-' + id.replace('new-', '').replace('inc-def-', 'inc-def-'));
          if (eEl && eEl._lastMsg) {
            eEl.textContent = eEl._lastMsg;
            eEl.classList.add('visible');
            // hide hint
            const row = el.closest('.form-row');
            if (row) { const h = row.querySelector('.form-hint'); if (h) h.style.display = 'none'; }
          }
        }
      };
      el.addEventListener('blur', recheck);
    }
  }
  const errEl = document.getElementById('err-' + id.replace('new-', ''));
  if (errEl) {
    errEl._lastMsg = msg;
    errEl.textContent = msg;
    errEl.classList.add('visible');
  }
  // Hide form-hint (change 3)
  if (el) {
    const row = el.closest('.form-row');
    if (row) { const h = row.querySelector('.form-hint'); if (h) h.style.display = 'none'; }
  }
}

function clearFieldError(id) {
  const el = document.getElementById(id);
  if (el) el.classList.remove('field-error');
  // derive error id
  const errId = 'err-' + id.replace('new-', '').replace('inc-def-', 'inc-def-');
  const errEl = document.getElementById(errId);
  if (errEl) {
    errEl.textContent = '';
    errEl.classList.remove('visible');
  }
  // Restore form-hint (change 3) — only if field has a value
  if (el) {
    const val = (el.tagName === 'SELECT' ? el.value : el.value.trim());
    if (val) {
      const row = el.closest('.form-row');
      if (row) { const h = row.querySelector('.form-hint'); if (h) h.style.display = ''; }
    }
  }
}

function addWord() {
  const word = document.getElementById('new-word').value.trim();
  const pos = document.getElementById('new-pos').value;
  const example = document.getElementById('new-example').value.trim();
  const correctDef = document.getElementById('new-def-correct').value.trim();
  const incDefs = [1, 2, 3, 4].map(i => document.getElementById(`inc-def-${i}`)?.value.trim() || '');

  // Clear all errors first
  ['new-word', 'new-pos', 'new-example', 'new-def-correct'].forEach(id => clearFieldError(id));
  document.getElementById('err-inc-defs').textContent = '';
  document.getElementById('err-inc-defs').classList.remove('visible');

  const matches = example.match(/\*\*/g) || [];
  let hasError = false;
  if (!word) {
    setFieldError('new-word', 'Word is required.');
    hasError = true;
  }
  if (appData.words.find(w => w.word.toLowerCase() === word.toLowerCase())) {
    setFieldError('new-word', 'This word already exists.');
    hasError = true;
  }
  if (!pos) {
    setFieldError('new-pos', 'Part of speech is required.');
    hasError = true;
  }
  if (!example) {
    setFieldError('new-example', 'Example sentence is required.');
    hasError = true;
  } else if (matches.length !== 2) {
    setFieldError('new-example', 'Enclose the word in **double asterisks** as shown in the example.');
    hasError = true;
  }
  if (!correctDef) {
    setFieldError('new-def-correct', 'Correct definition is required.');
    hasError = true;
  }
  if (incDefs.some(d => !d)) {
    incDefs.forEach((d, i) => {
      if (!d) {
        const fieldId = `inc-def-${i + 1}`;
        const fieldEl = document.getElementById(fieldId);
        if (fieldEl) {
          fieldEl.classList.add('field-error');
          // attach re-trigger listener (change 4)
          if (!fieldEl._errorRelistener) {
            fieldEl._errorRelistener = true;
            fieldEl.addEventListener('blur', () => {
              if (!fieldEl.value.trim()) {
                fieldEl.classList.add('field-error');
                updateIncDefsGroupError();
              }
            });
          }
        }
      }
    });
    updateIncDefsGroupError();
    hasError = true;
  }

  if (hasError) return;

  const newEntry = {
    word: word.toLowerCase(),
    part_of_speech: pos,
    example,
    definitions: [{
        definition: correctDef,
        is_correct: true
      },
      ...incDefs.map(d => ({
        definition: d,
        is_correct: false
      }))
    ]
  };

  appData.words.push(newEntry);
  saveToStorage();
  toggleAddForm();
  renderWordTable();
  renderOverview();
  showToast('Word "' + newEntry.word + '" added successfully.');
}

function triggerImport() {
  document.getElementById('file-input').click();
}

function exportJSON() {
  const blob = new Blob([JSON.stringify(appData, null, 2)], {
    type: 'application/json'
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'vocabtrainerr.json';
  a.click();
  URL.revokeObjectURL(url);
  showToast('JSON file downloaded successfully.');
}

function importJSON(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = evt => {
    try {
      const parsed = JSON.parse(evt.target.result);
      if (!parsed.words) throw new Error('Invalid format');
      appData.words = parsed.words;
      if (parsed.mastery) appData.mastery = parsed.mastery;
      if (parsed.sessions) appData.sessions = parsed.sessions;
      saveToStorage();
      renderOverview();
      renderWordTable();
      showToast(`Imported ${appData.words.length} words successfully.`);
    } catch (err) {
      showToast('Failed to import: invalid JSON file.', true);
    }
    e.target.value = '';
  };
  reader.readAsText(file);
}

// ─────────────────────────────────────────────
// TOAST NOTIFICATIONS
// ─────────────────────────────────────────────

function showToast(msg, isError = false) {
  const container = document.getElementById('toast-container');
  const duration = 4000;

  const toast = document.createElement('div');
  toast.className = 'toast';
  if (isError) toast.style.borderColor = 'rgba(139,58,15,0.25)';

  toast.innerHTML = `
    <div class="toast-header">
      <span class="toast-msg">${msg}</span>
      <button class="toast-close" onclick="dismissToast(this.closest('.toast'))">
        <span class="material-symbols-outlined" style="font-size:16px">close</span>
      </button>
    </div>
    <div class="toast-timer" style="animation-duration:${duration}ms"></div>
  `;

  // Set timer keyframes dynamically
  const style = document.createElement('style');
  style.textContent = `@keyframes toastTimer { from { width: 100%; } to { width: 0%; } }`;
  document.head.appendChild(style);

  container.appendChild(toast);

  setTimeout(() => dismissToast(toast), duration);
}

function dismissToast(toast) {
  if (!toast || !toast.parentNode) return;
  toast.classList.add('toast-out');
  setTimeout(() => toast.remove(), 300);
}

// ─────────────────────────────────────────────
// SOUND EFFECTS (coded manually)
// ─────────────────────────────────────────────

function playSound(type) {
  try {
    const ctx = new(window.AudioContext || window.webkitAudioContext)();
    const masterGain = ctx.createGain();
    masterGain.connect(ctx.destination);

    if (type === 'correct') {
      // Pleasant ascending two-tone chime
      const freqs = [523.25, 783.99]; // C5, G5
      freqs.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(masterGain);
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, ctx.currentTime + i * 0.12);
        gain.gain.setValueAtTime(0, ctx.currentTime + i * 0.12);
        gain.gain.linearRampToValueAtTime(0.18, ctx.currentTime + i * 0.12 + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.12 + 0.35);
        osc.start(ctx.currentTime + i * 0.12);
        osc.stop(ctx.currentTime + i * 0.12 + 0.35);
      });
    } else if (type === 'incorrect') {
      // Low thud-like descending tone
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(masterGain);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(220, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(110, ctx.currentTime + 0.25);
      gain.gain.setValueAtTime(0.2, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.35);
    } else if (type === 'finish') {
      // Triumphant ascending arpeggio
      const freqs = [523.25, 659.25, 783.99, 1046.5]; // C5, E5, G5, C6
      freqs.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(masterGain);
        osc.type = 'sine';
        const t = ctx.currentTime + i * 0.1;
        osc.frequency.setValueAtTime(freq, t);
        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(0.15, t + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
        osc.start(t);
        osc.stop(t + 0.5);
      });
    }
  } catch (e) {}
}

// ─────────────────────────────────────────────
// TABS
// ─────────────────────────────────────────────

const tabs = document.querySelectorAll('.tab');
const indicator = document.querySelector('.tab-indicator');

function moveIndicator(tab) {
  const rect = tab.getBoundingClientRect();
  const parentRect = tab.parentElement.getBoundingClientRect();

  indicator.style.width = `${rect.width}px`;
  indicator.style.transform = `translateX(${rect.left - parentRect.left}px)`;
}

tabs.forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelector('.tab.active')?.classList.remove('active');
    tab.classList.add('active');
    moveIndicator(tab);
  });
});

function switchTab(name) {
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
  document.querySelectorAll('.panel').forEach(p => p.id === 'panel-' + name ? p.classList.add('active') : p.classList.remove('active'));
  
  const activeTab = document.querySelector(`.tab[data-tab="${name}"]`);

  if (activeTab) moveIndicator(activeTab);  if (name === 'overview') renderOverview();
  if (name === 'manage') renderWordTable();
  if (name === 'learn' && !session) {
    document.getElementById('learn-idle').style.display = 'block';
    document.getElementById('learn-active').style.display = 'none';
    document.getElementById('learn-complete').style.display = 'none';
  }
}

document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => switchTab(tab.dataset.tab));
});

// ─────────────────────────────────────────────
// INIT
// ─────────────────────────────────────────────

moveIndicator(document.querySelector('.tab.active'));
loadFromStorage();
renderOverview();
renderWordTable();
