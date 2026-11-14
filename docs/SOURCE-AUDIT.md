# Source audit (13 Nov 2026)

Every value marked `"source_ref": "assumption"` in `data/seed/*.json` was checked by research agents that were told to cite only pages they opened. Open each URL once yourself before citing it.

**Applied (13 Nov 2026):** the values below were written to `data/seed/*.json` with new entries in `sources.json`, and each indicator card now shows its source. Later research replaced some rows: body mass uses CDC BMI at NASA astronaut heights (46-90 kg, alerts 39 and 108), grip watches below 16 kg with no alert limit (EWGSOP2 cut-offs are by sex, 27 kg men and 16 kg women, not severity levels), the SpO2 alert is below 92 (NEWS2: 91% or lower scores 3 points), reaction time is normal from 100 ms (the false-start limit) to 300 ms, urine alert is above 5, stress follows Elo 2003, social connection follows ONS, dizziness follows NASA motion sickness grades, pelvis 1.35 and femoral neck 1.15 %/month follow LeBlanc 2000, calcaneus 0.5 %/month is derived from Sibonga 2007, and the SEP peak is 93 mSv/h unshielded (50 mSv/h behind 5 g/cm2). Entry ranges (`min_plausible`/`max_plausible`) are input guards, not clinical limits, and have no source; they were widened to heart rate 25-250 bpm, systolic 40-300 and diastolic 20-200 mmHg, SpO2 50-100%, body temperature 25-45 °C, blood glucose 10-1500 mg/dL, sleep 0-24 h and reaction time 50-5000 ms. Diastolic low alert, fluid upper limits and kcal upper limits were removed because no source gives them. Still `assumption`: score, model and routine settings, the illness scale, body mass guidance steps and crew-protocol steps.

Status: **OK** = source states the app value. **CHANGE** = a source exists but gives another value; change the app to the source value. **DESIGN** = a design choice; no source can exist, say so honestly. **NONE** = no source found; label it a prototype rule or remove it.

## 1. Clinical limits (`indicators.json`)

| Value | App | Status | Use / say | Source |
|---|---|---|---|---|
| Heart rate watch high | > 100 | OK | normal resting 60–100 | AHA, All About Heart Rate: https://www.heart.org/en/health-topics/high-blood-pressure/the-facts-about-high-blood-pressure/all-about-heart-rate-pulse (`aha_hr` old URL moved: https://www.heart.org/en/healthy-living/exercise-and-physical-activity/fitness-basics/target-heart-rates) |
| Heart rate watch low | < 50 | CHANGE or NONE | NEWS2 gives 41–50 = 1 point, so "≤ 50"; AHA only says athletes may rest near 40 | RCP NEWS2 Chart 1: https://www.rcp.ac.uk/media/alxev00t/news2-chart-1_the-news-scoring-system_0_0.pdf |
| Heart rate alert low | < 40 | OK | NEWS2 ≤ 40 = 3 points | RCP NEWS2 Chart 1 (above) |
| Heart rate alert high | > 130 | OK | NEWS2 ≥ 131 = 3 points | RCP NEWS2 Chart 1 (above) |
| Systolic alert low | < 80 | CHANGE | ≤ 90 (NEWS2 score 3) | RCP NEWS2 Chart 1 (above) |
| Diastolic alert low | < 45 | NONE → CHANGE | no diastolic-only limit exists; use mean arterial pressure < 65 or drop it | Surviving Sepsis Campaign: https://survivingsepsis.org/guidelines-and-resources/surviving-sepsis-campaign-adult-guidelines |
| Blood glucose alert high | > 250 | CHANGE wording | 250 = check ketones; 300 sustained = emergency | CDC, Diabetic Ketoacidosis: https://www.cdc.gov/diabetes/about/diabetic-ketoacidosis.html |
| Blood glucose watch high | > 140 | OK with note | 140 is the 2-hour glucose-tolerance-test value, not a limit for any reading | CDC Diabetes Testing (already in SOURCES.md) |
| SpO2 alert | < 92 | Applied | NEWS2: 91% or lower scores 3 points. MedlinePlus: provider at ≤ 92, emergency at ≤ 88 | RCP NEWS2 Chart 1: https://www.rcp.ac.uk/media/alxev00t/news2-chart-1_the-news-scoring-system_0_0.pdf ; MedlinePlus Pulse Oximetry: https://medlineplus.gov/lab-tests/pulse-oximetry/ |
| Reaction time normal | 100–300 ms | Applied | alert participants typically average 200–300 ms; faster than 200 ms is not a problem | Basner et al. 2020, Sleep: https://pmc.ncbi.nlm.nih.gov/articles/PMC8240655 |
| Reaction time critical | 500 ms | Applied | 500 ms (PVT lapse) | Basner & Dinges 2011: https://pmc.ncbi.nlm.nih.gov/articles/PMC3079937 |
| Reaction time floor | 100 ms | Applied | 100 ms (false start) is the watch-low limit | same |
| Urine colour normal | 1–3 | OK | "keep below shade four" | USADA Hydration 101: https://www.usada.org/spirit-of-sport/hydration-101-need-know/ |
| Urine colour alert | ≥ 6 | NONE → CHANGE | published cut-offs are 2–3; keep 6 only as "prototype rule" | Wardenaar et al. 2021: https://www.mdpi.com/1660-4601/18/8/4126 |
| Fluid intake low | 1500 mL | CHANGE | 2000 mL drinking water per day minimum | NASA-STD-3001 Vol 2 Rev B §6.3.2.1 (V2 6029) |
| Fluid high / critical | 4000 / 1000 / 5000 | NONE | prototype rules | – |
| Calories | 1800–3200 | CHANGE | per-person energy requirement (EER × 1.25) from age, height, mass | NASA-STD-3001 Vol 2 Rev B §7.1.1.3 (V2 7003) |
| Body mass band | 55–95 kg | NONE → CHANGE | use change from personal baseline; no fixed band published | NASA HRP nutrition evidence report (NTRS 20150000512) for the risk only |
| Grip strength | watch < 16 kg, no alert | Applied | EWGSOP2 low-strength cut-offs are by sex (27 kg men, 16 kg women), not severity levels; compare with the personal pre-flight value | EWGSOP2 (Cruz-Jentoft et al. 2019): https://academic.oup.com/ageing/article/48/1/16/5126704 ; norms: Dodds et al. 2014: https://pmc.ncbi.nlm.nih.gov/articles/PMC4256164/ |
| Stress, social connection, illness scales | 1–5 | NONE | self-report design choice; NASA lists these as tracked risks only | NASA HRR behavioural risk: https://humanresearchroadmap.nasa.gov/Risks/risk.aspx?i=99 |

