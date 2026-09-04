const express = require('express');
const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(express.static('public')); // Caută fișierele jocului în folderul "public"

// Conectare la Supabase
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// Funcție care determină săptămâna anului (ex: 2026-W36)
function getSaptamanaCurenta() {
  const acum = new Date();
  const inceputAn = new Date(acum.getFullYear(), 0, 1);
  const zile = Math.floor((acum - inceputAn) / (24 * 60 * 60 * 1000));
  const numarSaptamana = Math.ceil((zile + inceputAn.getDay() + 1) / 7);
  return `${acum.getFullYear()}-W${numarSaptamana}`;
}

// 1. Pasul de Autentificare Discord
app.get('/login-discord', (req, res) => {
  const url = `https://discord.com/api/oauth2/authorize?client_id=${process.env.DISCORD_CLIENT_ID}&redirect_uri=${encodeURIComponent(process.env.DISCORD_REDIRECT_URI)}&response_type=code&scope=identify`;
  res.redirect(url);
});

// 2. Callback-ul de la Discord (Preluare nume și ID automat)
app.get('/auth/discord/callback', async (req, res) => {
  const code = req.query.code;
  if (!code) return res.send("Eroare la autentificare.");

  try {
    // Schimbăm codul pe un token de acces
    const tokenResponse = await axios.post('https://discord.com/api/oauth2/token', new URLSearchParams({
      client_id: process.env.DISCORD_CLIENT_ID,
      client_secret: process.env.DISCORD_CLIENT_SECRET,
      grant_type: 'authorization_code',
      code: code,
      redirect_uri: process.env.DISCORD_REDIRECT_URI,
    }), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });

    // Luăm datele reale ale profilului de Discord
    const userResponse = await axios.get('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${tokenResponse.data.access_token}` }
    });

    const discordUser = userResponse.data; // { id, username }

    // Redirecționăm jucătorul înapoi în joc cu ID-ul și numele salvat temporar
    res.redirect(`/?id=${discordUser.id}&username=${encodeURIComponent(discordUser.username)}`);
  } catch (error) {
    console.error(error);
    res.send("A apărut o eroare la conectarea cu Discord.");
  }
});

// 3. Salvare Scor și Verificare 3 Încercări
app.post('/api/salveaza-scor', async (req, res) => {
  const { discord_id, nume_discord, scorObtinut } = req.body;

  // Verificare date de la client
  if (!discord_id) {
    return res.status(400).json({ success: false, message: "Utilizator neautentificat!" });
  }

  const saptamana = getSaptamanaCurenta();

  try {
    // 1. Căutăm jucătorul în Baza de Date
    let { data: jucator, error: fetchError } = await supabase
      .from('jucatori')
      .select('*')
      .eq('discord_id', discord_id)
      .maybeSingle();

    if (fetchError) {
      console.error("Eroare la citire Supabase:", fetchError);
    }

    // 2. Dacă e prima dată când joacă SAU e o săptămână nouă -> Resetăm datele la 3 încercări
    if (!jucator || jucator.saptamana_curenta !== saptamana) {
      jucator = {
        discord_id: discord_id,
        nume_discord: nume_discord || 'Jucator Anonim',
        incercari_ramase: 3,
        scor_total: 0,
        saptamana_curenta: saptamana
      };
    }

    // 3. Verificăm dacă mai are încercări rămase
    if (jucator.incercari_ramase <= 0) {
      return res.json({
        success: false,
        message: "Ai epuizat cele 3 încercări pentru săptămâna aceasta!",
        scor_total: jucator.scor_total,
        incercari_ramase: 0
      });
    }

    // 4. Actualizăm datele (scădem 1 încercare și adăugăm scorul)
    const dateActualizate = {
      discord_id: jucator.discord_id,
      nume_discord: nume_discord || jucator.nume_discord,
      incercari_ramase: jucator.incercari_ramase - 1,
      scor_total: jucator.scor_total + (Number(scorObtinut) || 0),
      saptamana_curenta: saptamana
    };

    // 5. Salvăm în Supabase (UPSERT inserează dacă nu există, sau face UPDATE dacă există)
    const { data: savedData, error: saveError } = await supabase
      .from('jucatori')
      .upsert(dateActualizate, { onConflict: 'discord_id' })
      .select();

    if (saveError) {
      console.error("Eroare salvare Supabase:", saveError);
      return res.status(500).json({ success: false, message: "Eroare la salvarea în baza de date." });
    }

    // 6. Răspuns de succes trimis către frontend
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

app.listen(3000, () => console.log('Serverul rulează pe http://localhost:3000'));
