const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { getDb, get, all, run, insert, saveDb } = require('../database');
const { adminAuthMiddleware, JWT_SECRET } = require('../middleware/auth');

const router = express.Router();

// ─── Auth ───────────────────────────────────────────────────────────────────

router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
  const db = await getDb();
  const admin = get(db, 'SELECT * FROM admin_users WHERE username = ?', [username]);
  if (!admin) return res.status(401).json({ error: 'Invalid credentials' });
  const match = await bcrypt.compare(password, admin.password_hash);
  if (!match) return res.status(401).json({ error: 'Invalid credentials' });
  const token = jwt.sign({ id: admin.id, username: admin.username, role: 'admin' }, JWT_SECRET, { expiresIn: '8h' });
  res.json({ token, username: admin.username });
});

router.put('/change-password', adminAuthMiddleware, async (req, res) => {
  const { current_password, new_password } = req.body;
  if (!current_password || !new_password || new_password.length < 6)
    return res.status(400).json({ error: 'Current password and new password (min 6 chars) required' });
  const db = await getDb();
  const admin = get(db, 'SELECT * FROM admin_users WHERE id = ?', [req.admin.id]);
  const match = await bcrypt.compare(current_password, admin.password_hash);
  if (!match) return res.status(401).json({ error: 'Current password is incorrect' });
  const hash = await bcrypt.hash(new_password, 10);
  run(db, 'UPDATE admin_users SET password_hash = ? WHERE id = ?', [hash, req.admin.id]);
  saveDb();
  res.json({ success: true });
});

// ─── Stats ───────────────────────────────────────────────────────────────────

router.get('/stats', adminAuthMiddleware, async (req, res) => {
  const db = await getDb();
  const today = new Date().toISOString().slice(0, 10);
  const stats = {
    total_students: get(db, 'SELECT COUNT(*) as c FROM students')?.c ?? 0,
    premium_students: get(db, 'SELECT COUNT(*) as c FROM students WHERE is_premium = 1')?.c ?? 0,
    total_quizzes: get(db, 'SELECT COUNT(*) as c FROM quiz_attempts')?.c ?? 0,
    total_revenue: get(db, "SELECT COALESCE(SUM(amount),0) as s FROM payments WHERE status = 'paid'")?.s ?? 0,
    new_students_today: get(db, "SELECT COUNT(*) as c FROM students WHERE date(created_at) = ?", [today])?.c ?? 0,
    quizzes_today: get(db, "SELECT COUNT(*) as c FROM quiz_attempts WHERE date(completed_at) = ?", [today])?.c ?? 0,
    total_subjects: get(db, 'SELECT COUNT(*) as c FROM subjects')?.c ?? 0,
    total_questions: get(db, 'SELECT COUNT(*) as c FROM questions')?.c ?? 0,
    by_class: all(db, 'SELECT class_level, COUNT(*) as count FROM students GROUP BY class_level ORDER BY class_level'),
    recent_signups: all(db, 'SELECT name, email, class_level, created_at FROM students ORDER BY created_at DESC LIMIT 5'),
  };
  res.json(stats);
});

// ─── Students ────────────────────────────────────────────────────────────────

