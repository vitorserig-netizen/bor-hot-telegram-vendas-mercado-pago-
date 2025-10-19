const TelegramBot = require('node-telegram-bot-api');
const mercadopago = require('mercadopago');
const { TELEGRAM_TOKEN, PLANOS, MERCADO_PAGO, GRUPO_ID } = require('./config');

// Configurar Mercado Pago
mercadopago.configure({
  access_token: MERCADO_PAGO.ACCESS_TOKEN
});

const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

// Banco de dados simples
const assinaturas = new Map();

// ==================== SISTEMA DE ASSINATURAS ====================

// Adicionar usuário ao grupo automaticamente
async function adicionarAoGrupo(chatId, plano) {
  try {
    console.log(`🔄 Tentando adicionar usuário ${chatId} ao grupo ${GRUPO_ID}...`);
    
    // Adicionar usuário ao grupo via ID
    if (GRUPO_ID) {
      try {
        // Tentar adicionar automaticamente
        await bot.addChatMembers(GRUPO_ID, [chatId]);
        console.log(`✅ Usuário ${chatId} adicionado ao grupo com sucesso!`);
        
        // Mensagem de confirmação
        await bot.sendMessage(
          chatId,
          `🎉 *PAGAMENTO CONFIRMADO! ACESSO LIBERADO!* 🎸\n\n*Parabéns! Você foi adicionado automaticamente ao grupo VIP!*\n\n*Plano: ${plano.nome}*\n⏰ *Expira em: ${plano.dias} dias*\n\n✨ *Aproveite o conteúdo exclusivo!*`,
          { parse_mode: 'Markdown' }
        );
        
      } catch (error) {
        console.log('❌ Erro ao adicionar usuário ao grupo:', error.message);
        
        // Criar link de convite que expira em 2 minutos
        try {
          const inviteLink = await bot.createChatInviteLink(GRUPO_ID, {
            member_limit: 1, // Apenas 1 uso
            expire_date: Math.floor(Date.now() / 1000) + 120, // Expira em 2 minutos (120 segundos)
            creates_join_request: false
          });
          
          const teclado = {
            inline_keyboard: [
              [{ text: "🎸 ENTRAR NO GRUPO VIP (⏰2min)", url: inviteLink.invite_link }]
            ]
          };
          
          await bot.sendMessage(
            chatId,
            `🎉 *PAGAMENTO CONFIRMADO!* 🎸\n\n*Plano: ${plano.nome}*\n⏰ *Expira em: ${plano.dias} dias*\n\n⚠️ *LINK VÁLIDO POR APENAS 2 MINUTOS!*\n\n*Clique no botão abaixo para entrar no grupo VIP:*`,
            { 
              parse_mode: 'Markdown',
              reply_markup: teclado 
            }
          );
          
          console.log(`✅ Link de convite (2min) enviado para ${chatId}`);
          
          // Agendar revogação do link após 2 minutos (redundância)
          setTimeout(async () => {
            try {
              await bot.revokeChatInviteLink(GRUPO_ID, inviteLink.invite_link);
              console.log(`🔒 Link revogado para ${chatId}`);
            } catch (revokeError) {
              console.log('Erro ao revogar link:', revokeError.message);
            }
          }, 2 * 60 * 1000); // 2 minutos
          
        } catch (linkError) {
          console.log('❌ Erro ao criar link de convite:', linkError.message);
          
          await bot.sendMessage(
            chatId,
            `🎉 *PAGAMENTO CONFIRMADO!* 🎸\n\n*Plano: ${plano.nome}*\n⏰ *Expira em: ${plano.dias} dias*\n\n❌ *Entre em contato com o suporte para receber acesso ao grupo.*`,
            { parse_mode: 'Markdown' }
          );
        }
      }
    }
    
    // Registrar assinatura
    const expiracao = new Date();
    expiracao.setDate(expiracao.getDate() + plano.dias);
    
    assinaturas.set(chatId, {
      plano: plano.nome,
      expiracao: expiracao,
      ativa: true
    });
    
    // Agendar remoção automática
    agendarRemocao(chatId, expiracao);
    
  } catch (error) {
    console.error('Erro ao processar adição ao grupo:', error);
  }
}