## 2. Mission adjustments (`indicator_adjustments.json`)

| Rule | Status | Action | Source |
|---|---|---|---|
| Mars day 31+: reaction watch 380 ms | NONE | delete; ISS data show no slowing over 6 months | Jones et al. 2022: https://pmc.ncbi.nlm.nih.gov/articles/PMC8919197 |
| Moon days 1–7: heart rate up to 110 | NONE | delete; partial gravity lowers heart rate | Richter et al. 2017: https://frontiersin.org/journals/physiology/articles/10.3389/fphys.2017.00583/full |

## 3. Radiation (`model_params.json`, `missions.json`)

| Value | App | Status | Use | Source |
|---|---|---|---|---|
| Reference shielding | 10 g/cm² | CHANGE | 20 g/cm² (ISS and Orion average) | Cucinotta et al. 2013: https://pmc.ncbi.nlm.nih.gov/articles/PMC3797711 |
| GCR attenuation | e-fold 100 g/cm² | CHANGE | cap the reduction at 25%, reached by 20 g/cm² | Chancellor et al. 2018: https://arxiv.org/pdf/1710.07311 ; NASA/TP-2005-213164 (NTRS 20050196720) |
| SEP attenuation | 8 g/cm² | NONE (`assumption`) | keep 8 g/cm² as a modelling assumption; the report's abstract does not give an attenuation length | Kim, Wilson et al. 1999, NASA/TP-1999-209320 (`wilson1999`): https://ntrs.nasa.gov/citations/19990051001 |
| SEP peak rate | 2 mSv/h | CHANGE | 50 mSv/h (Aug 1972 class, behind 5 g/cm² Al; model) | Wilson et al., Biological response to SPE exposures: https://ntrs.nasa.gov/api/citations/20040100724/downloads/20040100724.pdf |
| SEP duration | 24 h | CHANGE | 72 h (Oct 1989 lasted about three days) | same Wilson report; NOAA SWPC "hours to days" |
| ISS dose | 0.884 mSv/day | OK | TEPC measurement | `iss_tepc` (already sourced) |
| ISS SEP exposure factor (`sep_exposure_factor`) | 0.2 | NONE (assumption) | unsourced modelling assumption; it stands for the ISS being inside Earth's magnetic field, which keeps most solar particles away. Other missions use 1 | – |
| Moon | 1.37 mSv/day | OK, fix ref | 1369 µSv/day measured by Chang'e-4 LND; replace `radlab` | Zhang et al. 2020: https://pmc.ncbi.nlm.nih.gov/articles/PMC7518862/ |
| Rover | 1.37 mSv/day | NONE | keep as assumption based on Zhang 2020 | – |
| Lunar transit | 1.8 mSv/day | CHANGE | about 1.1 (0.96–1.24 inside Orion, Artemis I) | George et al. 2024, Nature: https://www.osti.gov/pages/servlets/purl/2447574 |
| Mars transit | 1.84 mSv/day | CHANGE | 1.8, replace `radlab` | JPL 2013: https://www.jpl.nasa.gov/news/data-from-nasa-rovers-voyage-to-mars-aids-planning/ ; Zeitlin et al. 2013, Science |

`radlab` (NASA OSDR RadLab) contains no dose values and should not be cited for any number.

