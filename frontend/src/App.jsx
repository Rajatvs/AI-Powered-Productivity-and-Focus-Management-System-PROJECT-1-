import React, {

  useEffect,

  useMemo,

  useRef,

  useState,

} from "react";



import {

  extractFile,

  summarizeText,

  generateQuestions,

  checkFace,

} from "./api";



const NAV = [

  ["dashboard", "⌂", "Dashboard"],

  ["notes", "✦", "Smart Notes"],

  ["tasks", "✓", "Tasks"],

  ["timer", "◷", "Focus Timer"],

  ["analytics", "▥", "Analytics"],

  ["productivity", "⚡", "Productivity"],

  ["monitor", "◉", "Focus Monitor"],

  ["relax", "♫", "Relax Mode"],

  ["settings", "⚙", "Settings"],

];



const fmt = (s) =>

  `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(

    s % 60

  ).padStart(2, "0")}`;



const todayKey = () =>

  new Date().toISOString().slice(0, 10);



const load = (k, d) => {

  try {

    return JSON.parse(localStorage.getItem(k)) ?? d;

  } catch {

    return d;

  }

};



const save = (k, v) =>

  localStorage.setItem(k, JSON.stringify(v));



function App() {

  const [page, setPage] = useState("dashboard");



  const [tasks, setTasks] = useState(() =>

    load("focus_tasks", [])

  );



  const [sessions, setSessions] = useState(() =>

    load("focus_sessions", [])

  );

  // Load MongoDB sessions and migrate eligible local study history once per app load.
  // The backend upserts by session ID, so retrying this migration will not duplicate sessions.
  useEffect(() => {
    let cancelled = false;
    const syncSessions = async () => {
      try {
        const response = await fetch("http://127.0.0.1:5000/api/sessions");
        if (!response.ok) throw new Error(`Sessions API returned ${response.status}`);
        const data = await response.json();
        const remote = Array.isArray(data.sessions) ? data.sessions : [];
        const remoteIds = new Set(remote.map((item) => String(item.id)));

        // Only migrate valid study sessions; break entries are not study analytics.
        const localSnapshot = load("focus_sessions", []);
        const toMigrate = localSnapshot.filter((item) =>
          item && item.type === "study" &&
          typeof item.id === "string" && item.id.trim() &&
          Number.isFinite(Number(item.minutes)) &&
          Number(item.minutes) > 0 && Number(item.minutes) <= 180 &&
          !remoteIds.has(String(item.id))
        );

        for (const session of toMigrate) {
          const saveResponse = await fetch("http://127.0.0.1:5000/api/sessions", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(session),
          });
          if (!saveResponse.ok) {
            console.warn("Could not migrate local study session:", session.id, saveResponse.status);
          } else {
            remoteIds.add(String(session.id));
          }
        }

        if (cancelled) return;
        // Re-fetch so the UI reflects the canonical set persisted by the backend.
        const latestResponse = await fetch("http://127.0.0.1:5000/api/sessions");
        if (!latestResponse.ok) throw new Error(`Sessions refresh returned ${latestResponse.status}`);
        const latestData = await latestResponse.json();
        const latestRemote = Array.isArray(latestData.sessions) ? latestData.sessions : [];
        setSessions((local) => {
          const byId = new Map();
          [...local, ...latestRemote].forEach((item) => byId.set(String(item.id), item));
          return [...byId.values()]
            .sort((a, b) => String(b.time || "").localeCompare(String(a.time || "")))
            .slice(0, 500);
        });
      } catch (error) {
        console.warn("Could not sync MongoDB sessions; using local history.", error);
      }
    };
    syncSessions();
    return () => { cancelled = true; };
  }, []);



  const [goal, setGoal] = useState(() =>

    load("focus_goal", 180)

  );



  // Start each fresh app session at 100. The previous score was persisted in
  // localStorage, so an old 0% could reappear whenever the app was reopened.
  const [focusScore, setFocusScore] = useState(100);



  const [theme, setTheme] = useState(() =>

    load("focus_theme", "dark")

  );



  const [distractions, setDistractions] = useState(() =>

    load("focus_distractions", [])

  );



  /*

   * ============================================================

   * GLOBAL TIMER STATE

   * ============================================================

   */



  const [study, setStudy] = useState(() =>

    load("timer_study", 25)

  );



  const [brk, setBrk] = useState(() =>

    load("timer_break", 5)

  );



  const [timerMode, setTimerMode] = useState(() =>

    load("timer_mode", "study")

  );



  const [timerRunning, setTimerRunning] = useState(() =>

    load("timer_running", false)

  );



  const [timerStarted, setTimerStarted] = useState(() =>

    load("timer_started", false)

  );



  const [timerRemaining, setTimerRemaining] = useState(() => {

    const saved = load("timer_state", null);



    if (saved?.running && saved?.endTime) {

      return Math.max(

        0,

        Math.ceil((saved.endTime - Date.now()) / 1000)

      );

    }



    return saved?.remaining ?? 1500;

  });



  const [timerEndTime, setTimerEndTime] = useState(() => {

    const saved = load("timer_state", null);



    if (saved?.running && saved?.endTime) {

      return saved.endTime;

    }



    return null;

  });



  useEffect(() => {

    save("focus_tasks", tasks);

  }, [tasks]);



  useEffect(() => {

    save("focus_sessions", sessions);

  }, [sessions]);



  useEffect(() => {

    save("focus_goal", goal);

  }, [goal]);



  useEffect(() => {

    save("focus_score", focusScore);

  }, [focusScore]);



  useEffect(() => {

    save("focus_theme", theme);

  }, [theme]);



  useEffect(() => {

    save("focus_distractions", distractions);

  }, [distractions]);



  useEffect(() => {

    save("timer_study", study);

  }, [study]);



  useEffect(() => {

    save("timer_break", brk);

  }, [brk]);



  useEffect(() => {

    save("timer_mode", timerMode);

    save("timer_running", timerRunning);

    save("timer_started", timerStarted);



    save("timer_state", {

      running: timerRunning,

      mode: timerMode,

      remaining: timerRemaining,

      endTime: timerEndTime,

    });

  }, [

    timerRunning,

    timerMode,

    timerStarted,

    timerRemaining,

    timerEndTime,

  ]);



  /*

   * ============================================================

   * GLOBAL TIMER ENGINE

   * ============================================================

   */



  useEffect(() => {

    if (!timerRunning || !timerEndTime) {

      return;

    }



    const updateTimer = () => {

      const seconds = Math.max(

        0,

        Math.ceil((timerEndTime - Date.now()) / 1000)

      );



      if (seconds <= 0) {

        if (timerMode === "study") {

          addSession(study, "study");

        }



        const nextMode =

          timerMode === "study" ? "break" : "study";



        const nextDuration =

          (timerMode === "study" ? brk : study) * 60;



        setTimerMode(nextMode);

        setTimerRemaining(nextDuration);

        setTimerRunning(false);

        setTimerStarted(false);

        setTimerEndTime(null);



        return;

      }



      setTimerRemaining(seconds);

    };



    updateTimer();



    const interval = setInterval(updateTimer, 250);



    return () => clearInterval(interval);

  }, [

    timerRunning,

    timerEndTime,

    timerMode,

    study,

    brk,

  ]);



  const toggleTimer = () => {

    if (timerRunning) {

      const seconds = timerEndTime

        ? Math.max(

            0,

            Math.ceil((timerEndTime - Date.now()) / 1000)

          )

        : timerRemaining;



      setTimerRemaining(seconds);

      setTimerRunning(false);

      setTimerEndTime(null);

      setTimerStarted(true);



      return;

    }



    const endTime = Date.now() + timerRemaining * 1000;



    setTimerEndTime(endTime);

    setTimerRunning(true);

    setTimerStarted(true);

  };



  const resetTimer = () => {

    setTimerRunning(false);

    setTimerStarted(false);

    setTimerMode("study");

    setTimerRemaining(study * 60);

    setTimerEndTime(null);

  };



  const changeStudyDuration = (value) => {

    setStudy(value);



    if (!timerRunning && timerMode === "study") {

      setTimerRemaining(value * 60);

      setTimerEndTime(null);

    }

  };



  const changeBreakDuration = (value) => {

    setBrk(value);



    if (!timerRunning && timerMode === "break") {

      setTimerRemaining(value * 60);

      setTimerEndTime(null);

    }

  };



  const setRhythm = (studyMinutes, breakMinutes) => {

    setStudy(studyMinutes);

    setBrk(breakMinutes);



    if (!timerRunning) {

      setTimerMode("study");

      setTimerRemaining(studyMinutes * 60);

      setTimerStarted(false);

      setTimerEndTime(null);

    }

  };



  /*

   * ============================================================

   * DISTRACTION TRACKING

   * ============================================================

   */



  useEffect(() => {

    const onVis = () => {

      if (document.hidden) {

        const item = {

          site: document.title || "FocusAI",

          time: new Date().toLocaleTimeString(),

          date: todayKey(),

          reason: "Left FocusAI tab",

        };



        setDistractions((d) => [item, ...d].slice(0, 100));



        setFocusScore((s) => Math.max(0, s - 3));

      }

    };



    document.addEventListener("visibilitychange", onVis);



    return () => {

      document.removeEventListener("visibilitychange", onVis);

    };

  }, []);



  /*

   * ============================================================

   * GLOBAL DATA

   * ============================================================

   */



  const todayMinutes = useMemo(

    () =>

      sessions

        .filter((x) => x.date === todayKey())

        .reduce((a, b) => a + b.minutes, 0),

    [sessions]

  );



  const completed = tasks.filter((t) => t.done).length;



  const active = tasks.filter((t) => !t.done).length;



  const addSession = (minutes, type = "study") => {

    if (minutes <= 0) return;

    const session = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      date: todayKey(),
      minutes: Number(minutes),
      type,
      time: new Date().toISOString(),
      focus_score: Number(focusScore) || 0,
      distraction_count: distractions.filter((d) => d.date === todayKey()).length,
      // The user supplies this label after the session; do not fabricate training labels.
      goal_met: null,
    };

    // Show it immediately, then persist it in MongoDB.
    setSessions((s) => [session, ...s].slice(0, 500));
    fetch("http://127.0.0.1:5000/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(session),
    })
      .then(async (response) => {
        if (!response.ok) {
          const detail = await response.text();
          throw new Error(`Sessions API ${response.status}: ${detail}`);
        }
      })
      .catch((error) => {
        console.error("Session is saved locally, but MongoDB save failed:", error);
      });
  };



  const common = {

    tasks,

    setTasks,

    goal,

    setGoal,

    sessions,

    setSessions,

    focusScore,

    setFocusScore,

    distractions,

    setDistractions,

    todayMinutes,

    completed,

    active,

    addSession,

  };



  return (

    <div className={theme === "light" ? "app light" : "app"}>

      <aside className="sidebar">

        <div className="brand">

          <div className="brandmark">F</div>



          <div>

            <b>FocusAI</b>

            <span>Study smarter</span>

          </div>

        </div>



        <nav>

          {NAV.map(([id, icon, label]) => (

            <button

              key={id}

              className={page === id ? "nav active" : "nav"}

              onClick={() => setPage(id)}

            >

              <span>{icon}</span>

              {label}

            </button>

          ))}

        </nav>



        <div className="sidebar-bottom">

          <div className="mini-score">

            <span>Focus score</span>



            <strong>{focusScore}%</strong>



            <div className="progress">

              <i

                style={{

                  width: `${focusScore}%`,

                }}

              />

            </div>

          </div>

        </div>

      </aside>



      <main className="main">

        <header className="topbar">

          <div>

            <span className="eyebrow">

              STUDENT WORKSPACE

            </span>



            <h1>

              {NAV.find((x) => x[0] === page)?.[2]}

            </h1>

          </div>



          <div className="top-actions">

            <div className="date">

              {new Date().toLocaleDateString(undefined, {

                weekday: "short",

                month: "short",

                day: "numeric",

              })}

            </div>



            <button

              className="icon-btn"

              onClick={() =>

                setTheme(theme === "dark" ? "light" : "dark")

              }

            >

              {theme === "dark" ? "☼" : "☾"}

            </button>

          </div>

        </header>



        <div className="content">

          {page === "dashboard" && (

            <Dashboard

              {...common}

              setPage={setPage}

            />

          )}



          {page === "notes" && <Notes />}



          {page === "tasks" && (

            <Tasks {...common} />

          )}



          {page === "timer" && (

            <Timer

              study={study}

              brk={brk}

              mode={timerMode}

              remaining={timerRemaining}

              running={timerRunning}

              started={timerStarted}

              toggleTimer={toggleTimer}

              reset={resetTimer}

              changeStudyDuration={changeStudyDuration}

              changeBreakDuration={changeBreakDuration}

              setRhythm={setRhythm}

            />

          )}



          {page === "analytics" && (

            <Analytics

              sessions={sessions}

              distractions={distractions}

              todayMinutes={todayMinutes}

            />

          )}



          {page === "productivity" && (

            <Productivity

              distractions={distractions}

              score={focusScore}

              sessions={sessions}

              setSessions={setSessions}

            />

          )}



          {page === "monitor" && (

            <Monitor addSession={addSession} />

          )}



          {page === "relax" && <Relax />}



          {page === "settings" && (

            <Settings

              theme={theme}

              setTheme={setTheme}

              goal={goal}

              setGoal={setGoal}

            />

          )}

        </div>

      </main>

    </div>

  );

}



