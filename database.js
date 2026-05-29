const initSqlJs = require('sql.js/dist/sql-asm.js');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');

const BUNDLE_DB_PATH = path.join(__dirname, 'study_sikkim.db');
// On Vercel the filesystem is read-only; use /tmp for writes
const DB_PATH = process.env.VERCEL
  ? '/tmp/study_sikkim.db'
  : BUNDLE_DB_PATH;

let db = null;

async function getDb() {
  if (db) return db;
  const SQL = await initSqlJs();
  // On Vercel: seed /tmp from the bundled DB on first cold start
  if (process.env.VERCEL && !fs.existsSync(DB_PATH) && fs.existsSync(BUNDLE_DB_PATH)) {
    fs.copyFileSync(BUNDLE_DB_PATH, DB_PATH);
  }
  if (fs.existsSync(DB_PATH)) {
    const buf = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buf);
  } else {
    db = new SQL.Database();
  }
  db.run('PRAGMA foreign_keys = ON');
  return db;
}

function saveDb() {
  if (!db) return;
  const data = db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

// Helper: run a statement (INSERT / UPDATE / DELETE / CREATE)
function run(database, sql, params = []) {
  database.run(sql, params);
}

// Helper: get a single row
function get(database, sql, params = []) {
  const stmt = database.prepare(sql);
  stmt.bind(params);
  if (stmt.step()) {
    const row = stmt.getAsObject();
    stmt.free();
    return row;
  }
  stmt.free();
  return null;
}

// Helper: get all rows
function all(database, sql, params = []) {
  const results = [];
  const stmt = database.prepare(sql);
  stmt.bind(params);
  while (stmt.step()) {
    results.push(stmt.getAsObject());
  }
  stmt.free();
  return results;
}

// Helper: run INSERT and return last insert id
function insert(database, sql, params = []) {
  database.run(sql, params);
  const row = get(database, 'SELECT last_insert_rowid() as id');
  return row ? row.id : null;
}

async function initSchema() {
  const database = await getDb();
  database.run(`
    CREATE TABLE IF NOT EXISTS students (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      phone TEXT NOT NULL,
      school TEXT NOT NULL,
      class_level INTEGER NOT NULL,
      password_hash TEXT NOT NULL,
      is_premium INTEGER DEFAULT 0,
      premium_expires_at TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  database.run(`
    CREATE TABLE IF NOT EXISTS subjects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      class_level INTEGER NOT NULL,
      name TEXT NOT NULL,
      icon TEXT DEFAULT 'book',
      color TEXT DEFAULT '#1B3A6B',
      order_num INTEGER DEFAULT 0
    )
  `);
  database.run(`
    CREATE TABLE IF NOT EXISTS chapters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      subject_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      order_num INTEGER DEFAULT 0
    )
  `);
  database.run(`
    CREATE TABLE IF NOT EXISTS questions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chapter_id INTEGER NOT NULL,
      question_text TEXT NOT NULL,
      option_a TEXT,
      option_b TEXT,
      option_c TEXT,
      option_d TEXT,
      correct_answer TEXT NOT NULL,
      type TEXT DEFAULT 'mcq',
      media_url TEXT,
      is_premium INTEGER DEFAULT 0,
      difficulty TEXT DEFAULT 'medium',
      order_num INTEGER DEFAULT 0
    )
  `);
  database.run(`
    CREATE TABLE IF NOT EXISTS quiz_attempts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id INTEGER NOT NULL,
      chapter_id INTEGER NOT NULL,
      score INTEGER NOT NULL,
      total INTEGER NOT NULL,
      time_taken_seconds INTEGER,
      answers_json TEXT,
      completed_at TEXT DEFAULT (datetime('now'))
    )
  `);
  database.run(`
    CREATE TABLE IF NOT EXISTS payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id INTEGER NOT NULL,
      razorpay_order_id TEXT,
      razorpay_payment_id TEXT,
      razorpay_signature TEXT,
      amount INTEGER NOT NULL,
      currency TEXT DEFAULT 'INR',
      plan TEXT DEFAULT 'monthly',
      status TEXT DEFAULT 'pending',
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  database.run(`
    CREATE TABLE IF NOT EXISTS admin_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL
    )
  `);
  database.run(`
    CREATE TABLE IF NOT EXISTS banners (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      subtitle TEXT,
      image_url TEXT,
      action_type TEXT DEFAULT 'none',
      action_value TEXT,
      bg_color TEXT DEFAULT '#1B3A6B',
      text_color TEXT DEFAULT '#ffffff',
      is_active INTEGER DEFAULT 1,
      order_num INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  database.run(`
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);
  database.run(`
    CREATE TABLE IF NOT EXISTS announcements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      type TEXT DEFAULT 'info',
      is_active INTEGER DEFAULT 1,
      target_class INTEGER,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  saveDb();
}

async function seedData() {
  const database = await getDb();
  const count = get(database, 'SELECT COUNT(*) as c FROM subjects');
  if (count && count.c > 0) return;

  const adminHash = await bcrypt.hash('admin123', 10);
  run(database, 'INSERT OR IGNORE INTO admin_users (username, password_hash) VALUES (?, ?)', ['admin', adminHash]);

  const subjectData = [
    { classes: [3, 4, 5], subjects: [
      { name: 'Mathematics', icon: 'calculator', color: '#1B3A6B' },
      { name: 'Environmental Science', icon: 'leaf', color: '#27AE60' },
      { name: 'English', icon: 'book-open', color: '#E8800A' },
      { name: 'Hindi', icon: 'pen-tool', color: '#8B5CF6' },
    ]},
    { classes: [6, 7, 8], subjects: [
      { name: 'Mathematics', icon: 'calculator', color: '#1B3A6B' },
      { name: 'Science', icon: 'zap', color: '#27AE60' },
      { name: 'Social Science', icon: 'globe', color: '#E8800A' },
      { name: 'English', icon: 'book-open', color: '#E74C3C' },
      { name: 'Hindi', icon: 'pen-tool', color: '#8B5CF6' },
    ]},
    { classes: [9, 10], subjects: [
      { name: 'Mathematics', icon: 'calculator', color: '#1B3A6B' },
      { name: 'Physics', icon: 'zap', color: '#27AE60' },
      { name: 'Chemistry', icon: 'thermometer', color: '#E8800A' },
      { name: 'Biology', icon: 'heart', color: '#E74C3C' },
      { name: 'Social Science', icon: 'globe', color: '#F59E0B' },
      { name: 'English', icon: 'book-open', color: '#8B5CF6' },
    ]},
    { classes: [11, 12], subjects: [
      { name: 'Mathematics', icon: 'calculator', color: '#1B3A6B' },
      { name: 'Physics', icon: 'zap', color: '#27AE60' },
      { name: 'Chemistry', icon: 'thermometer', color: '#E8800A' },
      { name: 'Biology', icon: 'heart', color: '#E74C3C' },
      { name: 'Accountancy', icon: 'trending-up', color: '#F59E0B' },
      { name: 'Economics', icon: 'bar-chart', color: '#0891B2' },
      { name: 'English', icon: 'book-open', color: '#8B5CF6' },
    ]},
  ];

  const sampleChapters = {
    'Mathematics': ['Number System', 'Algebra', 'Geometry', 'Mensuration', 'Statistics'],
    'Science': ['Matter in Our Surroundings', 'Cell: The Unit of Life', 'Motion', 'Force & Laws of Motion', 'Gravitation'],
    'Physics': ['Physical World', 'Units and Measurements', 'Motion in a Straight Line', 'Laws of Motion', 'Work, Energy & Power'],
    'Chemistry': ['Some Basic Concepts', 'Structure of Atom', 'Periodic Table', 'Chemical Bonding', 'States of Matter'],
    'Biology': ['The Living World', 'Biological Classification', 'Plant Kingdom', 'Animal Kingdom', 'Cell Structure'],
    'Social Science': ['India — Size and Location', 'Physical Features of India', 'Drainage', 'Climate', 'Natural Vegetation'],
    'Environmental Science': ['Food: Where Does It Come From?', 'Components of Food', 'Fibre to Fabric', 'Sorting Materials', 'Separation of Substances'],
    'English': ['A Letter to God', 'Two Stories About Flying', 'A Triumph of Surgery', 'The Midnight Visitor', 'A Question of Trust'],
    'Hindi': ['साखी', 'मेघ आए', 'बिहारी के दोहे', 'कबीर की साखियाँ', 'मीरा के पद'],
    'Accountancy': ['Introduction to Accounting', 'Theory Base of Accounting', 'Recording of Transactions', 'Trial Balance', 'Financial Statements'],
    'Economics': ['Indian Economy on the Eve of Independence', 'Indian Economy 1950-1990', 'Liberalisation Privatisation Globalisation', 'Poverty', 'Human Capital'],
  };

  const mathQ = [
    ['What is the value of π (pi) approximately?', '3.14', '3.41', '2.14', '4.13', 'A', 'mcq', 0, 'easy'],
    ['Which of the following is a prime number?', '4', '6', '7', '9', 'C', 'mcq', 0, 'easy'],
    ['What is 15% of 200?', '25', '30', '35', '20', 'B', 'mcq', 0, 'easy'],
    ['What is the square root of 144?', '11', '12', '13', '14', 'B', 'mcq', 0, 'easy'],
    ['What is the sum of angles in a triangle?', '90°', '180°', '270°', '360°', 'B', 'mcq', 0, 'easy'],
    ['What is 2³?', '6', '8', '9', '12', 'B', 'mcq', 0, 'easy'],
    ['What is the LCM of 4 and 6?', '8', '12', '16', '24', 'B', 'mcq', 0, 'medium'],
    ['If a = 3, what is 2a + 5?', '9', '10', '11', '12', 'C', 'mcq', 0, 'medium'],
    ['What is the area of a rectangle with length 8 and width 5?', '30', '35', '40', '45', 'C', 'mcq', 0, 'easy'],
    ['Which is the largest prime number less than 20?', '17', '19', '18', '16', 'B', 'mcq', 0, 'medium'],
    ['What is 0.5 as a fraction?', '1/3', '1/4', '1/2', '2/3', 'C', 'mcq', 0, 'easy'],
    ['What is the perimeter of a square with side 7?', '21', '28', '35', '49', 'B', 'mcq', 0, 'easy'],
    ['Solve: 3x = 21, x = ?', '5', '6', '7', '8', 'C', 'mcq', 0, 'easy'],
    ['What is the HCF of 12 and 18?', '3', '4', '6', '9', 'C', 'mcq', 0, 'medium'],
    ['What is 5! (5 factorial)?', '25', '60', '120', '720', 'C', 'mcq', 0, 'medium'],
    ['What is the slope of a horizontal line?', 'Undefined', '1', '0', '-1', 'C', 'mcq', 0, 'medium'],
    ['What is 2/3 + 1/4?', '3/7', '7/12', '11/12', '5/6', 'C', 'mcq', 0, 'medium'],
    ['What is the value of sin 90°?', '0', '1', '-1', '0.5', 'B', 'mcq', 0, 'medium'],
    ['What is the next term: 2, 4, 8, 16, __?', '24', '28', '32', '64', 'C', 'mcq', 0, 'easy'],
    ['What is 100² - 99²?', '1', '99', '100', '199', 'D', 'mcq', 0, 'hard'],
    ['What is the derivative of x²?', 'x', '2x', '2', 'x²', 'B', 'mcq', 1, 'hard'],
    ['What is the integral of 2x?', 'x', 'x² + C', '2x² + C', '2 + C', 'B', 'mcq', 1, 'hard'],
    ['In how many ways can 4 books be arranged?', '16', '24', '48', '256', 'B', 'mcq', 1, 'hard'],
    ['Sum of first 100 natural numbers?', '4950', '5000', '5050', '5100', 'C', 'mcq', 1, 'hard'],
    ['Train at 60 km/h covers 150 km in?', '2 hours', '2.5 hours', '3 hours', '3.5 hours', 'B', 'mcq', 1, 'hard'],
  ];

  const sciQ = [
    ['Chemical formula of water?', 'H2O2', 'H2O', 'HO2', 'H3O', 'B', 'mcq', 0, 'easy'],
    ['Plants absorb during photosynthesis?', 'Oxygen', 'Nitrogen', 'Carbon Dioxide', 'Hydrogen', 'C', 'mcq', 0, 'easy'],
    ['Bones in adult human body?', '196', '206', '216', '226', 'B', 'mcq', 0, 'easy'],
    ['Speed of light in vacuum?', '3×10⁶ m/s', '3×10⁸ m/s', '3×10¹⁰ m/s', '3×10⁴ m/s', 'B', 'mcq', 0, 'medium'],
    ['Red Planet?', 'Venus', 'Jupiter', 'Mars', 'Saturn', 'C', 'mcq', 0, 'easy'],
    ['Powerhouse of the cell?', 'Nucleus', 'Ribosome', 'Mitochondria', 'Chloroplast', 'C', 'mcq', 0, 'easy'],
    ['Newton\'s first law also called?', 'Law of Inertia', 'Law of Gravity', 'Law of Motion', 'Law of Force', 'A', 'mcq', 0, 'medium'],
    ['SI unit of force?', 'Watt', 'Newton', 'Joule', 'Pascal', 'B', 'mcq', 0, 'easy'],
    ['Vitamin from sunlight?', 'Vitamin A', 'Vitamin B', 'Vitamin C', 'Vitamin D', 'D', 'mcq', 0, 'easy'],
    ['Chemical symbol for Gold?', 'Go', 'Gd', 'Au', 'Ag', 'C', 'mcq', 0, 'easy'],
    ['Boiling point of water at sea level?', '90°C', '95°C', '100°C', '105°C', 'C', 'mcq', 0, 'easy'],
    ['Organ that purifies blood?', 'Liver', 'Heart', 'Kidney', 'Lungs', 'C', 'mcq', 0, 'easy'],
    ['Photosynthesis is?', 'Breaking of food', 'Making food using sunlight', 'Digestion', 'Respiration', 'B', 'mcq', 0, 'easy'],
    ['Universal donor blood group?', 'A', 'B', 'AB', 'O', 'D', 'mcq', 0, 'medium'],
    ['Chromosomes in human cell?', '23', '46', '48', '44', 'B', 'mcq', 0, 'medium'],
    ['Atomic number of Carbon?', '6', '8', '12', '14', 'A', 'mcq', 0, 'medium'],
    ['Planet with most moons?', 'Jupiter', 'Saturn', 'Uranus', 'Neptune', 'B', 'mcq', 0, 'medium'],
    ['Unit of electrical resistance?', 'Ampere', 'Volt', 'Ohm', 'Watt', 'C', 'mcq', 0, 'medium'],
    ['Water changing to vapor?', 'Condensation', 'Evaporation', 'Sublimation', 'Precipitation', 'B', 'mcq', 0, 'easy'],
    ['Most of Earth\'s atmosphere?', 'Oxygen', 'Carbon Dioxide', 'Nitrogen', 'Hydrogen', 'C', 'mcq', 0, 'easy'],
    ['Half-life of Carbon-14?', '5370 years', '5730 years', '5930 years', '6000 years', 'B', 'mcq', 1, 'hard'],
    ['Avogadro\'s number?', '6.023×10²³', '6.023×10²⁴', '6.022×10²³', '6.022×10²⁴', 'C', 'mcq', 1, 'hard'],
    ['Particle with no charge?', 'Proton', 'Electron', 'Neutron', 'Positron', 'C', 'mcq', 1, 'hard'],
    ['Formula for kinetic energy?', 'mgh', '½mv²', 'mv', 'Fxd', 'B', 'mcq', 1, 'hard'],
    ['DNA stands for?', 'Deoxyribonucleic Acid', 'Diribonucleic Acid', 'Deoxyribonicle Acid', 'None', 'A', 'mcq', 1, 'hard'],
  ];

  const ssQ = [
    ['Capital of Sikkim?', 'Darjeeling', 'Gangtok', 'Namchi', 'Gyalshing', 'B', 'mcq', 0, 'easy'],
    ['River through Sikkim?', 'Ganga', 'Teesta', 'Brahmaputra', 'Yamuna', 'B', 'mcq', 0, 'easy'],
    ['Sikkim became Indian state in?', '1947', '1975', '1960', '1980', 'B', 'mcq', 0, 'easy'],
    ['Highest peak in Sikkim?', 'Everest', 'Kangchenjunga', 'Nanda Devi', 'K2', 'B', 'mcq', 0, 'easy'],
    ['Sikkim borders which country to north?', 'Nepal', 'Bhutan', 'China', 'Bangladesh', 'C', 'mcq', 0, 'easy'],
    ['Official language of Sikkim?', 'Nepali', 'English', 'Hindi', 'All of above', 'D', 'mcq', 0, 'medium'],
    ['First CM of Sikkim?', 'Nar Bahadur Bhandari', 'Kazi Lhendup Dorjee', 'Pawan Chamling', 'None', 'B', 'mcq', 0, 'medium'],
    ['India\'s national river?', 'Yamuna', 'Ganga', 'Godavari', 'Cauvery', 'B', 'mcq', 0, 'easy'],
    ['Indian Constitution adopted on?', 'Jan 26, 1950', 'Aug 15, 1947', 'Nov 26, 1949', 'Dec 26, 1949', 'C', 'mcq', 0, 'medium'],
    ['Author of India\'s National Anthem?', 'Rabindranath Tagore', 'Bankim Chandra', 'Subhas Chandra', 'Mahatma Gandhi', 'A', 'mcq', 0, 'easy'],
    ['Capital of India?', 'Mumbai', 'Kolkata', 'New Delhi', 'Chennai', 'C', 'mcq', 0, 'easy'],
    ['States in India?', '26', '28', '29', '30', 'B', 'mcq', 0, 'medium'],
    ['Largest state by area?', 'Maharashtra', 'Uttar Pradesh', 'Rajasthan', 'Madhya Pradesh', 'C', 'mcq', 0, 'medium'],
    ['Longest river in India?', 'Ganga', 'Yamuna', 'Godavari', 'Narmada', 'A', 'mcq', 0, 'easy'],
    ['Panchayati Raj relates to?', 'Central government', 'Local self government', 'State government', 'Army', 'B', 'mcq', 0, 'medium'],
    ['First President of India?', 'Jawaharlal Nehru', 'B.R. Ambedkar', 'Rajendra Prasad', 'Sardar Patel', 'C', 'mcq', 0, 'easy'],
    ['Fundamental Right forbidding slavery?', 'Right to Equality', 'Right against Exploitation', 'Right to Freedom', 'Cultural Rights', 'B', 'mcq', 0, 'medium'],
    ['GDP stands for?', 'Gross Domestic Product', 'General Development Plan', 'Growth Domestic Plan', 'None', 'A', 'mcq', 0, 'easy'],
    ['India is in which continent?', 'Africa', 'Europe', 'Asia', 'Australia', 'C', 'mcq', 0, 'easy'],
    ['Tropic of Cancer passes through how many Indian states?', '6', '7', '8', '9', 'C', 'mcq', 0, 'hard'],
    ['Directive Principle of State Policy?', 'Enforceable rights', 'Non-justiciable guidelines', 'Fundamental duties', 'None', 'B', 'mcq', 1, 'hard'],
    ['Author of Discovery of India?', 'Gandhi', 'Nehru', 'Ambedkar', 'Tagore', 'B', 'mcq', 1, 'hard'],
    ['Laissez-faire means?', 'Government intervention', 'Free market economy', 'Mixed economy', 'Socialism', 'B', 'mcq', 1, 'hard'],
    ['73rd Constitutional Amendment relates to?', 'Panchayati Raj', 'Urban bodies', 'Parliament', 'Judiciary', 'A', 'mcq', 1, 'hard'],
    ['Article abolishing untouchability?', 'Article 14', 'Article 15', 'Article 17', 'Article 19', 'C', 'mcq', 1, 'hard'],
  ];

  for (const group of subjectData) {
    for (const classLevel of group.classes) {
      for (let si = 0; si < group.subjects.length; si++) {
        const subj = group.subjects[si];
        const subjId = insert(database,
          'INSERT INTO subjects (class_level, name, icon, color, order_num) VALUES (?, ?, ?, ?, ?)',
          [classLevel, subj.name, subj.icon, subj.color, si]
        );

        const chapNames = sampleChapters[subj.name] || ['Chapter 1', 'Chapter 2', 'Chapter 3'];
        for (let ci = 0; ci < chapNames.length; ci++) {
          const chapId = insert(database,
            'INSERT INTO chapters (subject_id, name, order_num) VALUES (?, ?, ?)',
            [subjId, chapNames[ci], ci]
          );

          let qBank = mathQ;
          if (['Science', 'Physics', 'Chemistry', 'Biology'].includes(subj.name)) qBank = sciQ;
          else if (['Social Science', 'Environmental Science', 'Economics', 'Accountancy'].includes(subj.name)) qBank = ssQ;

          for (let qi = 0; qi < qBank.length; qi++) {
            const [text, a, b, c, d, ans, type, isPremium, diff] = qBank[qi];
            run(database,
              `INSERT INTO questions (chapter_id, question_text, option_a, option_b, option_c, option_d, correct_answer, type, is_premium, difficulty, order_num)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [chapId, text, a, b, c, d, ans, type, isPremium, diff, qi + 1]
            );
          }
        }
      }
    }
  }

  saveDb();
  console.log('Database seeded successfully');
}

async function ensureReady() {
  await initSchema();
  await seedData();
}

module.exports = { getDb, saveDb, run, get, all, insert, ensureReady };