## 4. Bone (`model_params.json`, `bone_sites.json`)

| Value | App | Status | Use | Source |
|---|---|---|---|---|
| Watch | 5% loss | OK | hip and spine must stay ≥ 95% of pre-mission | NASA-STD-3001 Vol 1 Rev C §4.7.2: https://standards.nasa.gov/sites/default/files/standards/NASA/C//nasa-std-3001-vol-1-rev-c-signature.pdf |
| Alert | 10% loss | OK for femoral neck only | femoral neck ≥ 90% | same |
| Exercise target | 60 min/day | CHANGE | 120 min/day | NASA Astronaut Exercise: https://www.nasa.gov/missions/station/iss-research/astronaut-exercise ; CSA: https://asc-csa.gc.ca/eng/astronauts/living-exercising.asp |
| Exercise window | 14 days | CHANGE | 7 days (weekly prescription) | NASA ARED Update 2009 (NTRS 20090007467) |
| Max reduction | 0.5 | OK | below the 68–70% reduction with ARED | NASA HRP bone evidence report 2017, Table 4: https://ntrs.nasa.gov/api/citations/20170004597/downloads/20170004597.pdf |
| Spine loss | 1.0 %/month | OK | – | THESEUS review: https://escholarship.org/content/qt0sn103w5/qt0sn103w5.pdf |
| Femoral neck loss | 1.5 %/month | CHANGE | 1.0 %/month | same |
| Trochanter loss | 1.5 %/month | OK | – | same |
| Pelvis 1.2, calcaneus 1.0 %/month | – | NONE | label as assumption | – |

Changing the exercise target to 120 halves the credit for the simulated crew; review the simulated exercise minutes at the same time. Old values are also hard-coded in `docs/CONTRACT.md`, `frontend/mock/config.json`, `frontend/js/activity.js` (60) and `frontend/js/trends.js` (14).

## 5. Guidance text (`guidance.json`)

Sourced steps (use the source's wording):
- Rest at least 5 minutes before measuring; no caffeine or exercise within 30 minutes; take two readings 1 minute apart (AHA home monitoring: https://www.heart.org/en/health-topics/high-blood-pressure/understanding-blood-pressure-readings/monitoring-your-blood-pressure-at-home).
- Above 180/120 with chest pain, shortness of breath, back pain, numbness, weakness, vision change or difficulty speaking: emergency (same AHA page).
- Very high or very low heart rate with chest pain, shortness of breath, dizziness or fainting: emergency (AHA All About Heart Rate).
- Low blood pressure: drink water, stand up slowly (NHS low blood pressure); lie down with legs raised (NHS fainting).
- Low SpO2: provider at ≤ 92%, emergency at ≤ 88% (MedlinePlus Pulse Oximetry).
- Fever: rest and fluids; 38 °C or above is a fever (NHS fever in adults; MedlinePlus Fever).
- Hypothermia below 35 °C, or confusion: emergency, first aid while waiting (NHS hypothermia; MedlinePlus Hypothermia).
- Low glucose: 15 g fast carbs, recheck after 15 minutes, repeat if still below 70 (CDC treatment of low blood sugar: https://www.cdc.gov/diabetes/treatment/treatment-low-blood-sugar-hypoglycemia.html).
- High glucose: ketones at 250, emergency if it stays at 300 (CDC DKA).

Unsourced, remove or label as prototype rule: all other re-measure intervals (2, 10, 15, 30 min, 1–2 h), "sit upright and breathe slowly" for SpO2, blanket rewarming for mild low temperature, "loosen clothing", "drink water" and "hold food" for high glucose, "do not change medicine dose", confusion or severe headache as emergency signs where the source does not list them, every crew medical officer and ground protocol step, and the self-care steps for body mass, calories, fluid and grip.

## 6. Score, model and routine parameters

All DESIGN. Say so in the README:
- Score points 100/60/10, weights 0.45/0.25/0.15/0.15, bone penalty 8, storm penalty 20: chosen for the demo, not fitted to data.
- Anomaly model: personal rolling baseline follows the approach of Mishra et al. 2020 (https://www.nature.com/articles/s41551-020-00640-6); baseline 20, minimum 7, SD floor 2% and z = 3 are our choices (NIST suggests a modified z-score above 3.5: https://www.itl.nist.gov/div898/handbook/eda/section3/eda35h.htm).
- 24 h check-in interval and 3/7/30-day badges: product choices.

## 7. Check yourself before citing

- MedlinePlus Fever emergency signs (stiff neck, confusion, breathing trouble): one agent confirmed them, another did not.
- George 2024 gives 0.81 mSv/day for the Moon and attributes it to Zhang 2020, but Zhang does not contain it; do not use 0.81.
- Wilson 1999 (NTRS 19990051001) is Kim, Wilson et al. 1999, NASA/TP-1999-209320; its abstract gives no attenuation length, so `rad.sep_atten_g_cm2` is `assumption` and the source row was removed from `sources.json`.
- 2018 ACC/AHA bradycardia guideline (< 50): could not be opened.
