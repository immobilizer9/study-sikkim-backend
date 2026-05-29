const express = require('express');
const { getDb, get, all, run, insert, saveDb } = require('../database');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

router.get('/subjects/:classLevel', authMiddleware, async (req, res) => {
  const classLevel = parseInt(req.params.classLevel);
  if (isNaN(classLevel) || classLevel < 3 || classLevel > 12) {
    return res.status(400).json({ error: 'Invalid class level' });
  }
  const db = await getDb();
  const subjects = all(db, `
    SELECT s.id, s.name, s.icon, s.color, s.order_num,
           COUNT(c.id) as chapter_count
    FROM subjects s
    LEFT JOIN chapters c ON c.subject_id = s.id
    WHERE s.class_level = ?
    GROUP BY s.id
    ORDER BY s.order_num
  `, [classLevel]);

  res.json({ subjects });
});

router.get('/chapters/:subjectId', authMiddleware, async (req, res) => {
  const subjectId = parseInt(req.params.subjectId);
  const db = await getDb();
  const subject = get(db, 'SELECT * FROM subjects WHERE id = ?', [subjectId]);
  if (!subject) return res.status(404).json({ error: 'Subject not found' });

  const chapters = all(db, `
    SELECT c.id, c.name, c.order_num,
           COUNT(q.id) as total_questions,
           SUM(CASE WHEN q.is_premium = 0 THEN 1 ELSE 0 END) as free_questions,
           SUM(CASE WHEN q.is_premium = 1 THEN 1 ELSE 0 END) as premium_questions
    FROM chapters c
    LEFT JOIN questions q ON q.chapter_id = c.id
    WHERE c.subject_id = ?
    GROUP BY c.id
    ORDER BY c.order_num
  `, [subjectId]);

  const studentId = req.student.id;
  const chaptersWithScore = chapters.map(ch => {
    const best = get(db, `
      SELECT MAX(score) as best_score, COUNT(*) as attempts
      FROM quiz_attempts
      WHERE student_id = ? AND chapter_id = ?
    `, [studentId, ch.id]);
    return { ...ch, best_score: best?.best_score ?? null, attempts: best?.attempts ?? 0 };
  });

  res.json({ subject, chapters: chaptersWithScore });
});

router.get('/questions/:chapterId', authMiddleware, async (req, res) => {
  const chapterId = parseInt(req.params.chapterId);
  const db = await getDb();
  const chapter = get(db, 'SELECT * FROM chapters WHERE id = ?', [chapterId]);
  if (!chapter) return res.status(404).json({ error: 'Chapter not found' });

  const student = get(db, 'SELECT is_premium, premium_expires_at FROM students WHERE id = ?', [req.student.id]);
  const isPremium = student.is_premium === 1 && (!student.premium_expires_at || new Date(student.premium_expires_at) > new Date());

  const questions = all(db, `
    SELECT id, question_text, option_a, option_b, option_c, option_d,
           type, is_premium, difficulty, order_num, media_url
    FROM questions
    WHERE chapter_id = ?
    ORDER BY order_num ASC
  `, [chapterId]);

  const sanitized = questions.map(q => {
    if (q.is_premium && !isPremium) {
      return {
        id: q.id, question_text: '🔒 Premium Question — Upgrade to access',
        option_a: null, option_b: null, option_c: null, option_d: null,
        type: q.type, is_premium: 1, difficulty: q.difficulty,
        order_num: q.order_num, media_url: null, locked: true,
      };
    }
    return { ...q, locked: false };
  });

  res.json({ chapter, questions: sanitized, is_student_premium: isPremium });
});

router.post('/subjects', async (req, res) => {
  const { class_level, name, icon, color } = req.body;
  if (!class_level || !name) return res.status(400).json({ error: 'class_level and name required' });
  const db = await getDb();
  const max = get(db, 'SELECT MAX(order_num) as m FROM subjects WHERE class_level = ?', [class_level]);
  const id = insert(db, 'INSERT INTO subjects (class_level, name, icon, color, order_num) VALUES (?, ?, ?, ?, ?)',
    [class_level, name, icon || 'book', color || '#1B3A6B', (max?.m ?? 0) + 1]);
  saveDb();
  res.status(201).json({ id });
});

router.post('/chapters', async (req, res) => {
  const { subject_id, name } = req.body;
  if (!subject_id || !name) return res.status(400).json({ error: 'subject_id and name required' });
  const db = await getDb();
  const max = get(db, 'SELECT MAX(order_num) as m FROM chapters WHERE subject_id = ?', [subject_id]);
  const id = insert(db, 'INSERT INTO chapters (subject_id, name, order_num) VALUES (?, ?, ?)',
    [subject_id, name, (max?.m ?? 0) + 1]);
  saveDb();
  res.status(201).json({ id });
});

router.post('/questions', async (req, res) => {
  const { chapter_id, question_text, option_a, option_b, option_c, option_d, correct_answer, type, is_premium, difficulty } = req.body;
  if (!chapter_id || !question_text || !correct_answer) {
    return res.status(400).json({ error: 'chapter_id, question_text, and correct_answer required' });
  }
  const db = await getDb();
  const max = get(db, 'SELECT MAX(order_num) as m FROM questions WHERE chapter_id = ?', [chapter_id]);
  const isPremiumFlag = (max?.m ?? 0) >= 20 ? 1 : (is_premium ?? 0);
  const id = insert(db, `
    INSERT INTO questions (chapter_id, question_text, option_a, option_b, option_c, option_d, correct_answer, type, is_premium, difficulty, order_num)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [chapter_id, question_text, option_a, option_b, option_c, option_d, correct_answer, type || 'mcq', isPremiumFlag, difficulty || 'medium', (max?.m ?? 0) + 1]
  );
  saveDb();
  res.status(201).json({ id });
});

router.delete('/questions/:id', async (req, res) => {
  const db = await getDb();
  run(db, 'DELETE FROM questions WHERE id = ?', [req.params.id]);
  saveDb();
  res.json({ success: true });
});

module.exports = router;
