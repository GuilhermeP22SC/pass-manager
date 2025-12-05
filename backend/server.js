const express = require('express');
const nodemailer = require('nodemailer');
const cors = require('cors');
const bodyParser = require('body-parser');

const app = express();
app.use(cors()); // Permite que a extensão chame este servidor
app.use(bodyParser.json());

// SUAS CREDENCIAIS (Idealmente, use variáveis de ambiente)
const EMAIL_USER = 'luisguilhermep16@gmail.com';
const EMAIL_PASS = 'qzqn ovsx ynnf ggkn'; 

// Armazenamento temporário de códigos (Em memória)
// Formato: email -> { code, expiresAt }
const verificationCodes = new Map();

// Configuração do Nodemailer
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: EMAIL_USER,
    pass: EMAIL_PASS
  }
});

// Rota 1: Enviar Código
app.post('/send-code', async (req, res) => {
  const { email } = req.body;
  
  if (!email) return res.status(400).json({ error: 'Email obrigatório' });

  // Gera código de 6 dígitos
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  
  // Define expiração (10 minutos a partir de agora)
  const expiresAt = Date.now() + (10 * 60 * 1000);

  // Salva no mapa
  verificationCodes.set(email, { code, expiresAt });

  const mailOptions = {
    from: EMAIL_USER,
    to: email,
    subject: 'Seu Código de Verificação - Gerenciador de Senhas',
    text: `Seu código de verificação é: ${code}\n\nEste código expira em 10 minutos.`
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log(`Código enviado para ${email}: ${code}`); // Log para debug
    res.json({ success: true, message: 'Código enviado!' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao enviar e-mail' });
  }
});

// Rota 2: Verificar Código
app.post('/verify-code', (req, res) => {
  const { email, code } = req.body;
  
  if (!verificationCodes.has(email)) {
    return res.status(400).json({ valid: false, message: 'Nenhum código solicitado para este email.' });
  }

  const data = verificationCodes.get(email);

  // Verifica expiração
  if (Date.now() > data.expiresAt) {
    verificationCodes.delete(email);
    return res.status(400).json({ valid: false, message: 'Código expirado. Solicite outro.' });
  }

  // Verifica validade
  if (data.code === code) {
    verificationCodes.delete(email); // Limpa após uso (opcional)
    return res.json({ valid: true, message: 'Email verificado com sucesso!' });
  } else {
    return res.status(400).json({ valid: false, message: 'Código incorreto.' });
  }
});

app.listen(3000, () => {
  console.log('Servidor de email rodando na porta 3000');
});