/* ============================================================

   DASHBOARD

   ============================================================ */



function Dashboard({

  todayMinutes,

  goal,

  focusScore,

  completed,

  active,

  setPage,

  tasks,

}) {

  const pct = Math.min(

    100,

    Math.round((todayMinutes / goal) * 100)

  );



  return (

    <div className="stack">

      <section className="hero">

        <div>

          <span className="pill">

            ✦ AI STUDY COMPANION

          </span>



          <h2>

            Make your next study session count.

          </h2>



          <p>

            Organize notes, stay focused, and turn study

            time into measurable progress.

          </p>



          <button

            className="primary"

            onClick={() => setPage("timer")}

          >

            Start focus session →

          </button>

        </div>



        <div className="hero-orb">

          <div className="orb-inner">

            <strong>{focusScore}%</strong>

            <span>focus score</span>

          </div>

        </div>

      </section>



      <div className="grid four">

        <Stat

          label="Study today"

          value={`${Math.floor(todayMinutes / 60)}h ${

            todayMinutes % 60

          }m`}

          sub={`${pct}% of ${Math.floor(goal / 60)}h goal`}

          icon="◷"

        />



        <Stat

          label="Focus score"

          value={`${focusScore}%`}

          sub="Keep distractions low"

          icon="⚡"

        />



        <Stat

          label="Tasks done"

          value={`${completed}`}

          sub={`${active} remaining`}

          icon="✓"

        />



        <Stat

          label="Sessions"

          value="4"

          sub="This week"

          icon="▥"

        />

      </div>



      <div className="grid two">

        <Card

          title="Today's progress"

          action="View analytics"

          onClick={() => setPage("analytics")}

        >

          <div className="goal-row">

            <div>

              <b>

                {Math.floor(todayMinutes / 60)}h{" "}

                {todayMinutes % 60}m

              </b>



              <span> studied today</span>

            </div>



            <strong>{pct}%</strong>

          </div>



          <div className="progress big">

            <i

              style={{

                width: `${pct}%`,

              }}

            />

          </div>



          <div className="muted">

            Goal: {Math.floor(goal / 60)}h {goal % 60}m

          </div>

        </Card>



        <Card

          title="Priority tasks"

          action="Open tasks"

          onClick={() => setPage("tasks")}

        >

          {tasks

            .filter((t) => !t.done)

            .slice(0, 3)

            .map((t) => (

              <div

                className="task-line"

                key={t.id}

              >

                <span

                  className={`dot ${t.priority}`}

                />



                <div>

                  <b>{t.text}</b>



                  <small>

                    {t.priority} priority

                  </small>

                </div>

              </div>

            ))}



          {tasks.filter((t) => !t.done).length === 0 && (

            <Empty text="No pending tasks. You're all caught up!" />

          )}

        </Card>

      </div>



      <div className="grid three">

        <Quick

          icon="✦"

          title="Smart Notes"

          text="Extract, summarize & generate questions"

          onClick={() => setPage("notes")}

        />



        <Quick

          icon="◉"

          title="Focus Monitor"

          text="Use your webcam to stay accountable"

          onClick={() => setPage("monitor")}

        />



        <Quick

          icon="♫"

          title="Relax Mode"

          text="Play calming sounds during breaks"

          onClick={() => setPage("relax")}

        />

      </div>

    </div>

  );

}