// Remover usuário do grupo quando expirar
async function removerDoGrupo(chatId) {
  try {
    if (GRUPO_ID) {
      try {
        await bot.banChatMember(GRUPO_ID, chatId);
        console.log(`❌ Usuário ${chatId} removido do grupo (assinatura expirada)`);
      } catch (error) {
        console.log('Erro ao remover do grupo:', error.message);
      }
    }
    
    // Atualizar status da assinatura
    if (assinaturas.has(chatId)) {
      assinaturas.get(chatId).ativa = false;
    }
    
    // Notificar usuário
    await bot.sendMessage(
      chatId,
      `❌ *SUA ASSINATURA EXPIROU!*\n\nSeu acesso ao grupo VIP foi encerrado.\n\nPara continuar tendo acesso, renove sua assinatura! 🔥`,
      { parse_mode: 'Markdown' }
    );
    
  } catch (error) {
    console.error('Erro ao remover do grupo:', error);
  }
}

// Agendar remoção automática
function agendarRemocao(chatId, expiracao) {
  const agora = new Date();
  const tempoRestante = expiracao - agora;
  
  if (tempoRestante > 0) {
    setTimeout(() => {
      removerDoGrupo(chatId);
    }, tempoRestante);
    
    console.log(`⏰ Remoção agendada para ${chatId} em ${Math.round(tempoRestante/1000/60/60)} horas`);
  }
}

// Verificar assinatura do usuário
function verificarAssinatura(chatId) {
  if (assinaturas.has(chatId)) {
    const assinatura = assinaturas.get(chatId);
    if (assinatura.ativa && new Date() < assinatura.expiracao) {
      return assinatura;
    }
  }
  return null;
}

// ==================== GERAR PIX COM MERCADO PAGO ====================

