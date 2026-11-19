const {
  SlashCommandBuilder, ModalBuilder, TextInputBuilder, TextInputStyle,
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
} = require('discord.js');
const { db } = require('../database');
const {
  embed, requireStaff, configuredChannel, getSetting, safeDM, logAction,
} = require('../utils');

function modalRow(input) {
  return new ActionRowBuilder().addComponents(input);
}

function textInput(customId, label, required, maxLength = 500) {
  return new TextInputBuilder().setCustomId(customId).setLabel(label).setStyle(TextInputStyle.Short)
    .setRequired(required).setMaxLength(maxLength);
}

function reviewButtons(kind, id) {
  const prefix = kind === 'verificacion' ? 'verify' : 'application';
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`${prefix}-approve:${id}`).setLabel('Aprobar').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`${prefix}-reject:${id}`).setLabel('Rechazar').setStyle(ButtonStyle.Danger),
  );
}

async function submitRequest(interaction, kind, payload, channelKey, title, description) {
  const existing = db.prepare(`SELECT id FROM requests WHERE guild_id = ? AND user_id = ? AND kind = ? AND status IN ('pending', 'processing')`)
    .get(interaction.guildId, interaction.user.id, kind);
  if (existing) {
    await interaction.reply({ embeds: [embed('Solicitud pendiente', `Ya tienes una solicitud de ${description} pendiente de revisión.`)], ephemeral: true });
    return;
  }
  const channel = configuredChannel(interaction.guild, channelKey);
  if (!channel) {
    await interaction.reply({ embeds: [embed('Sistema sin configurar', `El Staff debe configurar el canal de ${description} con \`/configurar canales\`.`)], ephemeral: true });
    return;
  }
  let result;
  try {
    result = db.prepare('INSERT INTO requests (guild_id, user_id, kind, payload) VALUES (?, ?, ?, ?)')
      .run(interaction.guildId, interaction.user.id, kind, JSON.stringify(payload));
  } catch (error) {
    if (error.code !== 'SQLITE_CONSTRAINT_UNIQUE') throw error;
    await interaction.reply({ embeds: [embed('Solicitud pendiente', `Ya tienes una solicitud de ${description} pendiente de revisión.`)], ephemeral: true });
    return;
  }
  const id = Number(result.lastInsertRowid);
  const fields = Object.entries(payload).map(([name, value]) => ({ name, value: String(value || 'No proporcionado').slice(0, 1024), inline: false }));
  try {
    const message = await channel.send({
      embeds: [embed(title, `**Solicitud:** #${id}\n**Usuario:** ${interaction.user}\n\n${fields.map((field) => `**${field.name}:** ${field.value}`).join('\n')}`)],
      components: [reviewButtons(kind, id)],
      allowedMentions: { users: [interaction.user.id] },
    });
    db.prepare('UPDATE requests SET message_id = ? WHERE id = ?').run(message.id, id);
    await interaction.reply({ embeds: [embed('Solicitud enviada', `Tu solicitud quedó registrada para revisión en ${channel}.`)], ephemeral: true });
  } catch (error) {
    db.prepare('DELETE FROM requests WHERE id = ? AND status = ?').run(id, 'pending');
    throw error;
  }
}

const commands = [
  {
    data: new SlashCommandBuilder().setName('verificacion').setDescription('Envía tu solicitud para verificarte en el Media Team'),
    async execute(interaction) {
      const modal = new ModalBuilder().setCustomId('verify-modal').setTitle('Solicitud de verificación')
        .addComponents(
          modalRow(textInput('minecraft', 'Nick de Minecraft', true, 32)),
          modalRow(textInput('tiktok', 'TikTok (usuario o enlace)', false)),
          modalRow(textInput('youtube', 'YouTube (canal o enlace)', false)),
          modalRow(textInput('twitch', 'Twitch (usuario o enlace)', false)),
          modalRow(new TextInputBuilder().setCustomId('otras').setLabel('Otras redes sociales').setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(1000)),
        );
      await interaction.showModal(modal);
    },
  },
  {
    data: new SlashCommandBuilder().setName('evidencias').setDescription('Envía una evidencia al canal del Media Team')
      .addStringOption((option) => option.setName('plataforma').setDescription('Plataforma donde se publicó').setMaxLength(100).setRequired(true))
      .addStringOption((option) => option.setName('enlace').setDescription('Enlace público de la publicación').setMaxLength(1000).setRequired(true))
      .addStringOption((option) => option.setName('descripcion').setDescription('Descripción de la evidencia').setMaxLength(1000).setRequired(true))
      .addAttachmentOption((option) => option.setName('archivo').setDescription('Archivo o captura opcional')),
    async execute(interaction) {
      const channel = configuredChannel(interaction.guild, 'evidencias');
      if (!channel) {
        await interaction.reply({ embeds: [embed('Canal sin configurar', 'El Staff debe configurar el canal con `/configurar canales`.')], ephemeral: true });
        return;
      }
      const link = interaction.options.getString('enlace');
      let parsedUrl;
      try {
        parsedUrl = new URL(link);
      } catch {
        await interaction.reply({ embeds: [embed('Enlace no válido', 'Proporciona un enlace completo que comience con https:// o http://.')], ephemeral: true });
        return;
      }
      if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
        await interaction.reply({ embeds: [embed('Enlace no válido', 'Solo se aceptan enlaces http:// o https://.')], ephemeral: true });
        return;
      }
      const attachment = interaction.options.getAttachment('archivo');
      const evidence = embed('Nueva evidencia', `**Miembro:** ${interaction.user}\n**Plataforma:** ${interaction.options.getString('plataforma')}\n**Enlace:** [Abrir publicación](${parsedUrl.toString()})\n**Descripción:** ${interaction.options.getString('descripcion')}`);
      if (attachment?.contentType?.startsWith('image/')) evidence.setImage(attachment.url);
      if (attachment && !attachment.contentType?.startsWith('image/')) evidence.addFields({ name: 'Archivo adjunto', value: `[Descargar archivo](${attachment.url})` });
      await channel.send({ embeds: [evidence], allowedMentions: { users: [interaction.user.id] } });
      logAction(interaction.guildId, interaction.user.id, 'enviar_evidencia', null, interaction.options.getString('plataforma'));
      await interaction.reply({ embeds: [embed('Evidencia enviada', `Tu evidencia se publicó en ${channel}.`)], ephemeral: true });
    },
  },
  {
    data: new SlashCommandBuilder().setName('postular').setDescription('Envía una postulación al Media Team'),
    async execute(interaction) {
      const modal = new ModalBuilder().setCustomId('application-modal').setTitle('Postulación al Media Team')
        .addComponents(
          modalRow(new TextInputBuilder().setCustomId('experience').setLabel('Experiencia creando contenido').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(1000)),
          modalRow(new TextInputBuilder().setCustomId('networks').setLabel('Enlaces a tus redes').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(1000)),
          modalRow(new TextInputBuilder().setCustomId('motivation').setLabel('¿Por qué quieres unirte?').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(1000)),
        );
      await interaction.showModal(modal);
    },
  },
];

