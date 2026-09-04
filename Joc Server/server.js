const express = require('express');
const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname)));
app.use(express.static(path.join(__dirname, 'public')));

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

function getSaptamanaCurenta() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 4 - (d.getDay() || 7));
  const yearStart = new Date(d.getFullYear(), 0, 1);
  const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getFullYear()}-W${weekNo}`;
}

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

app.get('/login-discord', (req, res) => {
  const redirectUri = encodeURIComponent(process.env.DISCORD_REDIRECT_URI);
  const url = `https://discord.com/api/oauth2/authorize?client_id=${process.env.DISCORD_CLIENT_ID}&redirect_uri=${redirectUri}&response_type=code&scope=identify`;
  res.redirect(url);
});

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

    const userData = userResponse.data;
    res.redirect(`/?discord_id=${userData.id}&username=${encodeURIComponent(userData.username)}`);
  } catch (error) {
    console.error("Eroare OAuth:", error.response ? error.response.data : error.message);
    res.send("A apărut o eroare la conectarea cu Discord.");
  }
});

app.get('/api/jucator/:id', async (req, res) => {
  const discord_id = String(req.params.id);
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

app.get('/api/leaderboard', async (req, res) => {
  const saptamana = getSaptamanaCurenta();

  try {
    const { data: topJucatori, error } = await supabase
      .from('jucatori')
      .select('nume_discord, scor_total')
      .eq('saptamana_curenta', saptamana)
      .order('scor_total', { ascending: false })
      .limit(10);

    if (error) throw error;

    res.json({ success: true, leaderboard: topJucatori || [] });
  } catch (err) {
    console.error("Eroare clasament:", err);
    res.status(500).json({ success: false, message: "Eroare clasament." });
  }
});

app.post('/api/salveaza-scor', async (req, res) => {
  const { discord_id, nume_discord, scorObtinut } = req.body;

  if (!discord_id) {
    return res.status(400).json({ success: false, message: "Utilizator neautentificat sau ID lipsă!" });
  }

  const cleanDiscordId = String(discord_id);
  const saptamana = getSaptamanaCurenta();

  try {
    let { data: jucator } = await supabase
      .from('jucatori')
      .select('*')
      .eq('discord_id', cleanDiscordId)
      .maybeSingle();

    if (!jucator || jucator.saptamana_curenta !== saptamana) {
      jucator = {
        discord_id: cleanDiscordId,
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
      discord_id: cleanDiscordId,
      nume_discord: nume_discord || jucator.nume_discord,
      incercari_ramase: jucator.incercari_ramase - 1,
      scor_total: jucator.scor_total + (Number(scorObtinut) || 0),
      saptamana_curenta: saptamana
    };

    const { data: jucatorExistent } = await supabase
      .from('jucatori')
      .select('discord_id')
      .eq('discord_id', cleanDiscordId)
      .maybeSingle();

    let saveError;

    if (jucatorExistent) {
      const { error } = await supabase
        .from('jucatori')
        .update(dateActualizate)
        .eq('discord_id', cleanDiscordId);
      saveError = error;
    } else {
      const { error } = await supabase
        .from('jucatori')
        .insert([dateActualizate]);
      saveError = error;
    }

    if (saveError) {
      console.error("Eroare Supabase Detaliata:", saveError);
      return res.status(500).json({ success: false, message: `Eroare Supabase: ${saveError.message}` });
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
