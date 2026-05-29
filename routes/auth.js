const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { getDb, run, get, insert } = require('../database');
const { authMiddleware, JWT_SECRET } = require('../middleware/auth');

const router = express.Router();

router.post('/register', async (req, res) => {
  const { name, email, phone, school, class_level, password } = req.body;
  if (!name || !email || !phone || !school || !class_level || !password) {
    return res.status(400).json({ error: 'All fields are required' });
  }
  if (class_level < 3 || class_level > 12) {
    return res.status(400).json({ error: 'Class must be between 3 and 12' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }
  try {
    const db = await getDb();
    const existing = get(db, 'SELECT id FROM students WHERE email = ?', [email.toLowerCase().trim()]);
    if (existing) return res.status(409).json({ error: 'Email already registered. Please login.' });

    const hash = await bcrypt.hash(password, 10);
    const id = insert(db,
      'INSERT INTO students (name, email, phone, school, class_level, password_hash) VALUES (?, ?, ?, ?, ?, ?)',
      [name, email.toLowerCase().trim(), phone, school, class_level, hash]
    );
    const { saveDb } = require('../database');
    saveDb();

    const student = get(db, 'SELECT id, name, email, phone, school, class_level, is_premium, premium_expires_at, created_at FROM students WHERE id = ?', [id]);
    const token = jwt.sign({ id: student.id, email: student.email, role: 'student' }, JWT_SECRET, { expiresIn: '30d' });
    res.status(201).json({ token, student });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Registration failed. Please try again.' });
  }
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  try {
    const db = await getDb();
    const student = get(db, 'SELECT * FROM students WHERE email = ?', [email.toLowerCase().trim()]);
    if (!student) return res.status(401).json({ error: 'Invalid email or password' });

    const match = await bcrypt.compare(password, student.password_hash);
    if (!match) return res.status(401).json({ error: 'Invalid email or password' });

    const { password_hash, ...safe } = student;
    const token = jwt.sign({ id: safe.id, email: safe.email, role: 'student' }, JWT_SECRET, { expiresIn: '30d' });

    if (safe.is_premium && safe.premium_expires_at && new Date(safe.premium_expires_at) < new Date()) {
      const { run: dbRun, saveDb } = require('../database');
      dbRun(db, 'UPDATE students SET is_premium = 0 WHERE id = ?', [safe.id]);
      saveDb();
      safe.is_premium = 0;
    }

    res.json({ token, student: safe });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Login failed. Please try again.' });
  }
});

router.get('/me', authMiddleware, async (req, res) => {
  const db = await getDb();
  const student = get(db, 'SELECT id, name, email, phone, school, class_level, is_premium, premium_expires_at, created_at FROM students WHERE id = ?', [req.student.id]);
  if (!student) return res.status(404).json({ error: 'Student not found' });

  if (student.is_premium && student.premium_expires_at && new Date(student.premium_expires_at) < new Date()) {
    const { run: dbRun, saveDb } = require('../database');
    dbRun(db, 'UPDATE students SET is_premium = 0 WHERE id = ?', [student.id]);
    saveDb();
    student.is_premium = 0;
  }

  res.json({ student });
});

router.put('/update-class', authMiddleware, async (req, res) => {
  const { class_level } = req.body;
  if (!class_level || class_level < 3 || class_level > 12) {
    return res.status(400).json({ error: 'Invalid class level' });
  }
  const db = await getDb();
  const { run: dbRun, saveDb } = require('../database');
  dbRun(db, 'UPDATE students SET class_level = ? WHERE id = ?', [class_level, req.student.id]);
  saveDb();
  res.json({ success: true });
});

module.exports = router;