const modals = {
  'verify-modal': async (interaction) => submitRequest(interaction, 'verificacion', {
    'Nick de Minecraft': interaction.fields.getTextInputValue('minecraft'),
    TikTok: interaction.fields.getTextInputValue('tiktok'),
    YouTube: interaction.fields.getTextInputValue('youtube'),
    Twitch: interaction.fields.getTextInputValue('twitch'),
    'Otras redes': interaction.fields.getTextInputValue('otras'),
  }, 'head_chat', 'Solicitud de verificación', 'verificación'),
  'application-modal': async (interaction) => submitRequest(interaction, 'postulacion', {
    Experiencia: interaction.fields.getTextInputValue('experience'),
    Redes: interaction.fields.getTextInputValue('networks'),
    Motivación: interaction.fields.getTextInputValue('motivation'),
  }, 'applications_channel', 'Nueva postulación', 'postulación'),
};

async function reviewRequest(interaction, kind, approved) {
  if (!await requireStaff(interaction)) return;
  const id = Number(interaction.customId.split(':')[1]);
  const request = db.prepare('SELECT * FROM requests WHERE id = ? AND guild_id = ? AND kind = ?').get(id, interaction.guildId, kind);
  if (!request || request.status !== 'pending') {
    await interaction.reply({ embeds: [embed('Solicitud ya procesada', 'Esta solicitud no existe o ya fue revisada.')], ephemeral: true });
    return;
  }
  let verifiedMember = null;
  let verifiedRoleId = null;
  if (approved && kind === 'verificacion') {
    verifiedRoleId = getSetting(interaction.guildId, 'verified_role');
    if (!verifiedRoleId || !interaction.guild.roles.cache.has(verifiedRoleId)) {
      await interaction.reply({ embeds: [embed('Rol sin configurar', 'Configura un rol de verificado válido con `/configurar roles` antes de aprobar solicitudes.')], ephemeral: true });
      return;
    }
    verifiedMember = await interaction.guild.members.fetch(request.user_id);
  }
  const user = await interaction.client.users.fetch(request.user_id);
  const result = db.prepare(`UPDATE requests SET status = ?, reviewer_id = ?, reviewed_at = CURRENT_TIMESTAMP
    WHERE id = ? AND status = 'pending'`).run(approved ? 'processing' : 'rejected', interaction.user.id, id);
  if (!result.changes) {
    await interaction.reply({ embeds: [embed('Solicitud ya procesada', 'Otro miembro del Staff ya revisó esta solicitud.')], ephemeral: true });
    return;
  }
  if (approved && kind === 'verificacion') {
    try {
      await verifiedMember.roles.add(verifiedRoleId, 'Verificación aprobada');
      db.prepare(`UPDATE requests SET status = 'approved', reviewed_at = CURRENT_TIMESTAMP WHERE id = ?`).run(id);
    } catch (error) {
      db.prepare(`UPDATE requests SET status = 'pending', reviewer_id = NULL, reviewed_at = NULL WHERE id = ? AND status = 'processing'`).run(id);
      throw error;
    }
  }
  if (approved && kind === 'postulacion') {
    db.prepare(`UPDATE requests SET status = 'approved', reviewed_at = CURRENT_TIMESTAMP WHERE id = ?`).run(id);
  }
  logAction(interaction.guildId, interaction.user.id, `${kind}_${approved ? 'aprobada' : 'rechazada'}`, request.user_id, `Solicitud #${id}`);
  const statusEmbed = embed(approved ? 'Solicitud aprobada' : 'Solicitud rechazada', `Solicitud **#${id}** · <@${request.user_id}>\nRevisada por ${interaction.user}.`);
  await interaction.update({ embeds: [statusEmbed], components: [] });
  await safeDM(user, `Tu solicitud de **${kind === 'verificacion' ? 'verificación' : 'postulación'}** en **${interaction.guild.name}** fue **${approved ? 'aprobada' : 'rechazada'}** por ${interaction.user.tag}.`);
}

const buttons = {
  'verify-approve': (interaction) => reviewRequest(interaction, 'verificacion', true),
  'verify-reject': (interaction) => reviewRequest(interaction, 'verificacion', false),
  'application-approve': (interaction) => reviewRequest(interaction, 'postulacion', true),
  'application-reject': (interaction) => reviewRequest(interaction, 'postulacion', false),
};

module.exports = { commands, modals, buttons };
