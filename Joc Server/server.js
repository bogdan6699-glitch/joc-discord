const express = require('express');
const { Pool } = require('pg');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;

// Setază o cheie secretă pentru resetare
const ADMIN_SECRET_KEY = 'SECRET_TA';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// API: Date Jucator
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
      return res.json({ success: false, message: 'Nu mai ai încercări rămase!' });
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
    res.status(500).json({ success: false, message: 'Eroare la salvarea scorului.' });
  }
});

// API: Leaderboard
app.get('/api/leaderboard', async (req, res) => {
  try {
    const result = await pool.query('SELECT nume_discord, scor_total FROM jucatori ORDER BY scor_total DESC LIMIT 10');
    res.json({ success: true, leaderboard: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Eroare la preluarea clasamentului.' });
  }
});

// RUTA SECRETĂ PENTRU RESETARE DIRECT DIN BROWSER
app.get(`/admin/reset-incercari-${ADMIN_SECRET_KEY}`, async (req, res) => {
  try {
    await pool.query('UPDATE jucatori SET incercari_ramase = 3');
    res.send('<h1 style="color: green; font-family: sans-serif; text-align: center; margin-top: 50px;">✅ Încercările au fost resetate cu succes la 3/3 pentru toți jucătorii!</h1>');
  } catch (err) {
    console.error(err);
    res.status(500).send('<h1 style="color: red; font-family: sans-serif; text-align: center; margin-top: 50px;">❌ Eroare la resetarea bazei de date!</h1>');
  }
});

app.listen(port, () => {
  console.log(`Serverul ruleaza pe portul ${port}`);
});
