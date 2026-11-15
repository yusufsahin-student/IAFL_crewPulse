// Gravity health-risk reference data for the Gravital Tracking page.
// Source documents (team research, 14 Nov 2026):
//   "Yerçekiminin Astronot Sağlığına Etkileri" (research report) and
//   "Astronot Sağlık Monitörü – Mikro yerçekimi risk analizi" (risk analysis).
// Texts are English, like all page code; the Turkish wording of the documents is in i18n-tr-gravity.js.
// Risk scores are the team's probability x impact assessment (NASA HSRB style), not NASA's official scores.

// Probability and impact scales (risk analysis, section 2).
export const PROBABILITY_SCALE = [
  { score: 5, name: 'Almost certain', rule: 'Seen in more than 80% of astronauts' },
  { score: 4, name: 'High', rule: '40–80% of astronauts' },
  { score: 3, name: 'Medium', rule: '10–40%, or a very common early sign' },
  { score: 2, name: 'Low', rule: '1–10%, or rare but documented cases' },
  { score: 1, name: 'Very low', rule: 'Less than 1%' },
];

export const IMPACT_SCALE = [
  { score: 5, name: 'Critical', rule: 'Can threaten life or end the mission' },
  { score: 4, name: 'Serious', rule: 'Possibly permanent harm or serious loss of performance in critical tasks' },
  { score: 3, name: 'Moderate', rule: 'Temporary but clearly affects mission performance' },
  { score: 2, name: 'Minor', rule: 'Discomfort with limited effect on performance' },
  { score: 1, name: 'Negligible', rule: 'No noticeable effect' },
];

