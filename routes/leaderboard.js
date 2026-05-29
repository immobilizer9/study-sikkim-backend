const express = require('express');
const { getDb, get, all } = require('../database');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

router.get('/global/top', authMiddleware, async (req, res) => {
  const db = await getDb();
  const rows = all(db, `
    SELECT st.id, st.name, st.school, st.class_level,
           SUM(qa.score) as total_score,
           COUNT(qa.id) as quizzes_taken,
           ROUND(AVG(CAST(qa.score AS REAL)/CAST(qa.total AS REAL)*100), 1) as avg_percentage
    FROM quiz_attempts qa
    JOIN students st ON st.id = qa.student_id
    GROUP BY st.id
    ORDER BY total_score DESC, avg_percentage DESC
    LIMIT 100
  `);
  res.json({ leaderboard: rows.map((r, i) => ({ ...r, rank: i + 1 })) });
});

router.get('/:classLevel', authMiddleware, async (req, res) => {
  const classLevel = parseInt(req.params.classLevel);
  if (isNaN(classLevel) || classLevel < 3 || classLevel > 12) {
    return res.status(400).json({ error: 'Invalid class level' });
  }
  const db = await getDb();
  const rows = all(db, `
    SELECT st.id, st.name, st.school,
           SUM(qa.score) as total_score,
           SUM(qa.total) as total_questions,
           COUNT(qa.id) as quizzes_taken,
           ROUND(AVG(CAST(qa.score AS REAL)/CAST(qa.total AS REAL)*100), 1) as avg_percentage
    FROM quiz_attempts qa
    JOIN students st ON st.id = qa.student_id
    WHERE st.class_level = ?
    GROUP BY st.id
    ORDER BY total_score DESC, avg_percentage DESC
    LIMIT 50
  `, [classLevel]);

  const ranked = rows.map((r, i) => ({ ...r, rank: i + 1 }));
  const myRankIndex = ranked.findIndex(r => r.id === req.student.id);

  res.json({ leaderboard: ranked, my_rank: myRankIndex >= 0 ? myRankIndex + 1 : null });
});

module.exports = router;