router.get('/students', adminAuthMiddleware, async (req, res) => {
  const db = await getDb();
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = 50;
  const offset = (page - 1) * limit;
  const search = req.query.search ? `%${req.query.search}%` : null;
  const cls = req.query.class ? parseInt(req.query.class) : null;

  let where = 'WHERE 1=1';
  const params = [];
  if (search) { where += ' AND (name LIKE ? OR email LIKE ? OR school LIKE ?)'; params.push(search, search, search); }
  if (cls) { where += ' AND class_level = ?'; params.push(cls); }

  const students = all(db,
    `SELECT id, name, email, phone, school, class_level, is_premium, premium_expires_at, created_at FROM students ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset]);
  const total = get(db, `SELECT COUNT(*) as c FROM students ${where}`, params);
  res.json({ students, total: total?.c ?? 0, page, pages: Math.ceil((total?.c ?? 0) / limit) });
});

router.get('/students/:id', adminAuthMiddleware, async (req, res) => {
  const db = await getDb();
  const student = get(db, 'SELECT id, name, email, phone, school, class_level, is_premium, premium_expires_at, created_at FROM students WHERE id = ?', [req.params.id]);
  if (!student) return res.status(404).json({ error: 'Not found' });
  const attempts = all(db, `
    SELECT qa.score, qa.total, qa.completed_at, ch.name as chapter, s.name as subject
    FROM quiz_attempts qa JOIN chapters ch ON ch.id=qa.chapter_id JOIN subjects s ON s.id=ch.subject_id
    WHERE qa.student_id = ? ORDER BY qa.completed_at DESC LIMIT 20`, [req.params.id]);
  res.json({ student, attempts });
});

router.put('/students/:id/premium', adminAuthMiddleware, async (req, res) => {
  const { is_premium, days } = req.body;
  const db = await getDb();
  let expiresAt = null;
  if (is_premium && days) {
    const d = new Date();
    d.setDate(d.getDate() + parseInt(days));
    expiresAt = d.toISOString();
  }
  run(db, 'UPDATE students SET is_premium = ?, premium_expires_at = ? WHERE id = ?', [is_premium ? 1 : 0, expiresAt, req.params.id]);
  saveDb();
  res.json({ success: true });
});

router.delete('/students/:id', adminAuthMiddleware, async (req, res) => {
  const db = await getDb();
  run(db, 'DELETE FROM quiz_attempts WHERE student_id = ?', [req.params.id]);
  run(db, 'DELETE FROM payments WHERE student_id = ?', [req.params.id]);
  run(db, 'DELETE FROM students WHERE id = ?', [req.params.id]);
  saveDb();
  res.json({ success: true });
});

// ─── Payments ────────────────────────────────────────────────────────────────

router.get('/payments', adminAuthMiddleware, async (req, res) => {
  const db = await getDb();
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const payments = all(db, `
    SELECT p.*, s.name as student_name, s.email as student_email
    FROM payments p JOIN students s ON s.id = p.student_id
    ORDER BY p.created_at DESC LIMIT 50 OFFSET ?`, [(page - 1) * 50]);
  const total = get(db, 'SELECT COUNT(*) as c FROM payments');
  res.json({ payments, total: total?.c ?? 0, page });
});

// ─── Quiz Attempts ───────────────────────────────────────────────────────────

router.get('/attempts', adminAuthMiddleware, async (req, res) => {
  const db = await getDb();
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const attempts = all(db, `
    SELECT qa.id, qa.score, qa.total, qa.time_taken_seconds, qa.completed_at,
           ROUND(CAST(qa.score AS REAL)/CAST(qa.total AS REAL)*100,1) as percentage,
           st.name as student_name, st.class_level,
           ch.name as chapter_name, s.name as subject_name
    FROM quiz_attempts qa
    JOIN students st ON st.id = qa.student_id
    JOIN chapters ch ON ch.id = qa.chapter_id
    JOIN subjects s ON s.id = ch.subject_id
    ORDER BY qa.completed_at DESC LIMIT 100 OFFSET ?`, [(page - 1) * 100]);
  const total = get(db, 'SELECT COUNT(*) as c FROM quiz_attempts');
  res.json({ attempts, total: total?.c ?? 0, page });
});

// ─── Subjects ────────────────────────────────────────────────────────────────

router.get('/subjects', adminAuthMiddleware, async (req, res) => {
  const db = await getDb();
  const cls = parseInt(req.query.class) || 3;
  const subjects = all(db, `
    SELECT s.*, COUNT(c.id) as chapter_count, SUM(q_count.qc) as question_count
    FROM subjects s
    LEFT JOIN chapters c ON c.subject_id = s.id
    LEFT JOIN (SELECT chapter_id, COUNT(*) as qc FROM questions GROUP BY chapter_id) q_count ON q_count.chapter_id = c.id
    WHERE s.class_level = ? GROUP BY s.id ORDER BY s.order_num`, [cls]);
  res.json({ subjects });
});

router.post('/subjects', adminAuthMiddleware, async (req, res) => {
  const { name, class_level, icon, color } = req.body;
  if (!name || !class_level) return res.status(400).json({ error: 'Name and class_level required' });
  const db = await getDb();
  const max = get(db, 'SELECT MAX(order_num) as m FROM subjects WHERE class_level = ?', [class_level]);
  const id = insert(db, 'INSERT INTO subjects (name, class_level, icon, color, order_num) VALUES (?,?,?,?,?)',
    [name, class_level, icon || 'book-open', color || '#1B3A6B', (max?.m || 0) + 1]);
  saveDb();
  res.json({ success: true, id });
});

router.put('/subjects/:id', adminAuthMiddleware, async (req, res) => {
  const { name, icon, color } = req.body;
  const db = await getDb();
  run(db, 'UPDATE subjects SET name = COALESCE(?,name), icon = COALESCE(?,icon), color = COALESCE(?,color) WHERE id = ?',
    [name || null, icon || null, color || null, req.params.id]);
  saveDb();
  res.json({ success: true });
});

router.delete('/subjects/:id', adminAuthMiddleware, async (req, res) => {
  const db = await getDb();
  const chapters = all(db, 'SELECT id FROM chapters WHERE subject_id = ?', [req.params.id]);
  for (const ch of chapters) {
    run(db, 'DELETE FROM questions WHERE chapter_id = ?', [ch.id]);
    run(db, 'DELETE FROM quiz_attempts WHERE chapter_id = ?', [ch.id]);
  }
  run(db, 'DELETE FROM chapters WHERE subject_id = ?', [req.params.id]);
  run(db, 'DELETE FROM subjects WHERE id = ?', [req.params.id]);
  saveDb();
  res.json({ success: true });
});

// ─── Chapters ────────────────────────────────────────────────────────────────

router.get('/chapters/:subjectId', adminAuthMiddleware, async (req, res) => {
  const db = await getDb();
  const chapters = all(db, `
    SELECT c.*, COUNT(q.id) as question_count,
           SUM(CASE WHEN q.is_premium=0 THEN 1 ELSE 0 END) as free_q,
           SUM(CASE WHEN q.is_premium=1 THEN 1 ELSE 0 END) as premium_q
    FROM chapters c LEFT JOIN questions q ON q.chapter_id = c.id
    WHERE c.subject_id = ? GROUP BY c.id ORDER BY c.order_num`, [req.params.subjectId]);
  res.json({ chapters });
});

router.post('/chapters', adminAuthMiddleware, async (req, res) => {
  const { subject_id, name } = req.body;
  if (!subject_id || !name) return res.status(400).json({ error: 'subject_id and name required' });
  const db = await getDb();
  const max = get(db, 'SELECT MAX(order_num) as m FROM chapters WHERE subject_id = ?', [subject_id]);
  const id = insert(db, 'INSERT INTO chapters (subject_id, name, order_num) VALUES (?,?,?)',
    [subject_id, name, (max?.m || 0) + 1]);
  saveDb();
  res.json({ success: true, id });
});

router.put('/chapters/:id', adminAuthMiddleware, async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });
  const db = await getDb();
  run(db, 'UPDATE chapters SET name = ? WHERE id = ?', [name, req.params.id]);
  saveDb();
  res.json({ success: true });
});

router.delete('/chapters/:id', adminAuthMiddleware, async (req, res) => {
  const db = await getDb();
  run(db, 'DELETE FROM questions WHERE chapter_id = ?', [req.params.id]);
  run(db, 'DELETE FROM quiz_attempts WHERE chapter_id = ?', [req.params.id]);
  run(db, 'DELETE FROM chapters WHERE id = ?', [req.params.id]);
  saveDb();
  res.json({ success: true });
});

// ─── Questions ───────────────────────────────────────────────────────────────

router.get('/questions/:chapterId', adminAuthMiddleware, async (req, res) => {
  const db = await getDb();
  const questions = all(db, 'SELECT * FROM questions WHERE chapter_id = ? ORDER BY order_num', [req.params.chapterId]);
  res.json({ questions });
});

router.post('/questions', adminAuthMiddleware, async (req, res) => {
  const { chapter_id, question_text, option_a, option_b, option_c, option_d, correct_answer, is_premium, type, difficulty } = req.body;
  if (!chapter_id || !question_text || !option_a || !option_b || !correct_answer)
    return res.status(400).json({ error: 'Missing required fields' });
  const db = await getDb();
  const max = get(db, 'SELECT MAX(order_num) as m FROM questions WHERE chapter_id = ?', [chapter_id]);
  const id = insert(db,
    'INSERT INTO questions (chapter_id, question_text, option_a, option_b, option_c, option_d, correct_answer, is_premium, type, difficulty, order_num) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
    [chapter_id, question_text, option_a, option_b, option_c || null, option_d || null, correct_answer, is_premium || 0, type || 'mcq', difficulty || 'medium', (max?.m || 0) + 1]);
  saveDb();
  res.json({ success: true, id });
});

router.put('/questions/:id', adminAuthMiddleware, async (req, res) => {
  const { question_text, option_a, option_b, option_c, option_d, correct_answer, is_premium, difficulty } = req.body;
  const db = await getDb();
  run(db, `UPDATE questions SET
    question_text = COALESCE(?, question_text),
    option_a = COALESCE(?, option_a), option_b = COALESCE(?, option_b),
    option_c = COALESCE(?, option_c), option_d = COALESCE(?, option_d),
    correct_answer = COALESCE(?, correct_answer),
    is_premium = COALESCE(?, is_premium), difficulty = COALESCE(?, difficulty)
    WHERE id = ?`,
    [question_text||null, option_a||null, option_b||null, option_c||null, option_d||null,
     correct_answer||null, is_premium!=null?is_premium:null, difficulty||null, req.params.id]);
  saveDb();
  res.json({ success: true });
});

router.delete('/questions/:id', adminAuthMiddleware, async (req, res) => {
  const db = await getDb();
  run(db, 'DELETE FROM questions WHERE id = ?', [req.params.id]);
  saveDb();
  res.json({ success: true });
});

// Bulk import questions via JSON array
router.post('/questions/bulk', adminAuthMiddleware, async (req, res) => {
  const { chapter_id, questions } = req.body;
  if (!chapter_id || !Array.isArray(questions) || !questions.length)
    return res.status(400).json({ error: 'chapter_id and questions array required' });
  const db = await getDb();
  let max = get(db, 'SELECT MAX(order_num) as m FROM questions WHERE chapter_id = ?', [chapter_id])?.m || 0;
  let added = 0;
  for (const q of questions) {
    if (!q.question_text || !q.correct_answer) continue;
    max++;
    insert(db, 'INSERT INTO questions (chapter_id, question_text, option_a, option_b, option_c, option_d, correct_answer, is_premium, type, difficulty, order_num) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      [chapter_id, q.question_text, q.option_a||null, q.option_b||null, q.option_c||null, q.option_d||null,
       q.correct_answer, q.is_premium||0, q.type||'mcq', q.difficulty||'medium', max]);
    added++;
  }
  saveDb();
  res.json({ success: true, added });
});

// ─── Banners ─────────────────────────────────────────────────────────────────

router.get('/banners', adminAuthMiddleware, async (req, res) => {
  const db = await getDb();
  const banners = all(db, 'SELECT * FROM banners ORDER BY order_num, id DESC');
  res.json({ banners });
});

router.post('/banners', adminAuthMiddleware, async (req, res) => {
  const { title, subtitle, image_url, action_type, action_value, bg_color, text_color } = req.body;
  if (!title) return res.status(400).json({ error: 'Title required' });
  const db = await getDb();
  const max = get(db, 'SELECT MAX(order_num) as m FROM banners');
  const id = insert(db,
    'INSERT INTO banners (title, subtitle, image_url, action_type, action_value, bg_color, text_color, order_num) VALUES (?,?,?,?,?,?,?,?)',
    [title, subtitle||null, image_url||null, action_type||'none', action_value||null,
     bg_color||'#1B3A6B', text_color||'#ffffff', (max?.m||0)+1]);
  saveDb();
  res.json({ success: true, id });
});

router.put('/banners/:id', adminAuthMiddleware, async (req, res) => {
  const { title, subtitle, image_url, action_type, action_value, bg_color, text_color, is_active } = req.body;
  const db = await getDb();
  run(db, `UPDATE banners SET
    title=COALESCE(?,title), subtitle=COALESCE(?,subtitle), image_url=COALESCE(?,image_url),
    action_type=COALESCE(?,action_type), action_value=COALESCE(?,action_value),
    bg_color=COALESCE(?,bg_color), text_color=COALESCE(?,text_color),
    is_active=COALESCE(?,is_active) WHERE id=?`,
    [title||null, subtitle||null, image_url||null, action_type||null, action_value||null,
     bg_color||null, text_color||null, is_active!=null?is_active:null, req.params.id]);
  saveDb();
  res.json({ success: true });
});

router.delete('/banners/:id', adminAuthMiddleware, async (req, res) => {
  const db = await getDb();
  run(db, 'DELETE FROM banners WHERE id = ?', [req.params.id]);
  saveDb();
  res.json({ success: true });
});

// ─── Theme / App Settings ─────────────────────────────────────────────────────

router.get('/settings', adminAuthMiddleware, async (req, res) => {
  const db = await getDb();
  const rows = all(db, 'SELECT key, value FROM app_settings');
  const settings = {};
  rows.forEach(r => { try { settings[r.key] = JSON.parse(r.value); } catch { settings[r.key] = r.value; } });
  res.json({ settings });
});

router.put('/settings', adminAuthMiddleware, async (req, res) => {
  const db = await getDb();
  for (const [key, value] of Object.entries(req.body)) {
    const v = typeof value === 'object' ? JSON.stringify(value) : String(value);
    const existing = get(db, 'SELECT key FROM app_settings WHERE key = ?', [key]);
    if (existing) {
      run(db, "UPDATE app_settings SET value = ?, updated_at = datetime('now') WHERE key = ?", [v, key]);
    } else {
      run(db, 'INSERT INTO app_settings (key, value) VALUES (?, ?)', [key, v]);
    }
  }
  saveDb();
  res.json({ success: true });
});

// ─── Announcements ───────────────────────────────────────────────────────────

router.get('/announcements', adminAuthMiddleware, async (req, res) => {
  const db = await getDb();
  res.json({ announcements: all(db, 'SELECT * FROM announcements ORDER BY created_at DESC') });
});

router.post('/announcements', adminAuthMiddleware, async (req, res) => {
  const { title, body, type, target_class } = req.body;
  if (!title || !body) return res.status(400).json({ error: 'Title and body required' });
  const db = await getDb();
  const id = insert(db, 'INSERT INTO announcements (title, body, type, target_class) VALUES (?,?,?,?)',
    [title, body, type||'info', target_class||null]);
  saveDb();
  res.json({ success: true, id });
});

router.delete('/announcements/:id', adminAuthMiddleware, async (req, res) => {
  const db = await getDb();
  run(db, 'DELETE FROM announcements WHERE id = ?', [req.params.id]);
  saveDb();
  res.json({ success: true });
});

module.exports = router;
