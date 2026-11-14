# Sprint 2 Report

**Event:** NASA Space Apps Challenge Niğde 2026 (online)  
**Team:** IAFL  
**Date:** November 14, 2026  
**Scrum Master:** Murathan Yapıcı  
**Sprint focus:** Solution approach, research, data review, first prototype  

---

## Completed in this sprint

| # | Task | Status |
|---|------|--------|
| 1 | Mapped health indicators to NASA human spaceflight hazards and risks. The app now tracks 22 indicators (vitals, sleep, mood, stress, vision, reaction time and others) across 12 clickable body regions. | ✅ Done |
| 2 | Finalized the data approach: real NASA environmental data plus clearly labeled simulated crew health data, because real astronaut daily health data is not public. | ✅ Done |
| 3 | Connected real NASA data: solar particle events and coronal mass ejections from NASA DONKI, solar flares from the Fermi GBM flare list (the DONKI flare endpoint returned HTTP 404), and the ISS background dose from TEPC measurements. | ✅ Done |
| 4 | Extended the demo into a working prototype: daily check-in, personal baseline anomaly model, health score with written reasons, radiation page with habitat shelter zones, bone loss projection, trends and Mind Lab. | ✅ Done |
| 5 | Added distance-aware triage for 5 mission settings (ISS, transit, Moon, lunar rover, Mars): the same reading leads to "call the flight surgeon" on the ISS and to a crew-led protocol on the way to Mars. | ✅ Done |
| 6 | Added gravity tracking and gravity-aware projections, and a daily activity and recommendations page. | ✅ Done |
| 7 | Documented the source of every threshold (55 references) and the honest limits of the prototype in the README. | ✅ Done |
| 8 | Ran the automated tests: 9 JavaScript test files and 16 Python tests pass. | ✅ Done |

## Open issues

- The demo data used by the frontend preview shows only simulated solar events. The real DONKI and Fermi GBM events are stored in the local database but are not yet in the demo data.
- Some text on the Activity page stays in Turkish when the app is set to English.
- The app currently needs Python and Rust to run, so judges cannot open it without installing tools.

## Candidate tasks for Sprint 3

- Make the app available as a public web version so judges can open it with one link (hosting option to be decided).
- Add the real NASA DONKI and Fermi GBM events to the demo data and label their source and fetch date.
- Translate the remaining Turkish text on the Activity page.
- Test all pages in the browser on the public version.

## Who did what

| Name | Role | Tasks |
|------|------|-------|
| Renas Yusuf Babür | Researcher | Research: health indicators and NASA risks |
| Murathan Yapıcı | Scrum Master | Sprint report, task tracking |
| Efe Yüksel | Developer | Prototype development |
| Mehmet Recep Baltacı | Designer | Interface design |
| Semih Bakır | Researcher | Research: NASA data and sources |
| Yusuf Şahin | Developer | Prototype development and data visualization |