// Score = probability x impact. 15–25 high, 8–14 medium, 1–7 low.
export const LEVELS = {
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

// The 12 microgravity risks (risk analysis, sections 3 and 5).
// indicators: check-in indicators that give a live, indirect signal for the risk (empty = needs a
// scan, blood test or ultrasound that the daily check-in does not collect).
export const RISKS = [
  {
    id: 'R1', p: 5, i: 4, indicators: ['exercise_minutes'], useBone: true,
    name: 'Bone loss',
    window: 'Builds up for the whole flight; lasts months to years after landing.',
    effect: 'Without gravity load, cells that break bone down work faster than cells that build it. Hip, lumbar spine and leg bones thin; fracture risk and early osteoporosis follow. Calcium released from bone passes into the urine and raises kidney stone risk (R9).',
    evidence: [
      '1–1.5% loss per month in weight-bearing bones (hip 1.5%, lumbar spine 1%, whole body 0.3%).',
      'After a 4–6 month mission, regaining half the loss can take about 9 months.',
      'One year after return the shin bone was on average 2.1% less dense; 9 astronauts did not recover the loss.',
      'Good exercise makes a difference: Tim Peake returned after 6 months with a 2% total loss.',
    ],
    monitor: [
      ['Resistance exercise adherence (sessions, load)', 'Exercise device', 'Every session'],
      ['Estimated cumulative bone loss', 'Calculated model', 'Daily'],
      ['Fluid and calcium / vitamin D intake', 'Self-report', 'Daily'],
      ['Bone density (DXA)', 'Ground measurement', 'Before and after flight'],
    ],
    green: 'Weekly resistance exercise at 90% of plan or more; estimated loss on the expected curve.',
    yellow: '7-day adherence 70–90%, or estimated loss above the expected curve.',
    red: 'Adherence below 70% two weeks in a row, or high estimated loss before a surface or landing operation.',
    action: 'Update the training plan; review nutrition with the flight surgeon; re-plan surface tasks with a fall risk.',
  },
  {
    id: 'R2', p: 4, i: 4, indicators: ['near_acuity', 'amsler_distortion'],
    name: 'Vision changes (SANS)',
    window: 'Increases over months; worse the longer the mission.',
    effect: 'The fluid shift toward the head changes the pressure behind the eye. The optic nerve head swells, the retina and choroid fold, the back of the eyeball flattens and focus shifts toward far-sightedness. Near vision becomes blurred.',
    evidence: [
      'Earliest sign in 66% on long missions: disc edema 64%, folds 15%, globe flattening 26%, refraction change 14%.',
      'The effect can build up: in one astronaut the folds returned more widely on a second mission.',
      'No permanent vision loss has been reported from ISS missions.',
    ],
    monitor: [
      ['Peripapillary retinal thickness change (ΔTRT)', 'OCT device', 'Planned scan (e.g. every 30 days)'],
      ['Visual acuity and Amsler test', 'Tablet', 'Weekly'],
      ['Blurred vision report', 'Self-report', 'Immediately'],
    ],
    green: 'ΔTRT below 20 µm.',
    yellow: 'ΔTRT 20 µm or more (expert consensus class A: earliest sign).',
    red: 'ΔTRT 55 µm or more, Frisén grade 1 or more (class B), or impaired central vision.',
    action: 'Scan the eyes more often; prepare spare glasses; report to the flight surgeon.',
  },
  {
    id: 'R3', p: 4, i: 4, indicators: ['heart_rate', 'systolic_bp', 'diastolic_bp'],
    name: 'Cardiovascular deconditioning and landing blood pressure',
    window: 'Develops silently in flight; landing and the first days are the most critical.',
    effect: 'About 2 litres of fluid shift toward the head; the body reads this as excess and cuts plasma volume by 10–15%. The heart works less, its muscle shrinks and stroke volume falls. On return blood pools in the legs, too little reaches the brain, and the astronaut feels dizzy or faints while standing.',
    evidence: [
      'Orthostatic intolerance in 30–80% of returning astronauts, depending on mission length.',
      'Hadfield had to wear a G-suit after landing so his body could pump blood to his head.',
      'The symptom usually appears after standing for a long time, not on standing up.',
    ],
    monitor: [
      ['Resting heart rate and heart rate variability (HRV)', 'Wearable (e.g. Bio-Monitor)', 'Continuous'],
      ['Blood pressure', 'Blood pressure monitor', 'Daily / weekly'],
      ['Exercise fitness test', 'Exercise device', 'Periodic'],
      ['Active stand test', 'After landing', 'Landing day and after'],
    ],
    green: 'Values within the personal baseline range.',
    yellow: 'In flight: resting heart rate or HRV clearly off baseline 3 days in a row. At landing: reported dizziness.',
    red: 'On standing, systolic drop of 20 mmHg or more or diastolic drop of 10 mmHg or more (clinical orthostatic hypotension), or fainting.',
    action: 'Fluid and salt loading before landing; compression garment; do not stand alone in the first hours after landing.',
  },
  {
    id: 'R4', p: 3, i: 5, indicators: [], screening: [30, 50, 90, 150],
    name: 'Neck vein flow disturbance and clot',
    window: 'Clear around flight day 50; expected to resolve after return.',
    effect: 'Without gravity, blood flow in the internal jugular vein slows, stops or even reverses toward the head. Stagnant blood can clot; a clot that breaks off and reaches the lungs can be life-threatening. The danger is that it gives no symptoms.',
    evidence: [
      '6 of 11 ISS astronauts had stagnant or reversed flow around day 50; 1 had an occlusive clot and 1 a possible partial clot.',
      'The station had no drug to reverse the clot; it arrived by cargo on day 43 and treatment lasted over 90 days.',
      'NASA issued an external research call on this topic in September 2026.',
    ],
    monitor: [
      ['Doppler ultrasound flow grade (1 normal to 4 reversed)', 'Ultrasound', 'Planned (e.g. day 30, 50, 90, 150)'],
      ['Neck pain, swelling, headache', 'Self-report', 'Immediately'],
      ['Anticoagulant stock (in days)', 'Inventory', 'Continuous'],
    ],
    green: 'Flow grade 1 (normal, toward the heart).',
    yellow: 'Stagnant flow, or a planned scan was missed.',
    red: 'Reversed flow or suspected clot.',
    action: 'Notify the flight surgeon urgently; work out how many days the drug stock lasts; on a Mars mission there is no resupply.',
  },
  {
    id: 'R5', p: 5, i: 3, indicators: ['grip_strength', 'exercise_minutes'],
    name: 'Muscle loss',
    window: 'Starts in the first days, fast in the first 3–4 months; the effect shows at landing and on surface tasks.',
    effect: 'Postural muscles (calf, thigh, back) carry no weight and shrink quickly; strength loss is larger than volume loss. On return everything feels very heavy, and emergency egress or surface work carries injury risk.',
    evidence: [
      'After 6–9 days: thigh 6%, calf 6%, back 10%; after 6 months: 12% / 13% / 20% volume loss.',
      'One astronaut lost 20% of calf volume and 50% of explosive power.',
      'Loss is fast in the first 3–4 months, then levels off; it is regained in 1–2 months.',
    ],
    monitor: [
      ['Load lifted in exercise / estimated maximum strength', 'Exercise device', 'Every session'],
      ['Weekly strength test', 'Exercise device', 'Weekly'],
      ['Daily activity', 'Wearable', 'Continuous'],
    ],
    green: 'Strength loss below 10% of personal baseline.',
    yellow: 'Strength loss 10–20% (proposal; 8–17% isokinetic strength loss is reported after 6-month missions).',
    red: 'Strength loss above 20%, or a yellow level before a landing or surface task.',
    action: 'Increase training intensity; assign surface and egress tasks by muscle condition.',
  },
  {
    id: 'R6', p: 5, i: 3, indicators: ['balance_symptoms', 'reaction_ms'], expectedIn: ['P1', 'P4'],
    name: 'Balance disorder and space motion sickness',
    window: 'Phase 1 (days 1–7) and Phase 4 (landing).',
    effect: 'The balance organ in the inner ear loses the gravity signal and the brain learns to trust the eyes. Result: nausea, vomiting, dizziness and poor hand–eye coordination. On return it happens in reverse; the astronaut cannot walk straight with eyes closed.',
    evidence: [
      'Space motion sickness affects about 73% of crew in the first days (NASA OCHMO).',
      'Motion sickness at landing after long flights: 100%.',
      'Largely gone within 1–5 days in space and about 1 week after return.',
    ],
    monitor: [
      ['Nausea / dizziness score', 'Self-report', 'Daily'],
      ['Reaction and coordination test', 'Tablet', 'Daily in phases 1 and 4'],
      ['Eyes-closed walking / balance test', 'After landing', 'Landing day'],
    ],
    green: 'Expected symptoms in phases 1 and 4 (information note, no alarm).',
    yellow: 'Symptoms last longer than 7 days.',
    red: 'New dizziness in mid-flight or a sudden neurological sign (loss of speech etc.).',
    action: 'Take off critical tasks (driving, spacewalk) for now; emergency protocol for sudden neurological signs.',
  },
  {
    id: 'R7', p: 3, i: 4, indicators: ['back_pain'], expectedIn: ['P1'],
    name: 'Back pain and disc herniation',
    window: 'Phase 1, Phase 4 and the first year after landing (especially the first month).',
    effect: 'Discs between the vertebrae expand without load, height grows by about 5 cm and back muscles weaken. This causes back pain in space. On return the discs compress again with weakened muscles and the herniation risk rises.',
    evidence: [
      'Back pain in 52% of astronauts in the first 2–5 days.',
      'Disc herniation risk 4.3 times higher in NASA astronauts; most cases in the first month after landing.',
      'About 40% of astronauts report back pain after return.',
    ],
    monitor: [
      ['Pain score (0–10) and location on the body map', 'Self-report', 'Daily'],
      ['Spine ultrasound', 'Ultrasound', 'Planned'],
      ['Heavy lifting tasks after landing', 'Mission plan', 'After landing'],
    ],
    green: 'Mild to moderate pain in phase 1 (expected).',
    yellow: 'Pain 5/10 or more for longer than 5 days, or heavy lifting planned in the first month after landing.',
    red: 'Pain spreading to the leg, numbness or weakness.',
    action: 'Lifting restriction reminder after landing; core muscle exercise.',
  },
  {
    id: 'R8', p: 4, i: 3, indicators: [],
    name: 'Space anemia',
    window: 'Lasts the whole flight; critical at landing and in surface operations.',
    effect: 'In space the body destroys red blood cells much faster than normal. Oxygen demand is low in weightlessness, so it goes unnoticed; it shows as fatigue and lower performance on return or on the Mars surface.',
    evidence: [
      'Red blood cell destruction rises 54% (from 2 million to 3 million per second).',
      '5 of 13 astronauts were clinically anemic at landing.',
      'One year later destruction is still 30% higher; it gets worse the longer the mission.',
    ],
    monitor: [
      ['Hemoglobin / hematocrit', 'Blood test', 'Planned'],
      ['Fatigue score', 'Self-report', 'Daily'],
      ['Exercise performance', 'Exercise device', 'Every session'],
    ],
    green: 'Hemoglobin in the normal range.',
    yellow: 'Hemoglobin below 13 g/dL in men or 12 g/dL in women (WHO anemia threshold).',
    red: 'Hemoglobin below 11 g/dL (WHO moderate anemia) or a fast drop.',
    action: 'Review nutrition with the flight surgeon; check before landing and surface tasks.',
  },
  {
    id: 'R9', p: 2, i: 5, indicators: ['fluid_intake', 'urine_color'],
    name: 'Kidney stones',
    window: 'Throughout the flight; also high right after return.',
    effect: 'Calcium released from bone passes into the urine; astronauts also drink less, so urine volume falls and it turns acidic. This makes stones form more easily. A stone can end the mission with severe flank pain, nausea and blood in the urine.',
    evidence: [
      'Urine calcium rises; volume, pH and citrate fall.',
      'Risk rises regardless of exercise; the easiest countermeasure is drinking more.',
      '14 cases in 12 astronauts, 9 of them after flight.',
    ],
    monitor: [
      ['Daily fluid intake', 'Self-report / smart bottle', 'Daily'],
      ['Urine volume (if available)', 'Measurement', 'Daily'],
      ['Flank pain, blood in urine', 'Self-report', 'Immediately'],
      ['Bone loss model (R1)', 'Calculated', 'Daily'],
    ],
    green: 'Fluid intake at the personal target.',
    yellow: 'Fluid intake below target 2 days in a row; a stricter threshold while bone loss is high.',
    red: 'Flank pain with nausea, or blood in the urine (suspected stone).',
    action: 'Fluid reminder; ultrasound when in doubt; check the drug stock.',
  },
  {
    id: 'R10', p: 5, i: 2, indicators: [], expectedIn: ['P1'],
    name: 'Fluid shift: headache and congestion',
    window: 'Intense in phase 1; later a headache can point to other causes.',
    effect: 'About 2 litres of fluid move from the legs to the face and head, causing a puffy face, blocked nose and headache. It is the root cause of several other risks (R2, R4, R12).',
    evidence: [
      'Up to 90% of astronauts report headache in the first days.',
      'Earlier research: each 1 mmHg rise in cabin CO2 doubles the odds of headache.',
    ],
    monitor: [
      ['Headache log (severity, time)', 'Self-report', 'Daily'],
      ['Cabin CO2 level', 'Environment sensor', 'Continuous'],
    ],
    green: 'Headache in phase 1 (expected).',
    yellow: 'New or worsening headache in phase 2 and later, especially with high CO2.',
    red: 'Sudden severe headache, or headache with vision symptoms.',
    action: 'Check the CO2 source; change the sleep module; bring the SANS scan forward.',
  },
  {
    id: 'R11', p: 4, i: 2, indicators: ['illness_symptoms'],
    name: 'Immune dysfunction',
    window: 'Lasts the whole flight.',
    effect: 'Stress and spaceflight weaken immune cells; latent herpes viruses reactivate. It usually gives no symptoms, sometimes a cold sore or rash.',
    evidence: [
      'On long ISS missions 14 of 23 astronauts (61%) shed a herpes virus.',
      'Risk is 29% lower in astronauts with high preflight fitness.',
    ],
    monitor: [
      ['Rash, cold sore, fever', 'Self-report', 'Immediately'],
      ['Fitness / exercise', 'Exercise device', 'Weekly'],
    ],
    green: 'No symptoms.',
    yellow: 'New lesion or rash.',
    red: 'Widespread lesions with fever, or a lesion around the eye.',
    action: 'Photo report to the flight surgeon; in-crew infection precautions.',
  },
  {
    id: 'R12', p: 4, i: 2, indicators: ['reaction_ms'],
    name: 'Brain changes',
    window: 'Clear in phase 3; lasts years after return.',
    effect: 'The brain moves up inside the skull and the fluid-filled ventricles widen. The functional effect is not yet clear, but recovery takes years and can build up in astronauts who fly often.',
    evidence: [
      'Ventricles widen by 11–25%; plateau at 6 months.',
      'Only 55–64% recovered after 6–7 months; full recovery about 3 years.',
    ],
    monitor: [
      ['Reaction time and memory test', 'Tablet', 'Weekly'],
      ['Time since last mission', 'Record', 'Before the mission'],
    ],
    green: 'Cognitive test within the personal baseline range.',
    yellow: 'Clear drop from baseline in a cognitive test.',
    red: 'Sudden neurological sign (loss of speech, confusion).',
    action: 'Emergency protocol for sudden signs and record all data (as in the Fincke event, to understand the cause later).',
  },
];

// Mission phases (risk analysis, section 6). from/to are in-flight mission days; P4 and P5 follow landing.
export const PHASES = [
  { id: 'P0', from: null, to: 0, name: 'Phase 0 – Preflight',
    expected: '—', focus: [],
    scans: 'Personal baselines for all parameters; DXA, OCT, blood test, fitness' },
  { id: 'P1', from: 1, to: 7, name: 'Phase 1 – Adaptation (days 1–7)',
    expected: 'Headache, nausea, dizziness, puffy face, mild back pain',
    focus: ['R6', 'R10', 'R7'],
    scans: 'Daily symptom score, reaction test' },
  { id: 'P2', from: 8, to: 60, name: 'Phase 2 – Early flight (days 8–60)',
    expected: '—', focus: ['R5', 'R4'],
    scans: 'Neck ultrasound (days 30 and 50), weekly strength test' },
  { id: 'P3', from: 61, to: null, name: 'Phase 3 – Long flight (day 60+)',
    expected: '—', focus: ['R1', 'R2', 'R12'],
    scans: 'OCT scans, bone model, cognitive tests, ultrasound (days 90, 150)' },
  { id: 'P4', from: null, to: null, name: 'Phase 4 – Landing (0–7 days)',
    expected: 'Dizziness, feeling of weight, foot and low back pain',
    focus: ['R3', 'R6', 'R7', 'R8', 'R9'],
    scans: 'Stand test, balance test, blood test' },
  { id: 'P5', from: null, to: null, name: 'Phase 5 – Recovery (1–12 months)',
    expected: '—', focus: ['R1', 'R7', 'R8', 'R12'],
    scans: 'Heavy lifting restriction (first month), bone and blood follow-up' },
];

// Planned screening calendar (risk analysis R2, R4, R5 and section 6).
export const SCREENINGS = [
  { risk: 'R4', days: [30, 50, 90, 150], name: 'Neck vein Doppler ultrasound' },
  { risk: 'R2', every: 30, name: 'OCT eye scan' },
  { risk: 'R5', every: 7, name: 'Strength test' },
  { risk: 'R12', every: 7, name: 'Reaction and memory test' },
];

// Monthly bone mineral loss rates in microgravity (research report 2.3; NASA HRP).
export const BONE_RATES = [
  { id: 'hip', pctPerMonth: 1.5, name: 'Hip' },
  { id: 'lumbar', pctPerMonth: 1.0, name: 'Lumbar spine' },
  { id: 'whole', pctPerMonth: 0.3, name: 'Whole body' },
];

// Published muscle volume loss points (research report 2.4): [flight day, % loss].
// 6–9 day flights are plotted at day 7.5; values after day 180 are held (loss levels off).
export const MUSCLE_POINTS = [
  { id: 'quad', name: 'Thigh (quadriceps)', points: [[0, 0], [7.5, 6], [180, 12]] },
  { id: 'calf', name: 'Calf', points: [[0, 0], [7.5, 6], [180, 13]] },
  { id: 'back', name: 'Back muscles', points: [[0, 0], [7.5, 10], [180, 20]] },
];

// Reported incidence in astronauts, % (research report and risk analysis). lo..hi when a range is given.
export const INCIDENCE = [
  { risk: 'R10', lo: 90, hi: 90, upTo: true, name: 'Headache in the first days' },
  { risk: 'R6', lo: 100, hi: 100, name: 'Landing motion sickness after long flights' },
  { risk: 'R6', lo: 73, hi: 73, name: 'Space motion sickness in the first days' },
  { risk: 'R2', lo: 66, hi: 66, name: 'Earliest SANS sign on long missions' },
  { risk: 'R11', lo: 61, hi: 61, name: 'Herpes virus reactivation (ISS)' },
  { risk: 'R3', lo: 30, hi: 80, name: 'Orthostatic intolerance after return' },
  { risk: 'R4', lo: 55, hi: 55, name: 'Neck vein stagnant or reversed flow (6/11)' },
  { risk: 'R7', lo: 52, hi: 52, name: 'Back pain in the first 2–5 days' },
  { risk: 'R7', lo: 40, hi: 40, name: 'Back pain after return' },
  { risk: 'R8', lo: 38, hi: 38, name: 'Clinically anemic at landing (5/13)' },
  { risk: 'R4', lo: 9, hi: 9, name: 'Occlusive neck vein clot (1/11)' },
];

// Recovery after return, in days (research report sections 2–4). lo..hi when a range is given.
export const RECOVERY = [
  { risk: 'R6', lo: 2, hi: 7, name: 'Balance after landing' },
  { risk: 'R5', lo: 30, hi: 60, name: 'Muscle mass and strength' },
  { risk: 'R5', lo: 45, hi: 45, name: 'Standard reconditioning programme' },
  { risk: 'R5', lo: 21, hi: 90, name: 'Feeling physically normal (astronaut reports)' },
  { risk: 'R1', lo: 270, hi: 270, name: 'Regaining half the bone loss' },
  { risk: 'R7', lo: 30, hi: 365, name: 'Higher disc herniation risk' },
  { risk: 'R8', lo: 365, hi: 365, name: 'Red cell destruction still 30% higher' },
  { risk: 'R12', lo: 1095, hi: 1095, name: 'Brain ventricles recover' },
];

// Gravity environments (risk analysis 6.1). Mars surface is a reference only; the app has no such mission yet.
export const ENVIRONMENTS = [
  { id: 'leo', g: 0, missions: ['iss'], name: 'ISS (low Earth orbit)', delay: 'Under 1 second',
    change: 'Ground team in real time; standard thresholds' },
  { id: 'moon', g: 0.166, missions: ['moon', 'rover'], name: 'Moon surface', delay: 'About 1.3 seconds',
    change: 'Bone and muscle model at a reduced rate with a wide model assumption range' },
  { id: 'mars_transit', g: 0, missions: ['mars'], name: 'Mars transfer', delay: '3–22 minutes one way',
    change: 'Alerts must be solved fully on board; drug stock is critical' },
  { id: 'mars_surface', g: 0.38, missions: [], name: 'Mars surface', delay: '3–22 minutes',
    change: 'Landing risks (R3, R6, R7) without a help team; show model uncertainty' },
];

// Sources named in the documents, each with a public link (checked 15 Nov 2026).
// url: null means the document names the source but no public link is confirmed yet.
export const SOURCES = [
  { title: 'NASA: The Human Body in Space (RIDGE)', url: 'https://www.nasa.gov/humans-in-space/the-human-body-in-space/' },
  { title: 'NASA Human System Risk Board', url: 'https://www.nasa.gov/directorates/esdmd/hhp/human-system-risk-board/' },
  { title: 'NASA Human Research Roadmap – evidence reports', url: 'https://humanresearchroadmap.nasa.gov/evidence/' },
  { title: 'NASA HRP: bone loss data', url: 'https://ntrs.nasa.gov/citations/20170004597' },
  { title: 'NASA OCHMO: Space Adaptation Syndrome technical brief', url: 'https://www.nasa.gov/wp-content/uploads/2025/09/ochmo-mtb-004-space-adaptation-sickness-sas.pdf' },
  { title: 'NASA OCHMO: SANS technical brief (clinical update)', url: 'https://www.nasa.gov/wp-content/uploads/2024/02/ochmo-mtb-001-sans.pdf' },
  { title: 'SANS expert consensus (PMC)', url: null },
  { title: 'JAMA Network Open: jugular vein flow and clot', url: 'https://pubmed.ncbi.nlm.nih.gov/31722025/' },
  { title: 'npj Microgravity: musculoskeletal update', url: 'https://www.nature.com/articles/s41526-021-00158-4' },
  { title: 'npj Microgravity: immunity in space', url: 'https://www.nature.com/articles/s41526-024-00446-9' },
  { title: 'Ottawa Hospital Research Institute: space anemia', url: 'https://ohri.ca/en/newsroom/being-space-destroys-more-red-blood-cells' },
  { title: 'NASA: Moon and Mars partial gravity', url: 'https://ntrs.nasa.gov/citations/20210019591' },
  { title: 'NASA: Life After Microgravity (astronaut accounts)', url: 'https://www.nasa.gov/centers-and-facilities/johnson/life-after-microgravity-astronauts-reflect-on-post-flight-recovery/' },
];
