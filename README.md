# ExamMaker AI (Phase 1 MVP)

AI school exam paper generator. Phase 1 includes: Firebase email login, paper configuration form,
marks/difficulty validation, Gemini generation (server-side), duplicate detection, preview and print/Save-as-PDF.

Not built yet (later phases): SymPy math verification, OCR/uploads, answer sheets, paper sets, editor, admin UI, saved papers, server-side PDF.

## Run in Termux

```bash
pkg install nodejs git
cd exammaker-ai
npm install
cp .env.example .env        # then edit .env (nano .env)
cp public/firebase-config.example.js public/firebase-config.js   # edit with your Firebase web config
npm run check
npm start
```
Open http://localhost:3000 in your phone browser.

## Phase 2: math verification service (Python + SymPy)

The AI proposes an answer; `mathsvc/` checks it independently. Statuses: `VERIFIED_CORRECT`, `INCORRECT`,
`PARTIALLY_VERIFIED`, `VERIFICATION_UNAVAILABLE`, `NEEDS_MANUAL_REVIEW`. Unsupported problems are never labelled verified.

```bash
pip install -r mathsvc/requirements.txt      # installs SymPy (pure Python, works in Termux)
npm run test:math                            # run this first: SymPy tests were NOT run when this was written
npm run math                                 # terminal 1: Python service on 127.0.0.1:5001
npm start                                    # terminal 2: web app
```
Set the same `MATH_SERVICE_TOKEN` in `.env` (read by both services).

Supported kinds: `evaluate`, `equivalent` (algebra, identities, trig), `factor`, `solve_equation` (single equation or
system, real numbers, extraneous-root detection), `derivative`, `integral`, `statistics` (mean, median, mode, range,
variance, stdev; population by default, `"sample": true` for sample), `probability`, `geometry` (rectangle, square, triangle,
triangle_sss, right_triangle, circle, trapezium, parallelogram, rhombus, cube, cuboid, cylinder, cone, sphere; optional `"pi": "22/7"`).
Not supported yet: matrices, sequences/series, diagram-based geometry, theorem proofs, unit conversion as a separate kind.

Safety: expressions pass a strict whitelist (`mathsvc/safety.py`) before reaching SymPy; no `eval`/`exec` on user text; huge
exponents are rejected; each request has an 8 s timeout; the service binds to localhost and requires the token.
Syntax inside expressions: `^` for powers, `*` between variables (write `x*y`), `sqrt()`, `sind()` for degrees, no `%`.

New endpoints (login required):
- `POST /api/math/verify` body: a check spec, e.g. `{"kind":"solve_equation","equation":"x^2-5*x+6=0","proposed":["2","3"]}`.
- `POST /api/math/solve` body: `{problem, classLevel, language}`. Gemini writes the steps and a machine-checkable form of the
  problem; SymPy verifies it (one automatic retry if it proves the answer wrong). The UI shows the checked form so you can
  confirm it matches your original problem.

## Phase 3: uploads and OCR (Gemini Vision, no extra packages)

Upload JPG/PNG/WEBP/PDF (or take a photo) in the **Study Materials** card. Each file is processed one at a time with
its own progress bar, Remove / Replace / Retry buttons, and an editable extracted-text box. Nothing is used until you press
"Use for question paper" or "Use as math problem".

- The AI is told to transcribe only, never to fix or invent. Hard-to-read parts are wrapped in `⟦ ⟧` and listed as warnings;
  if you use text that still has marks, you are asked to confirm. Empty results return an error instead of made-up text.
- Math mode asks for ASCII math (`x^2 - 5*x + 6 = 0`) so it can go straight to the Math Solver, and never silently corrects symbols.
- Safety: login is checked before the large body is read; 12 uploads/minute; type must match the file's real bytes;
  6 MB limit per file (images are shrunk in the browser first to save mobile data); the document is treated as data, not instructions.
- Scanned and text PDFs both work because Gemini reads the PDF directly. Very long PDFs may be slow or truncated; split them if so.
- Files are not stored (no Firebase Storage yet); only the text you choose to use is kept in the page.

Endpoints: `POST /api/documents/extract` and `POST /api/math/ocr` with `{name, mimeType, data (base64), mode}`.
Run `npm test` for the Node tests (no network needed).

## Phase 4: paper editor, answer sheets, saved papers

After you press Generate, the paper opens in an editor with a live preview.

- **Edit:** change question text, options, marks, difficulty and section headings; add, duplicate, delete and reorder
  questions and sections; edit school, exam name and full marks. The total is recalculated live and mismatches are shown as
  warnings (total vs full marks, creative part marks, empty or duplicate questions, MCQs without 4 options). Nothing is "fixed" silently.
