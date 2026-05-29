const express = require('express');
const cors = require('cors');
const path = require('path');
const { ensureReady } = require('./database');

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/auth', require('./routes/auth'));
app.use('/api/content', require('./routes/content'));
app.use('/api/quiz', require('./routes/quiz'));
app.use('/api/leaderboard', require('./routes/leaderboard'));
app.use('/api/payment', require('./routes/payment'));
app.use('/api/admin', require('./routes/admin'));

app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/api/health', (req, res) => res.json({ status: 'ok', app: 'Study Sikkim' }));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

ensureReady()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Study Sikkim API running on http://localhost:${PORT}`);
    });
  })
  .catch(err => {
    console.error('Failed to initialize database:', err);
    process.exit(1);
  });

module.exports = app;
