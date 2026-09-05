const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const path = require('path');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

// Configurare Client Supabase
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Ruta principala
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Ruta OAuth Discord
app.get('/login-discord', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Ruta Callback Discord
app.get('/auth/discord/callback', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
// API: Preluare date jucător
app.get('/api/jucator/:discord_id', async (req, res) => {
  try {
    const { discord_id } = req.params;
    const { data, error } = await supabase
      .from('jucatori')
      .select('*')
      .eq('discord_id', discord_id)
      .single();

    if (error && error.code !== 'PGRST116') {
      throw error;
    }

    if (data) {
      res.json({ success: true, jucator: data });
    } else {
      res.json({ success: true, jucator: { incercari_ramase: 3, scor_total: 0 } });
    }
  } catch (err) {
    console.error("Eroare jucator:", err);
    res.status(500).json({ success: false, message: 'Eroare la preluarea datelor.' });
  }
});

// API: Salvare Scor
app.post('/api/salveaza-scor', async (req, res) => {
  const { discord_id, nume_discord, scorObtinut } = req.body;

  try {
    const { data: jucator, error: fetchErr } = await supabase
      .from('jucatori')
      .select('*')
      .eq('discord_id', discord_id)
      .single();

    if (fetchErr && fetchErr.code !== 'PGRST116') throw fetchErr;

    if (!jucator) {
      // Jucator nou
      await supabase
        .from('jucatori')
        .insert([{
          discord_id: discord_id,
          nume_discord: nume_discord,
          scor_total: scorObtinut,
          incercari_ramase: 2
        }]);

      return res.json({ success: true, message: 'Scor salvat!', incercari_ramase: 2 });
    }

    if (jucator.incercari_ramase <= 0) {
      return res.json({ success: false, message: 'Nu mai ai încercări rămase săptămâna aceasta!' });
    }

    const noiIncercari = jucator.incercari_ramase - 1;
    const noulScorTotal = jucator.scor_total + scorObtinut;

    await supabase
      .from('jucatori')
      .update({
        scor_total: noulScorTotal,
        incercari_ramase: noiIncercari,
        nume_discord: nume_discord
      })
      .eq('discord_id', discord_id);

    res.json({
      success: true,
      message: `Scor salvat! Încercări rămase: ${noiIncercari}`,
      incercari_ramase: noiIncercari
    });
  } catch (err) {
    console.error("Eroare salvare scor:", err);
    res.status(500).json({ success: false, message: 'Eroare la salvarea scorului.' });
  }
});

// API: Leaderboard
app.get('/api/leaderboard', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('jucatori')
      .select('nume_discord, scor_total')
      .order('scor_total', { ascending: false })
      .limit(10);

    if (error) throw error;

    res.json({ success: true, leaderboard: data || [] });
  } catch (err) {
    console.error("Eroare leaderboard:", err);
    res.status(500).json({ success: false, message: 'Eroare la preluarea clasamentului.' });
  }
});

// RUTA SECRETĂ DE RESETARE ÎNCERCĂRI PENTRU SUPABASE
app.get('/admin/reset-incercari-reseteaza1123', async (req, res) => {
  try {
    // Resetează coloana incercari_ramase la 3 pentru TOATE rândurile
    const { error } = await supabase
      .from('jucatori')
      .update({ incercari_ramase: 3 })
      .neq('discord_id', '0'); // Neq '0' actualizează tot din tabel

    if (error) throw error;

    res.send('<h1 style="color: #00ff88; font-family: sans-serif; text-align: center; margin-top: 50px; background-color: #080813; padding: 20px;">✅ Încercările au fost resetate cu succes la 3/3 în Supabase!</h1>');
  } catch (err) {
    console.error("Eroare resetare admin:", err);
    res.status(500).send('<h1 style="color: #ff4d4d; font-family: sans-serif; text-align: center; margin-top: 50px; background-color: #080813; padding: 20px;">❌ Eroare la resetarea bazei de date! Verifică log-urile.</h1>');
  }
});

app.listen(port, () => {
  console.log(`Serverul ruleaza pe portul ${port}`);
});
