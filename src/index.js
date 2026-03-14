require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const authRoutes = require('./routes/auth');
const adsRoutes = require('./routes/ads');
const reportsRoutes = require('./routes/reports');
const pixelRoutes = require('./routes/pixel');
const revenueRoutes = require('./routes/revenue');
const workspaceRoutes = require('./routes/workspace');

const app = express();

app.use(helmet());
app.use(cors({
  origin: [
    'https://trackr.ga4specialist.com',
    'https://ga4specialist.com',
    'http://localhost:3000',
    'http://localhost:5173'
  ],
  credentials: true
}));
app.use(express.json({ limit: '10kb' }));

const limiter = rateLimit({ windowMs: 60000, max: 100, standardHeaders: true });
app.use('/api/', limiter);

app.use('/api/auth', authRoutes);
app.use('/api/ads', adsRoutes);
app.use('/api/reports', reportsRoutes);
app.use('/api/pixel', pixelRoutes);
app.use('/api/revenue', revenueRoutes);
app.use('/api/workspace', workspaceRoutes);

app.get('/health', function(req, res) {
  res.json({ status: 'ok', ts: Date.now() });
});

app.use(function(req, res) {
  res.status(404).json({ error: 'Not found' });
});

app.use(function(err, req, res, next) {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || 'Internal error' });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, function() {
  console.log('Trackr backend running on port ' + PORT);
});
