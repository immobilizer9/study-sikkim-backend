const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { getDb, get, all, run, saveDb } = require('../database');
const { adminAuthMiddleware, JWT_SECRET } = require('../middleware/auth');

const router = express.Router();

router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
  const db = await getDb();
  const admin = get(db, 'SELECT * FROM admin_users WHERE username = ?', [username]);
  if (!admin) return res.status(401).json({ error: 'Invalid credentials' });
  const match = await bcrypt.compare(password, admin.password_hash);
  if (!match) return res.status(401).json({ error: 'Invalid credentials' });
  const token = jwt.sign({ id: admin.id, username: admin.username, role: 'admin' }, JWT_SECRET, { expiresIn: '8h' });
  res.json({ token });
});

router.get('/students', adminAuthMiddleware, async (req, res) => {
  const db = await getDb();
  const page = parseInt(req.query.page) || 1;
  const limit = 50;
  const offset = (page - 1) * limit;
  const students = all(db, 'SELECT id, name, email, phone, school, class_level, is_premium, premium_expires_at, created_at FROM students ORDER BY created_at DESC LIMIT ? OFFSET ?', [limit, offset]);
  const total = get(db, 'SELECT COUNT(*) as c FROM students');
  res.json({ students, total: total?.c ?? 0, page, pages: Math.ceil((total?.c ?? 0) / limit) });
});

router.get('/stats', adminAuthMiddleware, async (req, res) => {
  const db = await getDb();
  const stats = {
    total_students: get(db, 'SELECT COUNT(*) as c FROM students')?.c ?? 0,
    premium_students: get(db, 'SELECT COUNT(*) as c FROM students WHERE is_premium = 1')?.c ?? 0,
    total_quizzes: get(db, 'SELECT COUNT(*) as c FROM quiz_attempts')?.c ?? 0,
    total_revenue: get(db, "SELECT SUM(amount) as s FROM payments WHERE status = 'paid'")?.s ?? 0,
    by_class: all(db, 'SELECT class_level, COUNT(*) as count FROM students GROUP BY class_level ORDER BY class_level'),
  };
  res.json(stats);
});

router.get('/attempts', adminAuthMiddleware, async (req, res) => {
  const db = await getDb();
  const attempts = all(db, `
    SELECT qa.id, qa.score, qa.total, qa.time_taken_seconds, qa.completed_at,
           st.name as student_name, st.class_level,
           ch.name as chapter_name, s.name as subject_name
    FROM quiz_attempts qa
    JOIN students st ON st.id = qa.student_id
    JOIN chapters ch ON ch.id = qa.chapter_id
    JOIN subjects s ON s.id = ch.subject_id
    ORDER BY qa.completed_at DESC
    LIMIT 200
  `);
  res.json({ attempts });
});

router.put('/students/:id/premium', adminAuthMiddleware, async (req, res) => {
  const { is_premium, days } = req.body;
  const db = await getDb();
  let expiresAt = null;
  if (is_premium && days) {
    const d = new Date();
    d.setDate(d.getDate() + days);
    expiresAt = d.toISOString();
  }
  run(db, 'UPDATE students SET is_premium = ?, premium_expires_at = ? WHERE id = ?',
    [is_premium ? 1 : 0, expiresAt, req.params.id]);
  saveDb();
  res.json({ success: true });
});

module.exports = router;
