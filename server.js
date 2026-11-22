'use strict';
require('dotenv').config();
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const questions = require('./src/routes/questions');
const math = require('./src/routes/math');
const { extractHandler } = require('./src/routes/documents');
const { answersHandler, regenerateHandler } = require('./src/routes/ai');
const { createPaperHandlers } = require('./src/routes/papers');
const { firestoreStore } = require('./src/services/store');
const { schoolHandlers, templateHandlers } = require('./src/routes/collections');
const { requireAuth } = require('./src/middleware/auth');

const app = express();
app.set('trust proxy', 1);

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", 'https://www.gstatic.com'],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'", 'https://identitytoolkit.googleapis.com', 'https://securetoken.googleapis.com']
    }
  }
}));
app.use(cors({ origin: process.env.ALLOWED_ORIGIN || false }));

app.use('/api', rateLimit({ windowMs: 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false }));

// Upload/OCR routes: login is checked BEFORE the large body is parsed, with a tighter rate limit.
// These must be registered before the small global JSON parser below.
const uploadLimiter = rateLimit({ windowMs: 60 * 1000, limit: 12, standardHeaders: true, legacyHeaders: false });
const bigJson = express.json({ limit: '9mb' });
app.post('/api/documents/extract', uploadLimiter, requireAuth, bigJson, extractHandler);
app.post('/api/math/ocr', uploadLimiter, requireAuth, bigJson, (req, res, next) => { req.body = { ...req.body, mode: 'math' }; next(); }, extractHandler);

// Saved papers and answer generation carry bigger bodies (up to ~400 KB); login is checked first.
const midJson = express.json({ limit: '500kb' });
const aiLimiter = rateLimit({ windowMs: 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false });
app.post('/api/answers/generate', aiLimiter, requireAuth, midJson, answersHandler);
app.post('/api/questions/regenerate', aiLimiter, requireAuth, midJson, regenerateHandler);

const papers = createPaperHandlers(firestoreStore());
app.get('/api/papers', requireAuth, papers.list);
app.post('/api/papers', requireAuth, midJson, papers.create);
app.get('/api/papers/:id', requireAuth, papers.get);
app.put('/api/papers/:id', requireAuth, midJson, papers.update);
app.delete('/api/papers/:id', requireAuth, papers.remove);

const schools = schoolHandlers(firestoreStore('schools'));
app.get('/api/schools', requireAuth, schools.list);
app.post('/api/schools', requireAuth, midJson, schools.create);
app.get('/api/schools/:id', requireAuth, schools.get);
app.put('/api/schools/:id', requireAuth, midJson, schools.update);
app.delete('/api/schools/:id', requireAuth, schools.remove);

const templates = templateHandlers(firestoreStore('savedTemplates'));
app.get('/api/templates', requireAuth, templates.list);
app.post('/api/templates', requireAuth, midJson, templates.create);
app.get('/api/templates/:id', requireAuth, templates.get);
app.put('/api/templates/:id', requireAuth, midJson, templates.update);
app.delete('/api/templates/:id', requireAuth, templates.remove);

app.use(express.json({ limit: '200kb' }));
app.use('/api/questions', questions);
app.use('/api/math', math);

app.get('/api/health', (req, res) => res.json({ ok: true }));

app.use('/api', (req, res) => res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: 'Unknown endpoint' } }));

app.use(express.static(path.join(__dirname, 'public')));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ ok: false, error: { code: 'SERVER_ERROR', message: 'Something went wrong' } });
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`ExamMaker AI running on port ${port}`));