- **Regenerate one question (↻):** the AI writes a replacement with the same marks and type, different from the other questions.
  Optionally tell it what to change. Bad output (wrong option count, creative parts that do not add up, duplicates) is rejected.
- **Answer sheet:** "Generate answers" writes answers and solutions in batches of 8 with progress, and can resume after a failure.
  Math answers are sent to the SymPy service; **only answers that SymPy confirmed show "Verified by SymPy"**. Everything else is
  labelled "Not verified: teacher review". A wrong answer is retried once; if still wrong it is shown as "Checker disagrees"
  with the expected value. Editing a question deletes its old answer so a stale answer never sits next to a changed question.
- **Print modes:** Questions only, Questions + Answer sheet, Questions + Detailed solutions, Answer sheet only. Printing shows only
  the paper (the answer sheet starts on a new page). Use your browser's "Save as PDF".
- **Save / My Papers:** Save stores the paper, its answers and details in Firestore (collection `questionPapers`, owner = your login).
  The server checks ownership on every request (other users' papers look like "not found"). Up to 100 papers, 400 KB each.
  You are warned before discarding unsaved changes.

New endpoints (login required): `POST /api/answers/generate`, `POST /api/questions/regenerate`,
`GET/POST /api/papers`, `GET/PUT/DELETE /api/papers/:id`.

Honest limits:
- "Verified by SymPy" means the AI's answer matches SymPy for the checkable form the AI wrote for that question. The printed sheet
  and the detailed view show that form. If the AI restated the question wrongly, the check proves the wrong thing, so review math.
- Not in the editor yet: custom instructions text.

Tests: `npm test` runs 37 Node tests (60 as of Phase 8) (no network needed). The paper editor was also exercised in a real Chromium with Firebase
and the API stubbed (36 checks: editing, reordering, regenerate, answers, save/open/delete, print layout).

## Phase 5: print layout, PDF, formulas, paper sets

- **PDF = your browser's "Save as PDF".** Press "Print / Save as PDF", choose "Save as PDF", make sure the paper size matches
  your layout (A4 or A5) and turn off the browser's own "Headers and footers". The browser does the Bengali text shaping, so
  conjuncts (ক্ষ, শ্র, দ্ব) come out correctly, and fonts are embedded.
- **Paper details & layout** (inside the editor): address, date, time; template (Traditional school / Modern professional);
  A4 or A5; margins; sans or serif font; font size; line and question spacing; Bengali or English numerals for numbering, marks and
  header values (never digits inside question text or formulas); header alignment; page border (none/single/double); header text,
  footer text, watermark, page numbers ("Page 1 of 5", or "১ / ৫" with Bengali numerals); school logo (PNG/JPG/WEBP, resized in the
  browser to stay small). Layout is saved with the paper.
- **Formulas:** `$x^2 + 1$` and `$$...$$` are typeset with KaTeX (version 0.16.47, MIT, self-hosted in `public/vendor/katex/`, so it
  works offline and needs no CDN). "$5 and $10" is not treated as a formula.
- **Paper sets A-E:** "Create sets" makes sets with the same questions, marks and difficulty mix, in a different question order
  (MCQ options are shuffled too, except where an option says "all/none of the above" / "উপরের সবগুলো" / "কোনোটিই নয়"). Each set's
  answer key is remapped, so the right option stays right. Show one set, or "All sets" to print them together, one per page.
  Sets are not saved: editing a question or regenerating answers removes them and you create them again. A section with only two
  questions cannot give three different orders, and you are told when that happens.

Tested by exporting real PDFs from Chromium and inspecting them with `pdfinfo`, `pdftotext`, `pdffonts` and page images:
A4 and A5 page sizes, Bengali text, formulas, page numbers, header/footer text, watermark, logo, page border on every page,
embedded fonts, sets, and the answer sheet.

Not tested / not included:
- **Android Chrome's print dialog was not tested.** Check the paper size and page numbers in your first PDF.
- Noto Sans/Serif Bengali load from Google Fonts (internet needed); offline, the phone's own Bengali font is used. The PDF checks here
  used a fallback Bengali font because Noto was not available in my test environment.
- No server-side PDF download button and no Word (.docx) export. Sets with *different* questions (AI alternatives) are not built.
- Margin-box page numbers and header/footer text need a recent Chrome (131 or newer).

## Phase 6: school profiles and exam templates

- **School profile** (Firestore `schools`): school name, address, EIIN, contact, website, default language and time, logo and the
  whole print layout. "Save as new" copies them from the open paper (or from the form if none is open). "Use for new papers"
  fills the school name and gives every new paper that header and layout; "Apply to open paper" changes the open paper's header and layout.
  Up to 20 profiles. A profile never contains questions.
- **Exam template** (Firestore `savedTemplates`): a question pattern (sections, counts, marks each, difficulty %, language, optional class/subject/chapter).
  The server refuses a template whose marks do not add up to full marks, so a saved template can always be used. Up to 50.
- **Built-in templates** (Class test 20, Weekly 25, Half-yearly style 50, Model practice 100) are editable examples,
  **not official board formats**. Check them against your institution's current rules. 
- Paper header now has EIIN, contact and website lines (EIIN label in Bengali for Bengali papers).
- Endpoints (login required, owner-only, other users get "not found"): `GET/POST /api/schools`, `GET/PUT/DELETE /api/schools/:id`, same for `/api/templates`.
- **Deploy `firestore.rules` again**: it now has a `savedTemplates` rule. (The server uses the admin SDK, so this only matters if you ever read from the browser.)

Tests: `npm test` runs 45 Node tests. Browser checks with the API stubbed: profiles and templates save/load/update/delete,
logo and layout carried into new papers, server error shown, controls hidden when printing.

## Phase 7: "answer any N of M" (optional questions)

- In the create form each section has an **Answer any** box. Blank = all questions compulsory. Example: 10 creative questions at
  10 marks, answer any 7 = 70 marks. Section totals, the full-marks check and the generator all count only the N chosen questions.
- The AI is told to write all M questions with equal marks and similar difficulty. In the editor you can change N per section.
- The printed paper shows a line under the section heading: "নিচের ১০টি প্রশ্নের মধ্যে যেকোনো ৭টির উত্তর দাও।" or
  "Answer any 7 of the following 10 questions." (numerals follow your layout setting). All sets and saved papers keep the rule; templates can store it.
- The "Model practice (100 marks)" example now uses 30 MCQ + 10 creative, answer any 7. It is an example, not an official format.
- Warnings, never silent fixes: unequal marks in an optional section (the total then uses the N lowest, so it is never overstated),
  and N not smaller than the number of questions (then everything counts as compulsory and no instruction line is printed).
- Answer sheets still answer every question (the teacher needs all of them).

Tests: 53 Node tests; browser checks for form totals, editor edits and warnings, printed line, sets, and save/reopen.

## Phase 8: Word (.docx) export

"Download Word (.docx)" (next to Print) creates a Word file of exactly what the preview shows: the print mode (questions, with answers,
detailed solutions, answers only) and, if you made sets, one set or all sets (one per page). It is built in the browser with no
extra library and works offline. Opens in Word, WPS Office, LibreOffice and Google Docs.

Included: school header with logo (PNG/JPG), address, EIIN/contact/website, exam details, A4/A5 page size, margins, font size, line
spacing, page border (single/double), header text, footer text, "Page X of Y", Bengali or English numerals, "answer any N" lines,
creative parts, MCQ options, answers with the same honest verification labels as the preview.

Not included (said again under the button):
- **Formulas are plain text.** `$x^2 + \frac{1}{2}$` becomes `x² + (1)/(2)`. Simple school maths (powers, fractions, roots, Greek letters,
  ×, ÷, ≤, ≥) is converted; complicated LaTeX may stay partly as written. Check formulas before using the file.
- No watermark, no WEBP logo (Word cannot show it; the logo is skipped), Bengali page numerals show as 1, 2, 3 (Word limitation).
- The Traditional/Modern template look is not copied; fonts are Arial or Times New Roman with Nirmala UI for Bengali. On a device
  without Nirmala UI, Word substitutes another Bengali font. Check the first file you make.

Tested: 60 Node tests (zip CRCs, XML balance, escaping, Bengali text, modes, sets, layout) plus real files opened with python-docx
and converted by LibreOffice (page size, double border, logo, header/footer, Bengali shaping), and a browser run that downloads the real file.
Not tested: Microsoft Word itself and Word/WPS on Android.

## Setup needed
1. Firebase console: create a project, enable Authentication > Email/Password.
2. Project settings > Service accounts > generate key. Paste the JSON on ONE line into `FIREBASE_SERVICE_ACCOUNT_JSON` in `.env`.
3. Project settings > Your apps > Web app: put its config in `public/firebase-config.js`.
4. Get a Gemini API key from Google AI Studio, put it in `GEMINI_API_KEY`.
5. Deploy `firestore.rules` later when saving papers is added.

Never commit `.env` or service-account files (already in `.gitignore`).

## API
- `POST /api/questions/validate`  body: config. Returns `{ok, errors, total}`.
- `POST /api/questions/generate`  body: `{config, sourceText}`. Returns `{ok, paper, warnings, marksTotal}`.
All require `Authorization: Bearer <Firebase ID token>`. Errors: `{ok:false, error:{code,message}}`.

Teachers should review generated papers against their current institutional requirements.
