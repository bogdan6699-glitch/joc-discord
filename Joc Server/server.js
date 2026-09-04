const express = require('express');
const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname)));
app.use(express.static(path.join(__dirname, 'public')));

// Conectare Supabase
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

let activeUsers = {};

function getSaptamanaCurenta() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 4 - (d.getDay() || 7));
  const yearStart = new Date(d.getFullYear(), 0, 1);
  const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getFullYear()}-W${weekNo}`;
}

// Ruta principala HTML
app.get('/', (req, res) => {
  const rootPath = path.join(__dirname, 'index.html');
  const publicPath = path.join(__dirname, 'public', 'index.html');

  if (fs.existsSync(rootPath)) {
    res.sendFile(rootPath);
  } else if (fs.existsSync(publicPath)) {
    res.sendFile(publicPath);
  } else {
    res.status(404).send("Fișierul index.html nu a fost găsit!");
  }
});

// Autentificare Discord
app.get('/login-discord', (req, res) => {
  const redirectUri = encodeURIComponent(process.env.DISCORD_REDIRECT_URI);
  const url = `https://discord.com/api/oauth2/authorize?client_id=${process.env.DISCORD_CLIENT_ID}&redirect_uri=${redirectUri}&response_type=code&scope=identify`;
  res.redirect(url);
});

// Callback Discord
app.get('/auth/discord/callback', async (req, res) => {
  const code = req.query.code;
  if (!code) return res.send("Eroare la autentificare.");

  try {
    const tokenResponse = await axios.post('https://discord.com/api/oauth2/token', new URLSearchParams({
      client_id: process.env.DISCORD_CLIENT_ID,
      client_secret: process.env.DISCORD_CLIENT_SECRET,
      grant_type: 'authorization_code',
      code: code,
      redirect_uri: process.env.DISCORD_REDIRECT_URI
    }), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });

    const userResponse = await axios.get('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${tokenResponse.data.access_token}` }
    });

    activeUsers['current'] = userResponse.data;
    res.redirect('/');
  } catch (error) {
    console.error("Eroare OAuth:", error.response ? error.response.data : error.message);
    res.send("A apărut o eroare la conectarea cu Discord.");
  }
});

// User Curent
app.get('/api/user-curent', (req, res) => {
  if (activeUsers['current']) {
    res.json(activeUsers['current']);
  } else {
    res.status(401).json({ error: "Neautentificat" });
  }
});

// Date Jucator
app.get('/api/jucator/:id', async (req, res) => {
  const discord_id = req.params.id;
  const saptamana = getSaptamanaCurenta();

  const { data: jucator } = await supabase
    .from('jucatori')
    .select('*')
    .eq('discord_id', discord_id)
    .maybeSingle();

  if (!jucator || jucator.saptamana_curenta !== saptamana) {
    return res.json({
      success: true,
      jucator: { scor_total: 0, incercari_ramase: 3 }
    });
  }

  res.json({ success: true, jucator });
});

// Salvare Scor
app.post('/api/salveaza-scor', async (req, res) => {
  const { discord_id, nume_discord, scorObtinut } = req.body;

  if (!discord_id) {
    return res.status(400).json({ success: false, message: "Utilizator neautentificat!" });
  }

  const saptamana = getSaptamanaCurenta();

  try {
    let { data: jucator } = await supabase
      .from('jucatori')
      .select('*')
      .eq('discord_id', discord_id)
      .maybeSingle();

    if (!jucator || jucator.saptamana_curenta !== saptamana) {
      jucator = {
        discord_id: discord_id,
        nume_discord: nume_discord || 'Jucator',
        incercari_ramase: 3,
        scor_total: 0,
        saptamana_curenta: saptamana
      };
    }

    if (jucator.incercari_ramase <= 0) {
      return res.json({
        success: false,
        message: "Ai epuizat cele 3 încercări pentru această săptămână!",
        scor_total: jucator.scor_total,
        incercari_ramase: 0
      });
    }

    const dateActualizate = {
      discord_id: jucator.discord_id,
      nume_discord: nume_discord || jucator.nume_discord,
      incercari_ramase: jucator.incercari_ramase - 1,
      scor_total: jucator.scor_total + (Number(scorObtinut) || 0),
      saptamana_curenta: saptamana
    };

    const { error: saveError } = await supabase
      .from('jucatori')
      .upsert(dateActualizate, { onConflict: 'discord_id' });

    if (saveError) {
      console.error("Eroare Supabase:", saveError);
      return res.status(500).json({ success: false, message: "Eroare la salvarea în baza de date." });
    }

    return res.json({
      success: true,
      message: "Scorul a fost adăugat cu succes!",
      scor_total: dateActualizate.scor_total,
      incercari_ramase: dateActualizate.incercari_ramase
    });

  } catch (err) {
    console.error("Eroare server:", err);
    return res.status(500).json({ success: false, message: "Eroare internă de server." });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Serverul rulează pe portul ${PORT}`));