function Stat({

  label,

  value,

  sub,

  icon,

}) {

  return (

    <div className="stat card">

      <div className="stat-icon">{icon}</div>

      <span>{label}</span>

      <strong>{value}</strong>

      <small>{sub}</small>

    </div>

  );

}



function Card({

  title,

  action,

  onClick,

  children,

}) {

  return (

    <section className="card panel">

      <div className="panel-head">

        <h3>{title}</h3>



        {action && (

          <button

            className="link"

            onClick={onClick}

          >

            {action}

          </button>

        )}

      </div>



      {children}

    </section>

  );

}



function Quick({

  icon,

  title,

  text,

  onClick,

}) {

  return (

    <button

      className="quick card"

      onClick={onClick}

    >

      <span>{icon}</span>



      <div>

        <b>{title}</b>

        <small>{text}</small>

      </div>



      <em>→</em>

    </button>

  );

}



function Empty({ text }) {

  return <div className="empty">{text}</div>;

}



/* ============================================================

   SMART NOTES

   ============================================================ */



function Notes() {

  const [file, setFile] = useState(null);

  const [text, setText] = useState("");

  const [result, setResult] = useState("");

  const [mode, setMode] = useState("summary");

  const [busy, setBusy] = useState(false);

  const [err, setErr] = useState("");



  const run = async (kind) => {

    if (!text.trim()) {

      return setErr("Add some text first.");

    }



    setBusy(true);

    setErr("");



    try {

      const r =

        kind === "summary"

          ? await summarizeText(text)

          : await generateQuestions(text);



      setResult(r);

    } catch (e) {

      setErr(e.message);

    } finally {

      setBusy(false);

    }

  };



  const upload = async (f) => {

    setFile(f);

    setBusy(true);

    setErr("");



    try {

      setText(await extractFile(f));

    } catch (e) {

      setErr(e.message);

    } finally {

      setBusy(false);

    }

  };



  return (

    <div className="stack">

      <div className="section-intro">

        <div>

          <span className="eyebrow">

            AI STUDY TOOLS

          </span>



          <h2>

            Turn notes into understanding.

          </h2>



          <p>

            Upload an image or PDF, edit the extracted

            text, then summarize it or generate exam-style

            questions.

          </p>

        </div>

      </div>



      <div className="grid two">

        <Card title="1. Add study material">

          <label className="dropzone">

            <input

              type="file"

              accept=".png,.jpg,.jpeg,.webp,.pdf,.txt"

              onChange={(e) =>

                e.target.files[0] &&

                upload(e.target.files[0])

              }

            />



            <span className="drop-icon">↑</span>



            <b>

              {file

                ? file.name

                : "Drop an image, PDF or text file"}

            </b>



            <small>

              OCR extraction is handled by the Flask backend

            </small>

          </label>



          <textarea

            className="note-editor"

            value={text}

            onChange={(e) => setText(e.target.value)}

            placeholder="Extracted/editable text appears here..."

          />

        </Card>



        <Card title="2. AI results">

          <div className="segmented">

            <button

              className={

                mode === "summary" ? "selected" : ""

              }

              onClick={() => setMode("summary")}

            >

              Summarize

            </button>



            <button

              className={

                mode === "questions" ? "selected" : ""

              }

              onClick={() => setMode("questions")}

            >

              Generate questions

            </button>

          </div>



          <button

            className="primary wide"

            disabled={busy}

            onClick={() => run(mode)}

          >

            {busy

              ? "Processing…"

              : mode === "summary"

              ? "Summarize notes"

              : "Generate questions"}

          </button>



          {err && (

            <div className="error">

              {err}

            </div>

          )}



          <div className="result">

            {result || (

              <Empty text="Your AI result will appear here." />

            )}

          </div>

        </Card>

      </div>

    </div>

  );

}



