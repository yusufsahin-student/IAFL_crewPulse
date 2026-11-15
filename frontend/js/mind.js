import { initShell, el } from './shell.js';
import { assess, summarize, COGNITIVE_TASKS, summarizeCognitiveBattery } from './mind-core.js';
import { runCognitiveTask } from './mind-tasks.js';

const root = document.getElementById('lab');
let ctx;
try {
  ctx = await initShell({ page: 'mind' });
} catch {
  root.textContent = 'Crew selection could not be loaded. Start the server and reopen.';
}

if (ctx) run();

function run() {
  const key = `astro-mind-v1:${ctx.astronautId}`;
  let history = [];
  try {
    history = JSON.parse(localStorage.getItem(key) || '[]');
  } catch {}

  const result = {};
  // Every session (also "Start again") starts empty with its own time stamp.
  function newSession() {
    Object.assign(result, {
      at: new Date().toISOString(),
      survey: { sleep: 7, mood: null, stress: null, loneliness: null, workload: null },
      pvt: null,
      cognitive_tasks: {},
    });
  }
  newSession();

  let timer;
  let phase = 'idle';
  let signalAt = 0;
  let trials = [];
  let early = 0;
  let ends = 0;
  let cancelled = false;
  let activeTaskCleanup = null;

  const button = (text, fn, primary = false) =>
    el('button', { class: `btn${primary ? ' btn--primary' : ''}`, type: 'button', onclick: fn }, text);

  function stopTask() {
    if (activeTaskCleanup) {
      try { activeTaskCleanup(); } catch {}
      activeTaskCleanup = null;
    }
  }

  function step(n) {
    stopTask();
    document.querySelectorAll('.lab-steps span').forEach((s, i) => {
      s.classList.toggle('active', i === n);
      s.setAttribute('aria-current', i === n ? 'step' : 'false');
    });
    root.replaceChildren();
  }

  function intro() {
    step(0);
    root.append(
      el('h2', {}, 'Find a comfortable place first.'),
      el('p', {}, 'Silence notifications. Do not switch tabs during the test. You can use the spacebar or the large area on screen.'),
      el('ol', {},
        el('li', {}, '30 seconds: sleep and how you feel'),
        el('li', {}, '3 minutes: tap when the signal appears'),
        el('li', {}, 'Short interactive cognitive tasks (8 modules)'),
        el('li', {}, 'Result: comparison with your own previous days'),
      ),
      el('p', { class: 'muted' }, 'We will do one practice first. The practice result is not saved.'),
      button("I'm ready, start →", survey, true),
    );
  }

  function survey() {
    step(1);
    root.append(el('h2', {}, 'Today, from your point of view.'));
    const sleep = el('input', {
      class: 'input', id: 'sleep', type: 'number', min: 0, max: 24, step: 0.5, value: result.survey.sleep,
    });
    root.append(el('div', { class: 'lab-question' }, el('label', { for: 'sleep' }, 'How many hours did you sleep in the last 24 hours?'), sleep));

    const questions = [
      ['mood', 'Your mood', ['Very low', 'Low', 'Medium', 'Good', 'Very good']],
      ['stress', 'Your stress', ['Very little', 'Little', 'Medium', 'High', 'Very high']],
      ['loneliness', 'Your sense of loneliness', ['None', 'Little', 'Medium', 'A lot', 'Very much']],
      ['workload', 'Your workload', ['Very light', 'Light', 'Medium', 'Heavy', 'Very heavy']],
    ];

    for (const [id, title, labels] of questions) {
      const group = el('div', { class: 'lab-choice', role: 'group', 'aria-label': title });
      labels.forEach((label, i) => {
        const b = button(`${i + 1} · ${label}`, () => {
          result.survey[id] = i + 1;
          for (const c of group.children) c.setAttribute('aria-pressed', String(c === b));
        });
        b.setAttribute('aria-pressed', String(result.survey[id] === i + 1));
        group.append(b);
      });
      root.append(el('div', { class: 'lab-question' }, el('p', {}, title), group));
    }

    const error = el('p', { role: 'alert' });
    root.append(
      error,
      button('Continue to the attention test →', () => {
        if (sleep.value === '' || !sleep.checkValidity()) {
          error.textContent = 'Enter sleep between 0 and 24 hours.';
          sleep.focus();
          return;
        }
        if (['mood', 'stress', 'loneliness', 'workload'].some((k) => result.survey[k] === null)) {
          error.textContent = 'Please select an option for all four ratings.';
          return;
        }
        result.survey.sleep = Number(sleep.value);
        pvt(true);
      }, true),
    );
  }

  function pvt(practice) {
    step(2);
    cancelled = false;
    trials = [];
    early = 0;
    phase = 'wait';
    const heading = el('h2', {}, practice ? "Let's do a practice." : 'Focus only on the next signal.');
    const message = el('p', {}, 'Do not press before the signal. When it appears, press the spacebar or tap.');
    const clock = el('p', { class: 'eyebrow' }, practice ? 'PRACTICE · NOT SAVED' : '03:00');
    const target = el('button', { class: 'pvt-target', type: 'button' }, 'Wait…');
    root.append(
      heading,
      message,
      clock,
      target,
      button('Skip the attention test', () => { cleanup(); result.pvt = null; cognitiveHub(); }),
      button('Stop the test and start over', () => { cleanup(); newSession(); intro(); }),
    );
    ends = performance.now() + (practice ? 20000 : 180000);

    function schedule() {
      phase = 'wait';
      target.dataset.ready = 'false';
      target.textContent = 'Wait…';
      timer = setTimeout(() => {
        if (cancelled) return;
        phase = 'go';
        signalAt = performance.now();
        target.dataset.ready = 'true';
        target.textContent = '● Tap now';
      }, 1500 + Math.random() * 2500);
    }

    function press() {
      if (cancelled) return;
      if (phase === 'wait') {
        early++;
        message.textContent = 'A little early. Wait for the signal.';
        return;
      }
      if (phase !== 'go') return;
      trials.push(performance.now() - signalAt);
      phase = 'wait';
      if (practice) {
        cleanup();
        root.replaceChildren(
          el('h2', {}, "That's it."),
          el('p', {}, 'Now you will do the same test for three minutes. The test pauses if you leave the tab.'),
          button('Start the 3-minute test', () => pvt(false), true),
        );
        return;
      }
      schedule();
    }

    const keydown = (e) => {
      if ((e.code === 'Space' || e.code === 'Enter') && e.target === target) {
        e.preventDefault();
        if (!e.repeat) press();
      }
    };
    target.addEventListener('pointerdown', (e) => { e.preventDefault(); press(); });
    target.addEventListener('keydown', keydown);
    target.addEventListener('click', (e) => { if (e.detail === 0 && !cancelled && phase === 'go') press(); });

    const hidden = () => {
      if (document.hidden) {
        cleanup();
        root.replaceChildren(
          el('h2', {}, 'The test was interrupted.'),
          el('p', {}, 'This reading was not saved because the tab changed. Start again when ready.'),
          button('Try again', () => pvt(false), true),
        );
      }
    };
    document.addEventListener('visibilitychange', hidden);

    const tick = setInterval(() => {
      const left = Math.max(0, Math.ceil((ends - performance.now()) / 1000));
      clock.textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')} · ${trials.length} responses`;
      if (left === 0) {
        // A signal still on screen when time runs out was not answered: count it apart, not as a reaction time.
        const missed = phase === 'go' ? 1 : 0;
        cleanup();
        if (trials.length < 5) {
          root.replaceChildren(el('h2', {}, 'Not enough responses.'), button('Start again', () => pvt(false), true));
          return;
        }
        result.pvt = { ...summarize(trials, early), missed };
        cognitiveHub();
      }
    }, 250);

    function cleanup() {
      cancelled = true;
      phase = 'idle';
      clearTimeout(timer);
      clearInterval(tick);
      document.removeEventListener('visibilitychange', hidden);
    }

    schedule();
    target.focus();
  }

  function cognitiveHub() {
    step(3);
    const bat = summarizeCognitiveBattery(result.cognitive_tasks);
    const cards = el('div', { class: 'cog-grid' }, COGNITIVE_TASKS.map((t) => {
      const done = result.cognitive_tasks[t.id];
      return el('article', { class: `cog-card${done ? ' cog-card--done' : ''}` },
        el('div', { class: 'cog-card__head' },
          el('span', { class: 'eyebrow' }, `TASK ${t.code} · ${t.domain}`),
          el('span', { class: `cog-pill${done ? ' cog-pill--done' : ''}` },
            done ? `${done.score} / 1000` : 'Not run',
          ),
        ),
        el('h3', { class: 'cog-card__title' }, t.name),
        el('p', { class: 'cog-card__desc' }, t.measures),
        done ? el('p', { class: 'cog-card__metrics' }, done.metricsText) : null,
        el('div', { class: 'cog-card__actions' },
          button(done ? 'Run again' : 'Launch task', () => openTask(t), !done),
        ),
      );
    }));

    root.append(
      el('div', { class: 'eyebrow' }, 'COGNITIVE TASKS · INTERACTIVE BATTERY'),
      el('h2', {}, 'Run any cognitive task or continue to results.'),
      el('p', { class: 'muted' }, `${bat.completedCount} / ${bat.totalCount} tasks completed`),
      cards,
      el('div', { class: 'lab-actions' },
        button('Continue to results →', finish, true),
      ),
    );
  }

  function openTask(taskDef) {
    step(3);
    const stageHost = el('div', { class: 'cog-stage' });

    const infoBoxes = el('div', { class: 'cog-info-grid' }, [
      ['What you see on screen', taskDef.see],
      ['What you do', taskDef.doText],
      ['What it measures', taskDef.measures],
      ['Why it matters for astronauts', taskDef.why],
    ].map(([label, text]) =>
      el('div', { class: 'cog-info-card' },
        el('div', { class: 'eyebrow' }, label),
        el('p', {}, text),
      ),
    ));

    const showCompletion = (scoreObj) => {
      stopTask();
      result.cognitive_tasks[taskDef.id] = scoreObj;
      stageHost.replaceChildren(
        el('div', { class: 'cog-complete' },
          el('div', { class: 'eyebrow' }, 'TASK COMPLETED'),
          el('div', { class: 'lab-big' }, `${scoreObj.score} / 1000`),
          el('p', { class: 'muted' }, scoreObj.metricsText),
          el('div', { class: 'lab-actions' },
            button('Run again', () => startRunner()),
            button('Back to task list', cognitiveHub, true),
          ),
        ),
      );
    };

    const startRunner = () => {
      stopTask();
      stageHost.replaceChildren();
      activeTaskCleanup = runCognitiveTask(taskDef.id, stageHost, showCompletion).cleanup;
    };

    stageHost.replaceChildren(
      el('p', { class: 'muted' }, 'Read the briefing cards above, then start the interactive task when ready.'),
      el('div', { class: 'lab-actions' },
        button(`Start ${taskDef.name}`, startRunner, true),
        button('Back to task list', cognitiveHub),
      ),
    );

    root.append(
      el('div', { class: 'cog-runner-top' },
        el('div', {},
          el('div', { class: 'eyebrow' }, `TASK ${taskDef.code} · ${taskDef.domain}`),
          el('h2', {}, taskDef.name),
        ),
        button('← Back to task list', cognitiveHub),
      ),
      infoBoxes,
      stageHost,
    );
  }

  function finish() {
    step(4);
    const assessment = assess(result, history);
    const cogSummary = summarizeCognitiveBattery(result.cognitive_tasks);
    const entry = { ...result, assessment, cognitive_summary: cogSummary };
    let saved = true;
    try {
      localStorage.setItem(key, JSON.stringify([...history.slice(-29), entry]));
    } catch {
      saved = false;
    }

    const head = {
      skipped: 'ATTENTION TEST SKIPPED',
      learning: 'PERSONAL PATTERN LEARNING',
      review: 'REVIEW TOGETHER',
      watch: 'CHANGE DETECTED',
      usual: 'SIMILAR TO YOUR RECENT HISTORY',
    }[assessment.state];

    root.append(...[
      el('div', { class: 'eyebrow' }, head),
      el('div', { class: 'lab-big' }, result.pvt ? `${Math.round(result.pvt.median_ms)} ms` : 'Skipped'),
      el('p', {}, result.pvt ? 'Median reaction time' : 'Reaction time was not recorded'),
      result.pvt
        ? el('p', {}, `${result.pvt.trials} responses · ${result.pvt.early} early presses · ${result.pvt.lapses} slow responses (≥500 ms; prototype threshold)${result.pvt.missed ? ` · ${result.pvt.missed} unanswered signal` : ''}`)
        : null,
      assessment.delta !== null
        ? el('p', {}, `Change from previous days: ${assessment.delta}%. Reference: ${Math.round(assessment.baseline)} ms.`)
        : null,
      el('p', {}, assessment.message),
      bars([...history.filter((h) => h.pvt).slice(-6), ...(result.pvt ? [entry] : [])]),
      el('details', { class: 'lab-calc' },
        el('summary', {}, 'How was this result calculated?'),
        el('p', {}, 'The first 5 different days form the reference. A 20% slowdown, under 7 hours of sleep, low mood or high stress/loneliness/workload is a caution signal. Signals continuing for three consecutive days suggest a joint review. These are prototype rules, not validated clinical thresholds.'),
      ),
    ].filter(Boolean));

    const cogPanel = el('section', { class: 'cog-summary' },
      el('div', { class: 'eyebrow' }, 'COGNITIVE TASKS SUMMARY'),
      el('div', { class: 'cog-summary__head' },
        el('strong', {}, cogSummary.averageScore !== null ? `Battery average: ${cogSummary.averageScore} / 1000` : 'No cognitive tasks run in this session'),
        el('span', { class: 'muted' }, `${cogSummary.completedCount} / ${cogSummary.totalCount} tasks completed`),
      ),
      cogSummary.completedCount
        ? el('ul', { class: 'cog-summary__list' }, COGNITIVE_TASKS
            .filter((t) => result.cognitive_tasks[t.id])
            .map((t) => {
              const r = result.cognitive_tasks[t.id];
              return el('li', {},
                el('span', {}, t.name),
                el('span', { class: 'muted' }, r.metricsText),
                el('strong', {}, `${r.score} / 1000`),
              );
            }))
        : null,
    );
    root.append(cogPanel);

    const dl = el('a', {
      class: 'btn',
      href: URL.createObjectURL(new Blob([JSON.stringify(entry, null, 2)], { type: 'application/json' })),
      download: 'mind-checkin.json',
    }, 'Download result');

    root.append(
      el('p', { class: 'trust-note' }, saved ? 'The result was saved on this device.' : 'Storage is unavailable. Download the result now.'),
      el('div', { class: 'lab-actions' },
        dl,
        button('Start again', () => { newSession(); intro(); }),
        el('a', { class: 'btn btn--primary', href: 'index.html' }, 'Return to mission centre →'),
      ),
    );
    // Keep the saved list in memory too, so a second session on this page is added, not written over the first.
    history = [...history.slice(-29), entry];
  }

  function bars(entries) {
    if (!entries.length) return el('div');
    const max = Math.max(400, ...entries.map((e) => e.pvt.median_ms));
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 280 70');
    svg.setAttribute('class', 'lab-bars');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'Reaction times from the last seven measured sessions');
    svg.innerHTML = entries
      .map((e, i) => {
        const h = (e.pvt.median_ms / max) * 56;
        return `<rect x="${i * 40 + 6}" y="${62 - h}" width="26" height="${h}" rx="3" fill="${i === entries.length - 1 ? 'var(--accent)' : 'var(--line-strong)'}"/>`;
      })
      .join('');
    return el('figure', {}, svg, el('figcaption', { class: 'trust-note' }, 'Last 7 sessions · column height is reaction time.'));
  }

  intro();
}
