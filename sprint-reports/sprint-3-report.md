# Sprint 3 Report

**Event:** NASA Space Apps Challenge Niğde 2026 (online)  
**Team:** IAFL  
**Date:** November 15, 2026  
**Sprint focus:** Prototype development, application improvements and testing  

---

## Completed in this sprint

| # | Task | Status |
|---|------|--------|
| 1 | Published the app as a public web version on Render with Docker: https://iafl-crewpulse.onrender.com. Judges can open it with one link, without installing anything. | ✅ Done |
| 2 | Renamed the "Mars mission" environment to "Mars transit", because it models the journey to Mars (0 g), not the surface. | ✅ Done |
| 3 | Added a gravity risk analysis to the Gravital Tracking page: 12 risks (bone, vision, heart, muscle, balance and others) scored by probability and impact, linked to the astronaut's readings and to mission phases. Each risk links to its NASA or peer-reviewed source. | ✅ Done |
| 4 | Made the simulated cabin CO2 match real ISS levels (2.0–2.4 mmHg) based on Law et al. (2014), and added NASA OSDR's Environmental Data App as the source for recorded ISS cabin data. | ✅ Done |
| 5 | Fixed reliability issues: a check-in now always returns the assessment of that check-in, a repeated submission returns the same result instead of an error, personal radiation dose is only shown for the astronaut's own mission, the check-in form still opens if personal ranges fail to load, and each Mind Lab session starts empty. | ✅ Done |
| 6 | Improved alerts: during a solar particle event the shelter warning and the health message are now shown together. | ✅ Done |
| 7 | Added Turkish translations for the new gravity pages. | ✅ Done |
| 8 | Testing: 10 JavaScript test files, 16 Python tests and 12 Rust tests pass. On the live app we checked that real NASA data loads (86 DONKI coronal mass ejections and 70 Fermi GBM flares) and that Mars transit gives crew-led guidance with a 44-minute reply time. | ✅ Done |

## Planned for Sprint 4

- Final edits and full testing on the live app.
- Fill in the live app and demo links in the README.
- Prepare the final outputs: project presentation, project documentation and demo video (YouTube).
- Upload the outputs to the team's Google Drive folder.
- Complete the project submission on the NASA Space Apps website.

## Who did what

| Role | Tasks |
|------|-------|
| Scrum Master | Sprint report, task tracking |
| Developers | Prototype development, testing, deployment and data visualization |
| Researchers | Sources for gravity risks and cabin data; NASA data and sources |
| Designer | Interface design |
