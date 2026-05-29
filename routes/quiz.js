const express = require('express');
const { getDb, get, all, insert, saveDb } = require('../database');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

router.post('/submit', authMiddleware, async (req, res) => {
  const { chapter_id, answers, time_taken_seconds } = req.body;
  if (!chapter_id || !answers || !Array.isArray(answers)) {
    return res.status(400).json({ error: 'chapter_id and answers array required' });
  }

  const db = await getDb();
  const student = get(db, 'SELECT is_premium, premium_expires_at FROM students WHERE id = ?', [req.student.id]);
  const isPremium = student.is_premium === 1 && (!student.premium_expires_at || new Date(student.premium_expires_at) > new Date());

  const questions = all(db, 'SELECT id, correct_answer, is_premium FROM questions WHERE chapter_id = ?', [chapter_id]);

  let score = 0, total = 0;
  const details = [];

  for (const answer of answers) {
    const question = questions.find(q => q.id === answer.question_id);
    if (!question) continue;
    if (question.is_premium && !isPremium) continue;
    total++;
    const isCorrect = answer.selected_answer &&
      answer.selected_answer.trim().toUpperCase() === question.correct_answer.toUpperCase();
    if (isCorrect) score++;
    details.push({
      question_id: question.id,
      selected: answer.selected_answer,
      correct: question.correct_answer,
      is_correct: isCorrect,
    });
  }

  const percentage = total > 0 ? Math.round((score / total) * 100) : 0;

  insert(db,
    'INSERT INTO quiz_attempts (student_id, chapter_id, score, total, time_taken_seconds, answers_json) VALUES (?, ?, ?, ?, ?, ?)',
    [req.student.id, chapter_id, score, total, time_taken_seconds || 0, JSON.stringify(details)]
  );
  saveDb();

  res.json({ score, total, percentage, details });
});

router.get('/history', authMiddleware, async (req, res) => {
  const db = await getDb();
  const attempts = all(db, `
    SELECT qa.id, qa.score, qa.total, qa.time_taken_seconds, qa.completed_at,
           ch.name as chapter_name, s.name as subject_name
    FROM quiz_attempts qa
    JOIN chapters ch ON ch.id = qa.chapter_id
    JOIN subjects s ON s.id = ch.subject_id
    WHERE qa.student_id = ?
    ORDER BY qa.completed_at DESC
    LIMIT 50
  `, [req.student.id]);
  res.json({ attempts });
});

router.get('/stats', authMiddleware, async (req, res) => {
  const db = await getDb();
  const stats = get(db, `
    SELECT
      COUNT(*) as total_quizzes,
      SUM(score) as total_correct,
      SUM(total) as total_attempted,
      AVG(CAST(score AS REAL)/CAST(total AS REAL)*100) as avg_percentage,
      MAX(CAST(score AS REAL)/CAST(total AS REAL)*100) as best_percentage
    FROM quiz_attempts
    WHERE student_id = ?
  `, [req.student.id]);
  res.json({ stats });
});

module.exports = router;