/* ============================================================

   TASKS

   ============================================================ */



function Tasks({

  tasks,

  setTasks,

}) {

  const [text, setText] = useState("");

  const [priority, setPriority] = useState("medium");



  const add = () => {

    if (!text.trim()) return;



    setTasks((t) => [

      {

        id: Date.now(),

        text: text.trim(),

        priority,

        done: false,

      },

      ...t,

    ]);



    setText("");

  };



  const toggle = (id) =>

    setTasks((t) =>

      t.map((x) =>

        x.id === id

          ? {

              ...x,

              done: !x.done,

            }

          : x

      )

    );



  return (

    <div className="stack">

      <div className="section-intro">

        <div>

          <span className="eyebrow">

            PLAN YOUR DAY

          </span>



          <h2>

            Tasks that move you forward.

          </h2>



          <p>

            Keep your daily workload visible and manageable.

          </p>

        </div>

      </div>



      <Card title="Add a task">

        <div className="task-add">

          <input

            value={text}

            onChange={(e) => setText(e.target.value)}

            onKeyDown={(e) =>

              e.key === "Enter" && add()

            }

            placeholder="e.g. Revise probability & statistics"

          />



          <select

            value={priority}

            onChange={(e) =>

              setPriority(e.target.value)

            }

          >

            <option value="low">Low</option>

            <option value="medium">Medium</option>

            <option value="high">High</option>

          </select>



          <button

            className="primary"

            onClick={add}

          >

            Add task

          </button>

        </div>

      </Card>



      <Card title={`${tasks.length} tasks`}>

        <div className="task-list">

          {tasks.map((t) => (

            <div

              className={`task-item ${

                t.done ? "done" : ""

              }`}

              key={t.id}

            >

              <button

                className="check"

                onClick={() => toggle(t.id)}

              >

                {t.done ? "✓" : ""}

              </button>



              <div>

                <b>{t.text}</b>



                <small className={t.priority}>

                  {t.priority} priority

                </small>

              </div>



              <button

                className="trash"

                onClick={() =>

                  setTasks((a) =>

                    a.filter((x) => x.id !== t.id)

                  )

                }

              >

                ×

              </button>

            </div>

          ))}



          {!tasks.length && (

            <Empty text="Add your first task above." />

          )}

        </div>

      </Card>

    </div>

  );

}



/* ============================================================

   GLOBAL FOCUS TIMER

   ============================================================ */



function Timer({

  study,

  brk,

  mode,

  remaining,

  running,

  started,

  toggleTimer,

  reset,

  changeStudyDuration,

  changeBreakDuration,

  setRhythm,

}) {

  return (

    <div className="timer-page">

      <div className="timer-card card">

        <span className={`mode-pill ${mode}`}>

          {mode === "study"

            ? "FOCUS SESSION"

            : "BREAK TIME"}

        </span>



        <div className="timer">

          {fmt(remaining)}

        </div>



        <p>

          {mode === "study"

            ? "Stay with the task. Your focus time is being tracked."

            : "Recharge. Your next session starts when you're ready."}

        </p>



        <div className="timer-actions">

          <button

            className="primary"

            onClick={toggleTimer}

          >

            {running

              ? "Pause"

              : started

              ? "Resume"

              : "Start session"}

          </button>



          <button

            className="secondary"

            onClick={reset}

          >

            Reset

          </button>

        </div>



        <div className="timer-settings">

          <label>

            Study minutes



            <input

              type="number"

              min="1"

              max="180"

              value={study}

              onChange={(e) => {

                const v = +e.target.value;



                if (v > 0) {

                  changeStudyDuration(v);

                }

              }}

            />

          </label>



          <label>

            Break minutes



            <input

              type="number"

              min="1"

              max="60"

              value={brk}

              onChange={(e) => {

                const v = +e.target.value;



                if (v > 0) {

                  changeBreakDuration(v);

                }

              }}

            />

          </label>

        </div>

      </div>



      <div className="timer-side">

        <Card title="Suggested rhythms">

          <div

            className="rhythm"

            onClick={() => setRhythm(25, 5)}

          >

            <b>25 / 5</b>

            <span>Classic Pomodoro</span>

          </div>



          <div

            className="rhythm"

            onClick={() => setRhythm(50, 10)}

          >

            <b>50 / 10</b>

            <span>Deep work</span>

          </div>



          <div

            className="rhythm"

            onClick={() => setRhythm(35, 5)}

          >

            <b>35 / 5</b>

            <span>Balanced study</span>

          </div>

        </Card>

      </div>

    </div>

  );

}



/* ============================================================

   ANALYTICS

   ============================================================ */



function Analytics({

  sessions,

  distractions,

  todayMinutes,

}) {

  const days = Array.from(

    {

      length: 7,

    },

    (_, i) => {

      const d = new Date();



      d.setDate(d.getDate() - (6 - i));



      const key = d.toISOString().slice(0, 10);



      return {

        label: d.toLocaleDateString(undefined, {

          weekday: "short",

        }),



        minutes: sessions

          .filter(

            (x) =>

              x.date === key &&

              x.type === "study"

          )

          .reduce((a, b) => a + b.minutes, 0),

      };

    }

  );



  const max = Math.max(

    60,

    ...days.map((x) => x.minutes)

  );



  return (

    <div className="stack">

      <div className="section-intro">

        <div>

          <span className="eyebrow">

            YOUR PROGRESS

          </span>



          <h2>

            See where your time goes.

          </h2>



          <p>

            Study sessions sync with your MongoDB database.

          </p>

        </div>

      </div>



      <div className="grid four">

        <Stat

          label="Today"

          value={`${todayMinutes}m`}

          sub="Study time"

          icon="◷"

        />



        <Stat

          label="This week"

          value={`${days.reduce(

            (a, b) => a + b.minutes,

            0

          )}m`}

          sub="Total study"

          icon="▥"

        />



        <Stat

          label="Sessions"

          value={sessions.length}

          sub="Recorded"

          icon="●"

        />



        <Stat

          label="Distractions"

          value={distractions.length}

          sub="Tracked events"

          icon="⚡"

        />

      </div>



      <Card title="Study time — last 7 days">

        <div className="bars">

          {days.map((d) => (

            <div

              className="bar-col"

              key={d.label}

            >

              <div className="bar-wrap">

                <i

                  style={{

                    height: `${Math.max(

                      5,

                      (d.minutes / max) * 100

                    )}%`,

                  }}

                />

              </div>



              <b>{d.minutes}m</b>

              <span>{d.label}</span>

            </div>

          ))}

        </div>

      </Card>



      <div className="grid two">

        <Card title="Focus breakdown">

          <div className="donut">

            <div>

              <b>

                {Math.max(

                  0,

                  100 -

                    Math.min(

                      100,

                      distractions.length * 3

                    )

                )}

                %

              </b>



              <span>focused</span>

            </div>

          </div>

        </Card>



        <Card title="Recent distraction events">

          {distractions

            .slice(0, 6)

            .map((d, i) => (

              <div

                className="history-row"

                key={i}

              >

                <span>⚡</span>



                <div>

                  <b>{d.site}</b>



                  <small>

                    {d.time} · {d.reason}

                  </small>

                </div>

              </div>

            ))}



          {!distractions.length && (

            <Empty text="No distractions recorded yet." />

          )}

        </Card>

      </div>

    </div>

  );

}



