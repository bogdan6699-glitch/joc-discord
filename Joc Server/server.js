const express = require('express');
const { Pool } = require('pg');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;

// Configurare conexiune Bază de Date PostgreSQL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Ruta principala
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// API: Preluare date jucător
app.get('/api/jucator/:discord_id', async (req, res) => {
  try {
    const { discord_id } = req.params;
    const result = await pool.query('SELECT * FROM jucatori WHERE discord_id = $1', [discord_id]);
    
    if (result.rows.length > 0) {
      res.json({ success: true, jucator: result.rows[0] });
    } else {
      res.json({ success: true, jucator: { incercari_ramase: 3, scor_total: 0 } });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Eroare la preluarea datelor.' });
  }
});

// API: Salvare Scor
app.post('/api/salveaza-scor', async (req, res) => {
  const { discord_id, nume_discord, scorObtinut } = req.body;

  try {
    let userRes = await pool.query('SELECT * FROM jucatori WHERE discord_id = $1', [discord_id]);
    
    if (userRes.rows.length === 0) {
      await pool.query(
        'INSERT INTO jucatori (discord_id, nume_discord, scor_total, incercari_ramase) VALUES ($1, $2, $3, $4)',
        [discord_id, nume_discord, scorObtinut, 2]
      );
      return res.json({ success: true, message: 'Scor salvat!', incercari_ramase: 2 });
    }

    const jucator = userRes.rows[0];

    if (jucator.incercari_ramase <= 0) {
      return res.json({ success: false, message: 'Nu mai ai încercări rămase săptămâna aceasta!' });
    }

    const noiIncercari = jucator.incercari_ramase - 1;
    const noulScorTotal = jucator.scor_total + scorObtinut;

    await pool.query(
      'UPDATE jucatori SET scor_total = $1, incercari_ramase = $2, nume_discord = $3 WHERE discord_id = $4',
      [noulScorTotal, noiIncercari, nume_discord, discord_id]
    );

    res.json({
      success: true,
      message: `Scor salvat! Încercări rămase: ${noiIncercari}`,
      incercari_ramase: noiIncercari
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Eroare la salvarea scorului.' });
  }
});

// API: Leaderboard
app.get('/api/leaderboard', async (req, res) => {
  try {
    const result = await pool.query('SELECT nume_discord, scor_total FROM jucatori ORDER BY scor_total DESC LIMIT 10');
    res.json({ success: true, leaderboard: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Eroare la preluarea clasamentului.' });
  }
});

// API Admin: Resetare Încercări (protejat prin verificarea ID-ului)
app.post('/api/admin/reset-incercari', async (req, res) => {
  const { admin_discord_id } = req.body;
  
  // Înlocuiește string-ul de mai jos cu ID-ul tău real de Discord
  const MY_DISCORD_ID = '1215302644357140482';

  if (admin_discord_id !== MY_DISCORD_ID) {
    return res.status(403).json({ success: false, message: 'Acces interzis!' });
  }

  try {
    await pool.query('UPDATE jucatori SET incercari_ramase = 3');
    res.json({ success: true, message: 'Toate încercările au fost resetate la 3 pentru toți jucătorii!' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Eroare la resetarea bazei de date.' });
  }
});

app.listen(port, () => {
  console.log(`Serverul ruleaza pe portul ${port}`);
});