async function gerarPixMercadoPago(valor, descricao, chatId) {
  try {
    console.log(`💰 Gerando PIX de R$ ${valor} para ${chatId}`);
    
    const paymentData = {
      transaction_amount: valor,
      description: descricao,
      payment_method_id: 'pix',
      payer: {
        email: `${chatId}@telegram.com`,
        first_name: `Cliente_${chatId}`
      }
    };

    console.log('📦 Dados do pagamento:', paymentData);
    
    const payment = await mercadopago.payment.create(paymentData);
    console.log('✅ Resposta do Mercado Pago:', payment.body);
    
    if (payment.body && payment.body.point_of_interaction) {
      const pixData = payment.body.point_of_interaction.transaction_data;
      
      return {
        success: true,
        qr_code: pixData.qr_code_base64,
        qr_code_text: pixData.qr_code,
        transaction_id: payment.body.id,
        expiration_date: new Date(Date.now() + 30*60000)
      };
    } else {
      throw new Error('Dados PIX não gerados');
    }
    
  } catch (error) {
    console.error('❌ Erro ao gerar PIX:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

// ==================== BOT ====================

bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  
  // Verificar se já tem assinatura ativa
  const assinatura = verificarAssinatura(chatId);
  if (assinatura) {
    const diasRestantes = Math.ceil((assinatura.expiracao - new Date()) / (1000 * 60 * 60 * 24));
    
    return bot.sendMessage(
      chatId,
      `✅ *ASSINATURA ATIVA!*\n\n*Plano:* ${assinatura.plano}\n*Dias restantes:* ${diasRestantes}\n\nVocê já tem acesso ao grupo VIP! 🎸`,
      { parse_mode: 'Markdown' }
    );
  }
  
  const teclado = {
    reply_markup: {
      inline_keyboard: [
        [{ text: "🔥 VER PLANOS", callback_data: "ver_planos" }]
      ]
    }
  };

  bot.sendMessage(
    chatId,
    `🔥 *Oi amor, sei que cê tá doido querendo ver eu tocando uma guitarra!* 🎸\n\n*Experimente nosso plano de teste por apenas R$ 19,90!*\n\n*Escolha um dos planos abaixo:*`,
    { 
      parse_mode: 'Markdown',
      ...teclado
    }
  );
});

// Mostrar planos
function verPlanos(chatId) {
  const teclado = {
    inline_keyboard: [
      [{ text: "🔥 7 DIAS - R$ 19,90", callback_data: "plano_teste" }],
      [{ text: "🔥 15 DIAS - R$ 29,99", callback_data: "plano_15dias" }],
      [{ text: "🔥 VIP MENSAL - R$ 40,00", callback_data: "plano_mensal" }],
      [{ text: "🔥 6 MESES - R$ 150,00", callback_data: "plano_6meses" }]
    ]
  };

  bot.sendMessage(
    chatId,
    `🎸 *PLANOS DISPONÍVEIS* 🔥\n\n*💎 PLANO TESTE: 7 dias por apenas R$ 19,90*\n*Perfeito para conhecer nosso conteúdo!*\n\n*Escolha o seu plano:*`,
    { 
      parse_mode: 'Markdown',
      reply_markup: teclado 
    }
  );
}

// Processar plano selecionado
async function processarPlano(chatId, planoId) {
  console.log(`📝 Processando plano ${planoId} para usuário ${chatId}`);
  
  const plano = PLANOS[planoId];
  
  if (!plano) {
    console.log(`❌ Plano ${planoId} não encontrado`);
    return bot.sendMessage(chatId, '❌ Plano não encontrado. Tente novamente.');
  }
  
  console.log(`✅ Plano encontrado: ${plano.nome}`);

  const mensagemProcessando = await bot.sendMessage(
    chatId,
    `⏳ *Gerando PIX para ${plano.nome}...*`,
    { parse_mode: 'Markdown' }
  );

  try {
    const pixResult = await gerarPixMercadoPago(
      plano.precoNumero, 
      plano.nome,
      chatId
    );

    if (!pixResult.success) {
      throw new Error(pixResult.error);
    }

    const expiracao = pixResult.expiration_date;
    const expiracaoFormatada = expiracao.toLocaleTimeString('pt-BR', { 
      hour: '2-digit', 
      minute: '2-digit' 
    });

    console.log(`✅ PIX gerado com sucesso para ${plano.nome}`);

    // Criar mensagem com QR Code e código PIX juntos
    let mensagemCompleta = `💎 *PLANO: ${plano.nome}*
💵 *Valor: ${plano.preco}*
⏰ *Duração: ${plano.dias} dias*
⏰ *PIX válido até: ${expiracaoFormatada}*`;

    // Se tem QR code, enviar como foto com caption
    if (pixResult.qr_code) {
      try {
        const qrCodeBuffer = Buffer.from(pixResult.qr_code, 'base64');
        
        // Mensagem que vai na caption da foto
        const caption = `${mensagemCompleta}\n\n📱 *ESCANEIE O QR CODE ACIMA*\n\n*Ou copie o código PIX abaixo:*\n\n\`\`\`\n${pixResult.qr_code_text}\n\`\`\`\n\n*Como pagar:*\n1. Abra seu app do banco\n2. Cole o código acima no PIX\n3. Confirme o pagamento\n\n✅ *Você será adicionado automaticamente ao grupo VIP após a confirmação!*`;
        
        await bot.sendPhoto(chatId, qrCodeBuffer, {
          caption: caption,
          parse_mode: 'Markdown'
        });
        
        // Deletar mensagem de processamento
        bot.deleteMessage(chatId, mensagemProcessando.message_id);
        
        // Iniciar verificação automática
        iniciarVerificacaoPagamento(chatId, pixResult.transaction_id, plano);
        return;
        
      } catch (photoError) {
        console.log('❌ Não foi possível enviar QR Code como imagem:', photoError.message);
      }
    }

    // Fallback: enviar apenas texto se não conseguir enviar QR code
    mensagemCompleta += `\n\n📋 *COPIAR CÓDIGO PIX:*\n\n\`\`\`\n${pixResult.qr_code_text}\n\`\`\`\n\n*Como pagar:*\n1. Abra seu app do banco\n2. Cole o código acima no PIX\n3. Confirme o pagamento\n\n✅ *Você será adicionado automaticamente ao grupo VIP após a confirmação!*`;

    const teclado = {
      inline_keyboard: [
        [{ text: "✅ JÁ PAGUEI", callback_data: `ja_paguei_${pixResult.transaction_id}_${planoId}` }],
        [{ text: "🔄 VERIFICAR PAGAMENTO", callback_data: `verificar_${pixResult.transaction_id}` }],
        [{ text: "🔥 VOLTAR AOS PLANOS", callback_data: "ver_planos" }]
      ]
    };

    await bot.editMessageText(mensagemCompleta, {
      chat_id: chatId,
      message_id: mensagemProcessando.message_id,
      parse_mode: 'Markdown',
      reply_markup: teclado
    });

    iniciarVerificacaoPagamento(chatId, pixResult.transaction_id, plano);

  } catch (error) {
    console.error('❌ Erro no processamento:', error);
    
    await bot.editMessageText(
      `❌ *Erro ao gerar PIX*\n\n${error.message}\n\nTente novamente.`,
      {
        chat_id: chatId,
        message_id: mensagemProcessando.message_id,
        parse_mode: 'Markdown'
      }
    );
  }
}

// Verificar status do pagamento
async function verificarPagamento(transactionId) {
  try {
    const payment = await mercadopago.payment.get(transactionId);
    return payment.body.status;
  } catch (error) {
    console.error('❌ Erro ao verificar pagamento:', error);
    return 'error';
  }
}

// Verificação automática do pagamento
function iniciarVerificacaoPagamento(chatId, transactionId, plano) {
  console.log(`🔍 Iniciando verificação automática para ${chatId} - Transação: ${transactionId}`);
  
  const interval = setInterval(async () => {
    try {
      const status = await verificarPagamento(transactionId);
      console.log(`📊 Status do pagamento ${transactionId}: ${status}`);
      
      if (status === 'approved') {
        clearInterval(interval);
        console.log(`✅ Pagamento aprovado para ${chatId}`);
        
        // Adicionar usuário ao grupo automaticamente
        await adicionarAoGrupo(chatId, plano);
        
      } else if (status === 'cancelled' || status === 'rejected') {
        clearInterval(interval);
        console.log(`❌ Pagamento recusado para ${chatId}`);
        await bot.sendMessage(chatId, `❌ *Pagamento não aprovado.*\n\nTente novamente.`, { parse_mode: 'Markdown' });
      }
      
      // Parar verificação após 30 minutos
      setTimeout(() => {
        clearInterval(interval);
        console.log(`⏹️ Parando verificação para ${chatId} (timeout)`);
      }, 30 * 60 * 1000);
      
    } catch (error) {
      console.error('❌ Erro na verificação:', error);
      clearInterval(interval);
    }
  }, 10000); // Verificar a cada 10 segundos
}

// Já pagou (botão manual)
function jaPaguei(chatId, transactionId, planoId) {
  const plano = PLANOS[planoId];
  const teclado = {
    inline_keyboard: [
      [{ text: "🔄 VERIFICAR PAGAMENTO", callback_data: `verificar_${transactionId}` }],
      [{ text: "🔥 VOLTAR AOS PLANOS", callback_data: "ver_planos" }]
    ]
  };

  bot.sendMessage(
    chatId,
    `✅ *PAGAMENTO REGISTRADO!*\n\nObrigada pelo pagamento! 🎸\n\n*Plano: ${plano.nome}*\n*Estou verificando a confirmação...*\n\n⏱️ *Você será adicionado automaticamente ao grupo VIP em instantes!*`,
    { 
      parse_mode: 'Markdown',
      reply_markup: teclado 
    }
  );
}

// ==================== HANDLER DE CALLBACKS ====================

bot.on('callback_query', (callbackQuery) => {
  const msg = callbackQuery.message;
  const data = callbackQuery.data;
  const chatId = msg.chat.id;

  console.log(`🔘 Callback recebido: ${data} de ${chatId}`);

  try {
    switch (data) {
      case 'ver_planos':
        verPlanos(chatId);
        break;
      case 'plano_teste':
        processarPlano(chatId, 'plano_teste');
        break;
      case 'plano_15dias':
        processarPlano(chatId, 'plano1');
        break;
      case 'plano_mensal':
        processarPlano(chatId, 'plano2');
        break;
      case 'plano_6meses':
        processarPlano(chatId, 'plano3');
        break;
      default:
        if (data.startsWith('ja_paguei_')) {
          const parts = data.split('_');
          const transactionId = parts[2];
          const planoId = parts[3];
          jaPaguei(chatId, transactionId, planoId);
        } else if (data.startsWith('verificar_')) {
          const transactionId = data.split('_')[1];
          bot.sendMessage(chatId, `🔄 *Verificando pagamento...*`, { parse_mode: 'Markdown' });
        }
    }
  } catch (error) {
    console.error('❌ Erro no callback:', error);
    bot.sendMessage(chatId, '❌ Ocorreu um erro. Tente novamente.');
  }

  bot.answerCallbackQuery(callbackQuery.id);
});

// Mensagem de boas-vindas
bot.on('message', (msg) => {
  if (msg.text && !msg.text.startsWith('/')) {
    const teclado = {
      reply_markup: {
        inline_keyboard: [
          [{ text: "🔥 VER PLANOS", callback_data: "ver_planos" }]
        ]
      }
    };

    bot.sendMessage(
      msg.chat.id,
      `🎸 *Oi amor! Quer ver eu tocando guitarra?* 🔥\n\n*Experimente nosso plano de teste por apenas R$ 19,90!*\n\n*Clique em VER PLANOS abaixo:*`,
      { 
        parse_mode: 'Markdown',
        ...teclado
      }
    );
  }
});

console.log('🔥 Bot de Planos com PIX iniciado!');
console.log('💳 Mercado Pago integrado');
console.log('👥 Sistema de adição ao grupo ativo');
console.log('⏰ Links expiram em 2 minutos');
console.log('📊 Grupo ID:', GRUPO_ID);
console.log('🎯 NOVO: Plano de 7 dias por R$ 19,90 adicionado!');
console.log('🤖 @gotthgirlfriend_bot');