/* ============================================================

   PRODUCTIVITY / FOCUS INSIGHTS

   ============================================================ */



function MLInsights({ sessions, setSessions, distractions, score }) {
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [demoLoading, setDemoLoading] = useState(false);
  const [error, setError] = useState("");

  const pendingSessions = sessions.filter(
    (session) => session.type === "study" && session.goal_met !== true && session.goal_met !== false
  );

  const labelledCount = sessions.filter(
    (session) => session.type === "study" && typeof session.goal_met === "boolean"
  ).length;

  const labelSession = (target, goalMet) => {
    setSessions((current) => current.map((session) => {
      const sameSession = target.id
        ? session.id === target.id
        : session === target;
      return sameSession ? { ...session, goal_met: goalMet } : session;
    }));
    setResult(null);
    setError("");
  };

  const loadInsights = async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("http://127.0.0.1:5000/api/analytics/ml-insights", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessions,
          focus_score: Number(score) || 0,
          distraction_count: distractions.filter((d) => d.date === todayKey()).length,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not generate ML insights.");
      setResult(data);
    } catch (err) {
      setError(err.message || "Could not connect to the Flask backend.");
    } finally {
      setLoading(false);
    }
  };

  const loadDemoInsights = async () => {
    setDemoLoading(true);
    setError("");
    try {
      const response = await fetch("http://127.0.0.1:5000/api/analytics/ml-demo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_minutes: 2 }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not generate demo ML insights.");
      setResult(data);
    } catch (err) {
      setError(err.message || "Could not connect to the Flask backend.");
    } finally {
      setDemoLoading(false);
    }
  };

  return (
    <Card title="Random Forest · ML Insights">
      <div className="stack">
        <p>
          Teach FocusAI using your own study-session feedback. Mark whether you met your goal;
          the model will use only sessions with real labels.
        </p>

        <div className="grid three">
          <Stat label="Study sessions" value={sessions.filter((s) => s.type === "study").length} sub="Recorded" icon="◷" />
          <Stat label="Feedback labels" value={labelledCount} sub="Used for training" icon="✓" />
          <Stat label="Waiting for feedback" value={pendingSessions.length} sub="Unlabelled sessions" icon="○" />
        </div>

        {pendingSessions.length > 0 && (
          <div className="stack">
            <h3>Label your recent sessions</h3>
            {pendingSessions.slice(0, 5).map((session, index) => (
              <div className="history-row" key={session.id || session.time || index}>
                <span>◷</span>
                <div>
                  <b>{Number(session.minutes) || 0} minute study session</b>
                  <small>{session.time ? new Date(session.time).toLocaleString() : session.date || "Session"}</small>
                </div>
                <button className="secondary" onClick={() => labelSession(session, true)}>Goal met</button>
                <button className="secondary" onClick={() => labelSession(session, false)}>Not met</button>
              </div>
            ))}
          </div>
        )}

        <div className="grid two">
          <button className="primary" onClick={loadInsights} disabled={loading || demoLoading}>
            {loading ? "Analyzing sessions..." : "Generate ML insights (my data)"}
          </button>
          <button className="secondary" onClick={loadDemoInsights} disabled={loading || demoLoading}>
            {demoLoading ? "Running demo..." : "Run 2-Minute Demo"}
          </button>
        </div>

        {error && <p role="alert">{error}</p>}

        {result && (
          <div className="stack">
            <h3>Model results</h3>
            {result.message && <p>{result.message}</p>}
            {result.demo_mode && (
              <div className="stack">
                <div className="stat-card">
                  <span>Estimated goal success · example 2-minute session</span>
                  <strong>{result.prediction?.predicted_goal_success_percent ?? "—"}%</strong>
                </div>
                <p>Demo test accuracy: {result.test_accuracy_percent ?? "—"}%</p>
                <p><b>Data source:</b> Synthetic sample data ({result.sample_sessions ?? 0} sample sessions)</p>
                <div className="stack">
                  <h3>Study habit insights (calculated from demo data)</h3>
                  {result.productivity_insights ? (
                    <>
                      <div className="stat-card">
                        <span>Best-performing study time</span>
                        <strong>{result.productivity_insights.best_study_time?.label ?? "Not enough data"}</strong>
                        {result.productivity_insights.best_study_time && (
                          <small>{String(result.productivity_insights.best_study_time.start_hour).padStart(2, "0")}:00–{String(result.productivity_insights.best_study_time.end_hour === 24 ? 0 : result.productivity_insights.best_study_time.end_hour).padStart(2, "0")}:00 · {result.productivity_insights.best_study_time.success_rate_percent}% success across {result.productivity_insights.best_study_time.sessions} sample sessions</small>
                        )}
                      </div>
                      <div className="history-row">
                        <span>⚡</span><div><b>Distraction impact</b><small>
                          Low distractions (0–1): {result.productivity_insights.low_distraction_success_percent ?? "Not enough samples"}% success across {result.productivity_insights.low_distraction_sessions} sessions. High distractions (4+): {result.productivity_insights.high_distraction_success_percent ?? "Not enough samples"}% success across {result.productivity_insights.high_distraction_sessions} sessions.
                        </small></div>
                      </div>
                      <div className="history-row">
                        <span>⏱</span><div><b>Session duration comparison</b><small>
                          Around 10 minutes: {result.productivity_insights.ten_minute_success_percent ?? "Not enough samples"}% success across {result.productivity_insights.ten_minute_sessions} sessions. Around 25 minutes: {result.productivity_insights.twenty_five_minute_success_percent ?? "Not enough samples"}% success across {result.productivity_insights.twenty_five_minute_sessions} sessions.
                        </small></div>
                      </div>
                    </>
                  ) : (
                    <p role="alert">The backend returned no demo insights. Replace backend/app.py with the matching updated app_demo.py and restart Flask.</p>
                  )}
                  <small>Demo findings are calculated from synthetic sample sessions, not your personal study history.</small>
                </div>
                {Array.isArray(result.feature_importance) && (
                  <div className="stack">
                    <h3>Feature importance</h3>
                    {result.feature_importance.map((item) => (
                      <div className="history-row" key={item.feature}>
                        <span>•</span>
                        <div>
                          <b>{String(item.feature).replaceAll("_", " ")}</b>
                          <small>{(Number(item.importance) * 100).toFixed(1)}% importance</small>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                <small>{result.note}</small>
              </div>
            )}
            {typeof result.estimated_success_probability === "number" && (
              <div className="stat-card">
                <span>Estimated goal success</span>
                <strong>{Math.round(result.estimated_success_probability * 100)}%</strong>
              </div>
            )}
            {typeof result.predicted_success_probability === "number" && (
              <div className="stat-card">
                <span>Estimated goal success</span>
                <strong>{Math.round(result.predicted_success_probability * 100)}%</strong>
              </div>
            )}
            {typeof result.validation_accuracy === "number" && (
              <p>Cross-validation accuracy: {Math.round(result.validation_accuracy * 100)}%</p>
            )}
            {typeof result.accuracy === "number" && (
              <p>Model accuracy: {Math.round(result.accuracy * 100)}%</p>
            )}
            {!result.demo_mode && <small>These are estimates based on your available labelled sessions, not a guarantee of future performance.</small>}
          </div>
        )}
      </div>
    </Card>
  );
}


function Productivity({

  distractions,

  score,

  sessions,

  setSessions,

}) {

  const studySessions = sessions.filter(

    (s) =>

      s.type === "study" &&

      Number(s.minutes) > 0

  );



  const averageSession =

    studySessions.length > 0

      ? Math.round(

          studySessions.reduce(

            (total, session) =>

              total + Number(session.minutes),

            0

          ) / studySessions.length

        )

      : 0;



  const periodCounts = {

    "Early morning": 0,

    Morning: 0,

    Afternoon: 0,

    Evening: 0,

    Night: 0,

  };



  studySessions.forEach((session) => {

    if (!session.time) return;



    const hour = new Date(session.time).getHours();



    if (hour < 6) {

      periodCounts["Early morning"]++;

    } else if (hour < 12) {

      periodCounts["Morning"]++;

    } else if (hour < 17) {

      periodCounts["Afternoon"]++;

    } else if (hour < 21) {

      periodCounts["Evening"]++;

    } else {

      periodCounts["Night"]++;

    }

  });



  const bestPeriod =

    studySessions.length > 0

      ? Object.entries(periodCounts).sort(

          (a, b) => b[1] - a[1]

        )[0][0]

      : null;



  const bestPeriodText =

    bestPeriod === "Early morning"

      ? "12:00 AM – 6:00 AM"

      : bestPeriod === "Morning"

      ? "6:00 AM – 12:00 PM"

      : bestPeriod === "Afternoon"

      ? "12:00 PM – 5:00 PM"

      : bestPeriod === "Evening"

      ? "5:00 PM – 9:00 PM"

      : bestPeriod === "Night"

      ? "9:00 PM – 12:00 AM"

      : "Not enough data yet";



  const today = todayKey();



  const yesterdayDate = new Date();



  yesterdayDate.setDate(

    yesterdayDate.getDate() - 1

  );



  const yesterday = yesterdayDate

    .toISOString()

    .slice(0, 10);



  const todayDistractions = distractions.filter(

    (d) => d.date === today

  ).length;



  const yesterdayDistractions = distractions.filter(

    (d) => d.date === yesterday

  ).length;



  let comparisonText = "No comparison yet";

  let comparisonDirection = "neutral";



  if (

    yesterdayDistractions === 0 &&

    todayDistractions === 0

  ) {

    comparisonText = "No distractions today";

  } else if (

    yesterdayDistractions === 0 &&

    todayDistractions > 0

  ) {

    comparisonText =

      "More distractions than yesterday";



    comparisonDirection = "down";

  } else {

    const change = Math.round(

      ((todayDistractions - yesterdayDistractions) /

        yesterdayDistractions) *

        100

    );



    if (change < 0) {

      comparisonText = `${Math.abs(

        change

      )}% fewer distractions`;



      comparisonDirection = "up";

    } else if (change > 0) {

      comparisonText = `${change}% more distractions`;



      comparisonDirection = "down";

    } else {

      comparisonText = "Same number as yesterday";

      comparisonDirection = "neutral";

    }

  }



  let recommendation =

    "Start a focus session to build your first insight.";



  if (studySessions.length === 0) {

    recommendation =

      "Start with a 25 / 5 session and build a consistent routine.";

  } else if (averageSession < 25) {

    recommendation =

      "Try a 25 / 5 session next. Build your focus gradually.";

  } else if (averageSession < 40) {

    recommendation =

      "Try a 35 / 5 session next. You're ready to extend your focus.";

  } else if (averageSession < 50) {

    recommendation =

      "Try a 50 / 10 session next. You have a solid focus rhythm.";

  } else {

    recommendation =

      "Keep using 50 / 10 deep-work sessions and protect your strongest focus periods.";

  }



  return (

    <div className="stack">

      <MLInsights
        sessions={sessions}
        setSessions={setSessions}
        distractions={distractions}
        score={score}
      />

      <div className="section-intro">

        <div>

          <span className="eyebrow">

            FOCUS INSIGHTS

          </span>



          <h2>

            Understand how you focus.

          </h2>



          <p>

            FocusAI looks at your study sessions and

            distraction history to surface useful patterns.

          </p>

        </div>



        <div className="score-ring small">

          <b>{score}%</b>

          <span>focus</span>

        </div>

      </div>



      <div className="grid two">

        <Card title="🧠 Focus Insights">

          <div className="insight-list">

            <div className="insight-row">

              <div className="insight-icon">◷</div>



              <div>

                <span>Your best focus period</span>

                <b>{bestPeriodText}</b>

              </div>

            </div>



            <div className="insight-row">

              <div className="insight-icon">⏱</div>



              <div>

                <span>Average session</span>



                <b>

                  {averageSession > 0

                    ? `${averageSession} minutes`

                    : "Not enough data yet"}

                </b>

              </div>

            </div>



            <div className="insight-row">

              <div className="insight-icon">⚡</div>



              <div>

                <span>Today's distractions</span>

                <b>{todayDistractions}</b>

              </div>

            </div>



            <div className="insight-row">

              <div className="insight-icon">

                {comparisonDirection === "up"

                  ? "↓"

                  : comparisonDirection === "down"

                  ? "↑"

                  : "→"}

              </div>



              <div>

                <span>Compared with yesterday</span>

                <b>{comparisonText}</b>

              </div>

            </div>

          </div>

        </Card>



        <Card title="Activity history">

          <div className="history-list">

            {distractions

              .slice(0, 12)

              .map((d, i) => (

                <div

                  className="history-row"

                  key={i}

                >

                  <span>⚡</span>



                  <div>

                    <b>{d.site}</b>

                    <small>{d.time}</small>

                  </div>



                  <em>-3</em>

                </div>

              ))}



            {!distractions.length && (

              <Empty text="No distraction events yet. Keep this tab visible during a focus session." />

            )}

          </div>

        </Card>

      </div>



      <div className="grid two">

        <Card title="💡 Recommendation">

          <div className="recommendation">

            <div className="recommendation-icon">

              ✦

            </div>



            <div>

              <span>

                Based on your current focus pattern

              </span>



              <h3>{recommendation}</h3>

            </div>

          </div>



          <div className="insight-summary">

            <div>

              <span>Recorded sessions</span>

              <b>{studySessions.length}</b>

            </div>



            <div>

              <span>Current focus score</span>

              <b>{score}%</b>

            </div>

          </div>

        </Card>



        <Card title="Focus statistics">

          <div className="insight-summary">

            <div>

              <span>Best period</span>

              <b>{bestPeriod || "—"}</b>

            </div>



            <div>

              <span>Avg. session</span>



              <b>

                {averageSession > 0

                  ? `${averageSession}m`

                  : "—"}

              </b>

            </div>



            <div>

              <span>Today's distractions</span>

              <b>{todayDistractions}</b>

            </div>

          </div>

        </Card>

      </div>



      <div className="grid three">

        <div className="card insight-stat">

          <span>Best focus period</span>



          <strong>{bestPeriod || "—"}</strong>



          <small>

            Based on your recorded sessions

          </small>

        </div>



        <div className="card insight-stat">

          <span>Average session</span>



          <strong>

            {averageSession > 0

              ? `${averageSession}m`

              : "—"}

          </strong>



          <small>

            Across completed study sessions

          </small>

        </div>



        <div className="card insight-stat">

          <span>Today's distractions</span>



          <strong>{todayDistractions}</strong>



          <small>

            Keep this number low during focus sessions

          </small>

        </div>

      </div>

    </div>

  );

}



/* ============================================================

   FOCUS MONITOR

   ============================================================ */



function Monitor({

  addSession,

}) {

  const video = useRef(null);

  const streamRef = useRef(null);

  const faceCheckRunning = useRef(false);



  const MONITOR_DURATION = 45 * 60;



  const [remaining, setRemaining] =

    useState(MONITOR_DURATION);



  const [sessionStarted, setSessionStarted] =

    useState(false);



  const [sessionComplete, setSessionComplete] =

    useState(false);



  const [active, setActive] =

    useState(false);



  const [present, setPresent] =

    useState(false);



  const [message, setMessage] =

    useState("Camera is off.");



  const timerEndRef = useRef(null);



  /*

   * ============================================================

   * FACE CHECK LOOP

   * ============================================================

   */



  useEffect(() => {

    if (!active) return;



    const check = async () => {

      if (

        !video.current ||

        faceCheckRunning.current

      ) {

        return;

      }



      if (video.current.readyState < 2) {

        return;

      }



      faceCheckRunning.current = true;



      const canvas =

        document.createElement("canvas");



      canvas.width = 320;

      canvas.height = 240;



      const ctx = canvas.getContext("2d");



      if (!ctx) {

        faceCheckRunning.current = false;

        return;

      }



      ctx.drawImage(

        video.current,

        0,

        0,

        canvas.width,

        canvas.height

      );



      try {

        const result = await checkFace(

          canvas.toDataURL("image/jpeg", 0.65)

        );



        const detected = Boolean(

          result.face_detected

        );



        setPresent(detected);



        if (detected) {

          setSessionStarted(true);



          setMessage(

            "Face detected — focus timer running."

          );

        } else {

          setMessage(

            "Face not detected — timer paused."

          );

        }

      } catch (e) {

        setPresent(false);



        setMessage(

          "Face check unavailable — timer paused."

        );

      } finally {

        faceCheckRunning.current = false;

      }

    };



    check();



    const interval = setInterval(check, 1800);



    return () => clearInterval(interval);

  }, [active]);



  /*

   * ============================================================

   * ACCOUNTABILITY TIMER

   * ============================================================

   */



  useEffect(() => {

    if (

      !active ||

      !sessionStarted ||

      !present ||

      sessionComplete

    ) {

      if (timerEndRef.current) {

        const seconds = Math.max(

          0,

          Math.ceil(

            (timerEndRef.current - Date.now()) /

              1000

          )

        );



        setRemaining(seconds);

        timerEndRef.current = null;

      }



      return;

    }



    if (!timerEndRef.current) {

      timerEndRef.current =

        Date.now() + remaining * 1000;

    }



    const tick = () => {

      if (!timerEndRef.current) {

        return;

      }



      const seconds = Math.max(

        0,

        Math.ceil(

          (timerEndRef.current - Date.now()) /

            1000

        )

      );



      setRemaining(seconds);



      if (seconds <= 0) {

        timerEndRef.current = null;



        setSessionComplete(true);

        setSessionStarted(false);

        setPresent(true);



        setMessage(

          "Focus session complete — 45 minutes finished!"

        );



        addSession(45, "study");

      }

    };



    tick();



    const interval = setInterval(tick, 250);



    return () => clearInterval(interval);

  }, [

    active,

    present,

    sessionStarted,

    remaining,

    sessionComplete,

    addSession,

  ]);



  /*

   * ============================================================

   * ENABLE CAMERA

   * ============================================================

   */



  const start = async () => {

    if (sessionComplete) {

      setRemaining(MONITOR_DURATION);

      setSessionComplete(false);

      timerEndRef.current = null;

    }



    try {

      if (streamRef.current) {

        setActive(true);



        setMessage(

          "Camera active. Waiting for face..."

        );



        return;

      }



      const s =

        await navigator.mediaDevices.getUserMedia({

          video: true,

          audio: false,

        });



      streamRef.current = s;



      if (video.current) {

        video.current.srcObject = s;

        await video.current.play();

      }



      setActive(true);

      setSessionStarted(true);



      setMessage(

        "Camera active. Waiting for face..."

      );

    } catch (e) {

      setActive(false);

      setSessionStarted(false);



      setMessage(

        "Camera permission was denied or unavailable."

      );

    }

  };



  /*

   * ============================================================

   * STOP CAMERA

   * ============================================================

   */



  const stop = () => {

    if (timerEndRef.current) {

      const seconds = Math.max(

        0,

        Math.ceil(

          (timerEndRef.current - Date.now()) /

            1000

        )

      );



      setRemaining(seconds);

      timerEndRef.current = null;

    }



    if (streamRef.current) {

      streamRef.current

        .getTracks()

        .forEach((track) => track.stop());



      streamRef.current = null;

    }



    if (video.current) {

      video.current.srcObject = null;

    }



    setActive(false);

    setPresent(false);



    if (!sessionComplete) {

      setMessage(

        "Camera is off. Timer paused."

      );

    }

  };



  /*

   * ============================================================

   * RESET SESSION

   * ============================================================

   */



  const reset = () => {

    timerEndRef.current = null;



    setRemaining(MONITOR_DURATION);

    setSessionStarted(false);

    setSessionComplete(false);

    setPresent(false);



    if (active) {

      setMessage(

        "Camera active. Press Start 45-minute session when ready."

      );

    } else {

      setMessage("Camera is off.");

    }

  };



  /*

   * ============================================================

   * CLEANUP

   * ============================================================

   */



  useEffect(() => {

    return () => {

      if (streamRef.current) {

        streamRef.current

          .getTracks()

          .forEach((track) => track.stop());



        streamRef.current = null;

      }

    };

  }, []);



  /*

   * ============================================================

   * MONITOR UI

   * ============================================================

   */



  return (

    <div className="stack">

      <div className="section-intro">

        <div>

          <span className="eyebrow">

            ACCOUNTABILITY MODE

          </span>



          <h2>

            Stay in frame. Stay focused.

          </h2>



          <p>

            Complete a 45-minute study session while

            FocusAI checks that you're present.

          </p>

        </div>

      </div>



      <div className="monitor-grid">

        <Card title="Live camera">

          <div className="camera">

            <video

              ref={video}

              muted

              playsInline

            />



            <div

              className={`camera-status ${

                present ? "good" : ""

              }`}

            >

              {present

                ? "● Face detected"

                : "○ Waiting for face"}

            </div>

          </div>



          <div

            className="monitor-timer"

            style={{

              textAlign: "center",

              padding: "24px 10px 10px",

            }}

          >

            <span

              className="eyebrow"

              style={{

                display: "block",

                marginBottom: "8px",

              }}

            >

              {sessionComplete

                ? "SESSION COMPLETE"

                : present

                ? "FOCUSING"

                : "TIMER PAUSED"}

            </span>



            <div

              style={{

                fontSize: "64px",

                fontWeight: 800,

                lineHeight: 1,

                letterSpacing: "2px",

              }}

            >

              {fmt(remaining)}

            </div>



            <p

              className="muted"

              style={{

                marginTop: "12px",

                marginBottom: "0",

              }}

            >

              {sessionComplete

                ? "🎉 Excellent! You completed the 45-minute focus session."

                : present

                ? "Your face is detected. Keep studying — the timer is running."

                : sessionStarted

                ? "The timer is paused until your face is detected again."

                : "Enable the camera and start your 45-minute focus session."}

            </p>

          </div>



          <div

            className="camera-actions"

            style={{

              display: "flex",

              gap: "10px",

              flexWrap: "wrap",

            }}

          >

            {!active ? (

              <button

                className="primary"

                onClick={start}

              >

                Enable camera

              </button>

            ) : (

              <button

                className="secondary"

                onClick={stop}

              >

                Stop camera

              </button>

            )}



            <button

              className="secondary"

              onClick={reset}

            >

              Reset 45 min

            </button>

          </div>



          <p className="muted">

            {message}

          </p>

        </Card>

      </div>

    </div>

  );

}



/* ============================================================

   RELAX MODE

   ============================================================ */



function Relax() {

  const [sound, setSound] = useState("rain");

  const [playing, setPlaying] = useState(false);

  const [volume, setVolume] = useState(0.55);



  const audio = useRef(null);



  useEffect(() => {

    if (!audio.current) return;



    audio.current.volume = volume;



    if (playing) {

      audio.current

        .play()

        .catch(() => {});

    } else {

      audio.current.pause();

    }

  }, [

    playing,

    volume,

    sound,

  ]);



  const src = `/audio/${sound}.wav`;



  return (

    <div className="stack">

      <div className="relax-hero">

        <div>

          <span className="pill">

            BREAK TIME

          </span>



          <h2>

            Slow down. Breathe. Reset.

          </h2>



          <p>

            Choose a calming local sound to play while you

            recharge.

          </p>

        </div>



        <div className="sound-orb">

          ♫

        </div>

      </div>



      <audio

        ref={audio}

        src={src}

        loop

      />



      <div className="grid three">

        {[

          [

            "rain",

            "Rainfall",

            "Soft steady rain",

          ],

          [

            "water",

            "Water",

            "Gentle flowing water",

          ],

          [

            "nature",

            "Nature",

            "Calm ambient texture",

          ],

        ].map(([id, n, d]) => (

          <button

            className={`sound-card card ${

              sound === id ? "selected" : ""

            }`}

            key={id}

            onClick={() => {

              setSound(id);

              setPlaying(true);

            }}

          >

            <span className="sound-icon">

              {id === "rain"

                ? "☂"

                : id === "water"

                ? "≋"

                : "♧"}

            </span>



            <b>{n}</b>



            <small>{d}</small>



            {sound === id && (

              <em>Playing</em>

            )}

          </button>

        ))}

      </div>



      <Card title="Player controls">

        <div className="player">

          <button

            className="play"

            onClick={() => setPlaying(!playing)}

          >

            {playing ? "❚❚" : "▶"}

          </button>



          <div>

            <b>

              {sound === "rain"

                ? "Rainfall"

                : sound === "water"

                ? "Water"

                : "Nature"}

            </b>



            <small>

              Local audio • loops during your break

            </small>

          </div>



          <label>

            Volume



            <input

              type="range"

              min="0"

              max="1"

              step=".01"

              value={volume}

              onChange={(e) =>

                setVolume(+e.target.value)

              }

            />

          </label>

        </div>

      </Card>

    </div>

  );

}



/* ============================================================

   SETTINGS

   ============================================================ */



function Settings({

  theme,

  setTheme,

  goal,

  setGoal,

}) {

  return (

    <div className="stack">

      <div className="section-intro">

        <div>

          <span className="eyebrow">

            PREFERENCES

          </span>



          <h2>

            Make FocusAI yours.

          </h2>

        </div>

      </div>



      <Card title="Appearance">

        <div className="setting-row">

          <div>

            <b>Theme</b>



            <small>

              Switch between dark and light mode.

            </small>

          </div>



          <div className="segmented">

            <button

              className={

                theme === "dark" ? "selected" : ""

              }

              onClick={() => setTheme("dark")}

            >

              Dark

            </button>



            <button

              className={

                theme === "light" ? "selected" : ""

              }

              onClick={() => setTheme("light")}

            >

              Light

            </button>

          </div>

        </div>

      </Card>



      <Card title="Daily study goal">

        <div className="setting-row">

          <div>

            <b>Goal in minutes</b>



            <small>

              Used by the dashboard progress card.

            </small>

          </div>



          <input

            className="small-input"

            type="number"

            min="30"

            max="1440"

            value={goal}

            onChange={(e) =>

              setGoal(+e.target.value || 180)

            }

          />

        </div>

      </Card>



      <Card title="Privacy">

        <div className="privacy">

          <span>✓</span>



          <div>

            <b>

              Local-first by design

            </b>



            <small>

              Tasks, analytics and preferences stay in

              browser storage. Camera frames are sent only

              to your local Flask backend for face-presence

              checks.

            </small>

          </div>

        </div>

      </Card>

    </div>

  );

}



export default App;