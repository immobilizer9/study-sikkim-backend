const express = require('express');
const crypto = require('crypto');
const { getDb, get, all, run, insert, saveDb } = require('../database');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

const RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID || 'rzp_test_YOUR_KEY_ID';
const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || 'YOUR_KEY_SECRET';

const PLANS = {
  monthly:  { amount: 9900,   label: '1 Month Premium',  duration_days: 30 },
  yearly:   { amount: 79900,  label: '1 Year Premium',   duration_days: 365 },
  lifetime: { amount: 149900, label: 'Lifetime Premium', duration_days: null },
};

router.post('/create-order', authMiddleware, async (req, res) => {
  const { plan } = req.body;
  if (!PLANS[plan]) return res.status(400).json({ error: 'Invalid plan. Choose monthly, yearly, or lifetime.' });
  const selectedPlan = PLANS[plan];

  try {
    const orderId = `order_${Date.now()}_${req.student.id}`;
    const db = await getDb();
    insert(db,
      'INSERT INTO payments (student_id, razorpay_order_id, amount, plan, status) VALUES (?, ?, ?, ?, ?)',
      [req.student.id, orderId, selectedPlan.amount, plan, 'pending']
    );
    saveDb();
    res.json({ order_id: orderId, amount: selectedPlan.amount, currency: 'INR', key_id: RAZORPAY_KEY_ID, plan, label: selectedPlan.label });
  } catch {
    res.status(500).json({ error: 'Could not create payment order' });
  }
});

router.post('/verify', authMiddleware, async (req, res) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature, plan } = req.body;
  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    return res.status(400).json({ error: 'Missing payment verification data' });
  }

  const generated = crypto
    .createHmac('sha256', RAZORPAY_KEY_SECRET)
    .update(`${razorpay_order_id}|${razorpay_payment_id}`)
    .digest('hex');

  if (generated !== razorpay_signature) {
    return res.status(400).json({ error: 'Payment verification failed. Signature mismatch.' });
  }

  const selectedPlan = PLANS[plan] || PLANS.monthly;
  let expiresAt = null;
  if (selectedPlan.duration_days) {
    const d = new Date();
    d.setDate(d.getDate() + selectedPlan.duration_days);
    expiresAt = d.toISOString();
  }

  const db = await getDb();
  run(db,
    "UPDATE payments SET razorpay_payment_id = ?, razorpay_signature = ?, status = 'paid' WHERE razorpay_order_id = ?",
    [razorpay_payment_id, razorpay_signature, razorpay_order_id]
  );
  run(db, 'UPDATE students SET is_premium = 1, premium_expires_at = ? WHERE id = ?', [expiresAt, req.student.id]);
  saveDb();

  const student = get(db, 'SELECT id, name, email, phone, school, class_level, is_premium, premium_expires_at FROM students WHERE id = ?', [req.student.id]);
  res.json({ success: true, message: `Premium activated! ${selectedPlan.label}.`, student });
});

router.post('/verify-test', authMiddleware, async (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(403).json({ error: 'Not available in production' });
  }
  const { plan } = req.body;
  const selectedPlan = PLANS[plan] || PLANS.monthly;
  let expiresAt = null;
  if (selectedPlan.duration_days) {
    const d = new Date();
    d.setDate(d.getDate() + selectedPlan.duration_days);
    expiresAt = d.toISOString();
  }
  const db = await getDb();
  run(db, 'UPDATE students SET is_premium = 1, premium_expires_at = ? WHERE id = ?', [expiresAt, req.student.id]);
  saveDb();
  const student = get(db, 'SELECT id, name, email, phone, school, class_level, is_premium, premium_expires_at FROM students WHERE id = ?', [req.student.id]);
  res.json({ success: true, message: 'Test premium activated', student });
});

router.get('/status', authMiddleware, async (req, res) => {
  const db = await getDb();
  const student = get(db, 'SELECT is_premium, premium_expires_at FROM students WHERE id = ?', [req.student.id]);
  const payments = all(db, 'SELECT * FROM payments WHERE student_id = ? ORDER BY created_at DESC LIMIT 10', [req.student.id]);
  res.json({ is_premium: student.is_premium, premium_expires_at: student.premium_expires_at, payments });
});

module.exports = router;
