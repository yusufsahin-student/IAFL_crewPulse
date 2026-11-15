# CrewPulse

**Team IAFL** · NASA Space Apps Challenge 2026 · Niğde Local Event  
**Challenge:** *Create Health Monitoring Software for Astronauts on Space Missions*

> *Far away. Stay close to yourself.*

| | |
|---|---|
| **Live app** | https://iafl-crewpulse.onrender.com (no account needed; if the free server is asleep, the first load can take about a minute) |
| **Demo (7-slide pitch deck)** | https://drive.google.com/file/d/1P9mhGoz9fLms9pyCIh6Vf9GRCi3m1eTA/view?usp=sharing |
| **Project outputs** | https://drive.google.com/drive/folders/14TgAOtC_r5MkBHsC1mm_KQtjkjRhBYnP |
| **Source code** | https://github.com/yusufsahin-student/IAFL_crewPulse |
| **Sprint reports** | [`sprint-reports/`](sprint-reports/) |

**CrewPulse** is a health app for astronauts on long missions. Every day, the astronaut spends a few minutes taking measurements. The app compares these measurements with the person's own normal, warns early if something changes and says what to do. Even when the doctor is very far away, the astronaut knows what to do.

---

## Contents

1. [At a glance](#1-at-a-glance)
2. [The problem](#2-the-problem)
3. [Our solution](#3-our-solution)
4. [Features](#4-features)
5. [How we met the challenge requirements](#5-how-we-met-the-challenge-requirements)
6. [NASA data we used](#6-nasa-data-we-used)
7. [Technology](#7-technology)
8. [Run it locally](#8-run-it-locally)
9. [Deploy](#9-deploy-docker-for-example-on-render)
10. [Tests](#10-tests)
11. [Next steps](#11-next-steps)
12. [Use of AI](#12-use-of-ai)
13. [References and licenses](#13-references-and-licenses)

---

## 1. At a glance

| 22 | 5 | 12 | 3 | 57 |
|:---:|:---:|:---:|:---:|:---:|
| health measurements | mission settings | gravity risks | NASA data sources | scientific sources |

**The problem.** In space, the body slowly weakens, and the astronaut often does not notice it. When a problem appears, the doctor is very far away. On the way to Mars, a message can take up to **22 minutes** to reach Earth.

**Our solution.** CrewPulse works in four steps:

| Step | What happens |
|---|---|
| **1 · Measure** | The astronaut does a short check every day. Pictures show how to take each measurement. |
| **2 · Understand** | Results are compared with the astronaut's **own normal**. The status is shown with colour and text. |
| **3 · Connect** | Real NASA solar storm and radiation data appear on the same screen as the health data. |
| **4 · Decide** | The app says what to do. This decision changes with **how far the crew is from Earth**. |

**Three things that make us different**

- **Decisions based on distance.** On the ISS, the same reading means "write to the flight surgeon". During Mars transit, it means "act first yourself, then report to Earth".
- **Real NASA data.** NASA's solar storm records affect the app's decisions. If there is a storm, the app sends the astronaut to the shelter.
- **Prevention and warning.** The app does not only warn when a problem appears. It also helps the astronaut stay strong with a daily exercise plan.

> **Try it yourself:** Open the **Body map** page in the live app. In the "Where is the crew?" section, switch the mission from ISS to Mars transit. The measurements stay the same, but the app's advice changes.

---

## 2. The problem

NASA defines five hazards that threaten human health on long space missions. The table shows how each hazard affects the body and what we did about it in CrewPulse.

| Hazard | Effect on the body | What we did in CrewPulse |
|---|---|---|
| Space radiation | Radiation that builds up over time, reduced attention | Radiation page, real solar storm data, shelter advice, reaction time test |
| Isolation and confinement | Low mood, stress, sleep problems | Mind Lab, mood and stress measurements |
| Distance from Earth | Help arrives late, the crew has to decide on its own | Advice that changes with distance |
| Altered gravity | Bone and muscle loss, balance and vision problems | Bone loss forecast, gravity tracking, exercise plan, eye tests |
| Hostile, closed environment | Problems with nutrition, drinking water and illness | Food, water and illness symptom measurements, cabin air information |

**Three sides of the problem**

- **Change is silent.** Bone loss or poor sleep does not start with pain. It builds up slowly over weeks.
- **People do not notice.** Someone who is tired or short of sleep usually says "I'm fine". In space, even a small lapse in attention can be dangerous.
- **The doctor is far away.** On the ISS, the doctor is a phone call away. On the way to Mars, an answer can take more than 40 minutes.

> **The question we want to solve:** How can an astronaut far from Earth notice a change in their health early, and know what to do when they cannot reach a doctor right away?

---

## 3. Our solution

> **Our goal:** To help the astronaut stay strong every day, and to help them take the right step on their own even when the doctor is far away.

The app has two jobs. Both use the same daily measurements:

| Job | When? | What does the app do? |
|---|---|---|
| **Keep the astronaut strong** | Every day | Gives a personal exercise plan, forecasts bone loss, tracks gravity and reminds the astronaut to measure regularly. |
| **Help make the right decision** | When something changes | Notices a change from the person's normal, shows it together with solar storm data and says what to do. |

### Pages of the app

| Page | What is it for? |
|---|---|
| Home | Today's status, latest measurements, daily tasks and a summary to send to the ground team |
| Check-in | Where the 22 measurements are entered one by one, with picture guides |
| Body map | Health score, "what should I do now" advice, mission setting and a clickable body |
| Radiation | Solar storms, radiation in each part of the station and the shelter |
| Mind Lab | A short survey, an attention test and eight short mind games |
| Activity | Today's exercise plan and recommendations |
| Gravital Tracking | The gravity where the astronaut is, its effect on the body and the risk analysis |
| Trends | Charts that show how the measurements change over the days |

---

## 4. Features

In the examples we use our demo astronaut **Mira Sato**. Mira is a fictional character on day 73 of an ISS mission. The app can be used in English and Turkish.

### 4.1 Home

- **What it does:** When the astronaut opens the app, they immediately see how they are today: the latest measurements, daily tasks and cabin air.
- **How it works:** It reminds the astronaut to measure every day. It counts days in a row with measurements and gives badges on days 3, 7 and 30. If asked, it prepares a file that summarises the situation. This file is never sent anywhere automatically.
- **Why it matters:** The app needs regular measurements to learn the person's normal. Badges and reminders help build this habit.

### 4.2 Check-in

- **What it does:** The astronaut enters 22 measurements here, such as heart rate, blood pressure, sleep and mood. The measurements are asked one at a time.
- **How it works:** Next to each measurement, the app shows the normal range, a picture that explains how to measure it and why it matters. Some measurements are required every day, others are optional. Some limits depend on the person: for example, daily calorie needs are calculated from age, height, weight and sex. Entered values are not lost even if the connection drops, and the same measurement is never saved twice.
- **Why it matters:** Astronauts are not expected to be medical experts. That is why we explained every step clearly. All six measurements given as examples in the challenge are in the app, plus sixteen more.

| Measurement | Unit | Normal range | Related hazard |
|---|---|---|---|
| Heart rate | bpm | 50–100 | Gravity |
| Systolic blood pressure | mmHg | 100–129 | Gravity |
| Diastolic blood pressure | mmHg | 60–79 | Gravity |
| Blood oxygen (SpO2) | % | 95–100 | Closed environment |
| Body temperature | °C | 36.1–37.5 | Closed environment |
| Blood glucose | mg/dL | 70–140 | Closed environment |
| Sleep duration | hours | 7–9.5 | Closed environment |
| Mood | 1–5 | 3 or higher | Isolation |
| Reaction time | ms | 100–300 | Radiation |
| Daily exercise | min | 30 or more | Gravity |
| Body weight | kg | 46–90 | Closed environment |
| Back pain | 1–5 | 2 or lower | Gravity |
| Food eaten | kcal | Personal (about 2300+) | Closed environment |
| Water intake | mL | 2000 or more | Closed environment |
| Illness symptoms | 1–5 | 2 or lower | Closed environment |
| Stress | 1–5 | 3 or lower | Isolation |
| Social connection | 1–5 | 3 or higher | Isolation |
| Near vision (eye chart) | logMAR | 0–0.2 | Gravity |
| Amsler grid (vision distortion test) | squares | 0 | Gravity |
| Balance and dizziness | 1–5 | 2 or lower | Gravity |
| Urine colour | 1–8 | 3 or lower | Gravity |
| Hand grip strength | kg | By sex (16 / 27+) | Gravity |

### 4.3 Personal normal and health score

- **What it does:** It tells the astronaut how they are today compared with their own normal, using a score from 0 to 100. It also explains the reasons for the score in plain sentences.
- **How it works:** The app compares every new measurement with the astronaut's last 20 measurements. If a value is far from the person's own normal, it catches it and says which value it is. The score has four parts: the measurements, the person's own normal, the bone forecast and the radiation estimate. If there is even one serious problem, the score cannot go above 49.
- **Why it matters:** Everyone's normal is different. For example, 85 is high for someone whose heart rate is usually 60, but in general tables 85 looks normal. That is why we compare each person with themselves.

| Status | Meaning |
|---|---|
| 🟢 Normal | The value is within the normal range |
| 🟡 Caution | The value is outside the normal range |
| 🔴 Alert | The value is outside the danger limit |

The status is shown not only with colour but also with text and pattern. This way, someone who cannot tell colours apart can still understand it.

### 4.4 Advice based on distance

- **What it does:** It tells the astronaut what to do now and who to inform. This advice changes with how far the crew is from Earth.
- **How it works:** The app first looks at how serious the situation is (4 levels). Then it looks at where the crew is: on the ISS the ground team decides, on the Moon the crew and the ground decide together, and during Mars transit the crew acts first on its own. It also shows simple steps to take for every measurement that is not normal.
- **Why it matters:** This feature is the heart of our project. It answers this question from the challenge: *When does a result require the attention of the crew or the doctors on Earth?*

| Level | When? |
|---|---|
| 0 · Normal day | All measurements are normal |
| 1 · Measure again | A measurement is outside the normal range or different from the person's own normal |
| 2 · Act now | A measurement is dangerous, the score is below 50 or there is a solar storm |
| 3 · Emergency | Two or more measurements are dangerous |

| Mission setting | How long does a message take? | Who decides? |
|---|---|---|
| International Space Station (ISS) | Half a second | Ground team |
| Lunar transit spacecraft | 1 second | Crew and ground team together |
| Lunar surface base | 1.3 seconds | Crew and ground team together |
| Pressurized lunar rover | 1.3 seconds | Crew |
| Mars transit | Up to 22 minutes | Crew |

**Example: when Mira's heart rate goes up.** Mira's heart rate is usually around 75. One morning her reading is **101**. The app marks this as "caution" and says her heart rate is **34% above her own normal**. Her health score drops to 68. We changed only where Mira is:

| | On the ISS | During Mars transit |
|---|---|---|
| Advice | Measure again today | Act first, then report to Earth |
| Who is informed? | The flight surgeon, by normal message | The crew medical officer on board |
| Step 1 | Measure your heart rate again within 2 hours | Measure your heart rate now and again after 1 hour |
| Step 2 | Follow the simple steps in the app | Follow the simple steps in the app |
| Step 3 | Send the results to the flight surgeon | Tell the crew medical officer. Do not wait for Earth, an answer takes 44 minutes |
| Step 4 | Continue your work unless the doctor says otherwise | Send the results to Earth when communication opens |

### 4.5 Body map

- **What it does:** It divides the body into 12 regions and shows the status of each region with colour. Clicking a region opens the measurements for that region.
- **How it works:** If even one measurement in a region is bad, the region turns that colour. Each region explains in plain language how space affects that part of the body. For example, the eye region explains why vision can change on long missions and which tests are done.
- **Why it matters:** The challenge suggested exactly this: a human figure where every part can be clicked and shows the status of that part.

### 4.6 Radiation

- **What it does:** It shows whether there is a solar storm right now, how much radiation there is in each part of the station and where to take shelter during a storm.
- **How it works:** Each time the server starts, it downloads real solar storm records for the last 30 days from NASA. It estimates the radiation for each part of the station. For example, on the ISS the shelter reduces storm radiation by about 96% compared with the least protected part. The estimated radiation the astronaut has received so far is also shown.
- **Why it matters:** Here NASA data is not only displayed, it drives decisions. If a solar storm starts, the app raises the alert level and sends the astronaut to the shelter. On the home page, the shelter warning and the astronaut's health message appear together; one does not hide the other.

### 4.7 Gravity tracking and risk analysis

- **What it does:** It shows the 12 risks that weightlessness brings to the body (bone loss, vision changes, heart, muscle loss, balance, kidney stones, immunity and others) in one table. It also gives the gravity where the astronaut is and a forecast of bone and muscle loss.
- **How it works:** Each risk is scored from 1 to 25 based on how often it occurs (likelihood) and how serious it is (impact). The risks are linked to the astronaut's latest measurements: for example, eye tests feed the vision risk, and heart rate and blood pressure feed the heart risk. They also change with the mission phase: a headache in the first week is part of adapting, but a new headache on day 90 needs a check. The app shows upcoming checks (such as an eye scan or a strength test) in a calendar. Bone loss is forecast from monthly rates in scientific studies; 120 minutes of exercise a day reduces this loss by up to half.
- **Why it matters:** Screening cannot be done every day in space. This section shows the astronaut which risk is the priority right now and what to watch for. The scores were set by our team in a way similar to NASA's risk assessment method; the source of each risk is linked in the app.

### 4.8 Activity and recommendations

- **What it does:** It tells the astronaut how much and what kind of exercise to do today. It also shows which information each recommendation is based on.
- **How it works:** The plan is based on the latest measurements, sleep, mood and the exercise done in the last week. If the astronaut is tired, the load goes down; if they are well, it slowly goes up. If there is a serious health warning, hard exercise is not recommended.
- **Why it matters:** Preventing a problem is easier than treating it once it appears. The plan changes every day with the astronaut's condition.

### 4.9 Mind Lab

- **What it does:** It measures the astronaut's attention, mood and mental state in a few minutes and compares the result with their own previous days.
- **How it works:** First there is a short survey: sleep, mood, stress, loneliness and workload. Then comes a 3-minute attention test and eight short games on memory, attention and decision-making. If the astronaut has become clearly slower than on previous days, the app warns them. If this lasts three days, it suggests talking to the crew medical officer.
- **Why it matters:** Fatigue and loneliness are not things people can easily notice in themselves. A short test catches the change before it turns into a mistake.

> **Inspired by Cognition.** We built this test ourselves, inspired by the [Cognition](https://www.med.upenn.edu/uep/cognition.html) test battery, which was developed for NASA at the University of Pennsylvania and is used with astronauts on the ISS (Basner et al., 2015). Cognition consists of 10 short tests; our 3-minute attention test and eight games measure similar areas. Our version is independent; it is not NASA's test or a clinical assessment.

### 4.10 Trends

- **What it does:** It shows with charts how each measurement changes over the days. Solar storms appear on the same chart.
- **How it works:** The last 60 measurements are drawn together with their normal ranges, and the days that differ from the person's normal are marked. It also shows which measurements change together; for example, mood dropping when sleep goes down.
- **Why it matters:** One bad result on one day may mean nothing. If the same change lasts several days, it matters. The charts make this easy to see.

---

## 5. How we met the challenge requirements

| What does the challenge ask for? | What did we do? |
|---|---|
| Software that collects health measurements, evaluates the astronaut's health and helps them take action | Daily check-in, personal normal, health score and advice based on distance |
| Blood pressure, heart rate, blood glucose, body temperature, sleep and mood | All six are included, plus 16 more measurements |
| Build on NASA's five hazards | Every measurement is linked to a hazard; separate pages for radiation, gravity, isolation and distance; a 12-item gravity risk analysis |
| A visual tool and guidance for treatment and recovery | Body map, colour-coded status, charts, 45 guidance texts and a daily exercise plan |
| Taking input from the user | Keyboard and click input, game-like reaction and mind tests, eye chart and Amsler grid |
| Deciding when a result requires the attention of the crew or the doctors | A 4-level advice system and 3 decision modes based on distance |
| What can be done to prevent a serious condition | Exercise plan, bone protection, water and nutrition advice, storm shelter |
| A clickable human figure that shows the status of each part | 12-region body map |
| Different settings: spacecraft, station, rover, a base on another planet or the Moon | ISS, lunar transit spacecraft, lunar surface base, pressurized lunar rover and Mars transit |
| Reminding the user to measure within the mission routine | Daily measurement reminder and daily task list |
| Gamification | Days-in-a-row count, badges, daily tasks and game-like tests |
| Charts that show change over time | Trends and Gravital Tracking pages |
| Colours that show the status at a glance | Colour, text and pattern together |
| Simple instructions and explanations | A picture-based "how to measure" and "why it matters" explanation for every measurement |

---

## 6. NASA data we used

| Data | Where from? | How do we use it? |
|---|---|---|
| Solar storms and coronal mass ejections | [NASA DONKI](https://kauai.ccmc.gsfc.nasa.gov/DONKI/) (via [api.nasa.gov](https://api.nasa.gov/)) | Downloaded for the last 30 days each time the server starts. If there is a storm, the alert level goes up and the shelter is recommended |
| Solar flares | [NASA Fermi GBM flare list](https://hesperia.gsfc.nasa.gov/fermi/gbm/qlook/fermi_gbm_flare_list.txt) | Downloaded each time the server starts; shown on the Radiation and Trends pages |
| Daily radiation on the ISS | [ISS TEPC measurements](https://cdaweb.gsfc.nasa.gov/hapi/info?id=ISS_DOSANL_TEPC) (NASA CDAWeb) | Baseline radiation value for the ISS: 0.884 mSv per day |
| Hazards of spaceflight | [NASA Human Research Program](https://www.nasa.gov/hrp/) | We used this to decide which measurements to include |
| Health limits and bone loss rates | NASA-STD-3001, NASA HRP evidence reports and scientific studies | All rules in the app are based on these sources |
| Gravity risks | NASA HRP, OCHMO technical briefs, NASA NTRS and peer-reviewed papers | Each source is linked next to its risk on the Gravital Tracking page |
| Radiation monitoring for astronaut health | [Canadian Space Agency](https://www.asc-csa.gc.ca/eng/news/articles/2026/2026-02-26-monitoring-radiation-astronaut-health.asp) | Background information for the Radiation section |

When we tested the live app on 15 November 2026, it displayed 86 real DONKI records and 70 real Fermi GBM flares.

### Which data is real and which is sample data?

| Data | Status |
|---|---|
| Solar storms, ISS radiation | 🟢 Real NASA data |
| Health limits, bone loss rates and cabin air levels (CO2, temperature, humidity) | 🟢 From 57 scientific sources. Cabin CO2 levels are based on ISS measurements ([Law et al. 2014](https://pubmed.ncbi.nlm.nih.gov/24806559/), [NASA OSDR Environmental Data App](https://visualization.osdr.nasa.gov/eda/)); temperature and humidity follow the NASA-STD-3001 crew range (20–25 °C, 30–60% humidity) |
| Mira Sato, her daily measurements and cabin air records | 🟡 Sample data. We used it because the health data of real astronauts is confidential |

CrewPulse is an early warning and guidance tool. It does not diagnose, and it does not replace the crew medical officer or a doctor.

The full list of 57 sources is in [`data/seed/sources.json`](data/seed/sources.json), and [`docs/SOURCE-AUDIT.md`](docs/SOURCE-AUDIT.md) explains how each value was checked.

---

## 7. Technology

| Part | Technology | What does it do? |
|---|---|---|
| Server | Rust (axum, rusqlite) | Does the calculations and serves the pages |
| Database | SQLite | All rules and texts are stored here. Rules can be updated without changing the code |
| Data tools | Python | Downloads NASA data and prepares the database |
| Personal normal model | Python, TensorFlow | Measures how far a value is from the person's normal. The live version uses a lighter statistical method (z-score), because TensorFlow does not fit the free hosting instance |
| Interface | HTML, CSS, JavaScript | Eight pages; English and Turkish; day and night view; no external libraries or CDNs |
| Deployment | Docker, Render | The app runs publicly on the internet |

**Security and privacy.** The NASA key is not in the code; it is stored in the server settings. Mind Lab and activity records stay only in the astronaut's own browser. The app never sends any information anywhere automatically.

### Repository layout

| Path | What it is |
|---|---|
| `docs/CONTRACT.md` | The spec every part is built against: API, formulas, ownership |
| `docs/SOURCE-AUDIT.md` | How each value was checked against its source |
| `db/schema.sql` | SQLite schema |
| `data/seed/*.json` | Reference data, one file per table: edit these to change the app |
| `tools/seed.py` | Builds `db/astro.db` from the schema, seed files and sample history |
| `tools/fetch_donki.py`, `tools/fetch_gbm.py`, `tools/fetch_tepc.py` | Download NASA space-weather and dose data |
| `ml/` | Anomaly model: `train.py`, `score.py` |
| `backend/` | Rust API server, also serves the frontend |
| `frontend/` | HTML, CSS and JavaScript pages, no build step |
| `Dockerfile`, `docker-start.sh` | Container used for the live deployment |
| `tools/dev-server.mjs` | Frontend-only preview with mock data (Node) |
| `sprint-reports/` | Sprint reports of the hackathon |

### Changing the data

1. Edit the JSON files in `data/seed/` (for example add a measurement, change a limit, add a habitat zone).
2. Run `python tools/seed.py --fresh` to rebuild the database.
3. Run `python ml/train.py` if you added or removed measurements used by the model.

---

## 8. Run it locally

Requirements: Python 3.10–3.12, Rust (stable) via rustup (on Windows the MSVC build tools are needed for `rusqlite`'s bundled SQLite). Node.js only for the mock preview.

On Windows, from the repository root:

```bash
powershell -ExecutionPolicy Bypass -File .\start-app.ps1 -Fresh
```

Or step by step, from the repository root:

```bash
python tools/seed.py --fresh
```

```bash
cargo run --manifest-path backend/Cargo.toml --release
```

Then open http://127.0.0.1:8080.

Optional, the TensorFlow model: `pip install -r ml/requirements.txt`, then `python ml/train.py`.

Optional, real space weather (needs internet). Without `NASA_API_KEY` the fetcher uses the rate-limited `DEMO_KEY`:

```bash
python tools/fetch_donki.py --days 30
```

```bash
python tools/fetch_gbm.py --days 30
```

Frontend preview without Python or Rust (mock data): `node tools/dev-server.mjs`, then open http://127.0.0.1:5173.

---

## 9. Deploy (Docker, for example on Render)

The `Dockerfile` builds the Rust server and runs it with the Python tools. On every start `docker-start.sh` rebuilds the demo database, fetches NASA DONKI and Fermi GBM events, and starts the server on `0.0.0.0:$PORT`.

The live demo has no login, so judges can try it with one link: everyone sees the same demo astronaut, and check-ins entered by visitors are reset when the server restarts.

Environment variables:

- `NASA_API_KEY`: your api.nasa.gov key. Set it as a secret in the hosting dashboard; never commit it.
- `ASTRO_PUBLIC_HOST`: public host name(s), comma-separated. On Render this is read automatically from `RENDER_EXTERNAL_HOSTNAME`.
- Optional: `ASTRO_HOST` (default `127.0.0.1`, the container sets `0.0.0.0`), `ASTRO_PORT` or `PORT` (default `8080`), `ASTRO_DB`, `ASTRO_FRONTEND`, `ASTRO_PYTHON`.

---

## 10. Tests

10 JavaScript test files, 16 Python tests and 12 Rust tests pass. We also opened every page in the browser with the final code and checked that there were no errors, and confirmed that NASA data arrives in the live app.

```bash
node --test frontend/js/
```

```bash
cargo test --manifest-path backend/Cargo.toml
```

```bash
python -m unittest discover -s tools -p "test_*.py"
```

---

## 11. Next steps

- Add the Mars surface as a mission setting (Mars gravity and surface radiation).
- Test the personal normal model with real or published health data.
- Review the health limits and advice together with flight surgeons and physicians.
- Add camera-based measurements and connections to medical devices.
- Adapt the same idea for places on Earth that are far from doctors.

---

## 12. Use of AI

The project idea and all decisions belong to Team IAFL. We used AI tools to speed up our work:

- **Code and data:** AI coding assistants helped write and review parts of the code, tests and translations. The team chose the problem, the approach, the data sources and the design, and reviewed and tested all output.
- **Writing:** AI helped write, edit and translate parts of the documentation and the project texts.

No AI image, video or audio generators were used. The pictures in the app are icons from [Health Icons](https://healthicons.org) (CC0) and simple SVG drawings written as code (the logo, the cup and plate drawings and the measurement-step drawings in `frontend/img/measure/`); that SVG code falls under the AI-assisted coding statement above. NASA logos, insignia, flags and mission identifiers are not used; "NASA" appears only as text to name data sources.

---

## 13. References and licenses

Every limit, rate and guidance text in the app cites its source in `data/seed/sources.json` (shown in the app on each measurement card).

**Key references**

- NASA Space Apps Challenge 2026: Create Health Monitoring Software for Astronauts on Space Missions.
- [NASA Human Research Program](https://www.nasa.gov/hrp/): hazards and risks of spaceflight, and the "distance from Earth" hazard.
- [NASA DONKI](https://kauai.ccmc.gsfc.nasa.gov/DONKI/) space weather database ([api.nasa.gov](https://api.nasa.gov/)).
- [NASA Fermi GBM solar flare list](https://hesperia.gsfc.nasa.gov/fermi/gbm/qlook/fermi_gbm_flare_list.txt).
- [ISS TEPC radiation measurements](https://cdaweb.gsfc.nasa.gov/hapi/info?id=ISS_DOSANL_TEPC) (NASA CDAWeb).
- [NASA-STD-3001](https://standards.nasa.gov/sites/default/files/standards/NASA/C//nasa-std-3001-vol-1-rev-c-signature.pdf): NASA's human health standard.
- NASA/TM–20250003885: report on communication delay in space missions.
- Basner M. et al. (2015). [Development and Validation of the Cognition Test Battery for Spaceflight](https://pubmed.ncbi.nlm.nih.gov/26564759/). Aerospace Medicine and Human Performance, 86(11), 942–952.
- University of Pennsylvania: [Cognition Test Battery](https://www.med.upenn.edu/uep/cognition.html).
- Canadian Space Agency: [monitoring radiation for astronaut health](https://www.asc-csa.gc.ca/eng/news/articles/2026/2026-02-26-monitoring-radiation-astronaut-health.asp).
- Law J. et al. (2014). [Relationship between carbon dioxide levels and reported headaches on the International Space Station](https://pubmed.ncbi.nlm.nih.gov/24806559/). Journal of Occupational and Environmental Medicine, 56(5), 477–483.
- [NASA OSDR Environmental Data App](https://visualization.osdr.nasa.gov/eda/): ISS cabin temperature, humidity and CO2 records.
- NASA OCHMO-TB-002: Environmental Control & Life Support System technical brief (NASA-STD-3001 cabin temperature, humidity and CO2 limits).
- NASA Human Research Program, NASA OCHMO technical briefs and [NASA NTRS](https://ntrs.nasa.gov/): sources of the gravity risk analysis (each one linked next to the related risk in the app).

**Third-party material**

| Material | License |
|---|---|
| NASA DONKI, Fermi GBM, ISS TEPC data | NASA open data |
| [Health Icons](https://healthicons.org) (`frontend/img/healthicons/`) | CC0 1.0 |
| Rust crates: axum, tokio, tower-http, rusqlite (bundled SQLite), serde, serde_json, chrono | MIT or MIT/Apache-2.0; SQLite is public domain |
| TensorFlow (optional) | Apache-2.0 |
| NumPy | BSD-3-Clause |
| Docker base images: `rust:1-bookworm`, `python:3.12-slim` | Official Docker images (Rust: MIT/Apache-2.0; Python: PSF License) |

No copyrighted images, music or text are included. The frontend uses no external libraries or CDNs.

## License

CrewPulse is released under the [Apache License 2.0](LICENSE).

---

**Team IAFL** · CrewPulse · NASA Space Apps Challenge 2026 · Niğde  
*Far away. Stay close to yourself.*
